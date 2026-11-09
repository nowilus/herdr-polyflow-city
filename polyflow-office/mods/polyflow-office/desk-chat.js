// The desktop chat: an agent's conversation as a chat (its own session file, read by hooks/transcript.mjs), a box
// to write to it (hc send) and a side panel with what it is doing, the files it touched and its plan. This file is
// the chat's life: setup and close, polling, sending, saving what the person left, and putting the parts together.
// The history list is chat-list.js, the panel chat-panel.js, the reading and the shared state chat-io.js, the box
// text-field.js. Approvals and questions still need the real terminal: the chat says so and the title bar switches
// to it in one click.
import { div } from "gpui-kit";
import { VirtualListScrollHandle, h_flex, v_flex } from "gpui-base";
import { agents, hc, shared, spaces, terminals } from "herdr";
import { crewOf, doingText } from "./activity.js";
import { CHAT_KEYS_HINT, SUBAGENTS_KEY, chatAccess, clockStepMs, internalOf, lifeOf, mergePoll, nowCall, panelFiles, panelModeOf, repoDirtyFrom, repoNote, repoPollDecision, splitFiles, toolLine, withCollapsed, withRepoStats } from "./chat-model.js";
import { patchChat, patchSend, patchUi, readConversationFrom, readConversationRecord, readConversationV3, readOlder, readRepoSnapshot, savedChat, savedSend, savedUi, sourceHome } from "./chat-io.js";
import { CHAT_OWNER_KEY, transferable } from "./chat-place.js";
import { acceptPage, acceptRead, anchorFits, messageBytes, olderState } from "./chat-history.js";
import { CHECK_MS, readDecision, recordSignature } from "./chat-read-model.js";
import { watchFile } from "./folder-watch.js";
import { openFilePreview } from "./chat-file-preview.js";
import { randomToken, startMeterFlush } from "./cost-meter.js";
import { allLine, createMeter, readerLine } from "./cost-model.js";
import { META_KEY, energyOf, metaOfAgent, sessionContext } from "./energy.js";
import { anchorContextOf, anchorOfRow, cancelChatTransfer, follow, forgetGone, jumpToFile, pickedFile, restoreChatTransfer, restoreOlderAnchor, rowsOf, save, stick, talk, unpin } from "./chat-list.js";
import { FILES_STEP, renderChatPanel } from "./chat-panel.js";
import { bindFieldKeys, createTextField, releaseTextField, renderTextField } from "./text-field.js";
import { RADIUS, SIGN_FONT, UI_FONT } from "./ui-tokens.js";
import { uiButton } from "./ui-kit.js";
import { isCalm } from "./labels.js";

const REPO_TICK_MS = 1000;
// What the person left in a chat, per agent (chat-io.js): the draft, opened tool runs and following the newest
// message in the chat's own entry, the panel's folded sections in another. Kept in shared state because the window
// is rebuilt by its size buttons and by the CHAT/TERMINAL switch. Draft/version publish on every local edit;
// list and panel state use the delayed save below.
const SAVE_MS = 150;
const savedOf = savedChat;
const DEFAULT_BOX = { w: 800, h: 500 }; // the chat's size until its first layout says otherwise

const everyone = () => crewOf(agents(), terminals(), shared(SUBAGENTS_KEY));
const live = (address) => everyone().find((a) => a.address === address) ?? null;
// Where the agent is in its life; an internal subagent the office no longer lists has finished.
const lifeHere = (address) => (internalOf(address) && !live(address) ? "ended" : lifeOf(address, everyone(), terminals()));

// view.desk: { address, transcript, bound, size, cwd, messages (this session file's), prev (the conversation before
// /clear or resume, shown above a line), pending (a new session file not read yet: the old one stays meanwhile),
// stale (the last read failed: what is shown is the last good copy), record, sending, note, error,
// open: Set of opened tool runs }
export function openChatSession(address, cx, { focusInput = false, place } = {}) {
  const session = { deskPlace: place };
  initDeskChat(session, address, cx, { focusInput });
  return session;
}

export function closeChatSession(session) {
  if (!session || session.deskClosed) return;
  closeDeskChat(session);
}

export function renderChatSession(session, t, deps) {
  return renderDeskChat(session, t, deps);
}

export function focusChatSession(session) {
  if (!session || session.deskClosed || !accessOf(session).canSend) return false;
  try { session.deskField.focus(); }
  catch { session.desk = { ...session.desk, note: "Click the box to write" }; }
  return true;
}

// A closed object is never reused. In-flight work drains before its heavy state is detached.
function drained(view) {
  if (!view.deskClosed || view.deskPending) return;
  for (const key of ["desk", "deskHeights", "deskRepo", "deskRepoSeen", "deskRead", "deskUi", "deskField", "deskScroll", "deskFocus", "deskCx", "deskMeter", "deskMeterFlush", "deskTimers", "deskOlderAnchor", "deskJump", "deskTopKey", "deskTransferAnchor"]) view[key] = null;
}

function spawnDesk(view, cx, body) {
  view.deskPending = (view.deskPending ?? 0) + 1;
  return cx.spawn(async (acx) => {
    try { await body(acx); }
    finally { view.deskPending -= 1; drained(view); }
  });
}

