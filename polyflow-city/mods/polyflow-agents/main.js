// PolyFlow City Agents card: draws agents() as job portrait cards, as a tree (helpers started with hc run --parent sit
// indented under their parent); session name and model come from the optional statusLine cache.
// StatusLine cache plus shared energy data; the standalone tree follows metadata when no office reader is alive.
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, appHome, readTextFile, run, setAgentOrder, setShared, shared, spaces, terminals, theme, watchFolder } from "herdr";
import { activityText, agentTree, crewOf, parentsOf, subagentParents, subagentRecords } from "./activity.js";
import { followActivity } from "./activity-reader.js";
import { followSharedSubagents } from "./subagents-follow.js";
import { META_KEY, detailsLine, metaOfAgent } from "./energy.js";
import { CALM_KEY } from "./energy-pill.js";
import { renderEnergyPill } from "./energy-pill-ui.js";
import { followSharedMeta } from "./meta-follow.js";
import { startMeterFlush } from "./cost-meter.js";
import { createMeter } from "./cost-model.js";
import { JOBS_MEMORY_KEY, appLabel, assignJobs, cachePath, jobIn, rememberJobs, modelText, parseCache, portraitPath, remoteCachePath, spritePath, tabNames, tabRefs } from "./lib.js";

const HOME = appHome();
const SESSIONS_DIR = `${HOME}/data/polyflow-city/sessions`;
const JOBS_FILE = `${HOME}/mods/polyflow-agents/jobs.json`;
// Compact cards: full-body sprites (36x48 pixels) at 1.5x, helpers a step smaller.
const SIZES = [{ w: 54, h: 72 }, { w: 42, h: 56 }];
const INDENT = 16; // per tree level
const STATUS = { working: "Working", blocked: "Needs you", done: "Done", idle: "Idle" };

// Portrait: draw the portrait if a job is assigned; otherwise fall back to the program icon (svg for monochrome, image for pictures); if neither exists, leave blank.
function portrait(a, assigned, t, depth) {
  const { w, h } = SIZES[Math.min(depth, SIZES.length - 1)];
  const job = jobIn(a.tab_name, assigned);
  const sprite = spritePath(job, a.status);
  if (sprite) return image(sprite).w(w).h(h).flex_none();
  const src = portraitPath(job);
  if (src) return image(src).w(w).h(w).flex_none();
  const p = a.program;
  if (!p?.icon) return div().w(w).h(w).flex_none();
  return p.tint
    ? svg(p.icon).size(w).flex_none().text_color(t.foreground)
    : image(p.icon).w(w).h(w).flex_none();
}

// Tag row: a small framed label, then "model · effort" when known.
function tag(label, model, t) {
  const color = label.builder ? t.unknown : t.accent;
  return h_flex()
    .w_full()
    .min_w(0)
    .h(16)
    .gap(6)
    .items_center()
    .child(
      div()
        .flex_none()
        .px(5)
        .border(1)
        .border_color(color)
        .text_size(10)
        .text_color(color)
        .child(label.text),
    )
    .when(model !== null, (el) => el.child(modelLine(model, t)));
}

function modelLine(model, t) {
  return div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(model);
}

export default class PolyflowAgents extends View {
  init(_props, cx) {
    this.jobs = {};
    this.cache = {};
    this.remote = {};
    this.tick = 0;
    this.seen = new Set();
    this.watching = false;
    this.loadJobs(cx);
    this.load(cx);
    this.loadRemote(cx);
    this.watch(cx);
    // What each agent is doing now, from the PolyFlow Office activity hook (null until it runs).
    // What the tree's readers cost, counted for metrics.json (cost-model.js).
    this.cost = createMeter();
    startMeterFlush(cx, "tree", this.cost);
    followActivity(this, cx);
    // Claude Code's internal subagents (its Agent tool), listed under their agent.
    followSharedSubagents(this, cx, () => true, "tree");
    followSharedMeta(this, cx, () => true, "tree");
    this.syncCrew(cx);
    cx.timer.every(1000, (cx) => this.syncCrew(cx));
    // The data is numeric, so refreshing at most every 30 seconds is enough; this also lets the stale marker appear by itself and retries the watch.
    cx.timer.every(30000, (cx) => {
      this.load(cx);
      this.watch(cx);
      // Remote is read every 60 seconds, same as the statusLine update interval; remote folders cannot be watched.
      if (++this.tick % 2 === 0) this.loadRemote(cx);
    });
  }

