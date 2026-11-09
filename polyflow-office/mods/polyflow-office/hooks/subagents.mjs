#!/usr/bin/env node
// The internal subagents of a Claude Code session (its Agent tool): they run inside the agent's own process, with no
// terminal, so Herdr doesn't know them. Claude Code keeps each one's conversation next to the session file:
//   <session>/subagents/agent-<id>.jsonl   and   agent-<id>.meta.json { agentType, description, spawnDepth, finished }
//   node subagents.mjs <session.jsonl>  ->  {"subagents": [{ id, type, description, depth, status, record }]}
// `status` is "working" or "done" (a finished one is listed for a short while, so it can be seen leaving); `record`
// is like the activity hook's ({ at, tool, target }: the call it is in now), for its station in the office.
// Only names, short labels and times leave this script: never what the subagent was asked or answered.
import { closeSync, fstatSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { conversationFrom } from "./adapters.mjs";

const DONE_SHOWN_S = 60; // a finished subagent stays this long
const STUCK_S = 2 * 3600; // not finished but silent this long: its session ended without saying so
const TAIL_BYTES = 256 * 1024;
const DESC_MAX = 48;
const ID = /^[\w-]{1,64}$/;

export function subagentsDir(transcript) {
  if (typeof transcript !== "string" || !/\.jsonl$/i.test(transcript)) return null;
  const sep = transcript.includes("\\") ? "\\" : "/";
  return `${transcript.slice(0, -".jsonl".length)}${sep}subagents`;
}

const clean = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

// A running subagent's record, like the activity hook's. `at` is when its file last changed (how fresh the record is,
// never when the call began). When the call is known, `call` is its id and `startedAt` the time (ms) the call was made,
// from the subagent's own lines (null when they give none): the chat's NOW counts from that.
function recordOf(e) {
  const { tool, target, call, startedAt } = e.last;
  return { at: e.mtimeS, tool, target: target ?? null, ...(call ? { call } : {}), ...(startedAt !== undefined ? { startedAt } : {}) };
}

// entries: [{ id, meta, mtimeS, last: { tool, target, call?, startedAt? } | null, context?: number | null }] -> what the
// office shows, in the entries' order.
export function subagentsFrom(entries, nowS) {
  const out = [];
  for (const e of entries ?? []) {
    if (!e || !ID.test(e.id ?? "") || !e.meta || typeof e.meta !== "object") continue;
    const age = nowS - (e.mtimeS ?? 0);
    const finished = e.meta.finished === true;
    if (finished ? age > DONE_SHOWN_S : age > STUCK_S) continue;
    const description = [...(clean(e.meta.description) || clean(e.meta.agentType) || "subagent")].slice(0, DESC_MAX).join("");
    out.push({
      id: e.id,
      type: clean(e.meta.agentType) || null,
      description,
      depth: Number.isInteger(e.meta.spawnDepth) ? e.meta.spawnDepth : 1,
      status: finished ? "done" : "working",
      record: !finished && e.last?.tool ? recordOf(e) : null,
      // The size of its last request's context ({ used }); the percentage is the mod's, from the parent's window.
      context: !finished && Number.isSafeInteger(e.context) && e.context >= 0 ? { used: e.context } : null,
    });
  }
  return out;
}

// What the tail of a subagent's file says: { call: its newest tool call still without a result (or null), context: the
// input of its last response, cache included (or null) }.
function lastCall(file) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    const read = conversationFrom(lines, 50, { sidechain: true, fromStart: start === 0 });
    const running = read.messages.filter((m) => m.role === "tool" && m.status === "running").at(-1);
    return {
      call: running ? { tool: running.name, target: running.target, call: running.id, startedAt: running.startedAt ?? null } : null,
      context: read.session?.tokens?.context ?? null,
    };
  } finally {
    closeSync(fd);
  }
}

function read(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const m = name.match(/^agent-([\w-]{1,64})\.meta\.json$/);
    if (!m) continue;
    const file = join(dir, `agent-${m[1]}.jsonl`);
    try {
      const meta = JSON.parse(readFileSync(join(dir, name), "utf8"));
      const mtimeS = Math.floor(statSync(file).mtimeMs / 1000);
      const tail = meta.finished === true ? null : lastCall(file);
      entries.push({ id: m[1], meta, mtimeS, last: tail?.call ?? null, context: tail?.context ?? null });
    } catch {} // half-written or gone: next time
  }
  return entries;
}

function main() {
  const dir = subagentsDir(process.argv[2]);
  let subagents = [];
  try {
    if (dir) subagents = subagentsFrom(read(dir), Math.floor(Date.now() / 1000));
  } catch {} // no subagents folder: none
  process.stdout.write(JSON.stringify({ subagents }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
