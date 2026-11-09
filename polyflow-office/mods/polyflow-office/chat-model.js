// Shared-state keys of the chat. STATE: what the person left per agent ({ draft, open, pinned, seen }).
// HANDOFF: the chat's draft was put on the clipboard for the real terminal ({ address, at }; see chat-window.js).
import { acceptRead, messageBytes } from "./chat-history.js";

export const CHAT_STATE_KEY = "polyflow-office.chat-state";
export const CHAT_HANDOFF_KEY = "polyflow-office.chat-handoff";
export const HANDOFF_SHOWN_MS = 120000;
// The internal subagents the office found (activity-reader.js followSubagents), for the card, chat bar and chat:
// { [agent address]: [{ id, description, type, status, record }] }.
export const SUBAGENTS_KEY = "polyflow-office.subagents";
// What was typed in an agent card's MESSAGE box, per agent ({ [address]: { draft } }): its own draft, apart from the chat's.
export const CARD_DRAFTS_KEY = "polyflow-office.card-drafts";

// A shared map of per-agent entries with one entry changed: the entry keeps every field the patch doesn't name (the
// draft is written by one place, the panel's sections by another), and other agents' entries are untouched.
// A new map; `all` is never modified.
export function patchEntry(all, key, patch) {
  const isMap = (v) => v && typeof v === "object" && !Array.isArray(v);
  const base = isMap(all) ? all : {};
  return { ...base, [key]: { ...(isMap(base[key]) ? base[key] : {}), ...patch } };
}

// The desktop chat's model: what the side panel lists from the conversation. Pure (no herdr / gpui-kit), so node
// can test it.

const FILE_MAX = 10;
const OLD_KEPT = 60; // messages of the previous conversation kept above a "New conversation" line
const PREV_KEPT = 60; // messages read from the previous session file

// A path for comparing: forward slashes, no trailing slash, Windows drive paths case-folded.
const norm = (p) => {
  const s = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[A-Za-z]:\//.test(s) ? s.toLowerCase() : s;
};
// What the panel shows: the path inside the conversation's folder, or the whole path outside it.
function labelOf(path, cwd) {
  const p = String(path).replace(/\\/g, "/");
  if (!cwd) return p;
  const root = `${norm(cwd)}/`;
  return norm(p).startsWith(root) ? p.slice(root.length) : p;
}

// An edit whose result the reader could not find (a call at the edge of a loaded page, or one it stopped following) is
// "edit result unknown": never shown as done.
const verbOf = (f, status) => (f.verb !== "edited" ? "read" : status === "error" ? "edit failed" : status === "running" ? "editing" : status === "unknown" ? "edit result unknown" : "edited");

// The files the conversation touched, newest first, each once (by full path):
// [{ path, label, verb: "edited" | "editing" | "edit failed" | "read" }]. The newest edit of a file says what
// happened to it (a failed edit after a good one is "edit failed"); reads never hide an edit.
export function filesFrom(messages, cwd = null, max = FILE_MAX) {
  return collectFiles(messages, cwd).slice(0, max).map(({ path, label, verb }) => ({ path, label, verb }));
}

// An absolute path: a drive ("C:\" or "C:/"), a network share ("\\") or a root ("/").
const ABSOLUTE = /^([A-Za-z]:[\\/]|\\\\|\/)/;

// A path as the folder it was meant in makes it: the path itself when it is absolute, else the folder + the path with
// "." and ".." worked out (never above the root). null when it is relative and no folder is known. Separators become "/".
export function resolvePath(path, base) {
  const raw = String(path ?? "");
  if (raw === "") return null;
  if (ABSOLUTE.test(raw)) return raw;
  if (typeof base !== "string" || !ABSOLUTE.test(base)) return null;
  const parts = `${base}/${raw}`.replace(/\\/g, "/").split("/");
  const unc = parts[0] === "" && parts[1] === "";
  const root = /^[A-Za-z]:$/.test(parts[0]) ? [parts[0]] : unc ? ["", ""] : [""];
  const stack = [];
  for (const part of parts.slice(1)) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return [...root, ...stack].join("/");
}

