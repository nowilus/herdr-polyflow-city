// PolyFlow Office: a cyberpunk office tower where every agent works at the station that matches what it does.
// The panel and its modes (beside the terminals, full screen with the agent's terminal, floating chat, own window)
// around the tower overview. Clicking a floor lists its agents; the floor's own 3/4 view comes in a later stage.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, layout, terminals, appHome, theme, run, props, shared, setShared, openOverlay, closeOverlay, settings, spaces, readTextFile } from "herdr";
import { KEY, CHAT_PLACES, allowsFloatingChat, layoutCommands, nextState, officeState } from "./modes.js";
import { openScreen } from "./screen.js";
import { byFloor, doingText, subagentRecords, withHelpers, withSubagents } from "./activity.js";
import { followActivity } from "./activity-reader.js";
import { followSharedSubagents } from "./subagents-follow.js";
import { followSharedMeta } from "./meta-follow.js";
import { startMeterFlush } from "./cost-meter.js";
import { createMeter } from "./cost-model.js";
import { initLimitsWindow, renderLimitsChip, renderLimitsWindow } from "./limits-ui.js";
import { JOBS_MEMORY_KEY, assignJobs, tabNames, tabRefs } from "./lib.js";
import { TOWER, renderTower } from "./tower.js";
import { SHOWN_MAX, advance, floorGoals, newWorld, occupancy, pickShown } from "./crowd.js";
import { POUR_MS } from "./tower-props.js";
import { demoCrew } from "./demo.js";
import { chatIsOpen, closeChat, openChat, selectChatTarget, setChatView } from "./chat-window.js";
import { SCREEN_CHAT_KEY, chatPlaceOf } from "./chat-place.js";
import { closeChatBar, closeChatCoordinator, closeChatPlace, currentChatTarget, initChatBar, initChatCoordinator, initChatPlace, renderChatPlace, renderPlaceBar, setScreenChatShown } from "./chat-place-view.js";
import { startOfficePrefs } from "./office-prefs.js";
import { closeFilePreview, initFilePreview, renderFilePreview } from "./chat-file-preview.js";
import { closeCard, initCard, openAgentCard, renderAgentCard } from "./agent-card.js";
import { PENDING_KEY, closeNewAgent, initNewAgent, openNewAgent, pendingAgent, renderNewAgent, settlePending } from "./new-agent.js";
import { completePacks } from "./art-packs.js";
import { FLOOR_TICK_MS, closeFloor, floorTick, openFloor, renderOpenFloor } from "./floor-controller.js";
import { isCalm, setCalm, statusLook } from "./labels.js";
import { CHAT_UI_KEY, SUBAGENTS_KEY, internalOf, pruneChatUi } from "./chat-model.js";
import { BAR_HEIGHT, BODY_SIZE, BUTTON, SIGN_FONT, UI_FONT } from "./ui-tokens.js";
import { uiButton } from "./ui-kit.js";

const BAR_H = BAR_HEIGHT;
const TOWER_RATIO = TOWER.w / TOWER.h;
const CHAT_LABEL = { bottom: "Chat below", right: "Chat right", float: "Chat floating" };
const JOBS_FILE = `${appHome()}/mods/polyflow-agents/jobs.json`;
const MINI_MANIFEST = `${appHome()}/mods/polyflow-office/art/mini/manifest.json`;
const TOWER_MANIFEST = `${appHome()}/mods/polyflow-office/art/tower/manifest.json`;
const PEOPLE_MANIFEST = `${appHome()}/mods/polyflow-office/art/people/manifest.json`;
const SCENES_MANIFEST = `${appHome()}/mods/polyflow-office/art/scenes.json`;
const ART_INDEX = `${appHome()}/mods/polyflow-office/art/index.json`;
const TICK_MS = 250;
const UI_TIDY_MS = 10000;

// Whether the office runs on its own: docked in someone else's layout (the "PolyFlow Office" mod), not inside the
// PolyFlow City layout whose nodes (office, office-chat-*) the modes switch. Then there are no modes: the office is
// always on, and the floating chat is its chat.
function hasNode(node, id) {
  if (!node || typeof node !== "object") return false;
  if (node.id === id) return true;
  return Object.values(node).some((v) => (Array.isArray(v) ? v.some((c) => hasNode(c, id)) : typeof v === "object" && hasNode(v, id)));
}
export function screenMode() {
  const find = node => node && (node.content?.mod === "polyflow-office" && node.content?.props?.screen === true || (node.children ?? []).some(find));
  return Boolean(find(layout()));
}
export const standalone = () => !screenMode() && !hasNode(layout(), "office");
const conversationPlace = () => chatPlaceOf({ state: officeState(shared(KEY)), screen: screenMode(), standalone: standalone() });

