// The chat's history list: the messages as rows of a virtual list that stays on the newest message until the person
// scrolls up ("NEWEST" brings it back), tool calls folded into one line that opens on a click, and the jump from the
// side panel to the row that holds a file's call.
//
// Why a virtual list: it is the only scroll area a mod can move from code (scroll_to_bottom). Its rows need their
// heights up front and can't be measured inside it, so every message is also drawn once, invisibly, under the list,
// where on_size_change can measure it; until then an estimate from the text's length stands in.
// All of it works on the chat's view (view.desk, view.deskScroll, view.deskHeights ...: desk-chat.js sets them up).
import { div } from "gpui-kit";
import { Scrollbar, TextView, h_flex, v_flex, v_virtual_list } from "gpui-base";
import { findMessageRow, foldTools, joinConversations } from "./chat-model.js";
import { anchorFits, freshCount, inFile, messageRevision, newestSeq, olderState, trimLoaded } from "./chat-history.js";
import { BUTTON, INK_ON_ACCENT, MONO_FONT, RADIUS, SIGN_FONT, TOOL_SIZE, UI_FONT } from "./ui-tokens.js";

const STICK_MS = 60; // after a layout, so the list knows its new rows before it scrolls to them
const ROW_GAP = 8;
const OLDER_ITEM = { id: "older", role: "older" }; // the SHOW OLDER row: item 0 of the list while there is more history
const OLDER_HEIGHT = 32 + 8;
const MEASURE_BATCH = 10; // rows measured per frame, newest first (markdown is costly: more per frame got the render interrupted)

// A message's identity: the source's own id (hooks/adapters.mjs); a run of tool calls is named after its first call
// (chat-model.js foldTools), so it keeps its key (and stays open) while more calls join it.
export const keyOf = (m) => String(m.id);

// Mark what the person left (draft, opened tools, pinning) as changed; the view's own timer writes it a moment
// later (desk-chat.js), and the view's close writes it at once. No timers are started from event handlers: the one
// from init is the dependable one.
export function save(view, _cx) {
  if (view.deskClosed) return;
  view.deskDirty = true;
}

// Measured heights and opened tool runs of messages no longer in the history (KEEP moved on, another conversation)
// are dropped, so neither grows for ever (the opened runs are also kept in shared state).
export function forgetGone(view) {
  const d = view.desk;
  const list = rowsOf(d);
  const ids = new Set(list.map(keyOf));
  // A picked file whose call has left the history is no longer picked, and a jump to it is off.
  const picked = view.deskUi.selectedFile;
  if (picked && d.messages && !findMessageRow(list, picked.messageId)) {
    view.deskUi = { ...view.deskUi, selectedFile: null };
    view.deskUiDirty = true;
    view.deskJump = null;
  }
  // A height is kept while its row exists and its content is the one it was measured for (the revision is the key's end).
  const revisions = new Map(list.map((m) => [keyOf(m), rowRevision(m)]));
  const heights = Object.fromEntries(Object.entries(view.deskHeights).filter(([k]) => ids.has(k.split("|")[0]) && k.endsWith(`|${revisions.get(k.split("|")[0])}`)));
  const open = new Set([...d.open].filter((k) => ids.has(k)));
  view.deskHeights = heights;
  if (open.size !== d.open.size) {
    view.desk = { ...d, open };
    save(view);
  }
}

// Scroll to the newest message once the list has laid out what just changed.
export function stick(view, cx) {
  if (view.deskClosed || view.deskStick) return;
  view.deskStick = cx.timer.after(STICK_MS, (cx) => {
    view.deskStick = null;
    if (view.deskClosed || !view.deskPinned) return;
    view.deskScroll.scroll_to_bottom();
    cx.notify();
  });
}

// The history's rows as the list draws them: the previous conversation (if any) and this one, tool calls folded.
// Worked out once per state of the history (it was done at every render): remembered under the messages array, which
// changes whenever the history does, and checked against the previous conversation.
const rowMemo = new WeakMap();
export function rowsOf(d) {
  if (!d.messages) return [];
  // The previous conversation: what SHOW OLDER paged in (the whole of it, uncut) or the older reader's last 60.
  const before = d.prevHistory?.messages ?? d.prev;
  const beforeFile = d.prevHistory?.file ?? d.prevFile;
  const hit = rowMemo.get(d.messages);
  if (hit && hit.before === before && hit.beforeFile === beforeFile) return hit.rows;
  const rows = foldTools(!before?.length ? d.messages
    : joinConversations(beforeFile ? inFile(before, beforeFile) : before, d.messages, d.prevHistory ? { keep: Infinity } : {}));
  rowMemo.set(d.messages, { before, beforeFile, rows });
  return rows;
}

