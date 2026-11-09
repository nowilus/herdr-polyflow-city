// The chat's loaded history, as the v3 reader (hooks/transcript-v3.mjs) hands it over in parts. Pure (no herdr imports),
// so node can test every case. A HistoryState is one session file's messages the chat holds, sorted by their place in
// the file (seq, blockIndex, id), and what the reader said about the file besides them:
//   { file, epoch, end, size, oldest, atStart, messages, cwd, plan, session, revision, limited, resync, older }
//   file     the session file it belongs to
//   epoch    the reader's generation of the history (a new one: start over); null before the first read
//   end      the byte the reader has committed to (what the next read asks for: --since)
//   oldest   the byte offset of the first loaded line; atStart: nothing is before it (it is the file's start)
//   revision counts changes the screen has to show (the list redraws on it)
//   limited  a read would have gone over the limit and was not taken in (see trimLoaded); costly reads wait for NEWEST
//   resync   the reader's answer didn't fit what is held: the next read starts from scratch (no --since)
//   older    { busy, error }: SHOW OLDER's state
// Every function returns a new object (or, when nothing changed, the very same one); nothing is modified in place.

export const LOADED_CAP = 3000; // messages held in one window, the previous conversation included
export const LOADED_BYTES = 8 * 1024 * 1024; // their size, conservatively (see messageBytes)
export const KEEP_PINNED = 400; // while following the newest message, the history is cut back to this
const TRIM_SLACK = 200; // ... once it has grown this much beyond it
const COUNTED = new Set(["user", "assistant", "note"]); // what "N NEW" counts

export const comparePosition = (a, b) => a.seq - b.seq || a.blockIndex - b.blockIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const emptyHistory = (file = null) => ({
  file, epoch: null, end: 0, size: 0, oldest: 0, atStart: false, messages: [], cwd: null, plan: undefined, session: undefined,
  revision: 0, limited: false, resync: false, older: { busy: false, error: null },
});

const isSorted = (list) => list.every((m, i) => i === 0 || comparePosition(list[i - 1], m) <= 0);
const sorted = (list) => (isSorted(list) ? list : [...list].sort(comparePosition));

// What a message costs in memory, conservatively: UTF-16 (two bytes a character) for every text it holds, and some for
// the object itself. Not a claim about the heap, only a bound that grows with what is held.
export function messageBytes(m) {
  const chars = (m.text?.length ?? 0) + (m.output?.length ?? 0) + (m.name?.length ?? 0) + (m.target?.length ?? 0) + (m.from?.length ?? 0) + (m.cwd?.length ?? 0)
    + (m.files ?? []).reduce((n, f) => n + (f?.path?.length ?? 0) + 16, 0);
  return 2 * chars + 160;
}
const totalBytes = (messages) => messages.reduce((n, m) => n + messageBytes(m), 0);

// A message's revision: changes whenever something the row shows does (its text, a tool's output, files, state), so a
// cached height is not reused for other content under the same id. Remembered per message object (they never change).
const revisions = new WeakMap();
const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};
export function messageRevision(m) {
  let r = revisions.get(m);
  if (r === undefined) {
    r = `${m.status ?? ""}.${hash(`${m.text ?? ""}\u0000${m.output ?? ""}\u0000${(m.files ?? []).map((f) => `${f?.verb}:${f?.path}`).join("\u0001")}`)}`;
    revisions.set(m, r);
  }
  return r;
}

// ---- Applying what the reader answered ----

function applyFull(hist, out, file) {
  const base = hist ?? emptyHistory(file);
  const sameEpoch = hist !== null && hist.epoch !== null && hist.epoch === out.epoch;
  const keepsPages = sameEpoch && hist.oldest < out.coverage.start;
  // Pages loaded above this window stay (what is before the window's first line); the window replaces the rest.
  const older = keepsPages ? hist.messages.filter((m) => m.seq < out.coverage.start) : [];
  const messages = older.length ? [...older, ...sorted(out.messages)] : sorted(out.messages);
  return {
    ...base, file: base.file ?? file, epoch: out.epoch, end: out.end, size: out.size, oldest: keepsPages ? hist.oldest : out.coverage.start,
    atStart: keepsPages ? hist.atStart : out.coverage.fromStart === true, messages, cwd: out.cwd ?? null, plan: out.plan, session: out.session,
    revision: base.revision + 1, limited: false, resync: false, older: sameEpoch ? base.older : { busy: false, error: null },
  };
}