export function initDeskChat(view, address, cx, { focusInput = false } = {}) {
  if (view.deskClosed || view.desk) throw new Error("Chat session objects cannot be reused");
  const saved = transferable(savedOf(address));
  view.deskDraftVersion = typeof saved.draftVersion === "string" ? saved.draftVersion : randomToken(16);
  view.deskDraftApplying = false;
  view.deskDraftTouched = false;
  view.deskSendingToken = null;
  if (typeof saved.draftVersion !== "string") patchChat(address, { draft: typeof saved.draft === "string" ? saved.draft : "", draftVersion: view.deskDraftVersion });
  view.desk = { address, transcript: null, bound: null, size: -1, cwd: null, messages: null, prev: null, prevFile: null, pending: false, stale: null,
    history: null, readerMode: null, readerKey: randomToken(16), // the v3 history of the file, whether the hook knows v3, this window's checkpoint name
    prevHistory: null, prevReaderKey: randomToken(16), older: { busy: false, error: null }, // the previous conversation's history (SHOW OLDER) and its checkpoint; the request in flight
    record: null, sending: false, note: null, error: null,
    open: new Set(Array.isArray(saved.open) ? saved.open.filter((k) => typeof k === "string") : []) };
  view.deskScroll = VirtualListScrollHandle.new();
  view.deskHeights = {}; // sizeKey -> measured row height, for the current width only
  view.deskWidth = 600;
  view.deskStick = null; // the pending scroll to the newest message (one at a time)
  view.deskSeen = typeof saved.seen === "number" ? saved.seen : 0; // rows there were when the person scrolled away ("N NEW"; the older reader)
  // ... and with the v3 reader: the place of the newest message then, in which file and generation of its history
  view.deskSeenSeq = Number.isSafeInteger(saved.seenSeq) ? saved.seenSeq : -1;
  view.deskSeenFile = typeof saved.seenFile === "string" ? saved.seenFile : null;
  view.deskSeenEpoch = typeof saved.seenEpoch === "string" ? saved.seenEpoch : null;
  view.deskWant = (cx) => wantRead(view, cx); // for the history list (NEWEST asks for a fresh read)
  view.deskOlderRequest = (cx) => requestOlder(view, cx); // ... and its SHOW OLDER row
  view.deskOlderGen = 0; // which SHOW OLDER request is the current one (an answer of an older one is dropped)
  view.deskOlderAnchor = null; // { file, epoch, messageId, generation }: the row that holds the place after SHOW OLDER
  view.deskPinned = saved.pinned !== false; // following the newest message
  view.deskTopKey = null;
  view.deskTopHeld = false; // a restored reading point, kept until the person scrolls (chat-list.js runOlderAnchor)
  view.deskTransferAnchor = view.deskPinned ? null : saved.anchor;
  view.deskTransferPending = !view.deskPinned;
  view.deskDirty = false; // something to write to the chat's entry
  view.deskClosed = false;
  // What this window's readers cost (the SESSION section shows it; metrics.json gets it from the flush).
  view.deskMeter = createMeter();
  view.deskMeterFlush = startMeterFlush(cx, "chat", view.deskMeter, { notify: true });
  view.deskUi = savedUi(address); // the side panel's folded sections
  view.deskUiDirty = false;
  view.deskBox = DEFAULT_BOX; // the chat's own size, from its first layout (decides where the panel sits)
  view.deskPanelLayout = panelModeOf(DEFAULT_BOX.w, DEFAULT_BOX.h);
  view.deskDrawer = false; // the panel's drawer is open (narrow chats)
  view.deskShown = { changed: FILES_STEP, read: FILES_STEP }; // how many files of each list are listed
  view.deskJump = null; // a scroll to a picked file's row that is still on its way: { rowId }
  view.deskRepo = freshRepo(0, ""); // what the repo says about the files (see repoTick)
  view.deskRepoSeen = null; // the edits the conversation has settled so far: a new one asks for a repo read (see noteEdits)
  // A real text box (text-field.js): cursor, selection, paste, several lines. Enter sends, Shift+Enter is a new line.
  view.deskField = createTextField({
    id: "desk", mode: "multi", rows: [1, 8], placeholder: CHAT_KEYS_HINT, value: typeof saved.draft === "string" ? saved.draft : "",
    onChange: (value, cx) => { if (!view.deskClosed && !view.deskDraftApplying) { publishDraft(view, value); save(view, cx); cx?.notify(); } },
    onSubmit: (snap, cx) => send(view, cx, snap),
  });
  // Esc leaves the box (the keyboard goes to the chat itself); the draft stays and the conversation stays open.
  bindFieldKeys(cx);
  view.deskFocus = cx.focus_handle();
  syncChatSession(view, cx);
  // The keyboard goes to the box only when the person opened the chat to write (the card's CHAT, OPEN CHAT): a window
  // rebuilt by its size buttons, or opened by a click on an agent, must not take it from where it was.
  if (focusInput && !internalOf(address)) view.deskField.focus();
  // When the conversation is read (chat-read-model.js): at once, then when the watcher or the cheap record tick says
  // something was written, and as a control every CONTROL_MS. A quiet chat starts no process in between.
  view.deskRead = { busy: false, checking: false, dirtyAt: null, lastStart: null, lastControl: null, seen: null, timer: null, watch: null, watched: null };
  // The watcher keeps a context and tells it later: only an AsyncContext (from cx.spawn) may be kept; a plain Context is good for one host call.
  view.deskCx = null;
  spawnDesk(view, cx, (acx) => { if (!view.deskClosed) view.deskCx = acx; });
  startRead(view, cx, true);
  view.deskTimers = [
    cx.timer.every(CHECK_MS, (cx) => recordTick(view, cx)),
    cx.timer.every(SAVE_MS, (cx) => {
      if (view.deskClosed) return;
      syncDeskClock(view, cx);
      syncChatSession(view, cx);
      if (view.deskDirty) flushDeskChat(view);
      if (view.deskUiDirty) flushDeskUi(view);
    }),
  ];
  // Git cadence is independent of the presentation clock and CALM.
  view.deskRepoTimer = cx.timer.every(REPO_TICK_MS, cx => repoTick(view, cx));
  syncDeskClock(view, cx);
}