// Current rows retain their message objects. Previous fallback IDs are named by inFile; do not parse them or
// infer their file from the current history. Build the membership sets once per lookup/filter.
function rowSourceOf(d) {
  const current = new Set(d.messages ?? []);
  const previousFile = d.prevHistory?.file ?? d.prevFile;
  const previous = new Set(inFile(d.prevHistory?.messages ?? d.prev ?? [], previousFile).map(m => m.id));
  return row => {
    const message = row?.role === "tools" ? row.items[0] : row;
    if (!message || row.role === "divider" || row.role === "older") return null;
    if (current.has(message)) {
      const file = d.history?.file ?? d.transcript;
      return typeof file === "string" ? { file, epoch: d.history?.epoch ?? null } : null;
    }
    return typeof previousFile === "string" && previous.has(message.id) ? { file: previousFile, epoch: d.prevHistory?.epoch ?? null } : null;
  };
}

export function anchorOfRow(d, row) {
  const source = rowSourceOf(d)(row);
  const messageId = row?.role === "tools" ? row.items[0]?.id : row?.id;
  return source && typeof messageId === "string" ? { ...source, messageId } : null;
}

export function anchorContextOf(d, anchor) {
  const file = anchor?.file;
  const history = d.history?.file === file ? d.history : d.prevHistory?.file === file ? d.prevHistory
    : file && d.transcript === file && Array.isArray(d.messages) ? { file, epoch: null }
    : file && d.prevFile === file && Array.isArray(d.prev) ? { file, epoch: null } : null;
  const sourceOf = rowSourceOf(d);
  return { history, rows: rowsOf(d).filter(row => sourceOf(row)?.file === file) };
}

export function cancelChatTransfer(view) {
  if (view.deskClosed) return;
  view.deskTransferPending = false;
  view.deskTransferAnchor = null;
  view.deskOlderAnchor = null;
  view.deskOlderTimer?.cancel();
  view.deskOlderTimer = null;
  view.deskTopHeld = false; // the person moves the list: its top row is the reading point again
}

// Called only after the first successful cold read. Actual restoration uses the existing two-stage engine below.
export function restoreChatTransfer(view, cx) {
  if (view.deskClosed || !view.deskTransferPending || view.deskOlderTimer) return;
  const anchor = view.deskTransferAnchor;
  const { history, rows } = anchorContextOf(view.desk, anchor);
  if (anchorFits(anchor, history, rows, { transfer: true })) {
    view.deskTopKey = { ...anchor, epoch: history.epoch };
    view.deskOlderAnchor = { ...view.deskTopKey, generation: ++view.deskOlderGen };
    view.deskTransferAnchor = null;
    view.deskTransferPending = false;
    restoreOlderAnchor(view, cx);
  } else {
    view.desk = { ...view.desk, note: "This position is not in the loaded history. SHOW OLDER loads earlier messages." };
    // Wait for the first layout, just as the anchor engine does. No page read, no pinning and no synthetic tail.
    view.deskOlderTimer = cx.timer.after(STICK_MS, (cx) => {
      view.deskOlderTimer = null;
      if (view.deskClosed || !view.deskTransferPending || view.deskTransferAnchor !== anchor) return;
      view.deskTransferPending = false;
      view.deskTransferAnchor = null;
      view.deskTopKey = null;
      view.deskScroll.scroll_to_item(0, "top");
      cx.notify();
    });
  }
  cx.notify();
}

// What a row shows, as a short text that changes with it: the same id with other text, output, files or state is
// another revision (so a measured height is not reused for it). A run of tools is its calls' revisions together.
const rowRevision = (m) => (m.role === "tools" ? m.items.map(messageRevision).join(",") : m.role === "divider" ? m.text : messageRevision(m));

