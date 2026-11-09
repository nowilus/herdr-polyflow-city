#!/usr/bin/env node
// The office chat's reader: the last part of a Claude Code or Codex session file (.jsonl), as a short list of
// messages. Session files grow to hundreds of MB, so only the tail is read, and the mod gets just the messages.
//   node transcript.mjs <file.jsonl> [maxBytes] [knownSize]
//     -> {"schemaVersion": 2, "size": n, "cwd": dir, "messages": [...], "plan": ..., "session": ..., "coverage": {...}}
// With knownSize equal to the file's size nothing is read: {"schemaVersion": 2, "size": n, "same": true} (the chat
// polls often). The messages are adapters.mjs's (one adapter for Claude Code, one for Codex); the plan and session
// come from hooks/session-meta.mjs. An older chat reads the same answer and uses only size / cwd / messages.
//   node transcript.mjs --v3 ...   the reader that resumes from a checkpoint: see transcript-v3.mjs; with --page one page
//   of older history: see transcript-page.mjs.
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { KEEP, conversationFrom } from "./adapters.mjs";

export { KEEP } from "./adapters.mjs";
const DEFAULT_BYTES = 12 * 1024 * 1024;
const HEAD_BYTES = 64 * 1024; // the start of a file, read only to learn the folder when the tail doesn't say
// Herdr's exec() returns at most 8 MiB: the oldest messages go first when the answer would be bigger.
const OUT_MAX = 6 * 1024 * 1024;
const NO_SESSION = { provider: null, id: null, model: null, tokens: null };

// The answer for the chat, shortened from the old end to fit OUT_MAX; the plan, session and coverage stay whole.
// coverage: { fromStart, start, end } of the bytes that were read (null when unknown).
export function answer(size, conversation, coverage = null) {
  let { messages } = conversation;
  const build = () => JSON.stringify({
    schemaVersion: 2, size, cwd: conversation.cwd ?? null, messages,
    plan: conversation.plan ?? null, session: conversation.session ?? NO_SESSION, coverage,
  });
  let json = build();
  while (Buffer.byteLength(json, "utf8") > OUT_MAX && messages.length > 1) {
    messages = messages.slice(Math.ceil(messages.length / 4));
    json = build();
  }
  return json;
}

// The last `bytes` of a file as whole lines (the first, cut one is dropped unless the file starts there).
// -> { size, start (the byte the lines begin at), lines }
export function tailLines(file, bytes = DEFAULT_BYTES) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    return { size, start, lines };
  } finally {
    closeSync(fd);
  }
}

// The folder the session started in, from the first HEAD_BYTES of the file (a cut last line is not used); null if
// those say none. Only this one fact is taken from the start: nothing else of it is read as the conversation.
export function headCwd(file) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(size, HEAD_BYTES));
    readSync(fd, buf, 0, buf.length, 0);
    const lines = buf.toString("utf8").split("\n");
    if (size > HEAD_BYTES) lines.pop();
    for (const line of lines) {
      if (!line || line[0] !== "{") continue;
      try {
        const d = JSON.parse(line);
        const cwd = [d.cwd, d.payload?.cwd].find((c) => typeof c === "string" && c !== "");
        if (cwd) return cwd;
      } catch {}
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

// One read of the file's tail through the adapter: { size, conversation, coverage }.
function readTail(file, bytes, sidechain) {
  const { size, start, lines } = tailLines(file, bytes);
  const fromStart = start === 0;
  const initialCwd = fromStart ? null : headCwd(file);
  const conversation = conversationFrom(lines, KEEP, { sidechain, initialCwd, fromStart });
  return { size, conversation, coverage: { fromStart, start, end: size } };
}

function main() {
  const [file, bytes, known] = process.argv.slice(2);
  if (!file || !/\.jsonl$/i.test(file)) {
    process.stdout.write(JSON.stringify({ schemaVersion: 2, error: "no session file" }));
    return;
  }
  try {
    const want = Number(bytes) > 0 ? Number(bytes) : DEFAULT_BYTES;
    // A Claude Code subagent's own file (subagents/agent-<id>.jsonl): all of it is its side chain.
    const sidechain = /[\\/]subagents[\\/]agent-[\w-]+\.jsonl$/i.test(file);
    const now = statSync(file).size;
    if (known !== undefined && Number(known) === now) {
      process.stdout.write(JSON.stringify({ schemaVersion: 2, size: now, same: true }));
      return;
    }
    let read = readTail(file, want, sidechain);
    // A huge last line (an image, a big tool result) can fill the whole window: look further back once.
    if (read.conversation.messages.length === 0 && read.size > want) read = readTail(file, want * 4, sidechain);
    process.stdout.write(answer(read.size, read.conversation, read.coverage));
  } catch (err) {
    process.stdout.write(JSON.stringify({ schemaVersion: 2, error: String(err?.code ?? err) }));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // The reader that resumes (transcript-v3.mjs) only when asked with exactly --v3 first; every other call is v2 as ever.
  if (process.argv[2] === "--v3" && process.argv.includes("--page")) (await import("./transcript-page.mjs")).runPageCli(process.argv.slice(3));
  else if (process.argv[2] === "--v3") (await import("./transcript-v3.mjs")).runCli(process.argv.slice(3));
  else main();
}