function syncDeskClock(view, cx) {
  if (view.deskClosed) return;
  const step = clockStepMs(isCalm());
  if (view.deskClockStep === step && view.deskClockTimer) return;
  view.deskClockTimer?.cancel();
  view.deskClockStep = step;
  view.deskClockTimer = cx.timer.every(step, cx => {
    if (!view.deskClosed && clockShows(view)) cx.notify();
  });
}

// The chat window goes away (closed or rebuilt): keep what was left, stop the timers, let go of the box. Twice is fine.
export function closeDeskChat(view) {
  if (!view.desk || view.deskClosed) return;
  syncChatSession(view);
  flushDeskChat(view);
  flushDeskUi(view);
  view.deskClosed = true;
  for (const task of view.deskTimers ?? []) task.cancel();
  view.deskClockTimer?.cancel();
  view.deskRepoTimer?.cancel();
  view.deskClockTimer = null;
  view.deskRepoTimer = null;
  view.deskOlderGen += 1; // a SHOW OLDER answer on its way is dropped
  view.deskRead?.timer?.cancel(); // a read that is running finds the window closed and changes nothing
  view.deskRead?.watch?.stop();
  view.deskMeterFlush?.stop();
  for (const key of ["deskStick", "deskOlderTimer", "deskJumpTimer"]) {
    view[key]?.cancel();
    view[key] = null;
  }
  view.deskWant = null;
  view.deskOlderRequest = null;
  releaseTextField(view.deskField);
  view.deskScroll?.release();
  drained(view);
}

// Write what the person left right away (the window is being rebuilt or closed: no time for the delayed save).
// Only our own fields are written, into the entry as it is now: what other parts of the office keep in it (the side
// panel's sections) and other agents' entries stay.
export function flushDeskChat(view) {
  if (!view.desk || !view.deskField) return;
  view.deskDirty = false;
  // Draft/version are published by edits, never by the delayed list/UI flush.
  const anchor = view.deskPinned ? null : view.deskTopKey ?? view.deskTransferAnchor;
  patchChat(view.desk.address, { open: [...view.desk.open], pinned: view.deskPinned, seen: view.deskSeen, seenSeq: view.deskSeenSeq, seenFile: view.deskSeenFile, seenEpoch: view.deskSeenEpoch,
    anchor: transferable({ anchor }).anchor });
}

function publishDraft(view, value) {
  if (view.deskDraftApplying || view.deskClosed) return;
  view.deskDraftTouched = true;
  view.deskDraftVersion = randomToken(16);
  patchChat(view.desk.address, { draft: value, draftVersion: view.deskDraftVersion });
}

function adoptDraft(view, cx) {
  const saved = savedOf(view.desk.address);
  if (view.deskDraftTouched || saved.draftVersion === view.deskDraftVersion) return false;
  view.deskDraftApplying = true;
  try {
    view.deskField.setValue(typeof saved.draft === "string" ? saved.draft : "", cx);
    view.deskDraftVersion = saved.draftVersion;
  } finally { view.deskDraftApplying = false; }
  return true;
}

const sendRuntime = () => shared(CHAT_OWNER_KEY)?.runtime ?? "local";

// May run before Enter or close, not only on the SAVE tick. No process or automatic retry.
export function syncChatSession(view, cx) {
  if (view.deskClosed) return;
  let delivery = savedSend(view.desk.address);
  if (delivery?.status === "pending" && !delivery.token.startsWith(`${sendRuntime()}:`)) {
    delivery = { ...delivery, status: "failed", error: "Delivery status unknown after restart. Check the terminal before sending again." };
    patchSend(view.desk.address, delivery);
  }
  let changed = false;
  if (delivery && delivery.status !== "pending") changed = adoptSendResult(view, { ...delivery, address: view.desk.address }, null, cx);
  if (adoptDraft(view, cx)) changed = true;
  const sending = savedSend(view.desk.address)?.status === "pending";
  if (view.desk.sending !== sending) { view.desk = { ...view.desk, sending }; changed = true; }
  if (changed) cx?.notify();
}

// The panel's folded sections, into their own entry.
function flushDeskUi(view) {
  if (!view.desk) return;
  view.deskUiDirty = false;
  patchUi(view.desk.address, { collapsed: view.deskUi.collapsed, selectedFile: view.deskUi.selectedFile });
}

// Fold or open one panel section; kept for this agent.
function toggleSection(view, key, cx) {
  if (view.deskClosed) return;
  view.deskUi = withCollapsed(view.deskUi, key, !view.deskUi.collapsed[key]);
  view.deskUiDirty = true;
  cx.notify();
}

// What the chat may do now (chat-model.js chatAccess), from Herdr's live data and the session file's binding.
function accessOf(view) {
  const status = live(view.desk.address)?.status ?? "idle";
  return chatAccess({ bound: view.desk.bound, status, life: lifeHere(view.desk.address), internal: Boolean(internalOf(view.desk.address)) });
}

// ---- SHOW OLDER: more of the history above what is shown ----