// Go to the call that touched a file: leave the newest message, open its run of tools, mark the row and scroll it to
// the middle once the list has laid out. The row is found by id in the very rows the list draws; a call that has
// left the loaded history is said, not guessed.
export function jumpToFile(view, file, cx) {
  if (view.deskClosed) return;
  cancelChatTransfer(view);
  const d = view.desk;
  const rows = rowsOf(d);
  const target = findMessageRow(rows, file.messageId);
  if (!target) {
    view.desk = { ...d, note: "That message is outside the loaded history." };
    cx.notify();
    return;
  }
  const row = rows[target.index];
  view.deskPinned = false;
  view.deskOlderAnchor = null;
  markSeen(view, rows.length);
  view.desk = { ...d, note: null, open: row.role === "tools" && !d.open.has(keyOf(row)) ? new Set([...d.open, keyOf(row)]) : d.open };
  view.deskUi = { ...view.deskUi, selectedFile: { conversationKey: d.transcript ?? "", path: file.path, messageId: file.messageId } };
  view.deskUiDirty = true;
  view.deskJump = { rowId: target.rowId };
  save(view, cx);
  view.deskJumpTimer?.cancel();
  view.deskJumpTimer = cx.timer.after(STICK_MS, (cx) => {
    view.deskJumpTimer = null;
    if (!view.deskClosed) runJump(view, cx);
  });
  cx.notify();
}

// Scroll to the jump's row. Once its own height is measured the jump is done; until then it stays, and the
// measurement runs it again (the rows above it moved when they were measured).
function runJump(view, cx) {
  const jump = view.deskJump;
  if (!jump || view.deskClosed) return;
  const rows = rowsOf(view.desk);
  const index = rows.findIndex((r) => keyOf(r) === jump.rowId);
  if (index < 0) {
    view.deskJump = null;
    return;
  }
  view.deskScroll.scroll_to_item(index, "center");
  if (view.deskHeights[sizeKey(view, rows[index])] !== undefined) view.deskJump = null;
  cx.notify();
}

// The picked file as the panel marks it: only for the conversation it was picked in.
export const pickedFile = (view) => {
  const p = view.deskUi.selectedFile;
  return p && p.conversationKey === (view.desk.transcript ?? "") ? p : null;
};

// What was there when the person left the newest message: with the v3 reader the place of the newest message (and which
// file and generation of its history it is in), so folding, SHOW OLDER pages and a trimmed history can't change the
// count; with the older reader how many rows there were.
function markSeen(view, rows) {
  const h = view.desk.history;
  view.deskSeen = rows;
  view.deskSeenSeq = h ? newestSeq(h.messages) : -1;
  view.deskSeenFile = h?.file ?? null;
  view.deskSeenEpoch = h?.epoch ?? null;
}

// How many messages came after that: counted by place (v3); another file or generation than the one remembered counts
// everything it has (nothing is known to be seen); the older reader's history counts rows.
function freshOf(view, rows) {
  const h = view.desk.history;
  if (!h) return Math.max(0, rows.length - view.deskSeen);
  const seen = h.file === view.deskSeenFile && h.epoch === view.deskSeenEpoch ? view.deskSeenSeq : -1;
  return freshCount(h.messages, seen);
}

// Leave the newest message (the person scrolls up or grabs the scrollbar): remember what was there.
export function unpin(view, rows, cx) {
  if (view.deskClosed) return;
  if (!view.deskPinned) return;
  view.deskPinned = false;
  markSeen(view, rows);
  save(view, cx);
  cx.notify();
}

export function follow(view, cx) {
  if (view.deskClosed) return;
  cancelChatTransfer(view);
  view.deskPinned = true;
  // Back to the newest message: a SHOW OLDER request on its way is off, the place it would hold is no more, and what was
  // paged in above is let go (the history is cut back, the previous conversation shows its last 60 again).
  view.deskOlderAnchor = null;
  view.deskOlderGen = (view.deskOlderGen ?? 0) + 1;
  const kept = view.desk.history;
  if (kept || view.desk.prevHistory) {
    const trimmed = kept ? trimLoaded(kept, { pinned: true }) : kept;
    view.desk = { ...view.desk, older: { busy: false, error: null }, prevHistory: null, ...(trimmed && trimmed !== kept ? { history: trimmed, messages: trimmed.messages } : {}) };
  }
  // At its limit the history stopped taking reads in: NEWEST frees it (the next read starts from scratch).
  const h = view.desk.history;
  if (h?.limited) {
    view.desk = { ...view.desk, history: { ...h, limited: false, resync: true } };
    view.deskWant?.(cx);
  }
  save(view, cx);
  view.deskScroll.scroll_to_bottom();
  stick(view, cx);
  cx.notify();
}