// Every file the conversation touched, newest first, each once (by full path), with where it came from:
// { path, label, verb, messageId (the call that set `verb`), callCwd (the folder that call ran in), full (the absolute
// path when it can be known, else null) }. The newest edit of a file says what happened to it (a failed edit after a
// good one is "edit failed"); a read never hides an edit, and then the edit's call is the one that is kept.
function collectFiles(messages, cwd) {
  const seen = new Map();
  for (const m of [...(messages ?? [])].reverse()) {
    if (m?.role !== "tool" || !Array.isArray(m.files)) continue;
    const callCwd = typeof m.cwd === "string" && m.cwd !== "" ? m.cwd : cwd;
    for (const f of m.files) {
      if (typeof f?.path !== "string" || f.path === "") continue;
      const full = resolvePath(f.path, callCwd);
      const key = norm(full ?? f.path);
      const verb = verbOf(f, m.status);
      const entry = { path: f.path, label: labelOf(full ?? f.path, cwd), verb, messageId: m.id, callCwd: callCwd ?? null, full };
      const had = seen.get(key);
      if (!had) seen.set(key, entry);
      else if (had.verb === "read" && verb !== "read") seen.set(key, { ...had, verb, messageId: m.id, callCwd: entry.callCwd });
    }
  }
  return [...seen.values()];
}

// The panel's files: all of them (the panel shows a part and offers the rest), each with its source call.
export const panelFiles = (messages, cwd = null) => collectFiles(messages, cwd);

// The row of the history (after foldTools) that holds a message: a tool run holds its calls. null when it is not there.
export function findMessageRow(rows, messageId) {
  const index = (rows ?? []).findIndex((r) => r.id === messageId || (Array.isArray(r.items) && r.items.some((x) => x.id === messageId)));
  return index < 0 ? null : { index, rowId: rows[index].id };
}

// Runs of tool calls fold into one line ("3 tools: Edit a.js · Bash git"), so the talk stays readable. A run keeps
// the calls themselves (status, output) and is named after its first call, so it keeps its id while calls join.
export function foldTools(messages) {
  const out = [];
  for (const m of messages ?? []) {
    const last = out[out.length - 1];
    const failed = m.status === "error" ? 1 : 0;
    if (m.role === "tool" && last?.role === "tools") out[out.length - 1] = { ...last, items: [...last.items, m], failed: last.failed + failed };
    else if (m.role === "tool") out.push({ id: `run-${m.id}`, role: "tools", items: [m], failed, at: m.at });
    else out.push(m);
  }
  return out;
}

// The conversation after the agent's session changed (/clear, resume): the end of the old one, a line, the new
// one. A resumed session repeats the old messages: those are shown once, and the line says "Resumed".
// keep: how many of the old conversation's messages stay (the v2 reader's 60 by default; Infinity for a history that was
// paged in with SHOW OLDER, which is never cut).
export function joinConversations(old, fresh, { keep = OLD_KEPT } = {}) {
  if (!old?.length) return fresh ?? [];
  const ids = new Set((fresh ?? []).map((m) => m.id));
  if (old.every((m) => ids.has(m.id))) return fresh; // the same conversation, read twice
  const resumed = old.some((m) => ids.has(m.id));
  const before = old.filter((m) => !ids.has(m.id) && m.role !== "divider").slice(-keep);
  const divider = { id: `divider-${fresh?.[0]?.id ?? "empty"}`, role: "divider", text: resumed ? "Resumed" : "New conversation" };
  return [...before, divider, ...(fresh ?? [])];
}

// Where an agent is in its life, from Herdr: "live" (in agents()), "ended" (its terminal finished or exited) or
// "gone" (Herdr no longer knows it).
export function lifeOf(address, agents, terminals) {
  if ((agents ?? []).some((a) => a.address === address)) return "live";
  const t = (terminals ?? []).find((x) => x?.address === address);
  return t ? (t.state === "live" ? "live" : "ended") : "gone";
}

export const CHAT_KEYS_HINT = "Enter sends · Shift+Enter new line · Esc leaves the box";

// Whether the chat may write to the agent, and if not, why (shown instead of the box). Writing goes into the real
// terminal as typed text plus Enter, so it is refused whenever that could land somewhere wrong: a conversation not
// certainly this terminal's, or an agent waiting on an approval menu (Enter would pick an option).
export function chatAccess({ bound, status, life, internal = false }) {
  if (internal) return { canSend: false, reason: "An internal subagent: it runs inside its agent and can't be written to. Write to its agent." };
  if (life === "ended") return { canSend: false, reason: "This agent has ended: its conversation stays readable here." };
  if (life === "gone") return { canSend: false, reason: "This agent is gone." };
  if (bound !== "env") return { canSend: false, reason: "Can't confirm this conversation belongs to this terminal: write in its terminal." };
  if (status === "blocked") return { canSend: false, reason: "It's waiting for your answer (an approval or a question): answer in its terminal." };
  return { canSend: true, reason: null };
}