// Load one more page above the loaded part: the file's older history, and once that is all there, the previous
// conversation (read the first time through the v3 reader, then paged the same way). One request at a time (the row says
// LOADING…). The place is held by an anchor on the first message shown (chat-list.js restoreOlderAnchor). The answer is used
// only when nothing it was asked for changed meanwhile: the window, the history, its generation, the request.
export function requestOlder(view, cx) {
  if (view.deskClosed) return;
  const d = view.desk;
  const st = olderState(d);
  if (!st.show || st.disabled || st.busy || view.deskClosed) return;
  cancelChatTransfer(view);
  const generation = ++view.deskOlderGen;
  const rows = rowsOf(d);
  if (view.deskPinned) unpin(view, rows.length, cx); // reading the history: it is not cut back to 400 meanwhile
  // The first message of the file being paged holds the place; the first of the current file when the previous conversation
  // is read for the first time (what it shows above is replaced).
  const first = st.source === "previous-init" ? d.messages?.[0] : rows.find((r) => r.role !== "divider");
  const anchor = first ? anchorOfRow(d, first) : null;
  view.deskOlderAnchor = anchor ? { ...anchor, generation } : null;
  view.desk = { ...view.desk, older: { busy: true, error: null } };
  cx.notify();
  spawnDesk(view, cx, async (cx) => {
    let error = null;
    try {
      const home = await sourceHome(view.deskMeter);
      if (view.deskClosed || generation !== view.deskOlderGen) return;
      const read = await olderRead(view, d, st.source, home);
      if (view.deskClosed || generation !== view.deskOlderGen) return;
      error = applyOlder(view, cx, d, st.source, read);
    } catch (e) {
      error = String(e?.message ?? e).slice(0, 120);
    } finally {
      if (view.deskClosed) view.desk = { ...view.desk, older: { busy: false, error: null } };
      if (!view.deskClosed && generation === view.deskOlderGen) {
        view.desk = { ...view.desk, older: { busy: false, error } };
        if (view.deskOlderAnchor?.generation === generation) restoreOlderAnchor(view, cx);
        else view.deskOlderAnchor = null;
        cx.notify();
      }
    }
  });
}

function olderRead(view, d, source, home) {
  const h = d.history;
  if (source === "current") return readOlder(home, h.file, { readerKey: d.readerKey, epoch: h.epoch, before: h.oldest }, view.deskMeter);
  if (source === "previous-init") return readConversationV3(home, d.prevFile, { readerKey: d.prevReaderKey, epoch: null, end: 0, verify: false }, view.deskMeter);
  const p = d.prevHistory;
  return readOlder(home, p.file, { readerKey: d.prevReaderKey, epoch: p.epoch, before: p.oldest }, view.deskMeter);
}

const OLDER_FAILURES = { "line-too-large": "a line here is too large to load", ENOENT: "the file is gone" };

// What the answer does to the chat's state; null when it went in (or was dropped as old), else the text for the row.
function applyOlder(view, cx, asked, source, read) {
  const now = view.desk;
  const out = read.out;
  const sameAsked = (a, b) => Boolean(a && b) && a.file === b.file && a.epoch === b.epoch && a.oldest === b.oldest;
  const stale = source === "current" ? !sameAsked(now.history, asked.history)
    : source === "previous" ? !sameAsked(now.prevHistory, asked.prevHistory) : now.prevFile !== asked.prevFile || now.history?.file !== asked.history?.file;
  if (stale) {
    view.deskOlderAnchor = null;
    return null;
  }
  if (read.legacy) return "the reader does not know older history";
  if (read.failure) return OLDER_FAILURES[read.failure] ?? read.failure;
  if (out?.changed || !out || (source === "previous-init" ? out.kind !== "full" : out.kind !== "page")) {
    // The file or its history is no longer the one that was asked about: the live history starts over (the previous
    // conversation's is let go and read again on the next click).
    view.deskOlderAnchor = null;
    if (source === "current") view.desk = { ...now, history: { ...now.history, resync: true } };
    else view.desk = { ...now, prevHistory: null };
    wantRead(view, cx);
    return "the file changed: reloading";
  }
  const current = now.messages ?? [];
  const prev = now.prevHistory?.messages ?? now.prev ?? [];
  const bytes = (list) => list.reduce((n, m) => n + messageBytes(m), 0);
  if (source === "previous-init") {
    const res = acceptRead(null, out, { file: now.prevFile, pinned: false, extraCount: current.length, extraBytes: bytes(current) });
    view.desk = { ...now, prevHistory: res.hist };
    return null;
  }
  if (source === "current") {
    const res = acceptPage(now.history, out, { extraCount: prev.length, extraBytes: bytes(prev) });
    if (res.accepted) view.desk = { ...now, history: res.hist, messages: res.hist.messages };
    else if (res.hist.limited) view.desk = { ...now, history: res.hist };
    else return "nothing older was found";
    noteEdits(view, true); // old edits are not news
    return null;
  }
  const res = acceptPage(now.prevHistory, out, { extraCount: current.length, extraBytes: bytes(current) });
  if (res.accepted) view.desk = { ...now, prevHistory: res.hist };
  else if (res.hist.limited) view.desk = { ...now, history: { ...now.history, limited: true } };
  else return "nothing older was found";
  return null;
}

// ---- Reading: when (chat-read-model.js readDecision) and how ----

// Something may have been written: ask for a read. Only the first wake-up since the last read is remembered, so a
// stream of them can't push the read away; the rest is the decision's (a debounce, a gap between reads).
function wantRead(view, cx) {
  const r = view.deskRead;
  if (view.deskClosed || !r) return;
  if (r.dirtyAt === null) r.dirtyAt = Date.now();
  scheduleRead(view, cx);
}