function toggleTools(view, key) {
  const open = new Set(view.desk.open);
  if (open.has(key)) open.delete(key);
  else open.add(key);
  view.desk = { ...view.desk, open };
}

// A call's mark: done, failed (never mistaken for done) or still running.
const MARK = { ok: "✓", error: "✗", running: "…", unknown: "·" };
const OUTPUT_LINES = 12; // of a failed call's output, under it when its run is open

function toolRun(view, m, t) {
  const opened = view.desk.open.has(keyOf(m));
  const names = (xs) => xs.map((x) => `${MARK[x.status] ?? ""} ${x.text}`.trim()).join(" · ");
  const head = m.items.length === 1 ? names(m.items) : `${m.items.length} tools · ${names(m.items.slice(-2))}`;
  const failed = m.failed > 0;
  return v_flex().flex_none().w_full().px(8).py(2).gap(2).cursor_pointer()
    .child(h_flex().gap(6).items_center()
      .child(div().flex_1().min_w(0).font_family(UI_FONT).text_size(TOOL_SIZE).text_color(opened ? t.muted : t.dim).truncate().child(`${opened ? "▾" : "▸"} ${head}`))
      .when(failed, (el) => el.child(div().flex_none().px(5).font_family(SIGN_FONT).text_size(9).text_color(t.blocked).border(1).border_color(t.blocked)
        .child(m.failed === 1 ? "FAILED" : `${m.failed} FAILED`))))
    .when(opened, (el) => el.children(m.items.map((x) => v_flex().pl(14).gap(1)
      .child(div().font_family(MONO_FONT).text_size(TOOL_SIZE).text_color(x.status === "error" ? t.blocked : t.muted)
        .child(`${MARK[x.status] ?? " "} ${x.text}`))
      .children(x.files?.length ? [div().pl(14).font_family(MONO_FONT).text_size(BUTTON.size).text_color(t.dim).child(x.files.map((f) => f.path).join("\n"))] : [])
      .children(x.status === "error" && x.output ? [div().pl(14).font_family(MONO_FONT).text_size(BUTTON.size).text_color(t.blocked)
        .child(x.output.split("\n").slice(0, OUTPUT_LINES).join("\n"))] : []))));
}

// The line between conversations (/clear, resume).
function divider(m, t) {
  return h_flex().flex_none().w_full().py(4).gap(8).items_center()
    .child(div().flex_1().h(1).bg(t.border))
    .child(div().font_family(SIGN_FONT).text_size(9).text_color(t.dim).child(m.text.toUpperCase()))
    .child(div().flex_1().h(1).bg(t.border));
}

// One message, without handlers: it is drawn inside the virtual list's renderer (clicks go to on_item_click).
function bubble(view, m, t, measuring = false) {
  if (m.role === "tools") return toolRun(view, m, t);
  if (m.role === "divider") return divider(m, t);
  if (m.role === "note") {
    return div().flex_none().w_full().px(12).font_family(UI_FONT).text_size(11).text_color(t.dim).child(m.text);
  }
  const key = `${measuring ? "m-" : ""}${keyOf(m)}`;
  if (m.role === "user") {
    // Sent by another agent (hc send): says which one, so it isn't taken for the person's own words.
    return v_flex().flex_none().w_full().items_end().gap(2)
      .when(Boolean(m.from), (el) => el.child(div().font_family(UI_FONT).text_size(10).text_color(t.dim).child(`from agent ${m.from}`)))
      .child(div().max_w("85%").px(12).py(8).bg(m.from ? `${t.surface}e6` : `${t.accent}1f`).border(1).border_color(m.from ? t.border : `${t.accent}55`).rounded(RADIUS.bubble)
        .text_size(13).text_color(t.foreground).child(TextView.markdown(`umd-${key}`, m.text).selectable(!measuring)));
  }
  return div().flex_none().w_full().px(12).py(8).bg(`${t.surface}e6`).rounded(RADIUS.bubble).border_l(2).border_color(t.accent)
    .text_size(13).text_color(t.foreground).child(TextView.markdown(`md-${key}`, m.text).selectable(!measuring));
}