// FULL is a PolyFlow City mode: never on when the office runs on its own.
const fullMode = () => !screenMode() && !standalone() && officeState(shared(KEY)).mode === "full";

// Explicit FLOAT also belongs to SIDE. Runs after our own actions and, via
// the view's timer, after changes made elsewhere (the tab bar's Office button, keys.json commands). On its own the
// office keeps it.
function closeStrayChat(state) {
  if (standalone()) return;
  if (chatIsOpen() && !allowsFloatingChat(state)) closeChat();
}

// A click on an agent anywhere in the office. Left click shows the agent (its terminal or chat); in FULL that is all,
// elsewhere the card opens too. Right click (menu) only opens the card, wherever: nothing else moves.
function pickAgent(address, demo, agentsBy, doing, menu = false) {
  if (!menu) showAgent(address);
  if (!menu && fullMode()) return;
  const a = agentsBy[address];
  openAgentCard({ address, demo: Boolean(demo), name: a?.tab_name ?? null, status: a?.status ?? null, doing: doing?.(address) ?? null });
}

// What the card may do. TERMINAL always ends on the real terminal and CHAT on the conversation, whatever the
// floating window showed before. CHAT preserves the dock, or explicitly opens FLOAT in SIDE/standalone.
function cardDeps(button) {
  return {
    button,
    showTerminal: (address) => showTerminalOf(address),
    openChatFor: conversationPlace() ? (address) => showConversationOf(address) : null,
  };
}

// The agent's real terminal: focused, and if the floating window is open (or belongs to this mode) it switches to it.
function showTerminalOf(address) {
  if (!address || String(address).startsWith("demo-")) return;
  // An internal subagent has no terminal: its agent's.
  const inner = internalOf(address);
  if (inner) return showTerminalOf(inner.parent);
  const s = officeState(shared(KEY));
  const place = conversationPlace();
  const open = standalone() || (s.mode === "full" && s.chat === "float");
  if (place && (place !== "float" || open || chatIsOpen())) setChatView(address, "terminal", { place, open });
  else selectChatTarget(address);
}

// The agent's conversation in the current place; SIDE explicitly opens FLOAT without changing mode.
function showConversationOf(address) {
  const place = conversationPlace();
  if (!place) return;
  setChatView(address, "chat", { place, focusInput: true, open: place === "float" });
}

// Apply a user action: store the new state, then move the layout there.
function apply(action) {
  const next = nextState(shared(KEY), action);
  setShared(KEY, next);
  if (standalone()) return next; // no PolyFlow City nodes to show or hide
  for (const [name, args] of layoutCommands(next)) run(name, args);
  closeStrayChat(next);
  if (action?.type === "chat" && action.place === "float" && next.mode === "full") openChat(chatTarget());
  return next;
}

// The agent the chat should show: the focused one, else the first.
function chatTarget() {
  return currentChatTarget();
}

// Show an agent: focus it (the chat blocks follow the focused agent); in the floating mode also open the chat.
function showAgent(address) {
  if (!selectChatTarget(address)) return;
  const s = officeState(shared(KEY));
  if (fullMode() && s.chat === "float") openChat(address);
}

export default class PolyflowOffice extends View {
  // The view goes away (its window is rebuilt or closed): keep what was typed in the chat and the card, and let go
  // of the card's text fields.
  async close() {
    this.officePrefs?.stop();
    if (this.chatBar) closeChatBar(this);
    else if (this.chatPlace) closeChatPlace(this);
    if (this.chatCoordinatorTimer) closeChatCoordinator(this);
    if (this.agentCard) closeCard(this);
    if (this.newAgent) closeNewAgent(this);
    if (this.filePreview) closeFilePreview(this);
  }