// Decide now: start the read, or sleep until it is due (one timer, replaced each time).
function scheduleRead(view, cx) {
  const r = view.deskRead;
  if (view.deskClosed) return;
  r.timer?.cancel();
  r.timer = null;
  const decision = readDecision({ busy: r.busy, dirtyAt: r.dirtyAt, lastStart: r.lastStart, lastControl: r.lastControl, now: Date.now() });
  // The history is at its limit: no costly read until NEWEST frees it (the cheap record tick goes on).
  if (decision.run && view.desk.history?.limited) return;
  if (decision.run) startRead(view, cx, decision.verify);
  else if (decision.dueAt !== null) r.timer = cx.timer.after(Math.max(0, decision.dueAt - Date.now()), (cx) => scheduleRead(view, cx));
}

// One read at a time. A wake-up that comes while it runs is kept (dirtyAt) and decided again when it ends.
// verify: this is the control read: it also gets the watcher going again if it had given up.
function startRead(view, cx, verify) {
  const r = view.deskRead;
  r.busy = true;
  r.dirtyAt = null;
  r.lastStart = Date.now();
  if (verify) {
    r.lastControl = r.lastStart;
    r.watch?.ensure();
  }
  spawnDesk(view, cx, async (cx) => {
    try {
      await refresh(view, cx, verify);
    } finally {
      r.busy = false;
      scheduleRead(view, cx);
    }
  });
}

// The cheap tick: the two small records, no process. A newer activity record, another session file or a new previous
// one asks for a read; the record and the binding are taken in at once (the NOW line stays current).
function recordTick(view, cx) {
  const r = view.deskRead;
  if (view.deskClosed || r.checking) return;
  r.checking = true;
  spawnDesk(view, cx, async (cx) => {
    try {
      const rec = await readConversationRecord(view.desk, view.deskMeter);
      if (view.deskClosed) return;
      const sig = recordSignature(rec);
      const changed = r.seen !== null && sig !== r.seen;
      r.seen = sig;
      // Only the record and the binding are taken in here, and only for the file that is shown. A new session file is
      // switched to by the read (it knows what to do when the file isn't written yet), not by this tick.
      const now = view.desk;
      if ((!rec.transcript || rec.transcript === now.transcript) && (rec.bound !== now.bound || JSON.stringify(rec.record) !== JSON.stringify(now.record))) {
        view.desk = { ...now, bound: rec.bound, record: rec.record };
        cx.notify();
      }
      if (changed) wantRead(view, cx);
    } finally {
      r.checking = false;
    }
  });
}

async function refresh(view, cx, verify) {
  const d = view.desk;
  const isActive = () => !view.deskClosed;
  const rec = await readConversationRecord(d, view.deskMeter);
  if (!isActive()) return;
  const poll = await readConversationFrom(d, rec, view.deskMeter, { verify, isActive });
  if (!isActive() || !poll) return;
  view.deskRead.seen = recordSignature(rec);
  applyPoll(view, cx, d, poll);
  // A read that was not taken in as it was: the file changed under it, or the history held doesn't fit its answer
  // (another generation): ask again; the next one starts from scratch where it has to.
  if (poll.read?.out?.changed || view.desk.history?.resync) wantRead(view, cx);
}

// One poll's result into the chat's state. d: the state the poll was made for.
function applyPoll(view, cx, _d, poll) {
  // Merged into the state as it is NOW, not as it was when the read began: a SHOW OLDER page that came in meanwhile is part of
  // the history the read's delta goes onto (the read only depends on the history's epoch and end, which pages don't move).
  const now = view.desk;
  const merged = mergePoll(now, poll, { pinned: view.deskPinned });
  // Only the polled fields: what happened during the awaits (sending, opened tools) stays as it is now.
  const next = { ...now, ...Object.fromEntries(POLLED.map((k) => [k, merged[k]])) };
  const sig = signature;
  const changed = sig(next) !== sig(now);
  view.desk = next.prevHistory && next.prevHistory.file !== next.prevFile ? { ...next, prevHistory: null } : next;
  // A rebuilt window (size buttons, CHAT/TERMINAL) reads the same file again as a new generation of history: the mark the
  // person left is still true for that file, so it moves to the new epoch. A generation that changes while the window
  // lives is not trusted (the mark then counts everything: see chat-list.js freshOf).
  if (!now.history && next.history && view.deskSeenFile === next.history.file && view.deskSeenEpoch !== next.history.epoch) {
    view.deskSeenEpoch = next.history.epoch;
    view.deskDirty = true;
  }
  syncWatch(view);
  if (view.desk.messages !== now.messages) noteEdits(view, false);
  // Only the initial cold transfer may rebind an epoch. Later resets invalidate the remembered place strictly.
  for (const key of ["deskTopKey", "deskOlderAnchor"]) {
    const anchor = view[key];
    if (!anchor || (key === "deskTopKey" && view.deskTransferPending)) continue;
    const context = anchorContextOf(view.desk, anchor);
    if (!anchorFits(anchor, context.history, context.rows)) {
      view[key] = null;
      if (key === "deskOlderAnchor") { view.deskOlderTimer?.cancel(); view.deskOlderTimer = null; }
    }
  }
  const out = poll.read?.out;
  const goodRead = out && !poll.read.failure && !out.changed && !view.desk.history?.resync
    && !view.desk.pending && !view.desk.error && !view.desk.stale
    && (out.v3 ? ["full", "delta", "same"].includes(out.kind) : Array.isArray(out.messages) || out.same);
  if (goodRead || (!poll.transcript && !view.desk.transcript)) restoreChatTransfer(view, cx);
  if (!changed) return;
  forgetGone(view);
  if (view.deskPinned) stick(view, cx);
  cx.notify();
}