// One poll of the chat folded into its state. Pure, so node can test every case.
// desk: the chat's state ({ transcript, messages, size, cwd, prev, prevFile, pending, stale, error, ... }).
// poll: { transcript, bound, record, read, previous, prevRead }, where read / prevRead are what readConversation
// gave ({ out, failure }) and previous / prevRead are there only when the previous file was (re)read.
// - The same file: new messages, or "same" (nothing to do), or a failure: the last copy stays, marked stale.
// - Another file (/clear, resume): the old conversation stays until the new one is read; a new file that isn't
//   written yet (ENOENT) is an empty new conversation.
// - The previous file goes in as `prev` only once the switch happened and its read worked; otherwise it is retried.
// opts.pinned: the chat follows the newest message (the history may then be cut back, chat-history.js trimLoaded); with
// the person reading the history it is not cut, and a read that would pass the cap is not taken in.
export function mergePoll(desk, poll, { pinned = true } = {}) {
  const { transcript = null, bound = null, record = null, read = null, readerMode } = poll ?? {};
  const same = !transcript || transcript === desk.transcript;
  let next = same ? { ...desk, bound, record } : { ...desk, transcript, bound, record, size: -1, pending: Boolean(desk.messages?.length) };
  if (readerMode) next = { ...next, readerMode };
  if (transcript && read) {
    const { out, failure } = read;
    if (out?.same) next = { ...next, error: null, stale: null };
    else if (!failure && out?.v3 && (out.kind === "full" || out.kind === "delta")) next = mergeHistory(desk, next, out, pinned);
    else if (!failure && Array.isArray(out?.messages)) {
      // The messages, folder, plan, session and coverage of one read go in together: one snapshot of that file.
      next = { ...next, messages: out.messages, size: out.size, cwd: out.cwd ?? null, plan: out.plan, session: out.session, coverage: out.coverage, error: null, stale: null, pending: false, history: null };
    } else if (!same && /^ENOENT/.test(failure ?? "")) {
      // A new conversation that isn't written yet: nothing of the old one's folder, plan or session carries over.
      next = { ...next, messages: [], size: 0, cwd: null, plan: null, session: undefined, coverage: undefined, error: null, stale: null, pending: false, history: null };
    } else if (desk.messages && (same || next.pending)) {
      next = { ...next, transcript: desk.transcript, size: desk.size, pending: false, stale: failure };
    } else next = { ...next, messages: null, error: failure };
  }
  if ("previous" in (poll ?? {}) && (!transcript || next.transcript === transcript)) {
    const previous = poll.previous ?? null;
    const msgs = poll.prevRead?.out?.messages;
    if (!previous) next = { ...next, prevFile: null, prev: null };
    else if (Array.isArray(msgs)) next = { ...next, prevFile: previous, prev: msgs.slice(-PREV_KEPT) };
  }
  // The previous conversation's v3 history (SHOW OLDER) belongs to its file: another one (or none) drops it.
  if (next.prevHistory && next.prevHistory.file !== next.prevFile) next = { ...next, prevHistory: null };
  return next;
}

// A v3 full / delta of `desk.transcript`'s file into the chat's state. `next` is the state so far (the new file already
// named when the session changed). The history of ANOTHER file is never built on. Not taken in (a delta of another epoch,
// or a read over the cap while the history is being read): the last copy stays, the history says why (resync / limited).
function mergeHistory(desk, next, out, pinned) {
  const file = next.transcript;
  const base = desk.history && desk.history.file === file ? desk.history : null;
  const prev = desk.prevHistory?.messages ?? desk.prev ?? [];
  const res = acceptRead(base, out, { file, pinned, extraCount: prev.length, extraBytes: prev.reduce((n, m) => n + messageBytes(m), 0) });
  if (!res.accepted) return { ...next, history: res.hist, error: null, stale: null };
  const h = res.hist;
  return { ...next, history: h, messages: h.messages, size: out.size, cwd: h.cwd, plan: h.plan, session: h.session, coverage: { fromStart: h.atStart }, error: null, stale: null, pending: false };
}