// A first guess at a row's height, from its text and the list's width (replaced by the measured one).
function estimate(view, m) {
  if (m.role === "divider" || m.role === "note") return 24 + ROW_GAP;
  if (m.role === "tools") {
    const call = (x) => 18 + 14 * (x.files?.length ?? 0) + (x.status === "error" && x.output ? 14 * Math.min(OUTPUT_LINES, x.output.split("\n").length) : 0);
    return 22 + (view.desk.open.has(keyOf(m)) ? m.items.reduce((n, x) => n + call(x), 0) : 0) + ROW_GAP;
  }
  const perLine = Math.max(20, Math.floor((view.deskWidth * (m.role === "user" ? 0.85 : 1) - 40) / 7.4));
  const lines = m.text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return lines * 20 + 18 + ROW_GAP;
}

// A row's height depends on its text, the list's width and (for a tool run) how many calls it holds and whether
// it is open: all of that is in the cache key.
const sizeKey = (view, m) => `${keyOf(m)}|${m.items?.map((x) => x.status?.[0] ?? "").join("") ?? ""}|${view.desk.open.has(keyOf(m)) ? 1 : 0}|${Math.round(view.deskWidth)}|${rowRevision(m)}`;
const heightOf = (view, m) => view.deskHeights[sizeKey(view, m)] ?? estimate(view, m);

// Which rows the measuring layer draws this frame: while SHOW OLDER holds a place (the anchor), the unmeasured rows above
// the anchor, nearest first, so that the place settles; then the unmeasured ones from the newest.
function measureBatch(view, list) {
  const todo = [];
  const unmeasured = (m) => view.deskHeights[sizeKey(view, m)] === undefined;
  const anchor = view.deskOlderAnchor ? findMessageRow(list, view.deskOlderAnchor.messageId) : null;
  if (anchor) {
    for (let i = anchor.index - 1; i >= 0 && todo.length < MEASURE_BATCH; i--) if (unmeasured(list[i])) todo.push(list[i]);
  }
  for (let i = list.length - 1; i >= 0 && todo.length < MEASURE_BATCH; i--) {
    if (unmeasured(list[i]) && !todo.includes(list[i])) todo.push(list[i]);
  }
  return todo;
}

// The SHOW OLDER row: a label in the middle (what it says and does: chat-history.js olderState).
function olderRow(st, t) {
  return div().w_full().pb(ROW_GAP).child(h_flex().w_full().h(OLDER_HEIGHT - ROW_GAP).items_center().gap(8)
    .child(div().flex_1().h(1).bg(t.border))
    .child(div().font_family(SIGN_FONT).text_size(10).text_color(st.disabled ? t.dim : st.error ? t.blocked : t.accent).when(!st.disabled && !st.busy, (el) => el.cursor_pointer()).child(st.label))
    .child(div().flex_1().h(1).bg(t.border)));
}

// Put the list back where the person was after SHOW OLDER put rows above them: scroll to the row that was first, now
// that more rows are above it, and again after each batch of rows above it is measured (their real heights move it).
// Once every row above is measured the anchor is done. Not kept for another history, a row that is gone, or when the
// person has scrolled by hand (the wheel, the scrollbar, NEWEST and jumps drop it).
//
// The order matters: the list only knows its new items and their sizes after it has been drawn again. So the scroll never
// happens at once (that was before the draw: the list still had its old item count, took the index for a place past its end
// and went to the bottom); restoreOlderAnchor only asks for it, STICK_MS later, when the page has been laid out, and the
// measuring of the rows above (one batch a frame, nearest first) asks again after each batch. One request at a time.
//
// scroll_to_item "top" only brings a row to the *near* edge: the anchor, pushed below the screen by the page, would land
// at the bottom. So the place is taken in two steps: first a row about a screen below the anchor (the anchor is now above
// the screen), then, a frame later, the anchor, which comes to the top edge. Done once at once (estimated heights) and once
// more when every row above is measured; the batches in between do not move the list.
export function restoreOlderAnchor(view, cx) {
  if (!view.deskOlderAnchor || view.deskClosed || view.deskOlderTimer) return;
  view.deskOlderTimer = cx.timer.after(STICK_MS, (cx) => {
    view.deskOlderTimer = null;
    runOlderAnchor(view, cx);
  });
}