// The watcher follows the session file the chat shows: a new file (/clear, resume, a new day for Codex) is a new watch.
// Not for an agent on another machine (its files are not here).
function syncWatch(view) {
  const r = view.deskRead;
  const file = view.desk.transcript;
  if (view.deskClosed || r.watched === file || !view.deskCx) return;
  r.watch?.stop();
  r.watch = null;
  r.watched = file;
  if (file && canOpenFiles(view)) r.watch = watchFile(view.deskCx, file, (cx) => wantRead(view, cx));
}

const POLLED = ["transcript", "bound", "record", "size", "cwd", "messages", "prev", "prevFile", "pending", "stale", "error", "plan", "session", "coverage", "history", "readerMode"];

// What decides a redraw after a poll: more than the message count, because a tool's result, the model, the tokens
// or a plan step can change without a new message (with the v3 reader the history's revision says it for the messages:
// it changes whenever a message does, also an old tool's result). (The plan's text is not compared: its steps' states are.)
function signature(x) {
  const lastTools = (x.messages ?? []).slice(-3).map((m) => `${m.id}:${m.status ?? ""}:${m.finishedAt ?? ""}`);
  const plan = x.plan ? [x.plan.sourceMessageId, x.plan.items.length, x.plan.items.map((i) => i.status[0]).join("")] : x.plan;
  return JSON.stringify([x.transcript, x.bound, x.size, x.error, x.stale, x.record, x.messages?.length, x.prev?.length, lastTools, x.cwd, plan, x.session, x.coverage, x.history?.revision ?? null, x.history?.limited ?? false]);
}


// Send what is in the box. The handler's cx is only good until its first await, so the work runs in a task of its
// own (cx.spawn); whatever happens, "SENDING…" ends (a throw after the await once left the chat unable to send).
// snap: the text and revision the box submitted; what goes is that text, and only that text is cleared afterwards.
function send(view, cx, _snap) {
  if (view.deskClosed) return;
  syncChatSession(view, cx);
  const field = view.deskField;
  if (!field || field.released) return;
  // The event snapshot may predate adopting a completion from another copy.
  const taken = field.snapshot();
  const text = taken.value.trim();
  const address = view.desk.address;
  if (!text || savedSend(address)?.status === "pending") return;
  // Checked again at the moment of sending: the agent may have ended or stopped on an approval since the last frame.
  const access = accessOf(view);
  if (!access.canSend) {
    view.desk = { ...view.desk, note: access.reason };
    cx.notify();
    return;
  }
  view.desk = { ...view.desk, sending: true, note: null };
  const ticket = { token: `${sendRuntime()}:${randomToken(16)}`, address, value: taken.value,
    revision: taken.revision, draftVersion: view.deskDraftVersion };
  view.deskSendingToken = ticket.token;
  patchSend(address, { token: ticket.token, draftVersion: ticket.draftVersion, value: ticket.value, status: "pending", error: null });
  cx.notify();
  launchSend(view, ticket, cx);
}

// This task holds a small ticket and the lightweight owner only. Closed sessions can drain their history
// without waiting for hc; the task never reads their desk or native field after close.
function launchSend(view, ticket, cx) {
  cx.spawn(async (cx) => {
    let result;
    try {
      result = await hc(["send", ticket.address, ticket.value.trim()]);
    } catch (error) {
      result = { code: 1, stderr: String(error) };
    } finally {
      finishSend(ticket, result);
      if (!view.deskClosed) { adoptSendResult(view, ticket, result, cx); cx.notify(); }
    }
  });
}

function finishSend(ticket, result) {
  const delivery = savedSend(ticket.address);
  if (delivery?.token !== ticket.token || delivery.status !== "pending") return;
  const success = result?.code === 0;
  if (success) {
    const saved = savedOf(ticket.address);
    if (saved.draftVersion === ticket.draftVersion && saved.draft === ticket.value) {
      patchChat(ticket.address, { draft: "", draftVersion: randomToken(16) });
    }
  }
  patchSend(ticket.address, { ...delivery, status: success ? "sent" : "failed",
    error: success ? null : String(result?.stderr || "hc send failed").trim().slice(0, 120) });
}

function adoptSendResult(view, ticket, _result, cx) {
  if (view.deskClosed || view.desk.address !== ticket.address) return false;
  const delivery = savedSend(ticket.address);
  if (delivery?.token !== ticket.token || delivery.status === "pending") return false;
  const own = view.deskSendingToken === ticket.token;
  if (delivery.status === "sent" && own && view.deskDraftVersion === ticket.draftVersion && Number.isInteger(ticket.revision)
    && savedOf(ticket.address).draft === "" && savedOf(ticket.address).draftVersion !== ticket.draftVersion) {
    view.deskDraftApplying = true;
    try {
      if (view.deskField.clearIfUnchanged(ticket, cx)) {
        view.deskDraftVersion = savedOf(ticket.address).draftVersion;
        view.deskDraftTouched = false;
      }
    } finally { view.deskDraftApplying = false; }
  }
  adoptDraft(view, cx);
  view.desk = { ...view.desk, sending: false, note: delivery.status === "failed" ? (delivery.error?.startsWith("Delivery status unknown") ? delivery.error : `Not sent: ${delivery.error}`)
    : live(ticket.address)?.status === "working" ? "Sent while it works, just as if typed in its terminal." : null };
  if (own) view.deskSendingToken = null;
  if (delivery.status === "sent" && cx) follow(view, cx);
  // Only this ticket is consumed; never erase a newer send for the same address.
  if (savedSend(ticket.address)?.token === ticket.token) patchSend(ticket.address, null);
  return true;
}