// Whether the previous session file has to be (re)read.
export const needsPrevious = (desk, previous) => (previous ?? null) !== (desk.prevFile ?? null);

// An internal subagent's address ("<agent>~<id>", activity.js withSubagents) -> { parent, id }; null for others.
export function internalOf(address) {
  const m = typeof address === "string" ? address.match(/^([A-Za-z0-9][\w-]*)~([\w-]{1,64})$/) : null;
  return m ? { parent: m[1], id: m[2] } : null;
}

// Its conversation file, next to its agent's session file.
export function subagentFile(transcript, id) {
  if (typeof transcript !== "string" || !/\.jsonl$/i.test(transcript)) return null;
  const sep = transcript.includes("\\") ? "\\" : "/";
  return `${transcript.slice(0, -".jsonl".length)}${sep}subagents${sep}agent-${id}.jsonl`;
}

// The side panel's saved state, per agent, apart from the chat's own state (STATE_KEY): which sections are folded and
// the file last picked. { [address]: { collapsed: { now, changed, read, plan, session }, selectedFile } }.
export const CHAT_UI_KEY = "polyflow-office.chat-ui.v1";
export const PANEL_SECTIONS = ["now", "changed", "read", "plan", "session"];
const FOLDED_BY_DEFAULT = { now: false, changed: false, read: false, plan: false, session: true };

// An agent's panel state from the shared map, with defaults for anything missing or of the wrong type.
// -> { collapsed: { [section]: boolean }, selectedFile: { conversationKey, path, messageId } | null }
export function uiOf(all, address) {
  const entry = all && typeof all === "object" ? all[address] : null;
  const saved = entry && typeof entry === "object" && entry.collapsed && typeof entry.collapsed === "object" ? entry.collapsed : {};
  const collapsed = Object.fromEntries(PANEL_SECTIONS.map((s) => [s, typeof saved[s] === "boolean" ? saved[s] : FOLDED_BY_DEFAULT[s]]));
  const f = entry && typeof entry === "object" ? entry.selectedFile : null;
  const ok = f && typeof f === "object" && typeof f.conversationKey === "string" && typeof f.path === "string" && (typeof f.messageId === "string" || f.messageId === null);
  return { collapsed, selectedFile: ok ? { conversationKey: f.conversationKey, path: f.path, messageId: f.messageId } : null };
}

export const UI_GONE_MS = 60000; // an agent gone this long loses its panel state

// The panel state without the agents that have been gone for UI_GONE_MS. present: Set of the addresses there are now
// (terminals and internal subagents); gone: { [address]: when it was first missed } kept by the caller between calls
// (in memory, not in shared state). A blank `present` is not believed (nothing is dropped). A comeback within the time
// starts the count again. -> { ui, gone } (new objects; `ui` is the very same object when nothing was dropped)
export function pruneChatUi(all, present, gone, nowMs) {
  const entries = all && typeof all === "object" ? all : {};
  if (!present || present.size === 0) return { ui: all, gone: {} };
  const nextGone = {};
  const kept = {};
  let dropped = false;
  for (const [address, entry] of Object.entries(entries)) {
    if (present.has(address)) {
      kept[address] = entry;
      continue;
    }
    const since = Number.isFinite(gone?.[address]) ? gone[address] : nowMs;
    if (nowMs - since > UI_GONE_MS) dropped = true;
    else {
      kept[address] = entry;
      nextGone[address] = since;
    }
  }
  return { ui: dropped ? kept : all, gone: nextGone };
}

// The same panel state with one section folded or opened (a new object).
export const withCollapsed = (ui, section, folded) => ({ ...ui, collapsed: { ...ui.collapsed, [section]: Boolean(folded) } });

// How the panel sits for a chat of this size (logical px): beside the history, a narrower one beside it, or in a
// drawer over it. compact: leave out the detail lines. scrolls: too short for everything at once.
export function panelLayout(width, height) {
  const scrolls = height < 360;
  if (width >= 760) return { mode: "side", panelWidth: 280, compact: false, scrolls };
  if (width >= 600) return { mode: "side", panelWidth: 220, compact: true, scrolls };
  return { mode: "drawer", panelWidth: Math.min(320, Math.max(180, Math.floor(width * 0.9))), compact: false, scrolls };
}

export const DRAWER_HYSTERESIS = 16;

