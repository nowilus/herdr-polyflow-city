// What the chat reads from and keeps in the world around it. Two kinds:
//   - Herdr's shared state, per agent. Two separate keys: STATE (the draft, opened tool runs, following the newest
//     message) and UI (the side panel's folded sections and picked file). Each write reads the entry as it is at that
//     moment and changes only its own fields, so nothing the other writer keeps is lost.
//   - The session files and hook records on disk, through the reader (hooks/transcript.mjs).
import { appHome, readTextFile, setShared, shared } from "herdr";
import { subagentRecords } from "./activity.js";
import { meteredExec, meteredRead } from "./cost-meter.js";
import { CHAT_STATE_KEY, CHAT_UI_KEY, SUBAGENTS_KEY, internalOf, needsPrevious, patchEntry, readOutcome, subagentFile, uiOf, v2Refusal } from "./chat-model.js";
import { CHAT_SEND_KEY } from "./chat-place.js";

const OWN_HOME = appHome();
const PREV_BYTES = 2 * 1024 * 1024; // read from its end

export const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// Where the office's data and hooks live: the folder the hooks were installed from (SCREEN windows run elsewhere).
// cost / kind (optional): the meter that counts this read, and under what.
export async function sourceHome(cost, kind = "activity") {
  const src = (await meteredRead(cost, kind, `${OWN_HOME}/data/polyflow-office/source-home.txt`).catch(() => null))?.trim();
  return src ? src.replace(/[\\/]+$/, "") : OWN_HOME;
}

// The chat's saved entry for an agent ({} when there is none).
export function savedChat(address) {
  const all = shared(CHAT_STATE_KEY);
  const s = all && typeof all === "object" ? all[address] : null;
  return s && typeof s === "object" ? s : {};
}

// Write some fields of the chat's entry (draft, open, pinned, seen).
export function patchChat(address, fields) {
  setShared(CHAT_STATE_KEY, patchEntry(shared(CHAT_STATE_KEY), address, fields));
}

export function savedSend(address) {
  const entry = shared(CHAT_SEND_KEY)?.[address];
  return entry && typeof entry.token === "string" && ["pending", "sent", "failed"].includes(entry.status) ? entry : null;
}

// One ticket per address, not a history. Keep pending tickets; bound unconsumed completions.
export function patchSend(address, entry) {
  const all = shared(CHAT_SEND_KEY);
  const next = { ...(all && typeof all === "object" && !Array.isArray(all) ? all : {}) };
  if (entry) next[address] = entry;
  else delete next[address];
  const done = Object.keys(next).filter(key => next[key]?.status !== "pending");
  for (const key of done.slice(0, Math.max(0, done.length - 64))) delete next[key];
  setShared(CHAT_SEND_KEY, next);
}

// The side panel's saved state for an agent (chat-model.js uiOf).
export const savedUi = (address) => uiOf(shared(CHAT_UI_KEY), address);

// Write some fields of the panel's entry (collapsed, selectedFile).
export function patchUi(address, fields) {
  setShared(CHAT_UI_KEY, patchEntry(shared(CHAT_UI_KEY), address, fields));
}

// One session file through hooks/transcript.mjs (chat-model.js readOutcome):
// { out: { size, cwd, messages, plan, session, coverage } | { same }, failure: text | null }.
// cost (optional): the window's meter; what the reader answered (v2: the whole thing again, or "same") is counted there.
export async function readConversation(home, file, bytes, known, cost) {
  const args = [`${home}/mods/polyflow-office/hooks/transcript.mjs`, file, String(bytes), ...(known ? [known] : [])];
  const r = await meteredExec(cost, "transcript", "node", args).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
  const read = readOutcome(r.code === 0 ? parseJson(r.stdout) : null, r.stderr || "can't read the conversation");
  if (!read.failure) cost?.meter("transcript", { procs: 0, ...(read.out?.same ? { same: 1 } : { full: 1 }) });
  return read;
}

// One session file through the v3 reader (hooks/transcript-v3.mjs), which resumes from the checkpoint of this window
// (`readerKey`). from: { readerKey, epoch, end, verify }: the history held for this file (epoch, end), or none (a full
// read); verify: the control read, which also proves the file is the same one. -> { out, failure } like readConversation,
// or { legacy: true } when the hook is too old to know --v3 (it says exactly "no session file": ask the old way).
export async function readConversationV3(home, file, from, cost) {
  const state = `${home}/data/polyflow-office/chat-cache/${from.readerKey}.json`;
  const args = [`${home}/mods/polyflow-office/hooks/transcript.mjs`, "--v3", "--file", file, "--state", state,
    ...(from.epoch ? ["--since", String(from.end), "--epoch", from.epoch] : []), ...(from.verify ? ["--verify"] : [])];
  const r = await meteredExec(cost, "transcript", "node", args).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
  const raw = r.code === 0 ? parseJson(r.stdout) : null;
  if (v2Refusal(raw)) return { legacy: true };
  const read = readOutcome(raw, r.stderr || "can't read the conversation");
  const out = read.out;
  if (!read.failure && out?.v3) {
    cost?.meter("transcript", { procs: 0, bytes: out.cost.bytes, parseMs: out.cost.parseMs, ...(out.same ? { same: 1 } : out.kind === "delta" ? { delta: 1 } : { full: 1 }) });
  }
  return read;
}