// What the side panel shows now (chat-panel.js): the same NOW line as the card and the office, the files of the loaded
// history split into changed and read, and (from the newer reader) the plan and the session.
function panelModel(view, agent) {
  const d = view.desk;
  const status = agent?.status ?? "idle";
  const doing = doingText(status, d.record, Math.floor(Date.now() / 1000), lifeHere(d.address));
  const repo = view.deskRepo;
  const { changed, read } = splitFiles(withRepoStats(panelFiles(d.messages ?? [], d.cwd), repo.snap));
  return {
    status, doing, tool: toolLine(currentCall(view), Date.now(), { calm: isCalm() }), changed, read, shown: view.deskShown, picked: pickedFile(view),
    repoNote: repoNote(repo.snap, repo.failure), plan: d.plan, session: d.session, info: energyInfo(d),
    reader: readerLine(view.deskMeter.meterSnapshot(Date.now())), readerAll: allLine(view.deskMeterFlush?.all(), Date.now()),
  };
}

// Model, effort and how full the context is: the provider's own figures (shared META_KEY, written for the tower from
// the status line and the Codex session) where there are some, the conversation's otherwise (energy.js).
function energyInfo(d) {
  const meta = metaOfAgent(d.address, shared(META_KEY)?.agents, shared(SUBAGENTS_KEY));
  const info = sessionContext(meta, d.session);
  return { ...info, energy: energyOf({ context: info.context }, Date.now()) };
}

// ---- Changes in the repo: read every REPO_POLL_MS while the file lists are in sight (chat-model.js repoPollDecision) ----

// The repo's state for this chat: gen changes when the conversation or its folder does, so an old read can't land in a new
// one. snap: the last good snapshot; failure: the last read that failed (snap then stays, marked old).
const freshRepo = (gen, context) => ({ gen, context, busy: false, attemptAt: null, dirty: false, snap: null, failure: null });
const repoContext = (view) => `${view.desk.transcript ?? ""}|${view.desk.cwd ?? ""}`;

function repoTick(view, cx) {
  if (view.deskClosed) return;
  if (view.deskRepo.context !== repoContext(view)) view.deskRepo = freshRepo(view.deskRepo.gen + 1, repoContext(view));
  const ui = view.deskUi.collapsed;
  const { run } = repoPollDecision({
    visible: panelShown(view), expanded: !ui.changed || !ui.read, cwd: view.desk.cwd, local: canOpenFiles(view),
    busy: view.deskRepo.busy, attemptAt: view.deskRepo.attemptAt, dirty: view.deskRepo.dirty,
  }, Date.now());
  if (run) readRepo(view, cx);
}

// The conversation settled an edit that was not seen before: the repo's numbers may be out of date. Messages that are not
// new events (a page of older history) only move the baseline.
function noteEdits(view, baseline) {
  const { dirty, seen } = repoDirtyFrom(view.deskRepoSeen, view.desk.messages, baseline);
  view.deskRepoSeen = seen;
  if (dirty) view.deskRepo = { ...view.deskRepo, dirty: true };
}

function readRepo(view, cx) {
  const gen = view.deskRepo.gen;
  const cwd = view.desk.cwd;
  // The read takes the dirty flag with it; one that is set while it runs asks for the next.
  view.deskRepo = { ...view.deskRepo, busy: true, attemptAt: Date.now(), dirty: false };
  spawnDesk(view, cx, async (cx) => {
    try {
      const snap = await readRepoSnapshot(cwd, view.deskMeter, { isActive: () => !view.deskClosed });
      if (view.deskClosed || !snap || view.deskRepo.gen !== gen) return;
      // A good read replaces the numbers; "not a repo" has none; a failure keeps the old numbers, marked old.
      view.deskRepo = snap.state === "ok" ? { ...view.deskRepo, snap, failure: null } : { ...view.deskRepo, snap: snap.state === "not-repo" ? null : view.deskRepo.snap, failure: snap };
    } finally {
      if (view.deskRepo.gen === gen) view.deskRepo = { ...view.deskRepo, busy: false };
      if (!view.deskClosed) cx.notify();
    }
  });
}

// OPEN reads a file on this computer: not offered for an agent that lives on another machine (that comes later).
function canOpenFiles(view) {
  const agent = live(view.desk.address);
  return !spaces().find((s) => s.id === agent?.space)?.machine;
}

// The panel's actions, for chat-panel.js.
function panelDeps(view) {
  return {
    toggleSection: (key, cx) => toggleSection(view, key, cx),
    jumpToFile: (file, cx) => { if (!view.deskClosed) jumpToFile(view, file, cx); },
    openFile: (file) => { if (!view.deskClosed) openFilePreview({ address: view.desk.address, cwd: view.desk.cwd, path: file.full }); },
    canOpen: canOpenFiles(view),
    showMoreFiles: (list, cx) => { if (view.deskClosed) return; view.deskShown = { ...view.deskShown, [list]: view.deskShown[list] + FILES_STEP }; cx.notify(); },
    closeDrawer: null,
  };
}

// The tool call the agent is in now (chat-model.js nowCall), from this chat's own conversation and activity record.
function currentCall(view) {
  const d = view.desk;
  return nowCall(d.messages, d.record, { status: live(d.address)?.status ?? "idle", life: lifeHere(d.address) });
}

// Whether a running counter is on screen: the panel is there (beside the history, or its drawer is open), NOW is not
// folded, and there is a call with a known start. Only then does the presentation timer redraw.
function clockShows(view) {
  if (view.deskClosed || view.deskUi.collapsed.now || !panelShown(view)) return false;
  return Number.isFinite(currentCall(view)?.startedAt);
}

// Whether the panel is on screen: beside the history, or its drawer is open.
const panelShown = (view) => view.deskPanelLayout.mode === "side" || view.deskDrawer;