// Keep the whole drawer model through the hysteresis band, not just its mode.
export function panelModeOf(width, height, prevMode = null) {
  const drawer = prevMode === "drawer" ? width < 600 + DRAWER_HYSTERESIS : width < 600;
  if (!drawer) return panelLayout(width, height);
  return { mode: "drawer", panelWidth: Math.min(320, Math.max(180, Math.floor(width * 0.9))),
    compact: false, scrolls: height < 360 };
}

// The files of filesFrom() in the panel's two lists: what the agent changed (or is changing, or failed to change)
// and what it only read.
export function splitFiles(files) {
  const list = files ?? [];
  return { changed: list.filter((f) => f.verb !== "read"), read: list.filter((f) => f.verb === "read") };
}

// ---- What the conversation reader answers (hooks/transcript.mjs), whichever version wrote it ----

const PLAN_STATUS = new Set(["pending", "in_progress", "completed"]);
const optCount = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
const optText = (v) => (typeof v === "string" && v !== "" ? v : null);

// A plan from the reader, or undefined when it isn't one we understand (the panel then says "no data").
function planFrom(raw) {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return undefined;
  const items = [];
  for (const i of raw.items) {
    if (!i || typeof i.text !== "string" || !PLAN_STATUS.has(i.status)) return undefined;
    items.push({ id: String(i.id ?? items.length), text: i.text, status: i.status, activeForm: optText(i.activeForm) });
  }
  return {
    source: optText(raw.source), sourceMessageId: optText(raw.sourceMessageId), updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : null,
    outcome: raw.outcome === "pending" ? "pending" : "ok", truncated: raw.truncated === true, omittedItems: optCount(raw.omittedItems) ?? 0, items,
  };
}

// The session (model, tokens) from the reader, or undefined. Missing counts stay null: never 0.
function sessionFrom(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const k = raw.tokens && typeof raw.tokens === "object" ? raw.tokens : null;
  return {
    provider: raw.provider === "claude" || raw.provider === "codex" ? raw.provider : null, id: optText(raw.id), model: optText(raw.model),
    tokens: k && {
      input: optCount(k.input), output: optCount(k.output), cachedInput: optCount(k.cachedInput), cacheWriteInput: optCount(k.cacheWriteInput),
      reasoningOutput: optCount(k.reasoningOutput), total: optCount(k.total), context: optCount(k.context), contextWindow: optCount(k.contextWindow), scope: k.scope === "session" ? "session" : "loaded-window",
      source: optText(k.source), at: Number.isFinite(k.at) ? k.at : null, ...(k.approximate === true ? { approximate: true } : {}),
    },
  };
}

// ---- The v3 reader's answers (hooks/transcript-v3.mjs): checked field by field; one wrong field and the whole answer is
// refused (an error), never half taken in ----

const EPOCH = /^[\w-]{8,64}$/;
const MESSAGE_ROLES = new Set(["user", "assistant", "note", "tool"]);
const TOOL_STATUS = new Set(["running", "ok", "error", "unknown"]);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

function validMessage(m) {
  if (!m || typeof m !== "object" || typeof m.id !== "string" || m.id === "" || !MESSAGE_ROLES.has(m.role) || !isCount(m.seq) || !isCount(m.blockIndex)) return false;
  return typeof m.text === "string" && (m.role !== "tool" || TOOL_STATUS.has(m.status));
}

const costFrom = (c) => ({ bytes: isCount(c?.bytes) ? c.bytes : 0, parseMs: Number.isFinite(c?.parseMs) && c.parseMs >= 0 ? c.parseMs : 0, lines: isCount(c?.lines) ? c.lines : 0 });

