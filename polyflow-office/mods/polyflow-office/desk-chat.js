// The desktop chat: an agent's conversation as a chat (its own session file, read by hooks/transcript.mjs), a box
// to write to it (hc send) and a side panel with what it is doing and the files it touched. The whole kept history
// scrolls and, like a chat app, stays on the newest message until the person scrolls up ("NEWEST" brings it back);
// tool calls fold into one line that opens on a click. Approvals and questions still need the real terminal: the
// chat says so and the title bar switches to it in one click.
//
// Why a virtual list: it is the only scroll area a mod can move from code (scroll_to_bottom). Its rows need their
// heights up front and can't be measured inside it, so every message is also drawn once, invisibly, under the list,
// where on_size_change can measure it; until then an estimate from the text's length stands in.
import { div } from "gpui-kit";
import { Scrollbar, Textarea, TextareaState, TextView, VirtualListScrollHandle, h_flex, v_flex, v_virtual_list } from "gpui-base";
import { agents, appHome, exec, hc, readTextFile, setShared, shared, terminals } from "herdr";
import { activityText, withHelpers } from "./activity.js";
import { CHAT_STATE_KEY, chatAccess, filesFrom, foldTools, lifeOf } from "./chat-model.js";

const UI_FONT = "Chakra Petch";
const SIGN_FONT = "Silkscreen";
const POLL_MS = 1500;
// What the person left in a chat, per agent: { [address]: { draft, open: [tool run keys], pinned } }. Kept in shared
// state because the window is rebuilt by its size buttons and by the CHAT/TERMINAL switch; written a moment after
// the last change, not on every key.
const STATE_KEY = CHAT_STATE_KEY;
const SAVE_MS = 150;
const savedOf = (address) => {
  const all = shared(STATE_KEY);
  const s = all && typeof all === "object" ? all[address] : null;
  return s && typeof s === "object" ? s : {};
};
const STICK_MS = 60; // after a layout, so the list knows its new rows before it scrolls to them
const ROW_GAP = 8;
const MEASURE_BATCH = 10; // rows measured per frame, newest first (markdown is costly: more per frame got the render interrupted)
const OWN_HOME = appHome();