function runOlderAnchor(view, cx) {
  const a = view.deskOlderAnchor;
  if (!a || view.deskClosed) return;
  const { history, rows: fileRows } = anchorContextOf(view.desk, a);
  const rows = rowsOf(view.desk);
  const hit = anchorFits(a, history, fileRows) ? findMessageRow(rows, a.messageId) : null;
  if (!hit) {
    view.deskOlderAnchor = null;
    if (view.deskTopKey?.file === a.file && view.deskTopKey?.epoch === a.epoch) view.deskTopKey = null;
    return;
  }
  const settled = aboveMeasured(view, rows, hit.index);
  if (a.placed && !settled) return; // placed on estimates already: the next time is with the true heights
  const shift = olderState(view.desk).show ? 1 : 0;
  const below = rowScreenBelow(view, rows, hit.index);
  if (below < 0) view.deskScroll.scroll_to_bottom();
  else view.deskScroll.scroll_to_item(below + shift, "top");
  const mine = { ...a, placed: true };
  view.deskOlderAnchor = mine;
  view.deskOlderTimer = cx.timer.after(STICK_MS, (cx) => {
    view.deskOlderTimer = null;
    if (view.deskOlderAnchor !== mine || view.deskClosed) return;
    const now = rowsOf(view.desk);
    const context = anchorContextOf(view.desk, mine);
    const at = anchorFits(mine, context.history, context.rows) ? findMessageRow(now, mine.messageId) : null;
    if (!at) {
      view.deskOlderAnchor = null;
      if (view.deskTopKey?.file === mine.file && view.deskTopKey?.epoch === mine.epoch) view.deskTopKey = null;
      return;
    }
    view.deskScroll.scroll_to_item(at.index + (olderState(view.desk).show ? 1 : 0), "top");
    view.deskTopKey = { messageId: mine.messageId, file: mine.file, epoch: mine.epoch };
    // Held until the person scrolls: the list's first item may be the row above, shown by a few pixels, and taking it
    // would move the point up a row at every move of the chat.
    view.deskTopHeld = true;
    // With true heights above: done. Else the next measured batch asks again (or, if the last one came meanwhile, now).
    if (settled) view.deskOlderAnchor = null;
    else if (aboveMeasured(view, now, at.index)) restoreOlderAnchor(view, cx);
    cx.notify();
  });
  cx.notify();
}

const aboveMeasured = (view, rows, index) => rows.slice(0, index).every((m) => view.deskHeights[sizeKey(view, m)] !== undefined);

// The first row after the anchor that ends more than a screen below it (-1: the list ends sooner, the bottom will do).
const SCREEN_MARGIN = 100; // estimated heights may be short
function rowScreenBelow(view, rows, index) {
  const need = (view.deskTalkHeight || 800) + SCREEN_MARGIN;
  let sum = 0;
  for (let j = index + 1; j < rows.length; j++) {
    sum += heightOf(view, rows[j]);
    if (sum >= need) return j;
  }
  return -1;
}