  // Cache reads, remembered jobs and host ordering belong to lifecycle callbacks, never render.
  syncCrew(cx) {
    const crew = crewOf(agents(), terminals(), this.subagents);
    const tree = agentTree(crew, { ...parentsOf(terminals()), ...subagentParents(crew) });
    const list = tree.map((x) => x.agent);
    const kept = shared(JOBS_MEMORY_KEY) ?? {};
    const tabs = tabRefs(spaces(), list);
    const assigned = assignJobs(tabNames(spaces(), list), this.jobs, kept, tabs);
    const memory = rememberJobs(assigned, kept, tabs);
    if (memory) setShared(JOBS_MEMORY_KEY, memory);
    const order = list.map((a) => a.address);
    if (JSON.stringify(order) !== this.agentOrder) {
      this.agentOrder = JSON.stringify(order);
      setAgentOrder(order);
    }
    const fresh = list.filter((a) => !this.seen.has(a.address));
    if (fresh.some((a) => cachePath(HOME, a.address) !== null)) this.load(cx);
    if (fresh.some((a) => remoteCachePath(a.address) !== null)) this.loadRemote(cx);
    for (const a of fresh) this.seen.add(a.address);
  }

  // Watch the cache folder and reread on change. If the folder is missing or not allowed, end the loop
  // and let the timer above retry every 30 seconds, so it never becomes a tight loop.
  watch(cx) {
    if (this.watching) return;
    this.watching = true;
    cx.spawn(async (cx) => {
      let quick = 0;
      for (;;) {
        let changed;
        const started = Date.now();
        try {
          changed = await watchFolder(SESSIONS_DIR);
        } catch {
          break;
        }
        // If it returns immediately with no change, the watch is not really working; do not let it spin either.
        quick = Date.now() - started < 500 && (changed ?? []).length === 0 ? quick + 1 : 0;
        if (quick >= 3) break;
        this.load(cx);
      }
      this.watching = false;
    });
  }

