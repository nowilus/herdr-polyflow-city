#!/usr/bin/env node
// PolyFlow Office status line wrapper for Claude Code. Claude Code runs the `statusLine.command` after each answer
// and hands it a JSON with the model, effort, context window and rate limits on stdin. This script
//   1. keeps what the office needs: data/polyflow-office/meta/<terminal>.json (model, effort, context) and
//      data/polyflow-office/limits/claude.json (the 5 h and weekly limits), written only when they change;
//   2. then runs the status line the person had before (data/polyflow-office/statusline-chain.json, saved by
//      `install.mjs --statusline`), gives it the same stdin and prints exactly what it prints.
// It prints nothing of its own and never fails: a status line that errors would blank the person's bar. Every field
// is optional; a missing one is null, never 0. Only numbers, the model's name and the effort are kept: no prompts.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { appHome, clean, writeAtomic } from "./activity.mjs";

export const CHAIN_TIMEOUT_MS = 1500;
const OUT_MAX = 1024 * 1024; // of the chained command's output
const TERMINAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// A percentage 0..100 (one decimal), else null.
const pct = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v * 10) / 10 : null);
const whole = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);

// Claude Code's status line JSON -> what the office keeps per terminal, or null when it holds none of it.
export function metaFrom(payload, now) {
  const p = payload !== null && typeof payload === "object" ? payload : {};
  const model = clean(p.model?.display_name, 60);
  const modelId = clean(p.model?.id, 80);
  const effort = clean(p.effort?.level, 20);
  const context = { usedPct: pct(p.context_window?.used_percentage), size: whole(p.context_window?.context_window_size) };
  if (!model && !modelId && !effort && context.usedPct === null && context.size === null) return null;
  return { v: 1, at: now, provider: "claude", model, modelId, effort, context, source: "statusline" };
}

// One rate-limit window ({ used_percentage, resets_at in seconds }) -> { usedPct, resetsAt } or null.
const windowOf = (w) => {
  const usedPct = pct(w?.used_percentage);
  const resetsAt = typeof w?.resets_at === "number" && Number.isFinite(w.resets_at) && w.resets_at > 0 ? w.resets_at : null;
  return usedPct === null && resetsAt === null ? null : { usedPct, resetsAt };
};

// The account's limits, or null when the status line carries none (an API key, a plan without windows, before the
// first answer of a session): the file from before then stays.
export function limitsFrom(payload, now) {
  const r = payload?.rate_limits;
  if (r === null || typeof r !== "object") return null;
  const fiveHour = windowOf(r.five_hour);
  const sevenDay = windowOf(r.seven_day);
  return fiveHour || sevenDay ? { v: 1, at: now, fiveHour, sevenDay } : null;
}

// The record without its times (`at`, and `asOf` of a limits record), for "did anything change".
const withoutTimes = ({ at: _at, asOf: _asOf, ...rest }) => JSON.stringify(rest);
const sameContent = (a, b) => withoutTimes(a) === withoutTimes(b);

// Write `record` to `file` unless the file already holds the same content (the time apart). -> whether it wrote.
export function writeIfChanged(file, record) {
  let current = null;
  try {
    current = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  if (current && sameContent(current, record)) return false;
  mkdirSync(join(file, ".."), { recursive: true });
  writeAtomic(file, JSON.stringify(record));
  return true;
}

// Keep the office's data from one status line payload. env: process.env-like. -> the files written.
export function keep(payload, env, now) {
  const data = join(appHome(env), "data", "polyflow-office");
  const written = [];
  const id = env.HC_TERMINAL_ID || "";
  const meta = metaFrom(payload, now);
  if (meta && TERMINAL_ID.test(id)) {
    const file = join(data, "meta", `${id}.json`);
    if (writeIfChanged(file, meta)) written.push(file);
  }
  const limits = limitsFrom(payload, now);
  if (limits) {
    const file = join(data, "limits", "claude.json");
    if (writeIfChanged(file, limits)) written.push(file);
  }
  return written;
}

// Whether a command is this wrapper (a chain that is ours would start itself again, for ever).
export const isWrapper = (command) => typeof command === "string" && command.replace(/\\/g, "/").includes("polyflow-office/hooks/statusline.mjs");

// The command the person's status line was before ours (statusline-chain.json), or null. Never our own command.
export function chainCommand(env) {
  try {
    const c = JSON.parse(readFileSync(join(appHome(env), "data", "polyflow-office", "statusline-chain.json"), "utf8"))?.command;
    return typeof c === "string" && c.trim() !== "" && !isWrapper(c) ? c : null;
  } catch {
    return null;
  }
}

// Run the person's own command through the system shell (it is their settings' command, run as Claude Code runs it),
// with `input` on its stdin. Resolves with the bytes it printed: all of them, or what it had printed when the time
// ran out or it failed. Never rejects.
export function runChain(command, input, timeoutMs = CHAIN_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let child = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => {
      try {
        if (process.platform === "win32" && child?.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => {});
        else child?.kill();
      } catch {}
      finish();
    }, timeoutMs);
    try {
      child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
      child.on("error", finish);
      child.on("close", finish);
      child.stdout.on("data", (b) => {
        if (size >= OUT_MAX) return;
        chunks.push(b);
        size += b.length;
      });
      child.stdin.on("error", () => {}); // it may not read its input at all
      child.stdin.end(input);
    } catch {
      finish();
    }
  });
}

// The whole job. input: the stdin bytes; write(buffer): where the chained output goes.
export async function run({ input, env = process.env, now = Date.now(), write }) {
  try {
    let payload = null;
    try {
      payload = JSON.parse(input.toString("utf8"));
    } catch {}
    try {
      keep(payload, env, now);
    } catch {} // e.g. the office is reading the file right now: the next answer writes again
    const command = chainCommand(env);
    if (command) write(await runChain(command, input));
  } catch {}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let input = Buffer.alloc(0);
  try {
    input = readFileSync(0);
  } catch {}
  await run({ input, write: (b) => process.stdout.write(b) });
}
