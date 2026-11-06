#!/usr/bin/env node
// PolyFlow Office activity hook, for Claude Code and Codex (PreToolUse, PostToolUse, UserPromptSubmit, Stop).
// Reads the hook's JSON from stdin and writes what the agent is doing now to
//   <herdr app home>/data/polyflow-office/activity/<HC_TERMINAL_ID>.json
// Only the tool name, a file's base name, a command's first words or a URL's host are kept: never prompts,
// file contents or tool output. Outside a Herdr terminal it does nothing. Prints nothing.
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { terminalForSession } from "./codex-terminal.mjs";

const LOG_MAX_BYTES = 64 * 1024; // the error note starts over past this

const TARGET_MAX = 60;
const TERMINAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// Control and text-direction characters out, whitespace collapsed, length capped.
export function clean(value, max = TARGET_MAX) {
  if (typeof value !== "string") return null;
  const s = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();
  return s === "" ? null : [...s].slice(0, max).join("");
}

const baseName = (p) => (typeof p === "string" ? p.split(/[\\/]/).filter(Boolean).pop() ?? null : null);

// Programs whose next words name what they do ("npm run test", "cargo build", "git status").
const SUBCOMMANDS = new Set(["npm", "pnpm", "yarn", "bun", "npx", "cargo", "go", "git", "make", "docker", "dotnet", "gradle", "mvn", "pip", "uv", "poetry", "deno", "node", "python", "python3", "hc", "herdr-app", "gh", "kubectl", "terraform"]);
const WORD = /^[a-z][a-z0-9:_.-]{0,24}$/; // a subcommand or script name, never a value
const FILE = /^[^=]*[\\/]?[\w.-]+\.[A-Za-z0-9]{1,6}$/; // something that ends in a file name

// What a command does, without its values: the program, its subcommands, file names. Flags and their values,
// variable assignments and any other argument are dropped, so a password or token on the command line never
// reaches the office. "npm run test -- --watch" -> "npm run test"; "login --password X" -> "login".
export function commandHead(cmd) {
  if (typeof cmd !== "string") return null;
  const words = cmd.trim().split(/\s+/).filter((w) => w !== "" && !w.includes("="));
  if (words.length === 0) return null;
  const program = baseName(words[0]) ?? words[0];
  const out = [program.replace(/\.(exe|cmd|bat)$/i, "")];
  const sub = SUBCOMMANDS.has(out[0].toLowerCase());
  let afterFlag = false;
  for (const w of words.slice(1)) {
    if (out.length >= 3) break;
    if (w.startsWith("-")) { afterFlag = true; continue; } // a flag may take the next word as its value
    if (FILE.test(w) && !afterFlag) out.push(baseName(w) ?? w);
    else if (sub && !afterFlag && WORD.test(w)) out.push(w);
    else break;
    afterFlag = false;
  }
  return out.join(" ");
}