// One v3 answer -> { v3: true, kind: "same" | "full" | "delta" | "page", epoch, ... } or null when it is not a good one.
// A delta has plan / session / cwd only when the reader sent them (absent: what is known stays; plan null: cleared).
function v3Out(raw) {
  if (typeof raw.epoch !== "string" || !EPOCH.test(raw.epoch)) return null;
  const head = { v3: true, kind: raw.kind, epoch: raw.epoch, cost: costFrom(raw.cost) };
  if (raw.kind === "page") {
    if (!isCount(raw.before) || !isCount(raw.start) || raw.start > raw.before || typeof raw.fromStart !== "boolean") return null;
    if (!Array.isArray(raw.messages) || !raw.messages.every(validMessage)) return null;
    return { ...head, before: raw.before, start: raw.start, fromStart: raw.fromStart, messages: raw.messages };
  }
  if (!isCount(raw.end) || !isCount(raw.size) || raw.end > raw.size) return null;
  const ends = { ...head, end: raw.end, size: raw.size };
  if (raw.kind === "same") return { ...ends, same: true };
  if (raw.kind !== "full" && raw.kind !== "delta") return null;
  if (!Array.isArray(raw.messages) || !raw.messages.every(validMessage)) return null;
  const cache = raw.cache === "unavailable" ? "unavailable" : "ok";
  if (raw.kind === "delta") {
    return {
      ...ends, messages: raw.messages, cache, ...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}), ...(isCount(raw.replaceFrom) ? { replaceFrom: raw.replaceFrom } : {}),
      ...("plan" in raw ? { plan: planFrom(raw.plan) } : {}), ...("session" in raw ? { session: sessionFrom(raw.session) } : {}),
    };
  }
  const c = raw.coverage;
  if (!c || typeof c !== "object" || typeof c.fromStart !== "boolean" || !isCount(c.start) || !isCount(c.end) || c.start > c.end) return null;
  return { ...ends, messages: raw.messages, cache, cwd: typeof raw.cwd === "string" ? raw.cwd : null, plan: planFrom(raw.plan), session: sessionFrom(raw.session), coverage: { fromStart: c.fromStart, start: c.start, end: c.end } };
}

// The old reader (hooks without --v3) takes "--v3" for a file name and says exactly this, in schema 2. Only this answer
// means "ask the old way"; any other error is an error.
export const v2Refusal = (raw) => Boolean(raw) && typeof raw === "object" && raw.schemaVersion === 2 && raw.error === "no session file";

// The reader's JSON (already parsed) as one of
//   { kind: "v3", out }                           a version 3 answer (see v3Out)
//   { kind: "error", error }
//   { kind: "same", size }                       nothing changed: keep everything known
//   { kind: "full", version, size, cwd, messages, plan, session, coverage }
// Version 1 (no schemaVersion) and a newer one than we know give plan / session / coverage undefined, which the panel
// shows as "no data"; the conversation itself (messages, cwd) is read from either. A damaged core is an error, not an
// empty conversation.
export function normalizeTranscript(raw) {
  if (!raw || typeof raw !== "object") return { kind: "error", error: "can't read the conversation" };
  if (typeof raw.error === "string") return { kind: "error", error: raw.error };
  if (raw.schemaVersion === 3) {
    const out = v3Out(raw);
    return out ? { kind: "v3", out } : { kind: "error", error: "can't read the conversation" };
  }
  if (raw.same === true) return { kind: "same", size: Number.isFinite(raw.size) ? raw.size : null };
  if (!Array.isArray(raw.messages)) return { kind: "error", error: "can't read the conversation" };
  const version = raw.schemaVersion === undefined ? 1 : raw.schemaVersion;
  const known = version === 2;
  const c = raw.coverage;
  return {
    kind: "full", version, size: Number.isFinite(raw.size) ? raw.size : 0, cwd: typeof raw.cwd === "string" ? raw.cwd : null, messages: raw.messages,
    plan: known ? planFrom(raw.plan) : undefined, session: known ? sessionFrom(raw.session) : undefined,
    coverage: known && c && typeof c === "object" ? { fromStart: c.fromStart === true } : undefined,
  };
}

// One read for mergePoll: { out, failure } from the reader's parsed JSON (null when it wasn't JSON) and what the process
// said on stderr. out: { same: true, size } or { size, cwd, messages, plan, session, coverage }; failure: text or null.
export function readOutcome(raw, stderr = "") {
  const n = normalizeTranscript(raw);
  if (n.kind === "v3") return { out: n.out, failure: null };
  // The file changed under the read: not a failure to show, only a reason to ask again.
  if (n.kind === "error" && n.error === "changed" && raw?.schemaVersion === 3) return { out: { changed: true }, failure: null };
  if (n.kind === "same") return { out: { same: true, size: n.size }, failure: null };
  if (n.kind === "full") return { out: { size: n.size, cwd: n.cwd, messages: n.messages, plan: n.plan, session: n.session, coverage: n.coverage }, failure: null };
  const said = raw && typeof raw === "object" ? n.error : stderr || n.error;
  return { out: null, failure: String(said).trim().slice(0, 120) };
}

