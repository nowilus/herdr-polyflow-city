#!/usr/bin/env node
// What the office shows as each agent's energy and the account limits, in one cheap read per tick.
//   node agent-meta.mjs <herdr app home> [terminal ...]  ->  {"meta": {"<terminal>": Meta}, "limits": {"claude": Limits|null, "codex": Limits|null}}
// - Claude Code writes its own meta/<terminal>.json and limits/claude.json (hooks/statusline.mjs); they are only read here.
// - Codex has no such hook, so for every Codex terminal (sessions/<terminal>.json, transcript under .codex, bound by the
//   terminal's own id) the last 256 KiB of its session file are read: the last turn_context (model, effort) and the last
//   token_count (the size of the last request, the model's window, the rate limits). The result is written to
//   meta/<terminal>.json and limits/codex.json, only when it changed.
// A missing number is null, never 0. Nothing but model, effort and numbers is kept: no prompts, no output.
//   Meta:   { v: 1, at, provider, model, effort, context: { usedPct, size, used? }, ... }   (`at` moves only when the content does)
//   Limits: { v: 1, at, asOf?, fiveHour: { usedPct, resetsAt (s) } | null, sevenDay: ... }
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { clean } from "./activity.mjs";
import { writeIfChanged } from "./statusline.mjs";

export const TAIL_BYTES = 256 * 1024;
const EARLIER_BYTES = 16 * 1024 * 1024; // how far back to look for a turn_context the tail doesn't have
const TERMINAL_FILE = /^([A-Za-z0-9][A-Za-z0-9_-]*)\.json$/;
const FIVE_HOURS = 300; // minutes
const A_WEEK = 10080;

const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
const pct = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(100, Math.round(v * 10) / 10) : null);
const ms = (at) => {
  const t = typeof at === "string" ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : null;
};

// Codex's rate_limits -> { fiveHour, sevenDay }. The window is told by its length (window_minutes), not by being
// "primary" or "secondary"; a window of another length is left out.
export function windowsFrom(rateLimits) {
  const out = { fiveHour: null, sevenDay: null };
  for (const w of [rateLimits?.primary, rateLimits?.secondary]) {
    const usedPct = pct(w?.used_percent);
    const resetsAt = typeof w?.resets_at === "number" && Number.isFinite(w.resets_at) && w.resets_at > 0 ? w.resets_at : null;
    if (usedPct === null && resetsAt === null) continue;
    if (w.window_minutes === FIVE_HOURS) out.fiveHour = { usedPct, resetsAt };
    else if (w.window_minutes === A_WEEK) out.sevenDay = { usedPct, resetsAt };
  }
  return out;
}

// The lines of a Codex session file (the tail) -> what the last turn and the last token report say.
// -> { model, effort, used, size, limits: { fiveHour, sevenDay } | null, limitsAt (ms of the event that had them) }
export function codexFrom(lines) {
  const out = { model: null, effort: null, used: null, size: null, limits: null, limitsAt: null };
  for (const line of lines) {
    if (!line || line[0] !== "{") continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const p = d?.payload;
    if (d?.type === "turn_context") {
      out.model = clean(p?.model, 60) ?? out.model;
      out.effort = clean(p?.effort, 20) ?? out.effort;
    } else if (d?.type === "event_msg" && p?.type === "token_count") {
      // `info` is null on some reports: what was known stays.
      out.used = count(p.info?.last_token_usage?.input_tokens) ?? out.used;
      out.size = count(p.info?.model_context_window) ?? out.size;
      if (p.rate_limits && typeof p.rate_limits === "object") {
        const limits = windowsFrom(p.rate_limits);
        if (limits.fiveHour || limits.sevenDay) {
          out.limits = limits;
          out.limitsAt = ms(d.timestamp) ?? out.limitsAt;
        }
      }
    }
  }
  return out;
}

// The meta record for a Codex terminal, or null when the tail says nothing about it.
export function codexMeta(read, now) {
  if (!read.model && !read.effort && read.used === null && read.size === null) return null;
  const usedPct = read.used !== null && read.size ? pct((read.used / read.size) * 100) : null;
  return { v: 1, at: now, provider: "codex", model: read.model, effort: read.effort, context: { usedPct, size: read.size, used: read.used } };
}

// The last `bytes` of a file as whole lines (the first, cut one is dropped unless the file starts there).
function tailLines(file, bytes) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    return lines;
  } finally {
    closeSync(fd);
  }
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