function host(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// The short, safe description of what a tool is touching.
export function targetOf(input) {
  const i = input !== null && typeof input === "object" ? input : {};
  const raw =
    baseName(i.file_path ?? i.notebook_path ?? i.path) ??
    commandHead(i.command ?? (Array.isArray(i.cmd) ? i.cmd.join(" ") : i.cmd)) ??
    host(i.url);
  // Search queries, patterns and task descriptions are free text the agent wrote: never kept.
  return clean(raw);
}

const callId = (p) => (typeof p.tool_use_id === "string" && /^[\w.:-]{1,80}$/.test(p.tool_use_id) ? p.tool_use_id : null);

// Whether a new record replaces the one on disk: a tool's end only clears that same tool, so when tools overlap
// (start A, start B, end A) the office keeps showing B.
export function supersedes(next, current) {
  if (!next) return false;
  if (next.event !== "PostToolUse" || !current || current.event !== "PreToolUse") return true;
  return !next.call || !current.call || next.call === current.call;
}

// One hook payload -> the record the office reads. Unknown events give null (nothing is written).
export function activityRecord(payload, now) {
  const p = payload !== null && typeof payload === "object" ? payload : {};
  const event = typeof p.hook_event_name === "string" ? p.hook_event_name : null;
  const base = { at: now, event };
  switch (event) {
    case "PreToolUse":
      return { ...base, tool: clean(p.tool_name, 40), target: targetOf(p.tool_input), call: callId(p) };
    case "PostToolUse":
      return { ...base, tool: null, target: null, call: callId(p) };
    case "UserPromptSubmit":
      return { ...base, tool: null, target: null };
    case "Stop":
      return { ...base, tool: null, target: null, stopped: true };
    default:
      return null;
  }
}

// Where the session's conversation is kept (Claude: ~/.claude/projects, Codex: ~/.codex/sessions), so the office's
// chat can show it. Only an absolute .jsonl path is kept; anything else gives null.
export function transcriptOf(payload) {
  const t = payload?.transcript_path;
  if (typeof t !== "string" || t.length > 400 || !/\.jsonl$/i.test(t)) return null;
  return /^([A-Za-z]:[\\/]|\/)/.test(t) ? t : null;
}

const RENAME_TRIES = 4;
const RENAME_WAIT_MS = 15;

// On Windows a rename fails (EPERM/EBUSY) while the office happens to be reading the file: wait a moment and try
// again a few times before giving up (then the next event writes again).
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  for (let i = 1; ; i++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (err) {
      const busy = err?.code === "EPERM" || err?.code === "EBUSY" || err?.code === "EACCES";
      if (!busy || i >= RENAME_TRIES) {
        rmSync(tmp, { force: true });
        throw err;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_WAIT_MS);
    }
  }
}

// sessions/<terminal>.json: { transcript, session, bound } — written only when it changes. `bound` says how the
// terminal is known: "env" (the hook ran with that terminal's HC_TERMINAL_ID: certain) or "guess" (a Codex session
// matched to a terminal by folder and start time: maybe wrong, so the chat won't write to it).
export function sessionRecord(payload, bound) {
  const transcript = transcriptOf(payload);
  if (!transcript) return null;
  const session = typeof payload?.session_id === "string" && /^[\w-]{8,64}$/.test(payload.session_id) ? payload.session_id : null;
  return { transcript, session, bound: bound === "env" ? "env" : "guess" };
}

function rememberTranscript(data, id, payload, bound) {
  const next = sessionRecord(payload, bound);
  if (!next) return;
  const dir = join(data, "sessions");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.json`);
  let current = null;
  try {
    current = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  if (JSON.stringify(current) !== JSON.stringify(next)) writeAtomic(file, JSON.stringify(next));
}

export function appHome(env = process.env) {
  return env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const record = activityRecord(payload, Math.floor(Date.now() / 1000));
  if (!record) return;
  const data = join(appHome(), "data", "polyflow-office");
  // Claude Code and current Codex pass the terminal's environment; without it (older Codex) the session is
  // matched to a terminal.
  const fromEnv = process.env.HC_TERMINAL_ID || "";
  const id = fromEnv || terminalForSession(payload?.session_id, payload?.cwd, data) || "";
  if (!TERMINAL_ID.test(id)) return;
  try {
    rememberTranscript(data, id, payload, fromEnv ? "env" : "guess");
  } catch {} // e.g. the chat is reading the file right now (Windows): the activity record still goes through
  const dir = join(data, "activity");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.json`);
  let current = null;
  try {
    current = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  if (!supersedes(record, current)) return;
  writeAtomic(file, JSON.stringify(record));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (err) {
    // A hook must never break the agent's turn; leave a note where it can be found.
    try {
      const log = join(tmpdir(), "polyflow-office-hook.log");
      const big = (() => { try { return statSync(log).size > LOG_MAX_BYTES; } catch { return false; } })();
      writeFileSync(log, `${new Date().toISOString()} ${err?.stack ?? err}\n`, { flag: big ? "w" : "a" });
    } catch {}
  }
  process.exitCode = 0;
}