// A count for a narrow place: 950, 312k, 1.05M.
export function shortCount(n) {
  if (!Number.isFinite(n)) return null;
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(2))}M`;
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

// The session's first line: how full the last request's context was ("312k / 1.05M", or "312k" without a window).
export function contextLine(tokens) {
  const used = shortCount(tokens?.context);
  if (used === null) return null;
  const window = shortCount(tokens?.contextWindow);
  return window === null ? used : `${used} / ${window}`;
}

// ---- NOW: the tool the agent is in, and for how long ----

const CLOCK_SKEW_MS = 5000; // a start this far in the future is not believed
export const clockStepMs = calm => calm ? 10000 : 1000;
export const calmElapsed = seconds => `${Math.floor(Math.max(0, seconds) / 60)} min`;

// The tool call the agent is in now, for the second line of NOW (the first line stays activity.js doingText).
// messages: the conversation's (this agent's own file); record: the activity hook's (or a subagent's); status and life
// as Herdr and chatAccess know them. -> { id, name, startedAt (ms | null), source: "record" | "transcript" } | null,
// or { id: null, name: null, startedAt: null, count, source } when several calls are open and none can be told from
// the others. Nothing is shown unless the agent is working and alive.
// - With the hook's call id, only that very call counts; its start is the transcript's time for it, else the hook's
//   `at` (seconds, set when the call began). A subagent's record has `startedAt` of its own and an `at` that is only
//   freshness (its file's mtime), so `at` is never read as a start there.
// - Without it, one open call after the last interruption note is that call; more than one are only counted.
export function nowCall(messages, record, { status, life }) {
  if (status !== "working" || life !== "live") return null;
  const list = messages ?? [];
  const noteAfter = (index) => list.slice(index + 1).some((m) => m.role === "note");
  if (record?.tool && record.call) {
    const index = list.findIndex((m) => m.role === "tool" && m.id === record.call);
    const m = index >= 0 ? list[index] : null;
    if (m && (m.status !== "running" || noteAfter(index))) return null; // finished or interrupted: the record is behind
    const fromRecord = "startedAt" in record ? record.startedAt ?? null : Number.isFinite(record.at) ? record.at * 1000 : null;
    return { id: record.call, name: m?.name ?? record.tool, startedAt: m?.startedAt ?? fromRecord, source: "record" };
  }
  const lastBreak = list.reduce((at, m, i) => (m.role === "note" || m.role === "divider" ? i : at), -1);
  const open = list.slice(lastBreak + 1).filter((m) => m.role === "tool" && m.status === "running");
  if (open.length === 1) return { id: open[0].id, name: open[0].name ?? null, startedAt: open[0].startedAt ?? null, source: "transcript" };
  return open.length > 1 ? { id: null, name: null, startedAt: null, count: open.length, source: "transcript" } : null;
}

// "8 s", "1 min 08 s", "1 h 02 min"; null when the start is unknown or too far ahead of the clock. A little ahead is 0 s.
export function elapsedText(startedAt, nowMs, { calm = false } = {}) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(nowMs) || startedAt - nowMs > CLOCK_SKEW_MS) return null;
  const s = Math.max(0, Math.floor((nowMs - startedAt) / 1000));
  if (calm) return calmElapsed(s);
  const pad = (n) => String(n).padStart(2, "0");
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${pad(s % 60)} s`;
  return `${Math.floor(s / 3600)} h ${pad(Math.floor((s % 3600) / 60))} min`;
}

// The line under NOW's text: "Bash · 8 s". Unknown time is said, never guessed.
export function toolLine(call, nowMs, { calm = false } = {}) {
  if (!call) return null;
  if (call.count) return `${call.count} tools running · time unknown`;
  const name = call.name || "a tool";
  const time = elapsedText(call.startedAt, nowMs, { calm }) ?? "time unknown";
  return `${name} · ${time}${call.source === "transcript" ? " · from the conversation" : ""}`;
}

// ---- Changes in the repo (hooks/repo-files.mjs), shown next to the files the conversation touched ----

export const REPO_POLL_MS = 60000; // the control read: catches what the conversation doesn't say (a shell command that changed files)
export const REPO_DIRTY_GAP_MS = 1500; // a conversation edit asks for a read, but never sooner than this after the last one began

