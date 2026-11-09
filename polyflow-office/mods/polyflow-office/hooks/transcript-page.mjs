// SHOW OLDER: one page of the history before a byte offset of a session file, for the chat (transcript-v3.mjs has the
// reader that follows the end of the file; this one goes backwards from a point the chat already holds).
//   node transcript.mjs --v3 --page --file <f.jsonl> --state <checkpoint.json> --before <offset> --epoch <epoch> [--count 200]
//   -> { schemaVersion: 3, kind: "page", epoch, before, start, fromStart, messages, cost }
//      or { schemaVersion: 3, error, cost }   error: "changed" (the file or the history is not the one the chat holds: the
//      chat starts over), "line-too-large" (no whole line fits the budget: the chat says why and stops), "invalid-args", ...
// - Only what the live reader committed is read (before <= the checkpoint's end), and only when the checkpoint, its epoch and
//   the file's identity are the chat's: the page is part of the same history. The checkpoint itself is never written.
// - Bytes are read backwards in growing steps, each byte once (at most PAGE_BUDGET of I/O in all, look ahead and guards
//   included), and parsed forwards from the first whole line, so every call comes before its result. The page is the newest
//   whole lines that give `count` messages (a target, not a promise: the budget or OUT_MAX can give fewer); `start` is the
//   first byte of its oldest line, always below `before`: a page with no message still moves the chat back.
// - A page makes no plan, no session and no usage. A call whose result is not in the page is looked for in the first
//   LOOKAHEAD bytes after `before` (the lines only settle calls); one still open after that is "unknown".
import { closeSync, fstatSync, openSync } from "node:fs";
import { createConversationReader } from "./adapters.mjs";
import { loadCheckpoint, validStatePath } from "./transcript-state.mjs";
import {
  LF, OUT_MAX, ReadError, SUBAGENT_FILE, bytesOf, cheapSame, costOf, failure, feedComplete, guardsHold, headCwd, newestGroups, parseCli, readRange, safe,
} from "./transcript-v3.mjs";

export const PAGE_COUNT = 200;
export const PAGE_COUNT_MAX = 500;
export const PAGE_STEP = 2 * 1024 * 1024; // the first step back; each next one is twice as big
export const PAGE_BUDGET = 64 * 1024 * 1024; // I/O for one page, all of it
export const LOOKAHEAD = 1024 * 1024; // after `before`, to settle the calls of the page
export const PAGE_SOFT_MS = 3000; // no bigger step is started after this long

const count = (v) => (v === null || v === undefined ? null : Number.isSafeInteger(v) && v >= 0 ? v : NaN);

// The options -> checked ones, or null.
function normalize(raw) {
  const state = validStatePath(raw.state);
  const before = count(raw.before);
  const wanted = count(raw.count);
  const file = typeof raw.file === "string" && /\.jsonl$/i.test(raw.file) && !raw.file.includes("\0") ? raw.file : null;
  if (!file || !state || before === null || Number.isNaN(before) || Number.isNaN(wanted)) return null;
  if (typeof raw.epoch !== "string" || !/^[\w-]{8,64}$/.test(raw.epoch)) return null;
  const limit = (v, dflt) => (Number.isSafeInteger(v) && v > 0 ? v : dflt);
  return {
    file, state, before, epoch: raw.epoch, count: Math.min(PAGE_COUNT_MAX, Math.max(1, wanted ?? PAGE_COUNT)),
    step: limit(raw.step, PAGE_STEP), budget: limit(raw.budget, PAGE_BUDGET), outMax: limit(raw.outMax, OUT_MAX), softMs: limit(raw.softMs, PAGE_SOFT_MS),
  };
}

// One run -> the answer object. Never throws.
export function readPage(raw = {}) {
  const cost = { bytes: 0, parseMs: 0, lines: 0 };
  const o = normalize(raw ?? {});
  if (!o) return failure("invalid-args", cost);
  let fd;
  try {
    fd = openSync(o.file, "r");
  } catch (error) {
    return failure(String(error?.code ?? "error"), cost);
  }
  try {
    return pageOpen({ fd, o, cost, stat: fstatSync(fd, { bigint: true }), sidechain: SUBAGENT_FILE.test(o.file) });
  } catch (error) {
    return failure(error instanceof ReadError ? error.code : String(error?.code ?? "error"), cost);
  } finally {
    closeSync(fd);
  }
}