function applyDelta(hist, out, file) {
  if (!hist || hist.epoch === null || hist.epoch !== out.epoch) return { ...(hist ?? emptyHistory(file)), resync: true };
  let messages = Number.isSafeInteger(out.replaceFrom) ? hist.messages.filter((m) => m.seq < out.replaceFrom) : hist.messages;
  const index = new Map(messages.map((m, i) => [m.id, i]));
  const next = [...messages];
  let changed = next.length !== hist.messages.length;
  for (const m of out.messages) {
    const at = index.get(m.id);
    if (at !== undefined) {
      next[at] = m;
      changed = true;
    } else if (m.seq >= hist.oldest) {
      index.set(m.id, next.length);
      next.push(m); // a call below `oldest` that is not loaded is not added: that would leave a hole before the loaded part
      changed = true;
    }
  }
  messages = changed ? sorted(next) : hist.messages;
  const meta = {};
  if (out.cwd !== undefined && out.cwd !== null && out.cwd !== hist.cwd) meta.cwd = out.cwd;
  if (out.plan !== undefined) meta.plan = out.plan; // absent: what is known stays; null: cleared
  if (out.session !== undefined) meta.session = out.session;
  const moved = changed || Object.keys(meta).length > 0;
  return { ...hist, ...meta, messages, end: out.end, size: out.size, revision: hist.revision + (moved ? 1 : 0), limited: false, resync: false };
}

// One read of the current file into its history. out: normalized (chat-model.js normalizeTranscript, v3). hist: null when
// nothing is held for this file. `same` gives back the very same object (nothing to redraw).
// A delta of another epoch than the held one (or without a held history) is not applied: { resync: true }, and the next
// read starts from scratch.
export function applyRead(hist, out, file = null) {
  if (!out || out.kind === "same") return hist;
  if (out.kind === "full") return applyFull(hist, out, file);
  if (out.kind === "delta") return applyDelta(hist, out, file);
  return hist;
}

// ---- The limit ----

// The newest whole line groups that are at most `count` messages and `bytes`: the history cut from its old end. A line's
// messages (same seq) stay together. At least the newest group stays.
function newestGroups(messages, count, bytes) {
  const groups = [];
  for (const m of messages) {
    const last = groups.at(-1);
    if (last && last[0].seq === m.seq) last.push(m);
    else groups.push([m]);
  }
  let from = groups.length;
  let n = 0;
  let size = 0;
  for (let g = groups.length - 1; g >= 0; g--) {
    const groupBytes = groups[g].reduce((s, m) => s + messageBytes(m), 0);
    if (from < groups.length && (n + groups[g].length > count || size + groupBytes > bytes)) break;
    n += groups[g].length;
    size += groupBytes;
    from = g;
  }
  return groups.slice(from).flat();
}

// While the newest message is followed, the history is cut back to `keep` messages (whole lines) once it is `keep` + 200
// long; and whatever is followed or not, the cap holds: at most `cap` messages and `byteCap` bytes, the previous
// conversation's (extraCount, extraBytes) included. The cut moves `oldest` (SHOW OLDER brings the rest back).
// Reading the history (not pinned) is never cut here. -> the same object when nothing was cut.
export function trimLoaded(hist, { pinned, keep = KEEP_PINNED, cap = LOADED_CAP, byteCap = LOADED_BYTES, extraCount = 0, extraBytes = 0 } = {}) {
  if (!pinned || hist.messages.length === 0) return hist;
  const over = hist.messages.length > keep + TRIM_SLACK || hist.messages.length + extraCount > cap || totalBytes(hist.messages) + extraBytes > byteCap;
  if (!over) return hist;
  const count = Math.max(1, Math.min(keep, cap - extraCount));
  const messages = newestGroups(hist.messages, count, Math.max(1, byteCap - extraBytes));
  if (messages.length === hist.messages.length) return hist;
  return { ...hist, messages, oldest: messages[0].seq, atStart: false, revision: hist.revision + 1 };
}

// Whether the history (plus the previous conversation's) is beyond the cap.
export const overLimit = (hist, { cap = LOADED_CAP, byteCap = LOADED_BYTES, extraCount = 0, extraBytes = 0 } = {}) =>
  hist.messages.length + extraCount > cap || totalBytes(hist.messages) + extraBytes > byteCap;

// What a read leaves of the history: applyRead, then the cut (only while following the newest message). Reading the
// history (not pinned) and the read would go over the cap: it is NOT taken in (neither messages nor `end`), the history
// says `limited`, and the chat stops costly reads until NEWEST. -> { hist, accepted }
export function acceptRead(hist, out, { file = null, pinned = true, extraCount = 0, extraBytes = 0 } = {}) {
  const applied = applyRead(hist, out, file);
  if (applied === hist || applied?.resync) return { hist: applied, accepted: false };
  const limit = { extraCount, extraBytes };
  // Nothing held before this read: a window can always be cut like a followed one.
  const trimmed = trimLoaded(applied, { pinned: pinned || hist === null || hist.epoch !== applied.epoch, ...limit });
  if (!pinned && hist && hist.epoch === applied.epoch && overLimit(trimmed, limit)) return { hist: { ...hist, limited: true }, accepted: false };
  return { hist: trimmed, accepted: true };
}