async function sourceHome() {
  const src = (await readTextFile(`${OWN_HOME}/data/polyflow-office/source-home.txt`).catch(() => null))?.trim();
  return src ? src.replace(/[\\/]+$/, "") : OWN_HOME;
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const live = (address) => withHelpers(agents(), terminals()).find((a) => a.address === address) ?? null;

// A short stable hash, so a message keeps its ids when newer messages arrive.
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
// A message's identity. A run of tool calls is named after its first call, so it keeps its key (and stays open)
// while more calls join it.
const keyOf = (m) => m.role === "tools"
  ? `run-${m.at ?? ""}-${hash(m.items?.[0] ?? "")}`
  : `${m.at ?? ""}-${m.text?.length ?? 0}-${hash(m.text ?? "")}`;

// view.desk: { address, transcript, size, messages, record, sending, note, error, open: Set of opened tool runs }
export function initDeskChat(view, address, cx) {
  const saved = savedOf(address);
  view.desk = { address, transcript: null, bound: null, size: -1, messages: null, record: null, sending: false, note: null, error: null,
    open: new Set(Array.isArray(saved.open) ? saved.open.filter((k) => typeof k === "string") : []) };
  view.deskScroll = VirtualListScrollHandle.new();
  view.deskHeights = {}; // sizeKey -> measured row height, for the current width only
  view.deskWidth = 600;
  view.deskStick = null; // the pending scroll to the newest message (one at a time)
  view.deskSeen = typeof saved.seen === "number" ? saved.seen : 0; // rows there were when the person scrolled away ("N NEW")
  view.deskPinned = saved.pinned !== false; // following the newest message
  view.deskDirty = false; // something to write to STATE_KEY
  // A real text box: cursor, selection, paste, several lines. Enter sends, Shift+Enter is a new line.
  view.deskInput = TextareaState.new({ placeholder: "Write to the agent. Enter sends, Shift+Enter: new line", value: typeof saved.draft === "string" ? saved.draft : "" });
  view.deskInput.set_auto_grow(1, 8);
  view.deskInput.on("submit", (e, cx) => { if (!e?.shift) send(view, cx); });
  view.deskInput.on("change", (_e, cx) => { save(view, cx); cx.notify(); });
  view.deskInput.focus();
  let busy = false;
  const poll = () => {
    if (busy) return;
    busy = true;
    cx.spawn(async (cx) => {
      try {
        await refresh(view, cx);
      } finally {
        busy = false;
      }
    });
  };
  poll();
  cx.timer.every(POLL_MS, () => poll());
  cx.timer.every(SAVE_MS, () => { if (view.deskDirty) flushDeskChat(view); });
}

// Remember the draft, opened tool runs and pinning for this agent (see STATE_KEY).
// Mark what the person left (draft, opened tools, pinning) as changed; the view's own timer writes it a moment
// later (see initDeskChat), and flushDeskChat writes it at once when the view goes away. No timers are started
// from event handlers: the one from init is the dependable one.
function save(view, _cx) {
  view.deskDirty = true;
}

// Write what the person left right away (the window is being rebuilt or closed: no time for the delayed save).
export function flushDeskChat(view) {
  if (!view.desk || !view.deskInput) return;
  view.deskDirty = false;
  const all = shared(STATE_KEY);
  const next = { draft: view.deskInput.value(), open: [...view.desk.open], pinned: view.deskPinned, seen: view.deskSeen };
  setShared(STATE_KEY, { ...(all && typeof all === "object" ? all : {}), [view.desk.address]: next });
}

// What the chat may do now (chat-model.js chatAccess), from Herdr's live data and the session file's binding.
function accessOf(view) {
  const status = live(view.desk.address)?.status ?? "idle";
  return chatAccess({ bound: view.desk.bound, status, life: lifeOf(view.desk.address, withHelpers(agents(), terminals()), terminals()) });
}

async function refresh(view, cx) {
  const d = view.desk;
  const home = await sourceHome();
  const data = `${home}/data/polyflow-office`;
  const session = parse(await readTextFile(`${data}/sessions/${d.address}.json`).catch(() => null));
  const record = parse(await readTextFile(`${data}/activity/${d.address}.json`).catch(() => null));
  const transcript = typeof session?.transcript === "string" ? session.transcript : null;
  const bound = session?.bound === "env" ? "env" : session ? "guess" : null;
  const same = transcript === d.transcript;
  // Another conversation (or none): what was shown belongs to the old one.
  let polled = same ? { transcript, bound, record } : { transcript, bound, record, messages: null, size: -1, error: null };
  if (transcript) {
    const known = same && d.messages ? String(d.size) : undefined;
    const args = [`${home}/mods/polyflow-office/hooks/transcript.mjs`, transcript, "0", ...(known ? [known] : [])];
    const r = await exec("node", args).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
    const out = r.code === 0 ? parse(r.stdout) : null;
    if (out?.same) polled = { ...polled, error: null };
    else if (out?.messages) polled = { ...polled, messages: out.messages, size: out.size, error: null };
    else polled = { ...polled, messages: null, error: out?.error ?? (r.stderr || "can't read the conversation").trim().slice(0, 120) };
  }
  // Only the polled fields: what happened during the awaits (sending, opened tools) stays as it is now.
  const now = view.desk;
  const next = { ...now, ...polled };
  const changed = JSON.stringify([next.transcript, next.bound, next.size, next.error, next.record, next.messages?.length]) !== JSON.stringify([now.transcript, now.bound, now.size, now.error, now.record, now.messages?.length]);
  view.desk = next;
  if (!changed) return;
  if (view.deskPinned) stick(view, cx);
  cx.notify();
}

// Scroll to the newest message once the list has laid out what just changed.
function stick(view, cx) {
  if (view.deskStick) return;
  view.deskStick = cx.timer.after(STICK_MS, (cx) => {
    view.deskStick = null;
    if (!view.deskPinned) return;
    view.deskScroll.scroll_to_bottom();
    cx.notify();
  });
}

// Leave the newest message (the person scrolls up or grabs the scrollbar): remember how many rows were there.
function unpin(view, rows, cx) {
  if (!view.deskPinned) return;
  view.deskPinned = false;
  view.deskSeen = rows;
  save(view, cx);
  cx.notify();
}

function follow(view, cx) {
  view.deskPinned = true;
  save(view, cx);
  view.deskScroll.scroll_to_bottom();
  stick(view, cx);
  cx.notify();
}

async function send(view, cx) {
  const text = view.deskInput.value().trim();
  if (!text || view.desk.sending) return;
  // Checked again at the moment of sending: the agent may have ended or stopped on an approval since the last frame.
  const access = accessOf(view);
  if (!access.canSend) {
    view.desk = { ...view.desk, note: access.reason };
    cx.notify();
    return;
  }
  view.desk = { ...view.desk, sending: true, note: null };
  cx.notify();
  const r = await hc(["send", view.desk.address, text]).catch((e) => ({ code: 1, stderr: String(e) }));
  const working = live(view.desk.address)?.status === "working";
  if (r.code === 0 && view.deskInput.value().trim() === text) view.deskInput.set_value("");
  if (r.code === 0) follow(view, cx);
  save(view, cx);
  view.desk = r.code === 0
    ? { ...view.desk, sending: false, note: working ? "Sent while it works, just as if typed in its terminal." : null }
    : { ...view.desk, sending: false, note: `Not sent: ${(r.stderr || "hc send failed").trim().slice(0, 120)}` };
  cx.notify();
}

function toggleTools(view, key) {
  const open = new Set(view.desk.open);
  if (open.has(key)) open.delete(key);
  else open.add(key);
  view.desk = { ...view.desk, open };
}

function toolRun(view, m, t) {
  const key = keyOf(m);
  const opened = view.desk.open.has(key);
  const head = m.items.length === 1 ? m.items[0] : `${m.items.length} tools · ${m.items.slice(-2).join(" · ")}`;
  return v_flex().flex_none().w_full().px(8).py(2).gap(2).cursor_pointer()
    .child(div().font_family(UI_FONT).text_size(11).text_color(opened ? t.muted : t.dim).truncate().child(`${opened ? "▾" : "▸"} ${head}`))
    .when(opened, (el) => el.children(m.items.map((x) => div().pl(14).font_family("JetBrains Mono").text_size(11).text_color(t.muted).child(x))));
}

// One message, without handlers: it is drawn inside the virtual list's renderer (clicks go to on_item_click).
function bubble(view, m, t, measuring = false) {
  if (m.role === "tools") return toolRun(view, m, t);
  const key = `${measuring ? "m-" : ""}${keyOf(m)}`;
  if (m.role === "user") {
    return h_flex().flex_none().w_full().justify_end().child(
      div().max_w("85%").px(12).py(8).bg(`${t.accent}1f`).border(1).border_color(`${t.accent}55`).rounded(8)
        .text_size(13).text_color(t.foreground).child(TextView.markdown(`umd-${key}`, m.text).selectable(!measuring)));
  }
  return div().flex_none().w_full().px(12).py(8).bg(`${t.surface}e6`).border_l(2).border_color(t.working)
    .text_size(13).text_color(t.foreground).child(TextView.markdown(`md-${key}`, m.text).selectable(!measuring));
}

// A first guess at a row's height, from its text and the list's width (replaced by the measured one).
function estimate(view, m) {
  if (m.role === "tools") return 22 + (view.desk.open.has(keyOf(m)) ? 18 * m.items.length : 0) + ROW_GAP;
  const perLine = Math.max(20, Math.floor((view.deskWidth * (m.role === "user" ? 0.85 : 1) - 40) / 7.4));
  const lines = m.text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return lines * 20 + 18 + ROW_GAP;
}

// A row's height depends on its text, the list's width and (for a tool run) how many calls it holds and whether
// it is open: all of that is in the cache key.
const sizeKey = (view, m) => `${keyOf(m)}|${m.items?.length ?? 0}|${view.desk.open.has(keyOf(m)) ? 1 : 0}|${Math.round(view.deskWidth)}`;
const heightOf = (view, m) => view.deskHeights[sizeKey(view, m)] ?? estimate(view, m);

// The history: the measuring layer (invisible, under the list) and the list itself. Only rows without a measured
// height for the current width are drawn in the measuring layer, newest first, a batch per frame.
function talk(view, list, t, empty) {
  if (list.length === 0) {
    return div().id("desk-talk").flex_1().min_h(0).p(12).font_family(UI_FONT).text_size(12).text_color(t.dim).child(empty);
  }
  const keys = list.map(keyOf);
  const sizes = list.map((m) => heightOf(view, m));
  const row = (m) => div().w_full().pb(ROW_GAP).child(bubble(view, m, t));
  const todo = [];
  for (let i = list.length - 1; i >= 0 && todo.length < MEASURE_BATCH; i--) {
    if (view.deskHeights[sizeKey(view, list[i])] === undefined) todo.push(list[i]);
  }
  const measure = v_flex().absolute().left(0).top(0).w_full().opacity(0)
    .children(todo.map((m) => {
      const k = sizeKey(view, m);
      return div().id(`measure-${k}`).w_full().pb(ROW_GAP)
        .on_size_change((sz, cx) => {
          if (view.deskHeights[k] === Math.ceil(sz.height)) return;
          view.deskHeights = { ...view.deskHeights, [k]: Math.ceil(sz.height) };
          if (view.deskPinned) stick(view, cx);
          cx.notify();
        })
        .child(bubble(view, m, t, true));
    }));
  const fresh = Math.max(0, list.length - view.deskSeen);
  return div().id("desk-talk").flex_1().min_h(0).relative().overflow_hidden().px(12).pt(12)
    .on_size_change((sz, cx) => {
      if (Math.abs(sz.width - view.deskWidth) < 1) return;
      // Heights measured at another width no longer hold: start over (estimates stand in meanwhile).
      view.deskWidth = sz.width;
      view.deskHeights = {};
      if (view.deskPinned) stick(view, cx);
      cx.notify();
    })
    // Scrolling up leaves the newest message; NEW (or sending) comes back to it.
    .on_scroll_wheel((e, cx) => {
      if ((e.delta?.y ?? 0) > 0) unpin(view, list.length, cx);
    })
    .child(measure)
    .child(v_virtual_list("desk-list", list.length, sizes, (i) => keys[i], (range) => list.slice(range.start, range.end).map(row))
      .track_scroll(view.deskScroll).size_full()
      .on_item_click((key, cx) => {
        const m = list.find((x) => keyOf(x) === key);
        if (m?.role !== "tools") return;
        toggleTools(view, key);
        save(view, cx);
        cx.notify();
      }))
    // Grabbing the scrollbar is reading the history too.
    .child(div().id("desk-scrollbar").absolute().top(0).right(0).bottom(0).w(10)
      .on_mouse_down("left", (_e, cx) => unpin(view, list.length, cx))
      .child(Scrollbar.vertical("desk-list").size_full()))
    .when(!view.deskPinned, (el) => el.child(
      div().id("desk-newest").absolute().right(18).bottom(10).px(10).py(5).rounded(12).bg(t.accent).text_color("#0b0d10")
        .font_family(SIGN_FONT).text_size(10).cursor_pointer()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .tooltip("Back to the newest message")
        .on_click((_e, cx) => follow(view, cx)).child(fresh > 0 ? `↓ ${fresh} NEW` : "↓ NEWEST")));
}

function side(view, agent, t) {
  const d = view.desk;
  const nowS = Math.floor(Date.now() / 1000);
  const status = agent?.status ?? "idle";
  const life = lifeOf(d.address, withHelpers(agents(), terminals()), terminals());
  const doing = life !== "live" ? "ended" : activityText(status, d.record, nowS) ?? (status === "done" ? "finished its turn" : "resting");
  const files = filesFrom(d.messages ?? [], 30);
  const label = (s) => div().font_family(SIGN_FONT).text_size(9).text_color(t.dim).child(s);
  return v_flex().w(220).flex_none().h_full().p(10).gap(8).bg(`${t.chrome}f0`).border_l(1).border_color(t.border)
    .child(label("NOW"))
    .child(div().font_family(UI_FONT).text_size(12).text_color(status === "blocked" ? t.blocked : t.foreground).child(doing))
    .child(label(`FILES (${files.length})`))
    .child(files.length === 0
      ? div().font_family(UI_FONT).text_size(11).text_color(t.dim).child("none yet")
      : v_flex().id("desk-files").flex_1().min_h(0).gap(3).overflow_y_scrollbar().children(files.map((f, i) => h_flex().id(`file-${i}`).flex_none().gap(6).items_center()
        .child(div().w(6).h(6).flex_none().bg(f.verb === "edited" ? t.working : t.dim))
        .child(div().flex_1().min_w(0).truncate().font_family(UI_FONT).text_size(11).text_color(f.verb === "edited" ? t.foreground : t.muted)
          .tooltip(`${f.verb}: ${f.file}`).child(f.file)))));
}

// deps: { showTerminal(cx) } — switches the window to the real terminal (taking the draft along).
export function renderDeskChat(view, t, deps) {
  const d = view.desk;
  const agent = live(d.address);
  const status = agent?.status ?? "idle";
  const list = d.messages ? foldTools(d.messages) : [];
  const empty = !d.transcript
    ? "No conversation file for this agent yet: it appears after its next step (Claude Code or Codex with the office hooks)."
    : d.error ? `Can't read the conversation: ${d.error}` : d.messages === null ? "Reading…" : "Nothing said yet.";
  const access = accessOf(view);
  const tone = status === "blocked" ? t.blocked : t.dim;
  const waiting = access.canSend ? null
    : h_flex().id("desk-waiting").px(10).py(6).gap(8).items_center().bg(`${tone}33`).border_t(1).border_color(tone)
      .child(div().flex_1().font_family(UI_FONT).text_size(12).text_color(t.foreground).child(access.reason))
      .when(lifeOf(d.address, withHelpers(agents(), terminals()), terminals()) === "live", (el) => el.child(
        div().id("desk-open-terminal").px(8).py(3).bg(status === "blocked" ? t.blocked : t.surface).text_color("#ffffff").font_family(SIGN_FONT).text_size(10).cursor_pointer()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => deps.showTerminal(cx)).child("OPEN TERMINAL")));
  const typed = access.canSend && view.deskInput.value().trim() !== "";
  const input = h_flex().id("desk-input").px(10).py(8).gap(8).items_end().bg(t.chrome).border_t(1).border_color(t.border)
    .child(div().id("desk-box").flex_1().min_w(0).px(8).py(4).bg(t.canvas).border(1).border_color(t.accent).rounded(6).cursor_text()
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); view.deskInput.focus(); })
      .child(Textarea.new(view.deskInput).w_full().text_size(13).text_color(t.foreground)))
    .child(div().id("desk-send").px(12).py(6).rounded(6).bg(typed ? t.accent : t.surface).text_color(typed ? "#0b0d10" : t.dim)
      .font_family(SIGN_FONT).text_size(10).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .tooltip(access.canSend ? "Send (Enter)" : access.reason)
      .on_click((_e, cx) => send(view, cx)).child(d.sending ? "SENDING…" : "SEND"));
  return h_flex().id("desk-chat").size_full().bg(t.background)
    .child(v_flex().flex_1().min_w(0).h_full()
      .child(talk(view, list, t, empty))
      .when(Boolean(d.note), (el) => el.child(div().px(10).py(3).font_family(UI_FONT).text_size(11).text_color(t.accent).child(d.note)))
      .when(Boolean(waiting), (el) => el.child(waiting))
      .child(input))
    .child(side(view, agent, t));
}