  loadJobs(cx) {
    cx.spawn(async (cx) => {
      const text = await readTextFile(JOBS_FILE).catch(() => null);
      let jobs = {};
      try {
        const parsed = JSON.parse(text);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) jobs = parsed;
      } catch {
        jobs = {};
      }
      this.jobs = jobs;
      cx.notify();
    });
  }

  // Each local agent reads its own cache; remote ones are read by loadRemote.
  load(cx) {
    const wanted = [];
    for (const a of agents()) {
      const path = cachePath(HOME, a.address);
      if (path === null) continue;
      this.seen.add(a.address);
      wanted.push({ address: a.address, path });
    }
    cx.spawn(async (cx) => {
      const next = {};
      for (const w of wanted) {
        const text = await readTextFile(w.path).catch(() => null);
        next[w.address] = parseCache(text);
      }
      this.cache = next;
      cx.notify();
    });
  }

  // A remote agent reads the cache file on its machine (over Herdr's existing connection, no command executed); if unreachable it is null and the view shows "—".
  loadRemote(cx) {
    const wanted = [];
    for (const a of agents()) {
      const r = remoteCachePath(a.address);
      if (r === null) continue;
      this.seen.add(a.address);
      wanted.push({ address: a.address, ...r });
    }
    if (wanted.length === 0) return;
    cx.spawn(async (cx) => {
      const next = {};
      for (const w of wanted) {
        const text = await readTextFile(w.path, { on: w.on }).catch(() => null);
        next[w.address] = parseCache(text);
      }
      this.remote = next;
      cx.notify();
    });
  }

  card(a, depth, now, t, assigned) {
    const cache = this.cache[a.address] ?? this.remote[a.address] ?? null;
    // blocked is visible at a glance: border and status text use t.blocked, overriding the focused t.accent.
    // Focus is a left accent bar plus a tint, not a full border: the full accent frame belongs to the focused terminal.
    const frame = a.status === "blocked" ? t.blocked : t.border;
    const statusColor = a.status === "blocked" ? t.blocked : t[a.status] ?? t.dim;
    const label = appLabel(a.app);
    const model = modelText(cache?.model, cache?.effort);
    const doing = activityText(a.status, (a.internal ? subagentRecords(this.subagents)[a.address] : this.activity?.[a.address]) ?? null, now);
    const snapshot = shared(META_KEY);
    const meta = metaOfAgent(a.address, snapshot?.agents, this.subagents);
    const card = h_flex()
      .id(`polyflow-${a.address}`)
      .relative()
      .min_w(0)
      .px(6)
      .py(4)
      .gap(8)
      .items_center()
      .bg(a.focused ? `${t.accent}1f` : `${t.surface}f2`)
      .border(1)
      .border_color(frame)
      .when(a.focused, (el) => el.child(div().absolute().left(0).top(0).bottom(0).w(3).bg(a.status === "blocked" ? t.blocked : t.accent)))
      .cursor_pointer()
      .hover((s) => s.bg(`${t.raised}f8`))
      // An internal subagent has no terminal: its agent's. The office chat follows the pick, the subagent itself included
      // (the same record as the office's selectChatTarget, so a pick of a subagent is also let go here).
      .on_click(() => {
        setShared("polyflow-office.chat-target", { address: a.address, parent: a.internal ? a.parent : null, at: Date.now() });
        run("agent.focus", { terminal: a.internal ? a.parent : a.address });
      })
      .child(portrait(a, assigned, t, depth))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(4)
          .child(
            h_flex()
              .w_full()
              .min_w(0)
              .gap(8)
              .items_center()
              .child(div().flex_1().min_w(0).truncate().font_semibold().tooltip(detailsLine(meta)).child(a.tab_name || a.address))
              .child(renderEnergyPill(meta, t, { id: `ctx-${a.address}`, compact: true, stale: snapshot?.stale === true, calm: shared(CALM_KEY) === true }))
              .child(div().flex_none().text_size(11).text_color(statusColor).child(STATUS[a.status] ?? a.status)),
          )
          // Session name (set with /rename) under the tab name; takes no row when unset.
          .when(Boolean(cache?.name), (el) =>
            el.child(div().w_full().min_w(0).truncate().text_size(11).text_color(t.dim).child(cache.name)),
          )
          // Program tag: gold for Claude, purple for builders (orange means blocked).
          // Claude: model on the tag row. Builders: model on its own row, so long names fit.
          .when(Boolean(label), (el) => el.child(tag(label, label.builder ? null : model, t)))
          .when(Boolean(label?.builder) && model !== null, (el) => el.child(h_flex().w_full().min_w(0).child(modelLine(model, t))))
          // Activity line: what the agent is doing right now ("reading main.rs"), from the hook.
          .when(Boolean(doing), (el) =>
            el.child(div().w_full().min_w(0).truncate().text_size(11).text_color(a.status === "blocked" ? t.blocked : t.working).child(doing)),
          ),
      );
    if (depth === 0) return card.w_full().flex_none();
    // A helper: indented under its parent, with a guide line and an elbow pointing at it.
    return h_flex().id(`tree-${a.address}`).w_full().flex_none().items_center()
      .child(div().flex_none().w(INDENT * depth))
      .child(v_flex().flex_none().w(10).h_full().relative()
        .child(div().absolute().left(0).top(0).bottom(0).w(1).bg(t.border))
        .child(div().absolute().left(0).top("50%").w(9).h(1).bg(t.border)))
      .child(card.flex_1());
  }

  render(cx) {
    const t = theme();
    // Everyone, helpers without a pane of their own and internal subagents too, in tree order.
    const crew = crewOf(agents(), terminals(), this.subagents);
    const tree = agentTree(crew, { ...parentsOf(terminals()), ...subagentParents(crew) });
    const list = tree.map((x) => x.agent);
    const kept = shared(JOBS_MEMORY_KEY) ?? {};
    const tabs = tabRefs(spaces(), list);
    const assigned = assignJobs(tabNames(spaces(), list), this.jobs, kept, tabs);
    const now = Math.floor(Date.now() / 1000);
    return v_flex()
      .id("polyflow-agents")
      .size_full()
      .min_h(0)
      .text_color(t.foreground)
      .text_size(13)
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .gap(4)
          .p(6)
          .overflow_y_scrollbar()
          .children(tree.map(({ agent, depth }) => this.card(agent, depth, now, t, assigned)))
          .when(list.length === 0, (el) =>
            el.child(div().p(8).text_size(12).text_color(t.dim).child("No agents")),
          ),
      );
  }
}