// A long turn pushes its turn_context out of the tail: look for the last one further back, once (the answer is then
// kept in meta/<terminal>.json, so later ticks don't search again). -> { model, effort } or null
export function earlierTurn(file, tailBytes = TAIL_BYTES, reach = EARLIER_BYTES) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const end = Math.max(0, size - tailBytes);
    const start = Math.max(0, end - reach);
    if (end <= start) return null;
    const buf = Buffer.alloc(end - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    // Cheap test first: only the turn_context lines are parsed.
    const found = codexFrom(lines.filter((l) => l.includes('"turn_context"')));
    return found.model || found.effort ? { model: found.model, effort: found.effort } : null;
  } finally {
    closeSync(fd);
  }
}

// The terminals whose session is a Codex one that is certainly theirs: [{ id, transcript }].
export function codexTerminals(data) {
  let names = [];
  try {
    names = readdirSync(join(data, "sessions"));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const id = name.match(TERMINAL_FILE)?.[1];
    const s = id ? readJson(join(data, "sessions", name)) : null;
    const transcript = typeof s?.transcript === "string" ? s.transcript : null;
    if (id && s?.bound === "env" && transcript && /(^|[\\/])\.codex[\\/]/.test(transcript)) out.push({ id, transcript });
  }
  return out;
}

// Every meta file there is (Claude's and Codex's): { [terminal]: Meta }. Files that aren't a version 1 record are skipped.
export function allMeta(data) {
  const out = {};
  let names = [];
  try {
    names = readdirSync(join(data, "meta"));
  } catch {
    return out;
  }
  for (const name of names) {
    const id = name.match(TERMINAL_FILE)?.[1];
    const m = id ? readJson(join(data, "meta", name)) : null;
    if (m && m.v === 1 && typeof m.provider === "string") out[id] = m;
  }
  return out;
}

// Read the Codex terminals' session tails, keep their meta and the newest Codex limits, and answer with everything.
// only: the terminals that are alive (a Set of ids), or null for all that have a session record. Terminals closed long
// ago keep their files in sessions/ and meta/; with a list they are neither read nor reported.
export function collect(data, now = Date.now(), only = null) {
  let newest = null;
  for (const t of codexTerminals(data)) {
    if (only && !only.has(t.id)) continue;
    try {
      const read = codexFrom(tailLines(t.transcript, TAIL_BYTES));
      const metaFile = join(data, "meta", `${t.id}.json`);
      if (!read.model && !read.effort) {
        // Not in the tail: what the last tick found stays; with none, look further back (once).
        const kept = readJson(metaFile);
        const known = kept?.provider === "codex" && (kept.model || kept.effort) ? { model: kept.model ?? null, effort: kept.effort ?? null } : earlierTurn(t.transcript);
        read.model = known?.model ?? null;
        read.effort = known?.effort ?? null;
      }
      const meta = codexMeta(read, now);
      if (meta) {
        mkdirSync(join(data, "meta"), { recursive: true });
        writeIfChanged(metaFile, meta);
      }
      if (read.limits && (newest === null || (read.limitsAt ?? 0) > (newest.at ?? 0))) newest = { at: read.limitsAt, limits: read.limits };
    } catch {} // a session file that is gone or half written: next tick
  }
  const file = join(data, "limits", "codex.json");
  if (newest) {
    // An older terminal's report never replaces a newer one already kept.
    const kept = readJson(file);
    if (!(Number.isFinite(kept?.asOf) && Number.isFinite(newest.at) && kept.asOf > newest.at)) {
      try {
        writeIfChanged(file, { v: 1, at: now, asOf: newest.at, ...newest.limits });
      } catch {}
    }
  }
  const limit = (name) => {
    const l = readJson(join(data, "limits", name));
    return l && l.v === 1 ? l : null;
  };
  const meta = allMeta(data);
  const shown = only ? Object.fromEntries(Object.entries(meta).filter(([id]) => only.has(id))) : meta;
  return { meta: shown, limits: { claude: limit("claude.json"), codex: limit("codex.json") } };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let out = { meta: {}, limits: { claude: null, codex: null } };
  try {
    // Terminal ids after the app home: only those are read and reported (none given: all).
    const ids = process.argv.slice(3).filter((id) => TERMINAL_FILE.test(`${id}.json`));
    if (process.argv[2]) out = collect(join(process.argv[2], "data", "polyflow-office"), Date.now(), process.argv.length > 3 ? new Set(ids) : null);
  } catch {}
  process.stdout.write(JSON.stringify(out));
}