// One page of older history of a session file (hooks/transcript-page.mjs), for SHOW OLDER. from: { readerKey, epoch,
// before, count }: the checkpoint of this window, the history's epoch and where the loaded part begins. -> { out, failure }
// like readConversation: out is the page (kind "page"), or { changed: true } when the file or the history is no longer
// the one the chat holds (the chat starts over), or a failure (e.g. "line-too-large").
export async function readOlder(home, file, from, cost) {
  const state = `${home}/data/polyflow-office/chat-cache/${from.readerKey}.json`;
  const args = [`${home}/mods/polyflow-office/hooks/transcript.mjs`, "--v3", "--page", "--file", file, "--state", state,
    "--before", String(from.before), "--epoch", from.epoch, "--count", String(from.count ?? 200)];
  const r = await meteredExec(cost, "page", "node", args).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
  const read = readOutcome(r.code === 0 ? parseJson(r.stdout) : null, r.stderr || "can't read the older history");
  if (!read.failure && read.out?.v3) cost?.meter("page", { procs: 0, bytes: read.out.cost.bytes, parseMs: read.out.cost.parseMs });
  return read;
}

// What the repo around a folder says about its files (hooks/repo-files.mjs): a RepoSnapshot, or an "unavailable" one
// when the helper itself couldn't run. Never throws. cost (optional): the window's meter.
export async function readRepoSnapshot(cwd, cost, { isActive = () => true } = {}) {
  if (!isActive()) return null;
  const down = (error) => ({ cwd, root: null, at: Date.now(), state: "unavailable", error: String(error).trim().slice(0, 120), headMissing: false, files: [] });
  try {
    const home = await sourceHome(cost, "git");
    if (!isActive()) return null;
    const r = await meteredExec(cost, "git", "node", [`${home}/mods/polyflow-office/hooks/repo-files.mjs`, cwd]);
    if (!isActive()) return null;
    const out = r.code === 0 ? parseJson(r.stdout) : null;
    return out && typeof out.state === "string" && Array.isArray(out.files) ? out : down(r.stderr || "can't read the repo");
  } catch (err) {
    if (!isActive()) return null;
    return down(err?.message ?? err);
  }
}

// The session record of an internal subagent, made from its agent's: { transcript, bound: "internal" } or null.
function subagentSession(parentText, id) {
  const file = subagentFile(parseJson(parentText)?.transcript, id);
  return file ? { transcript: file, bound: "internal" } : null;
}

// What an agent's two small records say, read without starting any process: { home, transcript, bound, record,
// previous } (the session file the hook recorded, how sure that is, the activity record, and the file of the
// conversation before /clear or resume). This is the cheap tick of the chat; readConversationFrom does the costly part.
// cost (optional): the chat window's meter (cost-model.js createMeter), which counts the reads and the reader's runs.
export async function readConversationRecord(d, cost) {
  const home = await sourceHome(cost);
  const data = `${home}/data/polyflow-office`;
  const readData = (path) => meteredRead(cost, "activity", path).catch(() => null);
  // An internal subagent: its own file next to its agent's session file; its record comes with the office's list.
  const inner = internalOf(d.address);
  const session = inner ? subagentSession(await readData(`${data}/sessions/${inner.parent}.json`), inner.id)
    : parseJson(await readData(`${data}/sessions/${d.address}.json`));
  const record = inner ? subagentRecords(shared(SUBAGENTS_KEY))[d.address] ?? null
    : parseJson(await readData(`${data}/activity/${d.address}.json`));
  const transcript = typeof session?.transcript === "string" ? session.transcript : null;
  const bound = session?.bound === "env" ? "env" : session ? "guess" : null;
  // The hook keeps the previous conversation's file in the session record.
  const previous = typeof session?.previous === "string" ? session.previous : null;
  return { home, transcript, bound, record, previous };
}

// What the v3 reader is asked: the history held for this file (its epoch and end), if there is a good one.
const readerFrom = (d, file, verify) => {
  const h = d.history && d.history.file === file && d.history.epoch && !d.history.resync ? d.history : null;
  return { readerKey: d.readerKey, epoch: h?.epoch ?? null, end: h?.end ?? 0, verify };
};

// The session files themselves, through the reader (one process each), for a record just read:
// { transcript, bound, record, read?, previous?, prevRead? }, what chat-model.js mergePoll takes. d is the chat's state
// so far (what is already known decides what is read again).
export async function readConversationFrom(d, rec, cost, { verify = false, isActive = () => true } = {}) {
  if (!isActive()) return null;
  const { home, transcript, bound, record, previous } = rec;
  const poll = { transcript, bound, record };
  if (transcript) {
    const known = transcript === d.transcript && d.messages ? String(d.size) : undefined;
    // v3 unless this window found the hook too old (then v2, the way it always was).
    const first = d.readerMode === "v2" ? { legacy: true } : await readConversationV3(home, transcript, readerFrom(d, transcript, verify), cost);
    if (!isActive()) return null;
    if (first.legacy) {
      if (d.readerMode !== "v2") poll.readerMode = "v2";
      poll.read = await readConversation(home, transcript, 0, known, cost);
    } else poll.read = first;
    if (!isActive()) return null;
  }
  if (needsPrevious(d, previous)) {
    if (!isActive()) return null;
    poll.previous = previous;
    poll.prevRead = previous ? await readConversation(home, previous, PREV_BYTES, undefined, cost) : null;
    if (!isActive()) return null;
  }
  return poll;
}

// One poll of an agent's conversation: the records, then the files. (Kept whole for callers that want both at once.)
export async function pollConversation(d, cost) {
  return readConversationFrom(d, await readConversationRecord(d, cost), cost);
}