function closeDrawer(view, cx) {
  if (view.deskClosed || !view.deskDrawer) return;
  view.deskDrawer = false;
  cx.notify();
}

// The panel beside the history, or (narrow chats) a DETAILS button and a drawer over the history.
function panelParts(view, agent, t) {
  const layout = view.deskPanelLayout;
  const model = panelModel(view, agent);
  const deps = panelDeps(view);
  if (layout.mode === "side") return { side: renderChatPanel(model, view.deskUi, layout, t, deps), overlay: null, button: null };
  const open = (cx) => { if (view.deskClosed) return; view.deskDrawer = true; cx.notify(); };
  const button = uiButton("desk-details", "DETAILS", (_e, cx) => open(cx), t).absolute().top(6).right(18);
  const drawer = view.deskDrawer
    ? div().id("desk-drawer").absolute().top(0).right(0).bottom(0)
      .child(renderChatPanel(model, view.deskUi, layout, t, { ...deps, closeDrawer: (cx) => closeDrawer(view, cx) }))
    : null;
  return { side: null, overlay: drawer, button: view.deskDrawer ? null : button };
}

// deps: { showTerminal(cx) } — switches the window to the real terminal (taking the draft along).
export function renderDeskChat(view, t, deps) {
  const d = view.desk;
  const agent = live(d.address);
  const status = agent?.status ?? "idle";
  const list = rowsOf(d);
  const empty = !d.transcript
    ? "No conversation file for this agent yet: it appears after its next step (Claude Code or Codex with the office hooks)."
    : d.error ? `Can't read the conversation: ${d.error}` : d.messages === null ? "Reading…" : "Nothing said yet.";
  const access = accessOf(view);
  const tone = status === "blocked" ? t.blocked : t.dim;
  const waiting = access.canSend ? null
    : h_flex().id("desk-waiting").px(10).py(6).gap(8).items_center().bg(`${tone}33`).border_t(1).border_color(tone)
      // min_w(0): the reason wraps, so the fixed-size OPEN TERMINAL button stays in a narrow chat.
      .child(div().flex_1().min_w(0).font_family(UI_FONT).text_size(12).text_color(t.foreground).child(access.reason))
      .when(lifeHere(d.address) === "live" && !internalOf(d.address), (el) => el.child(
        uiButton("desk-open-terminal", "OPEN TERMINAL", (_e, cx) => deps.showTerminal(cx), t,
          { tone: status === "blocked" ? "blocked" : null, primary: status === "blocked" })));
  const typed = access.canSend && view.deskField.value().trim() !== "" && !d.sending;
  const input = h_flex().id("desk-input").px(10).py(8).gap(8).items_end().bg(t.chrome).border_t(1).border_color(t.border)
    .child(div().id("desk-box").flex_1().min_w(0)
      .child(renderTextField(view.deskField, t, { onCancel: (cx) => { if (view.deskClosed) return; view.deskFocus.focus(); cx.notify(); }, look: { radius: RADIUS.field } })))
    .child(uiButton("desk-send", d.sending ? "SENDING…" : "SEND", (_e, cx) => send(view, cx), t,
      { primary: typed, disabled: !typed, title: access.canSend ? "Send (Enter)" : access.reason }));
  const parts = panelParts(view, agent, t);
  return h_flex().id("desk-chat").track_focus(view.deskFocus).size_full().relative().bg(t.background)
    .on_key_down((e, cx) => {
      if (view.deskClosed || e.key !== "escape" || !view.deskDrawer || !view.deskFocus.is_focused()) return;
      cx.stop_propagation();
      closeDrawer(view, cx);
    })
    .on_size_change((sz, cx) => {
      if (view.deskClosed) return;
      const next = panelModeOf(sz.width, sz.height, view.deskPanelLayout.mode);
      if (sz.width === view.deskBox.w && sz.height === view.deskBox.h) return;
      if (next.mode !== view.deskPanelLayout.mode) view.deskDrawer = false;
      view.deskPanelLayout = next;
      view.deskBox = { w: sz.width, h: sz.height };
      cx.notify();
    })
    .child(v_flex().flex_1().min_w(0).h_full().relative()
      .child(talk(view, list, t, empty))
      .when(Boolean(parts.button), (el) => el.child(parts.button))
      // The last read failed: what is shown is the last good copy, and says so.
      // The history held is at its limit and a read would pass it: it was not taken in; NEWEST frees the old part.
      .when(Boolean(d.history?.limited), (el) => el.child(div().id("desk-limited").px(10).py(3).bg(`${t.accent}22`).border_t(1).border_color(t.accent)
        .font_family(UI_FONT).text_size(11).text_color(t.foreground).child("HISTORY LIMIT — scroll down to free it")))
      .when(Boolean(d.stale), (el) => el.child(div().id("desk-stale").px(10).py(3).bg(`${t.blocked}22`).border_t(1).border_color(t.blocked)
        .font_family(UI_FONT).text_size(11).text_color(t.foreground)
        .child(`Out of date: can't read the conversation right now (${d.stale}). Showing the last copy read.`)))
      .when(Boolean(d.note), (el) => el.child(div().px(10).py(3).font_family(UI_FONT).text_size(11).text_color(t.accent).child(d.note)))
      .when(Boolean(waiting), (el) => el.child(waiting))
      // An internal subagent can't be written to at all: no box, only the banner saying so.
      .when(!internalOf(d.address), (el) => el.child(input)))
    .when(Boolean(parts.side), (el) => el.child(parts.side))
    .when(Boolean(parts.overlay), (el) => el.child(parts.overlay));
}