function pageOpen(ctx) {
  const { o, stat, cost, fd } = ctx;
  ctx.size = safe(stat.size);
  const ckpt = loadCheckpoint(o.state.full, cost);
  // The page belongs to the history the checkpoint describes: this file, this epoch, a file that is still the same one.
  if (!ckpt || ckpt.file !== o.file || ckpt.sidechain !== ctx.sidechain || ckpt.epoch !== o.epoch || !cheapSame(ckpt.identity, stat)) throw new ReadError("changed");
  if (ckpt.end > ctx.size || o.before > ckpt.end || !guardsHold(ctx, ckpt)) throw new ReadError("changed");
  const done = (page) => ({ schemaVersion: 3, kind: "page", epoch: o.epoch, before: o.before, ...page, cost: costOf(cost) });
  if (o.before === 0) return done({ start: 0, fromStart: true, messages: [] });
  // `before` is where a line begins: the byte before it ends the line before.
  if (readRange(fd, o.before - 1, o.before, cost)[0] !== LF) throw new ReadError("changed");
  const found = scanBack(ctx);
  const reader = found.reader;
  settleAhead(ctx, reader);
  reader.unknownOpen();
  const messages = reader.emitted();
  const { kept, dropped } = chooseNewest(messages, o);
  const start = dropped ? kept[0].seq : found.base;
  return done({ start, fromStart: start === 0, messages: kept });
}

// Back from `before` in steps of PAGE_STEP, 2x, 4x ... (each byte read once, kept), until the whole lines read hold `count`
// messages, the file's start is reached, or the budget / time is out. Parsed forwards each time from the first whole line
// (the parse is repeated, the I/O is not). -> { reader, base (the first byte of the first whole line) }
function scanBack(ctx) {
  const { fd, o, cost, sidechain } = ctx;
  let window = Buffer.alloc(0); // [lo, before)
  let lo = o.before;
  let step = o.step;
  let prevByte = LF;
  let best = null;
  const began = Date.now();
  for (;;) {
    const room = o.budget - cost.bytes - LOOKAHEAD;
    if (lo > 0 && room > 0 && (best === null || Date.now() - began < o.softMs)) {
      const from = Math.max(0, lo - Math.min(step, room));
      const chunk = readRange(fd, from > 0 ? from - 1 : 0, lo, cost); // one byte more: is `from` the start of a line?
      prevByte = from > 0 ? chunk[0] : LF;
      window = Buffer.concat([from > 0 ? chunk.subarray(1) : chunk, window]);
      lo = from;
      step *= 2;
    } else break;
    const parsed = parseWindow(ctx, window, lo, prevByte);
    if (parsed) best = parsed;
    if (best && (best.base === 0 || best.reader.emitted().length >= o.count)) break;
  }
  if (!best) throw new ReadError("line-too-large");
  return best;
}

// The window [lo, before) from its first whole line, through a fresh reader. null when it holds no whole line.
function parseWindow(ctx, window, lo, prevByte) {
  let offset = 0;
  if (lo > 0 && prevByte !== LF) {
    const lf = window.indexOf(LF);
    if (lf < 0) return null;
    offset = lf + 1;
  }
  const base = lo + offset;
  if (base >= ctx.o.before) return null;
  const reader = createConversationReader(null, { sidechain: ctx.sidechain, initialCwd: base === 0 ? null : headCwd(ctx), fromStart: false, compact: true });
  feedComplete(reader, window.subarray(offset), base, ctx.cost);
  return { reader, base };
}

// Calls of the page without a result are looked for in the lines just after `before` (whole lines only, up to the
// checkpoint's committed end): those lines settle them and make nothing else.
function settleAhead(ctx, reader) {
  if (reader.unsettled() === 0) return;
  const { o, cost, fd } = ctx;
  const room = Math.min(LOOKAHEAD, o.budget - cost.bytes);
  const end = Math.min(ctx.size, o.before + Math.max(0, room));
  if (end <= o.before) return;
  const ahead = readRange(fd, o.before, end, cost);
  const lastLf = ahead.lastIndexOf(LF);
  if (lastLf < 0) return;
  feedComplete(reader, ahead.subarray(0, lastLf + 1), o.before, cost, true);
}

// The newest whole line groups that give `count` messages (the group that crosses the target is kept whole), then the
// ones that fit OUT_MAX. -> { kept, dropped (older messages were left out) }
function chooseNewest(messages, o) {
  const spare = bytesOf({ schemaVersion: 3, kind: "page", epoch: o.epoch, before: o.before, start: o.before, fromStart: false, messages: [], cost: { bytes: 0, parseMs: 0, lines: 0 } }) + 64;
  let have = 0;
  let from = messages.length;
  while (from > 0 && have < o.count) {
    const seq = messages[from - 1].seq;
    while (from > 0 && messages[from - 1].seq === seq) {
      from--;
      have++;
    }
  }
  const wanted = messages.slice(from);
  const fitted = newestGroups(wanted, Infinity, o.outMax - spare);
  return { kept: fitted.kept, dropped: from > 0 || fitted.dropped };
}

export function runPageCli(args) {
  const options = parseCli(args);
  const out = options ? readPage(options) : failure("invalid-args", { bytes: 0, parseMs: 0, lines: 0 });
  process.stdout.write(JSON.stringify(out));
}
