// What the v3 reader (transcript-v3.mjs) keeps on disk between two runs, one small file per chat window: a checkpoint
// that says how far a session file was read and what the parser knew there. It holds no conversation: only the calls
// still waiting for a result, the plan, the token sums and where the file's identity was checked. Losing it costs one
// full read, never a wrong answer: every reader decision that can't be proved from it ends in a full read.
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, opendirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const CHECKPOINT_MAX = 1024 * 1024; // a checkpoint bigger than this is not written (the answer then says cache: "unavailable")
export const HEAD_MAX = 4096; // the file's first bytes that are hashed for its identity (and its last ones, as a guard)
export const CACHE_AGE_MS = 24 * 60 * 60 * 1000;
export const CACHE_FILES_MAX = 100;
const SCAN_MAX = 1000; // directory entries looked at when pruning: the scan is bounded, not recursive

const KEY_FILE = /^[a-f0-9]{16}\.json$/;
const CACHE_DIR = /(^|[\\/])data[\\/]polyflow-office[\\/]chat-cache$/i;
const OWN_TEMP = /^[a-f0-9]{16}\.json\.[\w-]+\.tmp$/;

export const sha1 = (buffer) => createHash("sha1").update(buffer).digest("hex");
export const newEpoch = () => randomUUID();

// The checkpoint path the mod passes with --state: absolute, no "..", a [a-f0-9]{16}.json file directly inside
// <home>/data/polyflow-office/chat-cache. -> { full, dir, name } or null.
export function validStatePath(path) {
  if (typeof path !== "string" || path.includes("\0") || !isAbsolute(path)) return null;
  if (path.split(/[\\/]/).includes("..")) return null;
  const full = resolve(path);
  const dir = dirname(full);
  const name = basename(full);
  return KEY_FILE.test(name) && CACHE_DIR.test(dir) ? { full, dir, name } : null;
}

// Identity of a file, with dev / ino / birthtimeNs as text (they don't fit a safe integer everywhere). stat: from
// fstat(fd, { bigint: true }). headLen/headHash: the file's first bytes (hashed from the same descriptor).
export const identityOf = (stat, headLen, headHash) => ({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs), headLen, headHash });

// Whether `stat` is still the file `saved` describes. prefixHash: the hash of exactly the first saved.headLen bytes of
// the file as it is now (the same prefix: a growing small file keeps its identity).
export function sameIdentity(saved, stat, prefixHash) {
  return saved.dev === String(stat.dev) && saved.ino === String(stat.ino) && saved.birthtimeNs === String(stat.birthtimeNs)
    && BigInt(saved.headLen) <= stat.size && saved.headHash === prefixHash;
}

const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const isHash = (v) => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);

// A checkpoint as loaded, or null when it is not one this reader wrote (anything doubtful is "no checkpoint").
function shaped(c) {
  if (!c || typeof c !== "object" || c.v !== 1) return null;
  const id = c.identity;
  const guard = c.tailGuard;
  const ok = typeof c.file === "string" && typeof c.sidechain === "boolean" && typeof c.epoch === "string" && /^[\w-]{8,64}$/.test(c.epoch)
    && isCount(c.base) && typeof c.fromStart === "boolean" && isCount(c.end) && c.reader && typeof c.reader === "object" && c.reader.v === 1
    && id && typeof id.dev === "string" && typeof id.ino === "string" && typeof id.birthtimeNs === "string" && isCount(id.headLen) && isHash(id.headHash)
    && guard && isCount(guard.start) && isCount(guard.length) && isHash(guard.hash) && guard.start + guard.length === c.end;
  return ok ? c : null;
}

// The checkpoint at `path` (already validated), or null: missing, a link, too big, not JSON, wrong shape.
// cost.bytes is raised by what was read.
export function loadCheckpoint(path, cost = null) {
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.size > CHECKPOINT_MAX) return null;
    const text = readFileSync(path, "utf8");
    if (cost) cost.bytes += info.size;
    return shaped(JSON.parse(text));
  } catch {
    return null;
  }
}

// Write a checkpoint: a temp file of our own in the same folder, then a rename over the old one (the old one is never
// deleted first). false when it was not written: too big, or the folder / file can't be written. Never throws.
export function saveCheckpoint(path, value) {
  const dir = dirname(path);
  const temp = join(dir, `${basename(path)}.${process.pid}-${randomUUID().slice(0, 8)}.tmp`);
  try {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text, "utf8") > CHECKPOINT_MAX) return false;
    mkdirSync(dir, { recursive: true });
    if (lstatSync(dir).isSymbolicLink()) return false;
    writeFileSync(temp, text, { flag: "wx" });
    renameSync(temp, path);
    return true;
  } catch {
    return false;
  } finally {
    try {
      unlinkSync(temp);
    } catch {}
  }
}

// Remove old checkpoints from the cache folder: our own files (never links, never anything else) older than a day, then
// the oldest ones beyond CACHE_FILES_MAX. `keep`: the file name in use now, which stays. -> how many were removed.
export function pruneCache(dir, now, keep) {
  const found = [];
  let handle = null;
  try {
    handle = opendirSync(dir);
    for (let entry = handle.readSync(); entry && found.length < SCAN_MAX; entry = handle.readSync()) {
      if (!KEY_FILE.test(entry.name) && !OWN_TEMP.test(entry.name)) continue;
      const info = lstatSync(join(dir, entry.name));
      if (info.isFile()) found.push({ name: entry.name, at: info.mtimeMs });
    }
  } catch {
    return 0;
  } finally {
    try {
      handle?.closeSync();
    } catch {}
  }
  const others = found.filter((f) => f.name !== keep).sort((a, b) => a.at - b.at);
  const excess = Math.max(0, found.length - CACHE_FILES_MAX);
  const doomed = others.filter((f, i) => now - f.at > CACHE_AGE_MS || i < excess);
  let removed = 0;
  for (const f of doomed) {
    try {
      unlinkSync(join(dir, f.name));
      removed++;
    } catch {}
  }
  return removed;
}