  init(_p, cx) {
    // SCREEN has its own coordinator/shared; only CALM follows the main home.
    this.screen = Boolean(props()?.screen);
    // The same mod draws the floating chat's title bar and the agent card.
    this.chatBar = props()?.chatBar ?? null;
    this.chatPlace = props()?.chatPlace ?? null;
    if (this.chatBar) {
      this.chatPlace ??= "float";
      initChatBar(this, cx);
      return;
    }
    this.deskChat = props()?.deskChat ?? null;
    if (this.deskChat) {
      this.chatFocusInput = props()?.focusInput === true;
      initChatPlace(this, "float", cx);
      return;
    }
    if (this.chatPlace) {
      initChatPlace(this, this.chatPlace, cx);
      return;
    }
    this.agentCard = props()?.agentCard ?? null;
    if (this.agentCard) { initCard(this, cx); return; }
    this.newAgent = Boolean(props()?.newAgent);
    if (this.newAgent) { initNewAgent(this, cx); return; }
    this.filePreview = props()?.filePreview ?? null;
    if (this.filePreview) { initFilePreview(this, this.filePreview, cx); return; }
    this.limitsWindow = Boolean(props()?.limitsWindow);
    if (this.limitsWindow) {
      initLimitsWindow(this, cx);
      return;
    }
    this.notice = null;
    this.noticeUntil = 0; // a notice with a time limit goes away by itself (0: it stays)
    this.scene = { w: 800, h: 500 };
    this.hover = null;
    this.openFloor = null;
    this.jobs = {};
    this.needsOpen = false; // the NEEDS YOU list is open
    this.moreFloor = null; // the floor whose "+N" list is open
    this.demo = false; // a made-up crew instead of the real agents (DEMO button)
    this.world = newWorld(); // people and the elevator (crowd.js, lift.js)
    this.mounted = new Set(); // people drawn at least once (their walks glide from then on)
    this.stage = ""; // what last decided a redraw: phases, poses, doors, cups
    // Art in use: only packs whose every file art/index.json lists (a missing image path is cached forever).
    this.minis = { jobs: new Set(), versions: {} }; // side-view minis (art/mini/manifest.json)
    this.cast = {}; // big floor-view people: { job: version } (art/people/manifest.json)
    this.assets = new Set(); // tower art (art/tower/manifest.json); the rest is drawn as stand-ins
    this.scenes = new Set(); // floors drawn from their pictures (art/scenes.json)
    this.chatStandalone = standalone();
    initChatCoordinator(this, cx);
    this.officePrefs = startOfficePrefs(cx, { screen: this.screen, getCalm: isCalm, applyCalm: setCalm,
      onError: message => {
        if (message || this.notice?.startsWith("CALM sync: ")) { this.notice = message; this.noticeUntil = 0; }
      } });
    // What this tower's readers cost, counted for metrics.json and the chat's SESSION section (cost-model.js).
    this.cost = createMeter();
    startMeterFlush(cx, "office", this.cost);
    followActivity(this, cx);
    // Claude Code's internal subagents (its Agent tool): shown as read-only helpers of their agent.
    followSharedSubagents(this, cx, () => this.visible(), "office");
    // Each agent's energy (model, effort, context) and the account limits, shared for the tower, the tree and the chat.
    followSharedMeta(this, cx, () => this.visible());
    this.loadArt(cx);
    // Nothing moves while the office is closed (its view stays alive in the background).
    cx.timer.every(TICK_MS, (cx) => { if (this.visible()) this.tick(cx); });
    cx.timer.every(TICK_MS, (cx) => this.settle(cx));
    cx.timer.every(FLOOR_TICK_MS, (cx) => { if (this.openFloor && this.visible()) floorTick(this, this.crew(Date.now()), cx); });
    this.uiGone = {}; // when each agent with saved panel state was first missed (in memory only)
    cx.timer.every(UI_TIDY_MS, () => this.tidyChatUi());
    cx.spawn(async (cx) => {
      const text = await readTextFile(JOBS_FILE).catch(() => null);
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) this.jobs = parsed;
      } catch {}
      cx.notify();
    });
  }

  // The side panel's saved state (per agent) of agents that have been gone for a minute is dropped, so it doesn't pile
  // up. Only this instance (the tower, not a chat or a card) does it; the chat's drafts are never dropped here.
  tidyChatUi() {
    const present = new Set(terminals().map((t) => t.address));
    for (const [parent, list] of Object.entries(shared(SUBAGENTS_KEY) ?? {})) for (const s of list ?? []) present.add(`${parent}~${s.id}`);
    const { ui, gone } = pruneChatUi(shared(CHAT_UI_KEY), present, this.uiGone, Date.now());
    this.uiGone = gone;
    if (ui !== shared(CHAT_UI_KEY)) setShared(CHAT_UI_KEY, ui);
  }

  // The agents the office shows and what they are doing: the real ones, or the demo crew.
  crew(now) {
    if (this.demo) return demoCrew(now);
    const subs = this.subagents ?? {};
    return { agents: withSubagents(withHelpers(agents(), terminals()), subs), activity: { ...(this.activity ?? {}), ...subagentRecords(subs) } };
  }

  // Follow state changed from outside this view: a closed office forgets its open floor and lists (it would
  // otherwise come back showing them), and a floating chat that no longer fits the state goes away.
  settle(cx) {
    this.followPending(cx);
    if (this.noticeUntil && Date.now() > this.noticeUntil) {
      this.notice = null;
      this.noticeUntil = 0;
      cx.notify();
    }
    if (this.screen) return;
    const state = officeState(shared(KEY));
    closeStrayChat(state);
    if (standalone() || state.mode !== "off" || !(this.openFloor || this.needsOpen || this.moreFloor)) return;
    closeFloor(this);
    this.needsOpen = false;
    this.moreFloor = null;
    cx.notify();
  }

  say(text, ms) {
    this.notice = text;
    this.noticeUntil = Date.now() + ms;
  }

  // An agent started from "+ AGENT": say when it has walked in, or that it never showed up.
  followPending(cx) {
    if (this.screen) return;
    const now = Date.now();
    const r = settlePending(now);
    if (r?.arrived) {
      this.say(`${(r.arrived.tab_name || "THE NEW AGENT").toUpperCase()} WALKS INTO THE LOBBY`, 8000);
      cx.notify();
    } else if (r?.waiting?.late) {
      setShared(PENDING_KEY, null);
      this.say(`${String(r.waiting.name).toUpperCase()} DIDN'T SHOW UP: LOOK AT ITS TAB`, 15000);
      cx.notify();
    }
  }

  toggleDemo(cx) {
    this.demo = !this.demo;
    this.world = newWorld();
    this.everSeen = null; // the new crew is already in the building
    closeFloor(this);
    // The other crew has other floors and people: no list or hover of the old one stays.
    this.needsOpen = false;
    this.moreFloor = null;
    this.hover = null;
    cx.notify();
  }

  // Read the four manifests and art/index.json, then keep only the packs whose every file exists. No index (or a
  // broken one) leaves every pack empty: stand-ins, as with no manifest.
  loadArt(cx) {
    const read = async (file) => {
      const text = await readTextFile(file).catch(() => null);
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    };
    cx.spawn(async (cx) => {
      const [minis, people, scenes, tower, index] = await Promise.all([MINI_MANIFEST, PEOPLE_MANIFEST, SCENES_MANIFEST, TOWER_MANIFEST, ART_INDEX].map(read));
      const ok = completePacks({ minis, people, scenes, tower }, index?.files);
      this.minis = { jobs: new Set(ok.minis.jobs), versions: ok.minis.versions };
      this.cast = ok.people.versions;
      this.assets = new Set(ok.tower.assets);
      this.scenes = new Set(ok.scenes.ready);
      cx.notify();
    });
  }

  // The scene's size in unzoomed px (size events arrive zoomed).
  // Shown: the office's own window always; in the main window unless the office is switched off.
  visible() {
    return this.screen || standalone() || officeState(shared(KEY)).mode !== "off";
  }

  // Herdr's UI zoom: size and mouse events arrive multiplied by it.
  uiZoom() {
    return Number(settings()?.zoom) > 0 ? Number(settings().zoom) : 1;
  }

  onSceneSize(size, cx) {
    const zoom = this.uiZoom();
    const w = size.width / zoom;
    const h = size.height / zoom;
    if (Math.abs(w - this.scene.w) > 1 || Math.abs(h - this.scene.h) > 1) {
      this.scene = { w, h };
      cx.notify();
    }
  }

  button(id, label, action, t, opts) {
    return uiButton(id, label, action, t, opts);
  }

  toggleCalm(cx) {
    setCalm(!isCalm());
    this.officePrefs?.request(isCalm());
    cx.notify();
  }

  bar(state, crew, t) {
    const count = crew.agents.length;
    const waiting = crew.agents.filter((a) => a.status === "blocked");
    const limits = renderLimitsChip(t);
    const sep = () => div().w(1).h(16).mx(4).bg(t.border).flex_none();
    const row = h_flex().h(BAR_H).flex_none().px(8).gap(4).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(div().font_family(SIGN_FONT).text_size(12).text_color(t.accent).child("OFFICE"))
      .child(div().font_family(SIGN_FONT).text_size(10).text_color(this.demo ? t.accent : t.dim).ml(6)
        .child(this.demo ? `DEMO: ${count} MADE-UP AGENTS` : `${count} AGENTS`))
      // Who needs the person, always in sight; a click lists them.
      .when(waiting.length > 0, (el) => el.child(
        div().id("needs-you").ml(8).h(BUTTON.height).px(BUTTON.padX).flex().items_center().gap(4).bg(t.blocked).text_color(t.solid_foreground ?? t.background)
          .font_family(UI_FONT).text_size(BODY_SIZE).cursor_pointer()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { this.needsOpen = !this.needsOpen; cx.notify(); })
          .tooltip("Agents waiting for you: click for the list")
          .child(`${statusLook("blocked").mark} ${waiting.length} ${statusLook("blocked").word}`),
      ))
      .when(Boolean(pendingAgent(Date.now())), (el) => el.child(
        div().ml(8).font_family(SIGN_FONT).text_size(10).text_color(t.working).child(`CONNECTING ${String(pendingAgent(Date.now()).name).toUpperCase()}...`)))
      .when(Boolean(limits), (el) => el.child(limits))
      .child(div().flex_1());
    if (this.screen) {
      return row
        .child(this.button("chat", "CHAT", () => setScreenChatShown(shared(SCREEN_CHAT_KEY)?.shown === false), t,
          { on: shared(SCREEN_CHAT_KEY)?.shown !== false, title: "Show or hide the agent's conversation" }))
        .child(this.button("close", "X", () => run("window.close"), t, { title: "Close this window" }));
    }
    row.child(this.button("new-agent", "+ AGENT", () => openNewAgent(), t, { title: "Start a new agent: it walks in through the lobby" }))
      .child(sep());
    // On its own (another layout): no modes to switch, the chat is a floating window, and the office stays open.
    if (standalone()) {
      return row
        .child(this.button("chat-open", "OPEN CHAT", () => { const a = chatTarget(); if (a) showConversationOf(a); }, t, { title: "The focused agent's conversation" }))
        .child(sep())
        .child(this.button("calm", "CALM", (_e, cx) => this.toggleCalm(cx), t, { on: isCalm(), title: "Calm mode: no blinking lights or pulsing glows (states stay visible)" }))
        .child(this.button("demo", "DEMO", (_e, cx) => this.toggleDemo(cx), t, { on: this.demo, title: "Demo: a made-up crew walks the office (your agents are hidden meanwhile)" }));
    }
    row.child(this.button("full", state.mode === "full" ? "EXIT FULL" : "FULL", () => apply({ type: "full" }), t, { on: state.mode === "full", title: "Full: the office takes the place of the terminals, with the agent's chat beside it" }));
    if (state.mode === "full") {
      for (const place of CHAT_PLACES) {
        row.child(this.button(`chat-${place}`, place.toUpperCase(), () => apply({ type: "chat", place }), t, { on: state.chat === place, title: CHAT_LABEL[place] }));
      }
      if (state.chat === "float") row.child(this.button("chat-open", "OPEN CHAT", () => showConversationOf(chatTarget()), t, { title: "The agent's conversation" }));
    }
    return row
      .child(sep())
      .child(this.button("calm", "CALM", (_e, cx) => this.toggleCalm(cx), t, { on: isCalm(), title: "Calm mode: no blinking lights or pulsing glows (states stay visible)" }))
      .child(this.button("demo", "DEMO", (_e, cx) => this.toggleDemo(cx), t, { on: this.demo, title: "Demo: a made-up crew walks the office (your agents are hidden meanwhile)" }))
      .child(this.button("screen", "SCREEN", (_e, cx) => this.launchScreen(cx), t, { title: "Open the office in its own OS window (e.g. on a second monitor)" }))
      .child(this.button("off", "X", () => apply({ type: "off" }), t, { title: "Close the office" }));
  }

  launchScreen(cx) {
    this.notice = "OPENING SCREEN...";
    cx.notify();
    cx.spawn(async (cx) => {
      this.notice = await openScreen();
      cx.notify();
    });
  }

  // Title bar of the floating chat window: which agent, and a close button.


  // Move everyone shown and the elevator; redraw only when something visible changes its course.
  tick(cx) {
    if (this.openFloor) return; // the tower isn't drawn while a floor is open; it picks up again on return
    const now = Date.now();
    const crew = this.crew(now);
    const floors = byFloor(crew.agents, crew.activity, Math.floor(now / 1000));
    const goals = Object.assign({}, ...floors.map(({ floor, agents: entries }) => floorGoals(floor.id, pickShown(entries))));
    this.world = advance(this.world, goals, now);
    const { people, lift } = this.world;
    const stage = [
      `${lift.phase}:${lift.floor}:${lift.to}`,
      ...crew.agents.map((a) => `${a.address}:${a.status}:${a.tab_name}`),
      ...Object.entries(people).map(([a, p]) => `${a}:${p.phase}:${p.floor}:${p.toX ?? p.x}:${p.pose}:${p.facing}:${this.mounted.has(a)}:${p.phase === "at" && now - p.since >= POUR_MS}`),
    ].join("|");
    if (stage !== this.stage) {
      this.stage = stage;
      cx.notify();
    }
  }

  render() {
    const t = theme();
    if (this.limitsWindow) return renderLimitsWindow(this, t, (...a) => this.button(...a));
    if (this.chatBar) return renderPlaceBar(this, t, (...a) => this.button(...a));
    if (this.chatPlace) return renderChatPlace(this, t, {});
    if (this.filePreview) return renderFilePreview(this, t, (...a) => this.button(...a));
    if (this.newAgent) return renderNewAgent(this, t, (...a) => this.button(...a));
    if (this.agentCard) return renderAgentCard(this, t, cardDeps((...a) => this.button(...a)));
    const state = officeState(shared(KEY));
    const crew = this.crew(Date.now());
    const list = crew.agents;
    const assigned = assignJobs(tabNames(spaces(), list), this.jobs, this.demo ? {} : shared(JOBS_MEMORY_KEY) ?? {}, this.demo ? [] : tabRefs(spaces(), list));
    const agentsBy = Object.fromEntries(list.map((a) => [a.address, a]));
    const nowS = Math.floor(Date.now() / 1000);
    // What an agent is doing right now, for tooltips.
    const doing = (address) => doingText(agentsBy[address]?.status, crew.activity[address] ?? null, nowS);
    const scene = this.openFloor && this.floor
      ? renderOpenFloor(this, crew, { agentsBy, assigned, doing, minis: this.minis, cast: this.cast, onPerson: (address) => pickAgent(address, this.demo, agentsBy, doing), onPersonMenu: (address) => pickAgent(address, this.demo, agentsBy, doing, true), onInvite: () => openNewAgent() }, t)
      : this.renderTowerScene(byFloor(list, crew.activity, nowS), assigned, agentsBy, doing, t);
    return v_flex()
      .id("polyflow-office")
      .size_full()
      .min_w(0)
      .bg(t.canvas)
      .child(this.bar(state, crew, t))
      .child(
        div().id("office-scene").flex_1().min_h(0).relative().overflow_hidden().flex().items_center().justify_center()
          .on_size_change((size, cx) => this.onSceneSize(size, cx))
          .child(scene)
          .when(Boolean(this.needsOpen), (el) => el.child(this.renderNeeds(crew, t)))
          .when(Boolean(this.moreFloor) && !this.openFloor, (el) => el.child(this.renderFloorAgents(crew, t)))
          .when(Boolean(this.notice), (el) =>
            el.child(div().absolute().left(10).bottom(8).font_family(SIGN_FONT).text_size(10).text_color(t.accent).child(this.notice))),
      );
  }

  // A list of agents as rows (name, status, what it does); a row opens that agent's terminal.
  agentRows(list, activity, t, close) {
    const nowS = Math.floor(Date.now() / 1000);
    return list.map((a) => v_flex().id(`row-${a.address}`).px(8).py(6).gap(2).border_l(3)
      .border_color(t[statusLook(a.status).key] ?? t.border).bg(`${t.surface}e6`)
      .cursor_pointer().hover((s) => s.bg(`${t.raised}f0`))
      .on_click((_e, cx) => { close(); pickAgent(a.address, this.demo, { [a.address]: a }, () => doingText(a.status, activity[a.address] ?? null, nowS)); cx.notify(); })
      .on_mouse_down("right", (_e, cx) => { close(); pickAgent(a.address, this.demo, { [a.address]: a }, () => doingText(a.status, activity[a.address] ?? null, nowS), true); cx.notify(); })
      .child(div().font_family(UI_FONT).text_size(13).text_color(t.foreground).child(a.tab_name || a.address))
      .child(div().font_family(UI_FONT).text_size(BODY_SIZE).text_color(t.muted).truncate()
        .child(doingText(a.status, activity[a.address] ?? null, nowS))));
  }

  // The "+N" list: everyone on one floor, those who need the person first.
  renderFloorAgents(crew, t) {
    const entry = byFloor(crew.agents, crew.activity, Math.floor(Date.now() / 1000)).find((f) => f.floor.id === this.moreFloor);
    if (!entry) return div();
    const rank = (a) => (a.status === "blocked" ? 0 : a.status === "working" ? 1 : 2);
    const list = entry.agents.map((e) => e.agent).sort((a, b) => rank(a) - rank(b));
    const close = () => { this.moreFloor = null; };
    return v_flex().id("floor-agents").absolute().top(10).right(10).w(320).max_h_full().gap(6).p(10).bg(`${t.popover}f5`).border(1).border_color(t.accent)
      .child(h_flex().items_center()
        .child(div().flex_1().font_family(SIGN_FONT).text_size(12).text_color(t.accent).child(`0${entry.floor.no} // ${entry.floor.label}`))
        .child(this.button("floor-agents-open", "OPEN FLOOR", (_e, cx) => { close(); openFloor(this, entry.floor.id); cx.notify(); }, t, { title: "Open this floor" }))
        .child(this.button("floor-agents-close", "X", (_e, cx) => { close(); cx.notify(); }, t, { title: "Close" })))
      .children(this.agentRows(list, crew.activity, t, close));
  }

  // The list behind "NEEDS YOU": who waits, on which question; a row opens that agent's terminal.
  renderNeeds(crew, t) {
    const waiting = crew.agents.filter((a) => a.status === "blocked");
    if (waiting.length === 0) this.needsOpen = false;
    return v_flex().id("needs-list").absolute().top(10).right(10).w(320).gap(6).p(10).bg(`${t.popover}f5`).border(1).border_color(t.blocked)
      .child(h_flex().items_center()
        .child(div().flex_1().font_family(SIGN_FONT).text_size(12).text_color(t.blocked).child(statusLook("blocked").word))
        .child(this.button("needs-close", "X", (_e, cx) => { this.needsOpen = false; cx.notify(); }, t, { title: "Close" })))
      .children(this.agentRows(waiting, crew.activity, t, () => { this.needsOpen = false; }));
  }

  // The tower overview; while a floor is open the tower isn't drawn, so its people start fresh when it returns.
  renderTowerScene(floors, assigned, agentsBy, doing, t) {
    const shownCount = Object.fromEntries(floors.map((f) => [f.floor.id, Math.min(f.agents.length, SHOWN_MAX)]));
    // Contain: the whole tower fits, letterboxed on the canvas.
    const fit = this.scene.w / this.scene.h > TOWER_RATIO
      ? { w: this.scene.h * TOWER_RATIO, h: this.scene.h }
      : { w: this.scene.w, h: this.scene.w / TOWER_RATIO };
    const tower = renderTower({
      fit,
      floors,
      assigned,
      hover: this.hover,
      world: this.world,
      occupancy: occupancy(this.world.people),
      mounted: this.mounted,
      agentsBy,
      doing,
      minis: this.minis,
      assets: this.assets,
      now: Date.now(),
      shownCount,
      onPerson: (address) => pickAgent(address, this.demo, agentsBy, doing),
      onPersonMenu: (address) => pickAgent(address, this.demo, agentsBy, doing, true),
      onInvite: () => openNewAgent(),
      onHover: (id, cx) => { if (id !== this.hover) { this.hover = id; cx.notify(); } },
      onPick: (id, cx) => { this.moreFloor = null; openFloor(this, id); cx.notify(); },
      onMore: (id, cx) => { this.moreFloor = this.moreFloor === id ? null : id; cx.notify(); },
    }, t);
    // From the next frame on, the people drawn now glide to their targets.
    this.mounted = new Set(Object.keys(this.world.people));
    return tower;
  }
}