// The history: the measuring layer (invisible, under the list) and the list itself. Only rows without a measured
// height for the current width are drawn in the measuring layer, newest first, a batch per frame.
export function talk(view, list, t, empty) {
  if (list.length === 0) {
    return div().id("desk-talk").flex_1().min_h(0).p(12).font_family(UI_FONT).text_size(12).text_color(t.dim).child(empty);
  }
  // SHOW OLDER is the list's first item while there is more history (chat-history.js olderState).
  const older = olderState(view.desk);
  const items = older.show ? [OLDER_ITEM, ...list] : list;
  const keys = items.map(keyOf);
  const sizes = items.map((m) => (m === OLDER_ITEM ? OLDER_HEIGHT : heightOf(view, m)));
  const hot = findMessageRow(list, pickedFile(view)?.messageId)?.rowId;
  const row = (m) => (m === OLDER_ITEM ? olderRow(older, t) : div().w_full().pb(ROW_GAP).bg(keyOf(m) === hot ? `${t.accent}1a` : "#00000000").child(bubble(view, m, t)));
  const todo = measureBatch(view, list);
  const measure = v_flex().absolute().left(0).top(0).w_full().opacity(0)
    .children(todo.map((m) => {
      const k = sizeKey(view, m);
      return div().id(`measure-${k}`).w_full().pb(ROW_GAP)
        .on_size_change((sz, cx) => {
          if (view.deskClosed) return;
          if (view.deskHeights[k] === Math.ceil(sz.height)) return;
          view.deskHeights = { ...view.deskHeights, [k]: Math.ceil(sz.height) };
          view.deskMeter?.meterRows(1);
          if (view.deskPinned) stick(view, cx);
          else if (view.deskOlderAnchor) restoreOlderAnchor(view, cx); // the rows above the anchor change its place as they are measured
          else if (view.deskJump && k.split("|")[0] === view.deskJump.rowId) runJump(view, cx); // its real height is known now
          cx.notify();
        })
        .child(bubble(view, m, t, true));
    }));
  const fresh = freshOf(view, list);
  return div().id("desk-talk").flex_1().min_h(0).relative().overflow_hidden().px(12).pt(12)
    .on_size_change((sz, cx) => {
      if (view.deskClosed) return;
      view.deskTalkHeight = sz.height; // a screen, for the SHOW OLDER anchor (rowScreenBelow)
      if (Math.abs(sz.width - view.deskWidth) < 1) return;
      // Heights measured at another width no longer hold: start over (estimates stand in meanwhile).
      view.deskWidth = sz.width;
      view.deskHeights = {};
      if (view.deskPinned) stick(view, cx);
      cx.notify();
    })
    // Scrolling up leaves the newest message; NEW (or sending) comes back to it.
    .on_scroll_wheel((e, cx) => {
      if (view.deskClosed) return;
      cancelChatTransfer(view);
      view.deskJump = null; // the person scrolls by hand: a jump still on its way is off
      view.deskOlderAnchor = null; // ... and so is the anchor that holds the place after SHOW OLDER
      if ((e.delta?.y ?? 0) > 0) unpin(view, list.length, cx);
    })
    .child(measure)
    .child(v_virtual_list("desk-list", items.length, sizes, (i) => keys[i], (range) => {
      if (view.deskClosed) return [];
      if (!view.deskOlderAnchor && !view.deskTransferPending && !(view.deskTopHeld && view.deskTopKey)) {
        const first = items.slice(range.start, range.end).find(m => m.role !== "older" && m.role !== "divider");
        if (first) view.deskTopKey = anchorOfRow(view.desk, first);
      }
      return items.slice(range.start, range.end).map(row);
    })
      .track_scroll(view.deskScroll).size_full()
      .on_item_click((key, cx) => {
        if (view.deskClosed) return;
        if (key === OLDER_ITEM.id) {
          if (!older.disabled) view.deskOlderRequest?.(cx);
          return;
        }
        const m = list.find((x) => keyOf(x) === key);
        if (m?.role !== "tools") return;
        toggleTools(view, key);
        save(view, cx);
        cx.notify();
      }))
    // Grabbing the scrollbar is reading the history too.
    .child(div().id("desk-scrollbar").absolute().top(0).right(0).bottom(0).w(10)
      .on_mouse_down("left", (_e, cx) => { if (view.deskClosed) return; cancelChatTransfer(view); view.deskJump = null; unpin(view, list.length, cx); })
      .child(Scrollbar.vertical("desk-list").size_full()))
    .when(!view.deskPinned, (el) => el.child(
      div().id("desk-newest").absolute().right(18).bottom(10).px(10).py(5).rounded(RADIUS.pill).bg(t.accent).text_color(INK_ON_ACCENT)
        .font_family(SIGN_FONT).text_size(10).cursor_pointer()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .tooltip("Back to the newest message")
        .on_click((_e, cx) => follow(view, cx)).child(fresh > 0 ? `↓ ${fresh} NEW` : "↓ NEWEST")));
}