// ---- SHOW OLDER ----

// One page of older history (the reader's `page` answer, normalized) above what is loaded. Not applied (the very same
// history comes back) unless it is for THIS history (epoch) and ends exactly where the loaded part begins (before ===
// oldest), and moves back (start < before; a page that reaches the file's start may be empty). What the live reader gave
// wins over the page where both have a message: a call the page could not settle ("unknown") never undoes one the live
// reads settled. The checks of generation / file / request are the caller's, and the cap is acceptPage's.
export function applyPage(hist, out) {
  if (!hist || !out || out.kind !== "page" || out.epoch !== hist.epoch || out.before !== hist.oldest) return hist;
  if (!Number.isSafeInteger(out.start) || out.start < 0 || out.start > out.before) return hist;
  if (out.start === out.before && !out.fromStart) return hist;
  const byId = new Map(out.messages.map((m) => [m.id, m]));
  for (const m of hist.messages) byId.set(m.id, m);
  const messages = [...byId.values()].sort(comparePosition);
  return { ...hist, messages, oldest: out.start, atStart: out.fromStart === true, revision: hist.revision + 1, older: { busy: false, error: null } };
}

// applyPage with the cap: a page that would take the history (and the other conversation's: extraCount, extraBytes) over
// it is not taken in at all (not cut: the person is reading the history), and the history says `limited`.
// -> { hist, accepted }
export function acceptPage(hist, out, { extraCount = 0, extraBytes = 0 } = {}) {
  const applied = applyPage(hist, out);
  if (applied === hist) return { hist, accepted: false };
  if (overLimit(applied, { extraCount, extraBytes })) return { hist: { ...hist, limited: true }, accepted: false };
  return { hist: applied, accepted: true };
}

// A short tag of a file, for ids that are only unique inside one file (the reader's fallback ids are places in the file,
// so two files can have the same one): the previous conversation's rows carry it.
export const fileTag = (file) => hash(String(file ?? ""));

// The reader's fallback ids ("@offset.block") are places in a file, so the previous file's can equal the current one's: the
// previous conversation's messages carry the file's tag, and the two conversations' rows (and their cached heights) never
// share a key. Ids the source made itself stay as they are (a resumed session repeats them on purpose: they dedupe).
export const inFile = (messages, file) => {
  const tag = fileTag(file);
  return messages.map((m) => (typeof m.id === "string" && m.id.startsWith("@") ? { ...m, id: `${tag}${m.id}` } : m));
};

// rows must already be restricted to this file; transfer alone may rebind a fresh reader epoch.
export function anchorFits(anchor, history, rows, { transfer = false } = {}) {
  return Boolean(anchor && history && anchor.file === history.file
    && (transfer || anchor.epoch === history.epoch)
    && rows.some(r => r.id === anchor.messageId || r.items?.some(m => m.id === anchor.messageId)));
}

// What the SHOW OLDER row says for a chat's state (the history, the previous conversation, the request in flight):
//   { show: false }
//   { show: true, source: "current" | "previous-init" | "previous", busy, error, label, disabled? }
// The current file's older part first; at its start, the previous conversation (read the first time: "previous-init", then
// paged); nothing when there is none (or when it is the very file shown).
export function olderState(d) {
  const h = d?.history;
  if (!h) return { show: false };
  if (h.limited) return { show: true, disabled: true, source: null, busy: false, error: null, label: "HISTORY LIMIT — scroll down to free it" };
  let source = null;
  if (!h.atStart) source = "current";
  else if (d.prevFile && d.prevFile !== h.file) source = !d.prevHistory ? "previous-init" : !d.prevHistory.atStart ? "previous" : null;
  if (!source) return { show: false };
  const { busy = false, error = null } = d.older ?? {};
  return { show: true, source, busy, error, label: busy ? "LOADING…" : error ? `${error} — click to retry` : "SHOW OLDER" };
}

// ---- "N NEW" ----

// The place of the newest message (-1: none): what the chat remembers when the person scrolls away.
export const newestSeq = (messages) => (messages ?? []).reduce((n, m) => (Number.isSafeInteger(m?.seq) && m.seq > n ? m.seq : n), -1);

// How many messages the person said or the agent answered (or notes) after `seenSeq`. Tool calls, the way tool calls
// fold into runs and SHOW OLDER pages don't count: it is a count of the file's messages, not of rows.
export const freshCount = (messages, seenSeq) => (messages ?? []).reduce((n, m) => (COUNTED.has(m?.role) && m.seq > seenSeq ? n + 1 : n), 0);
