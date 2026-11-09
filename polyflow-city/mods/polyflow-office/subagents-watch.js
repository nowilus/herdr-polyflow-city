// When the office asks hooks/subagents.mjs about a Claude agent's internal subagents, and which changed paths concern
// them. Pure (no herdr imports): activity-reader.js followSubagents owns the watcher and the processes; node tests the
// decisions here. polyflow-agents keeps a byte-identical copy.
//
// Before, every Claude agent's helper ran every 3 seconds whether or not it had a subagent (20 processes a minute each).
// Now a read is woken by a write under <session>/subagents/ (the watcher), and a control read runs now and then: often
// while there are subagents (a finished one leaves the office after a minute, which no write announces), seldom when
// there are none (only in case the watcher missed the first one).
import { folderOf, normalizeWatchPath, readDecision } from "./chat-read-model.js";

export const SUBAGENTS_GAP_MS = 3000; // a working subagent writes all the time: never more often than the old poll
export const SUBAGENTS_CONTROL_MS = 15000; // while the agent has subagents
export const SUBAGENTS_IDLE_CONTROL_MS = 60000; // while it has none

// The folder watched for a session: its project folder, which is always there (<session>/subagents only appears with the
// first subagent, and a folder that is not there can't be watched). Herdr watches it with everything under it.
export const subagentsWatchFolder = (transcript) => folderOf(transcript);

// Whether a path from the watcher concerns the subagents of `transcript` (<project>/<session>.jsonl): anything under
// <session>/subagents/, that folder or the session's folder itself, or the watched folder (a batch with the root means
// "look at everything"). The session file, its tool-results and other sessions: no.
export function touchesSubagents(transcript, changed) {
  if (typeof transcript !== "string" || !/\.jsonl$/i.test(transcript)) return false;
  const seen = normalizeWatchPath(changed);
  const session = normalizeWatchPath(transcript.slice(0, -".jsonl".length));
  if (seen === "" || session === "") return false;
  return seen === session || seen === `${session}/subagents` || seen.startsWith(`${session}/subagents/`) || seen === normalizeWatchPath(folderOf(transcript));
}

// The decision for one agent at this moment (chat-read-model.js readDecision with the subagents' spacing). hasList: the
// agent has subagents on show now.
export function subagentsDecision({ dirtyAt = null, lastStart = null, lastControl = null, now, hasList = false }) {
  return readDecision({ dirtyAt, lastStart, lastControl, now, controlMs: hasList ? SUBAGENTS_CONTROL_MS : SUBAGENTS_IDLE_CONTROL_MS, gapMs: SUBAGENTS_GAP_MS });
}