// Whether to read the repo now. Only while the lists are in sight (the panel shows and CHANGED or READ is open), for a
// local folder, one read at a time. The first read comes at once; after that a read is due when the conversation settled an
// edit (`dirty`, at least REPO_DIRTY_GAP_MS after the last attempt began) and in any case REPO_POLL_MS after it (a failed
// attempt waits that long too). `dirty` that comes while a read runs is kept by the caller: this only decides.
// -> { run, reason }
export function repoPollDecision({ visible, expanded, cwd, local, busy, attemptAt, dirty = false }, nowMs) {
  if (!visible) return { run: false, reason: "hidden" };
  if (!expanded) return { run: false, reason: "folded" };
  if (!cwd) return { run: false, reason: "no folder" };
  if (!local) return { run: false, reason: "remote" };
  if (busy) return { run: false, reason: "busy" };
  if (attemptAt === null || attemptAt === undefined || nowMs < attemptAt || nowMs - attemptAt >= REPO_POLL_MS) return { run: true, reason: "due" };
  if (dirty && nowMs - attemptAt >= REPO_DIRTY_GAP_MS) return { run: true, reason: "dirty" };
  return { run: false, reason: "waiting" };
}

// The ids of tool calls that finished (done or failed: a failed edit may have changed a file in part) and edited a file.
const settledEdits = (messages) => new Set((messages ?? []).filter((m) => m?.role === "tool" && (m.status === "ok" || m.status === "error") && (m.files ?? []).some((f) => f?.verb === "edited")).map((m) => m.id));

// Whether the conversation settled an edit that was not settled before: the repo's numbers may have changed. seen: the
// edits counted so far (a Set; null before the first look: that look only sets the baseline). baseline: true for messages
// that are not new events (a page of older history): they are counted as seen and ask for nothing. A call that is upserted
// again (the same id, still settled) asks for nothing a second time. -> { dirty, seen } (a new Set)
export function repoDirtyFrom(seen, messages, baseline = false) {
  const now = settledEdits(messages);
  if (seen === null || seen === undefined || baseline) return { dirty: false, seen: now };
  return { dirty: [...now].some((id) => !seen.has(id)), seen: now };
}

// The panel's files with what the repo says about each: the file's `repo` is
//   null                                                 nothing to say (no repo information, the file is outside the repo, or its path is unknown)
//   { kind: "clean" }                                    inside the repo and git lists no change
//   { kind: "changed", added, removed, binary, untracked, status }   (counts are null when git gives none: binary, untracked, no HEAD)
// Files are matched by full path inside the repo, never by name. Nothing is added to the list: the repo only
// decorates files the conversation touched, and it says what differs from HEAD, not who changed it. A new list.
export function withRepoStats(files, snapshot) {
  if (snapshot?.state !== "ok" || typeof snapshot.root !== "string") return (files ?? []).map((f) => ({ ...f, repo: null }));
  const root = norm(snapshot.root);
  const byPath = new Map((snapshot.files ?? []).map((f) => [norm(`${snapshot.root}/${f.path}`), f]));
  return (files ?? []).map((f) => {
    if (!f.full) return { ...f, repo: null };
    const key = norm(f.full);
    const hit = byPath.get(key);
    if (hit) return { ...f, repo: { kind: "changed", added: hit.added ?? null, removed: hit.removed ?? null, binary: hit.binary === true, untracked: hit.untracked === true, status: hit.status ?? "" } };
    return { ...f, repo: key.startsWith(`${root}/`) ? { kind: "clean" } : null };
  });
}

// The mark beside a file: "+12 −3", "binary", "—" (changed or unchanged, no counts to show), null (say nothing).
export function repoMark(repo) {
  if (!repo) return null;
  if (repo.kind === "clean") return "—";
  if (repo.binary) return "binary";
  return Number.isFinite(repo.added) && Number.isFinite(repo.removed) ? `+${repo.added} −${repo.removed}` : "—";
}

// The line under the lists that says what the numbers are (or why there are none).
// snapshot: the last good one (or null); failure: the last failed read (or null).
export function repoNote(snapshot, failure) {
  if (failure?.state === "not-repo") return "not a git repository: no numbers";
  if (snapshot?.state === "ok") {
    const old = failure ? " · old: the last read failed" : "";
    return snapshot.headMissing ? "no commit yet: no numbers" : `changes in repo · vs HEAD${old}`;
  }
  return failure ? `git: ${failure.error ?? "no numbers"}` : null;
}
