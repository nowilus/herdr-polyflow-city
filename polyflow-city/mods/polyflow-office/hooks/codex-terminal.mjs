// Which Herdr terminal a Codex hook event belongs to, when the hook runs without HC_TERMINAL_ID (older Codex
// builds or hook setups that drop the environment). A Codex session id is a UUIDv7 carrying the time the session
// started, and herdr-core knows when each terminal was created. A match is made only when it is unambiguous;
// it is remembered per session, and a failed lookup is remembered briefly so a hook never pays for it twice.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const UUID_V7 = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLACK_MS = 500; // a session can report a time a hair before its terminal (clock rounding)
const KEEP_SESSIONS = 200;
const MISS_TTL_MS = 60000; // a failed lookup is not retried for this long
const BUDGET_MS = 2500; // all hc calls of one lookup together, well inside the hook's 5 s
const TERMINAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// The millisecond time in a UUIDv7, or null.
export function uuidV7Ms(id) {
  const m = typeof id === "string" ? UUID_V7.exec(id) : null;
  return m ? parseInt(m[1] + m[2], 16) : null;
}

// Paths compared the way Windows does: separators and case don't matter, nor a trailing separator.
export const samePath = (a, b) => {
  const norm = (p) => p.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
  return typeof a === "string" && typeof b === "string" && norm(a) === norm(b);
};

// terminals: [{ address, agent, cwd, created_ms }]. The Codex terminal of the folder created last before the
// session started, but only if no other Codex terminal of that folder started between it and the session (then
// either could own it). A session older than every terminal (resumed) goes to the folder's only Codex terminal.
export function pickTerminal(terminals, sessionMs, cwd) {
  const codex = (terminals ?? []).filter((t) => t.agent === "codex" && typeof t.created_ms === "number" && TERMINAL_ID.test(t.address ?? "") && (!cwd || samePath(t.cwd, cwd)));
  if (codex.length === 0) return null;
  if (sessionMs === null) return codex.length === 1 ? codex[0].address : null;
  const before = codex.filter((t) => t.created_ms <= sessionMs + SLACK_MS).sort((a, b) => b.created_ms - a.created_ms);
  if (before.length === 0) return codex.length === 1 ? codex[0].address : null;
  const [latest, next] = before;
  // Two terminals opened within the slack of each other: can't tell which one started this session.
  if (next && latest.created_ms - next.created_ms <= SLACK_MS) return null;
  return latest.address;
}

function hcJson(args, deadline) {
  const left = deadline - Date.now();
  if (left <= 100) throw new Error("hc budget spent");
  return JSON.parse(execFileSync("hc", args, { encoding: "utf8", timeout: left, windowsHide: true }));
}

// Live Codex terminals of the folder, with their start time (only those are asked for details).
function candidates(cwd, deadline) {
  const list = (hcJson(["ls"], deadline).terminals ?? []).filter((t) => t.agent === "codex" && t.state === "live" && (!cwd || samePath(t.cwd, cwd)));
  return list.map((t) => ({ ...t, created_ms: hcJson(["get", t.address], deadline).created_ms }));
}

function readMap(file) {
  try {
    const m = JSON.parse(readFileSync(file, "utf8"));
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}

function writeMap(file, dir, map) {
  const kept = Object.fromEntries(Object.entries(map).slice(-KEEP_SESSIONS));
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(kept));
  renameSync(tmp, file);
}

// The terminal for a Codex session, from the remembered matches or by asking herdr-core once.
// Map entries: "t1a" (a match) or { miss: <ms> } (no unambiguous match, recently).
export function terminalForSession(session, cwd, dataDir, now = Date.now()) {
  if (typeof session !== "string" || !/^[\w-]{8,64}$/.test(session)) return null;
  const file = join(dataDir, "codex-sessions.json");
  const map = readMap(file);
  const known = map[session];
  if (typeof known === "string" && TERMINAL_ID.test(known)) return known;
  if (known && typeof known.miss === "number" && now - known.miss < MISS_TTL_MS) return null;
  let address = null;
  try {
    address = pickTerminal(candidates(cwd, now + BUDGET_MS), uuidV7Ms(session), cwd);
  } catch {
    address = null;
  }
  writeMap(file, dataDir, { ...map, [session]: address ?? { miss: now } });
  return address;
}
