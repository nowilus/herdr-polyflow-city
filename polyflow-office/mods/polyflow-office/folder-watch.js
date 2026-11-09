// A watcher on one session file, built on Herdr's watchFolder (one folder, a promise per batch of changed paths).
// Several chats can watch files of the same folder (Claude keeps all of a project's sessions in one): one loop per
// folder serves them all, and each chat is told only about its own file (chat-read-model.js matchesWatchPath).
//
// Herdr can't cancel a watchFolder promise, and Task.cancel() leaves its promise pending for ever (its `finally` never
// runs). So nothing here depends on cleanup code running after a cancel: stop() changes the registry at once and
// synchronously, and a loop that is cancelled (or finishes late) only ever touches its own generation.
import { watchFolder } from "herdr";
import { folderOf, matchesWatchPath, normalizeWatchPath } from "./chat-read-model.js";

const QUICK_MS = 500; // a batch that comes back this soon and empty is not a real wait
const QUICK_MAX = 3; // that many in a row: Herdr can't watch this folder (it may not exist yet); the control read retries

const registry = new Map(); // normalized folder -> { folder, subscribers: Map(token -> subscriber), generation, owner, task, retry }
let counter = 0;

// A loop for the entry, run by subscriber `owner`'s own context. Ends by itself when nobody is left, when it was
// replaced (generation), or when the folder can't be watched; then entry.task is empty and ensure() starts it again.
function launch(entry, owner) {
  const generation = ++entry.generation;
  entry.owner = owner.token;
  entry.retry = false;
  entry.task = owner.cx.spawn(async () => {
    let quick = 0;
    try {
      while (entry.subscribers.size > 0 && entry.generation === generation) {
        const started = Date.now();
        const paths = await watchFolder(entry.folder);
        if (entry.generation !== generation) return;
        const batch = Array.isArray(paths) ? paths : [];
        quick = batch.length === 0 && Date.now() - started < QUICK_MS ? quick + 1 : 0;
        if (quick >= QUICK_MAX) {
          entry.retry = true;
          return;
        }
        for (const sub of [...entry.subscribers.values()]) {
          if (!sub.closed && batch.some((p) => sub.matches(p))) sub.onChange(sub.cx);
        }
      }
    } catch {
      entry.retry = true; // the control read starts it again; never a tight loop
    } finally {
      if (entry.generation === generation) entry.task = null;
    }
  });
}

function stopSubscriber(entry, token) {
  const sub = entry.subscribers.get(token);
  if (!sub) return;
  sub.closed = true;
  entry.subscribers.delete(token);
  if (entry.subscribers.size === 0) {
    ++entry.generation;
    registry.delete(entry.key);
    const task = entry.task;
    entry.task = null;
    task?.cancel(); // not waiting for any finally
    return;
  }
  // The window that owned the loop is going away: its loop ends now, the next one runs on a window that stays.
  if (entry.owner === token) {
    ++entry.generation;
    const task = entry.task;
    entry.task = null;
    task?.cancel();
    launch(entry, entry.subscribers.values().next().value);
  }
}

// Tell `onChange(cx)` whenever the file `filePath` is written. cx: an AsyncContext of the caller (from cx.spawn or a
// cx.timer callback; a plain Context is good for one host call only and must never be passed here), kept and handed to onChange. -> { stop(), ensure() }: stop() is idempotent; ensure() starts the
// loop again when it ended by itself (call it from the control read). Nothing happens for a path without a folder.
export function watchFile(cx, filePath, onChange) {
  const folder = folderOf(filePath);
  return watchPaths(cx, folder, (p) => matchesWatchPath(filePath, p, folder), onChange);
}

// The same for any paths under `folder`: onChange(cx) when a batch holds a path for which matches(path) says yes (paths
// come as the watcher gives them: normalize before comparing). -> { stop(), ensure() }
export function watchPaths(cx, folder, matches, onChange) {
  const key = normalizeWatchPath(folder);
  if (!folder || key === "") return { stop() {}, ensure() {} };
  const token = ++counter;
  const sub = { token, matches, onChange, cx, closed: false };
  let entry = registry.get(key);
  if (!entry) {
    entry = { key, folder, subscribers: new Map(), generation: 0, owner: null, task: null, retry: false };
    registry.set(key, entry);
  }
  entry.subscribers.set(token, sub);
  if (!entry.task) launch(entry, sub);
  return {
    stop: () => stopSubscriber(entry, token),
    ensure() {
      if (!sub.closed && !entry.task && entry.subscribers.size > 0) launch(entry, sub);
    },
  };
}

// For tests: how many folders are being watched.
export const watchedFolders = () => registry.size;
