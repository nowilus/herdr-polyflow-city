#!/usr/bin/env node
// What the repo around a folder says about its files, for the chat's CHANGED / READ lists: how many lines each file
// differs from HEAD by (staged and unstaged together), which are untracked. It reports the state of the repo, not
// who changed it. Read-only: only `git rev-parse`, `git status` and `git diff` run, with the arguments as an array
// (no shell), under a deadline and an output limit.
//   node repo-files.mjs <folder>  ->  one JSON RepoSnapshot:
//   { cwd, root, at, state: "ok" | "not-repo" | "unavailable", error, headMissing, files: [{ path, oldPath, added,
//     removed, binary, untracked, status }] }   (paths relative to root, with "/")
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DEADLINE_MS = 20000; // for the whole read
export const OUTPUT_MAX = 2 * 1024 * 1024; // of one git command
export const FILES_MAX = 5000; // listed files; more are cut and said

// `git diff HEAD --numstat -z` output -> Map(path -> { added, removed, binary }). A binary file shows "-\t-": no
// counts, never 0. The text is "added\tremoved\tpath\0" repeated; the path is everything after the second tab.
export function parseNumstatZ(out) {
  const stats = new Map();
  for (const record of String(out ?? "").split("\0")) {
    if (record === "") continue;
    const first = record.indexOf("\t");
    const second = first < 0 ? -1 : record.indexOf("\t", first + 1);
    if (second < 0) continue;
    const added = record.slice(0, first);
    const removed = record.slice(first + 1, second);
    const binary = added === "-" && removed === "-";
    const a = Number(added);
    const r = Number(removed);
    const counted = !binary && /^\d+$/.test(added) && /^\d+$/.test(removed) && Number.isSafeInteger(a) && Number.isSafeInteger(r);
    stats.set(record.slice(second + 1), { added: counted ? a : null, removed: counted ? r : null, binary });
  }
  return stats;
}

// `git status --porcelain=v1 -z --no-renames` output -> [{ path, status }]; status is the two-letter code ("??" for
// an untracked file). Records are "XY path\0"; the path keeps its spaces, tabs and newlines.
export function parseStatusZ(out) {
  const entries = [];
  for (const record of String(out ?? "").split("\0")) {
    if (record.length < 4 || record[2] !== " ") continue;
    entries.push({ path: record.slice(3), status: record.slice(0, 2) });
  }
  return entries;
}

// Status + numstat -> the snapshot's files. Counts only for tracked files git reported; an untracked file has the
// entry and no numbers; a file git lists in the diff but not in the status still shows.
export function joinFiles(statuses, stats) {
  const files = [];
  const seen = new Set();
  for (const { path, status } of statuses) {
    seen.add(path);
    const s = stats?.get(path);
    const untracked = status === "??";
    files.push({ path, oldPath: null, added: untracked ? null : s?.added ?? null, removed: untracked ? null : s?.removed ?? null, binary: Boolean(s?.binary), untracked, status });
  }
  for (const [path, s] of stats ?? []) {
    if (!seen.has(path)) files.push({ path, oldPath: null, added: s.added, removed: s.removed, binary: s.binary, untracked: false, status: "" });
  }
  return files;
}

// Runs git without a shell. -> { ok: true, out } | { ok: false, code, text } (code: the exit status, or a name like
// "ENOENT" / "ETIMEDOUT" / "OUTPUT").
function git(args, cwd, deadline) {
  const left = deadline - Date.now();
  if (left <= 0) return { ok: false, code: "ETIMEDOUT", text: "git took too long" };
  try {
    const out = execFileSync("git", args, { cwd, encoding: "utf8", timeout: left, maxBuffer: OUTPUT_MAX, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out };
  } catch (err) {
    const text = String(err?.stderr ?? err?.message ?? err).trim().slice(0, 160);
    const code = err?.code === "ENOBUFS" || err?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "OUTPUT" : err?.code ?? err?.status ?? "ERR";
    return { ok: false, code, text };
  }
}

const snapshot = (cwd, root, state, error, extra = {}) => ({ cwd, root, at: Date.now(), state, error, headMissing: false, files: [], ...extra });

export function readRepoSnapshot(cwd, deadlineMs = DEADLINE_MS) {
  const deadline = Date.now() + deadlineMs;
  if (typeof cwd !== "string" || cwd === "") return snapshot(cwd ?? "", null, "unavailable", "no folder");
  const top = git(["rev-parse", "--show-toplevel"], cwd, deadline);
  if (!top.ok) {
    if (top.code === "ENOENT" && /git/i.test(top.text) && !/cwd|directory/i.test(top.text)) return snapshot(cwd, null, "unavailable", "git isn't installed");
    if (/not a git repository/i.test(top.text)) return snapshot(cwd, null, "not-repo", null);
    return snapshot(cwd, null, "unavailable", top.code === "ETIMEDOUT" ? "git took too long" : top.text || "git failed");
  }
  const root = top.out.trim();
  const status = git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], root, deadline); // "all": a new folder lists its files, not itself
  if (!status.ok) return snapshot(cwd, root, "unavailable", status.code === "OUTPUT" ? "too many changes to list" : status.text || "git status failed");
  const head = git(["rev-parse", "--verify", "--quiet", "HEAD"], root, deadline);
  const headMissing = !head.ok && head.code === 1;
  let stats = null;
  if (!headMissing) {
    const diff = git(["diff", "HEAD", "--numstat", "-z", "--no-renames", "--no-ext-diff", "--no-textconv"], root, deadline);
    // A diff that failed gives no numbers; the list from status still stands.
    if (!diff.ok) return snapshot(cwd, root, "unavailable", diff.code === "OUTPUT" ? "too many changes to count" : diff.text || "git diff failed");
    stats = parseNumstatZ(diff.out);
  }
  const all = joinFiles(parseStatusZ(status.out), stats);
  return snapshot(cwd, root, "ok", null, { headMissing, files: all.slice(0, FILES_MAX), truncated: all.length > FILES_MAX });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.stdout.write(JSON.stringify(readRepoSnapshot(process.argv[2])));
