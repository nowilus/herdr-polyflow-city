// When the chat reads its conversation, and which file changes concern it. Pure (no herdr imports): desk-chat.js owns
// the timers and the processes, folder-watch.js the watcher; node tests every decision here.
//
// Three things wake a read, so that a quiet chat starts no process at all:
//   - the folder watcher (a write to the chat's own session file),
//   - the cheap tick: the session record and the activity record (two small files, no process) changed,
//   - a control read every CONTROL_MS whatever happens (a watcher can miss a write: a file held open by a process that
//     flushes without closing gives no events).
// The reads themselves are spaced: never sooner than READ_GAP_MS after the previous one started, and a burst of events
// is gathered for DEBOUNCE_MS (counted from its FIRST event: a steady stream can't postpone the read for ever).

export const CHECK_MS = 1500; // the cheap tick: the session and activity records
export const DEBOUNCE_MS = 200;
export const READ_GAP_MS = 1500;
export const CONTROL_MS = 15000;

// A path as the watcher reports it or as a session record has it -> one comparable text. Herdr's Windows watcher gives
// "\\?\C:\Users\you\..." with backslashes and another letter case than the folder it was asked to watch; POSIX paths keep
// their case. "\\?\UNC\server\share" is "//server/share".
export function normalizeWatchPath(path) {
  if (typeof path !== "string" || path === "") return "";
  let p = path.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "").replace(/^\/\/\?\//, "").replace(/\\/g, "/");
  const unc = p.startsWith("//");
  p = p.replace(/\/{2,}/g, "/");
  if (unc) p = `/${p}`;
  const windows = /^[A-Za-z]:(\/|$)/.test(p) || unc;
  if (windows && /^[A-Za-z]:$/.test(p)) p += "/";
  if (p.length > 1 && p.endsWith("/") && !/^[A-Za-z]:\/$/.test(p)) p = p.slice(0, -1);
  return windows ? p.toLowerCase() : p;
}

// Whether one path of a watcher's batch concerns `file` (a session file in the watched `folder`): the file itself, or
// the folder (the watcher's "something changed, look at everything"). Another session's file in the same folder: no.
export function matchesWatchPath(file, changed, folder) {
  const target = normalizeWatchPath(file);
  const seen = normalizeWatchPath(changed);
  if (target === "" || seen === "") return false;
  return seen === target || seen === normalizeWatchPath(folder);
}

// The folder of a file path (the text before its last separator, in the file's own style), or null.
export function folderOf(file) {
  const m = typeof file === "string" ? file.match(/^(.*)[\\/][^\\/]+$/) : null;
  return m && m[1] !== "" ? m[1] : null;
}

// What the cheap tick compares: the parts of the session record and the activity record that mean "something may have
// been written". Equal text, nothing new.
export function recordSignature(rec) {
  return JSON.stringify([rec?.transcript ?? null, rec?.bound ?? null, rec?.previous ?? null, rec?.record?.at ?? null]);
}

// The decision for this moment. busy: a read is running. dirtyAt: when the first wake-up since the last read began
// (null: none). lastStart: when the last read began (null: none yet). lastControl: when the last control read began
// (null: none yet: a control read is due at once). -> { run: start a read now, verify: it is also the control read,
// dueAt: when the next read is due (ms; the caller sleeps until then), or null when nothing is}.
// The control deadline is its own: events of other files never move it.
export function readDecision({ busy = false, dirtyAt = null, lastStart = null, lastControl = null, now, controlMs = CONTROL_MS, gapMs = READ_GAP_MS }) {
  const gap = lastStart === null ? -Infinity : lastStart + gapMs;
  const signalDue = dirtyAt === null ? Infinity : Math.max(dirtyAt + DEBOUNCE_MS, gap);
  const controlDue = lastControl === null ? gap : Math.max(lastControl + controlMs, gap);
  const dueAt = Math.min(signalDue, controlDue);
  const run = !busy && dueAt <= now;
  return { run, verify: run && controlDue <= now, dueAt: busy ? null : dueAt };
}
