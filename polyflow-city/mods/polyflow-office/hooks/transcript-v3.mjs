// The office chat's reader, v3: reads a session file (.jsonl) in parts and remembers where it stopped, so a chat that
// asks every second gets only what was appended (a delta), or "same" for nothing.
//   node transcript.mjs --v3 --file <f.jsonl> --state <checkpoint.json> [--since <end> --epoch <epoch>] [--verify]
// Answers (schemaVersion 3), all about COMMITTED lines only, i.e. lines that end with a line feed; the last line, while
// it has no line feed yet, is neither parsed nor shown, and `end` stays at the last line feed (the next read shows it):
//   same  { epoch, end, size, cost }
//   full  { epoch, end, size, cwd, messages, plan, session, coverage: { fromStart, start, end }, replaceFrom: null, cost, cache }
//   delta { epoch, end, size, cwd, messages (upserts by id), plan?, session? (only when changed), cost, cache }
//   { schemaVersion: 3, error, cost }   error: "changed" (the file changed under the read: ask again), "ENOENT",
//                                        "line-too-large", "invalid-args", ...
// `epoch` names one generation of the history the chat holds (a random id): it changes when the file is replaced or
// cut short, or when the reader lost its checkpoint, and then the chat starts over. The file is taken to be append-only:
// its identity (dev, ino, birth time, a hash of its first bytes) and the bytes just before `end` are checked, so a
// replaced or cut file is noticed; a change of bytes in the middle of the file that leaves those alone is not.
// Everything the reader can't prove from its checkpoint ends in a full read, never in a guess.
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { KEEP, createConversationReader } from "./adapters.mjs";
import { HEAD_MAX, identityOf, loadCheckpoint, newEpoch, pruneCache, sameIdentity, saveCheckpoint, sha1, validStatePath } from "./transcript-state.mjs";

export const COLD_BYTES = 12 * 1024 * 1024; // how much of the end of a file a full read parses
export const COLD_FACTOR = 4; // ... and a window this many times bigger when that gave no message at all
export const DELTA_MAX = 32 * 1024 * 1024; // more than this appended since `end`: a full read instead
export const OUT_MAX = 6 * 1024 * 1024; // an answer's size (UTF-8 bytes): Herdr's exec() returns 8 MiB at most
const HEAD_CWD_BYTES = 64 * 1024; // the start of a file, read only to learn the folder when the window doesn't say
export const LF = 0x0a;
const CR = 0x0d;
export const SUBAGENT_FILE = /[\\/]subagents[\\/]agent-[\w-]+\.jsonl$/i;
const EPOCH = /^[\w-]{8,64}$/;

export class ReadError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const bytesOf = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
const signature = (value) => sha1(Buffer.from(JSON.stringify(value ?? null)));
export const safe = (big) => {
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new ReadError("too-large");
  return Number(big);
};
export const costOf = (c) => ({ bytes: c.bytes, parseMs: Math.round(c.parseMs * 10) / 10, lines: c.lines });

// Exactly bytes [start, end) of the file, as one buffer: read() can return less than asked, so it is asked again.
// The file ending before `end` means it was cut since the snapshot: "changed". cost.bytes counts what was read.
export function readRange(fd, start, end, cost = null, read = readSync) {
  const length = end - start;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0) throw new ReadError("invalid-args");
  const buffer = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const n = read(fd, buffer, got, length - got, start + got);
    if (!(n > 0)) throw new ReadError("changed");
    got += n;
  }
  if (cost) cost.bytes += length;
  return buffer;
}

// Every complete line (up to its line feed; a carriage return before it is not part of the line) of `buffer`, which
// starts at byte `start` of the file, goes to reader.line(text, offset). The lines are cut at the BYTE, before decoding,
// so offsets stay exact with any UTF-8 text. settleOnly: the lines only settle calls the reader has (SHOW OLDER's look
// ahead past a page), they make no messages. -> { end (the byte after the last line feed), rest (what has none yet), lines }
export function feedComplete(reader, buffer, start, cost = null, settleOnly = false) {
  const began = performance.now();
  let p = 0;
  let lines = 0;
  for (;;) {
    const lf = buffer.indexOf(LF, p);
    if (lf < 0) break;
    const stop = lf > p && buffer[lf - 1] === CR ? lf - 1 : lf;
    const text = buffer.subarray(p, stop).toString("utf8");
    if (settleOnly) reader.settleOnly(text);
    else reader.line(text, start + p);
    lines++;
    p = lf + 1;
  }
  if (cost) {
    cost.parseMs += performance.now() - began;
    cost.lines += lines;
  }
  return { end: start + p, rest: buffer.subarray(p), lines };
}

// The folder the session started in, from the first bytes of the file (a cut last line is not used); null if none.
export function headCwd({ fd, size, cost }) {
  const length = Math.min(size, HEAD_CWD_BYTES);
  const lines = readRange(fd, 0, length, cost).toString("utf8").split("\n");
  if (size > length) lines.pop();
  for (const line of lines) {
    if (!line || line[0] !== "{") continue;
    try {
      const d = JSON.parse(line);
      const cwd = [d.cwd, d.payload?.cwd].find((c) => typeof c === "string" && c !== "");
      if (cwd) return cwd;
    } catch {}
  }
  return null;
}

export const failure = (error, cost) => ({ schemaVersion: 3, error, cost: costOf(cost) });

// The options a run is given -> checked ones, or null. since and epoch come together or not at all.
function normalize(raw) {
  const state = validStatePath(raw.state);
  const count = (v) => (v === null || v === undefined ? null : Number.isSafeInteger(v) && v >= 0 ? v : NaN);
  const since = count(raw.since);
  const epoch = raw.epoch ?? null;
  const file = typeof raw.file === "string" && /\.jsonl$/i.test(raw.file) && !raw.file.includes("\0") ? raw.file : null;
  if (!file || !state || Number.isNaN(since)) return null;
  if ((since === null) !== (epoch === null) || (epoch !== null && !EPOCH.test(epoch))) return null;
  const limit = (v, dflt) => (Number.isSafeInteger(v) && v > 0 ? v : dflt);
  return {
    file, state, since, epoch, verify: raw.verify === true, page: raw.page === true, before: count(raw.before), count: count(raw.count),
    coldBytes: limit(raw.coldBytes, COLD_BYTES), deltaMax: limit(raw.deltaMax, DELTA_MAX), outMax: limit(raw.outMax, OUT_MAX),
  };
}

// One run: options (see normalize; file, state, since, epoch, verify) -> the answer object. Never throws.
export function readV3(raw = {}) {
  const cost = { bytes: 0, parseMs: 0, lines: 0 };
  const o = normalize(raw ?? {});
  if (!o) return failure("invalid-args", cost);
  if (o.page) return failure("invalid-args", cost); // a page is transcript-page.mjs's
  let fd;
  try {
    fd = openSync(o.file, "r");
  } catch (error) {
    return failure(String(error?.code ?? "error"), cost);
  }
  try {
    return readOpen({ fd, o, cost, stat: fstatSync(fd, { bigint: true }), sidechain: SUBAGENT_FILE.test(o.file) });
  } catch (error) {
    return failure(error instanceof ReadError ? error.code : String(error?.code ?? "error"), cost);
  } finally {
    closeSync(fd);
  }
}

// Same file as the checkpoint says, as far as its stat tells (no hashing): the cheap test before anything else.
export const cheapSame = (id, stat) => id.dev === String(stat.dev) && id.ino === String(stat.ino) && id.birthtimeNs === String(stat.birthtimeNs) && BigInt(id.headLen) <= stat.size;

// The proofs that cost a little I/O: the first bytes still hash as saved, and the bytes just before `end` too.
export function guardsHold(ctx, ckpt) {
  const head = sha1(readRange(ctx.fd, 0, ckpt.identity.headLen, ctx.cost));
  if (!sameIdentity(ckpt.identity, ctx.stat, head)) return false;
  const g = ckpt.tailGuard;
  return sha1(readRange(ctx.fd, g.start, g.start + g.length, ctx.cost)) === g.hash;
}

function readOpen(ctx) {
  const { o, stat } = ctx;
  ctx.size = safe(stat.size);
  const ckpt = o.since === null ? null : loadCheckpoint(o.state.full, ctx.cost);
  if (!ckpt || ckpt.file !== o.file || ckpt.sidechain !== ctx.sidechain || !cheapSame(ckpt.identity, stat)) return fullRead(ctx, null);
  if (ctx.size < ckpt.end) return fullRead(ctx, null); // cut short
  const inStep = ckpt.epoch === o.epoch && ckpt.end === o.since;
  // Only a plain "nothing new" skips the proofs (the control read asks for them with --verify).
  if ((o.verify || !inStep || ctx.size > ckpt.end) && !guardsHold(ctx, ckpt)) return fullRead(ctx, null);
  if (!inStep) return fullRead(ctx, ckpt); // the chat's idea of the file is not the checkpoint's: start its window again
  if (ctx.size === ckpt.end) return finish(ctx, { schemaVersion: 3, kind: "same", epoch: ckpt.epoch, end: ckpt.end, size: ctx.size }, null);
  if (ctx.size - ckpt.end > o.deltaMax) return fullRead(ctx, ckpt);
  return deltaRead(ctx, ckpt) ?? fullRead(ctx, ckpt);
}

// A window of `want` bytes at the end of the file, parsed from its first whole line: { reader, base, end, messages }, or
// null when the window has no line start at all (one line is bigger than it).
function scanWindow(ctx, want) {
  const { fd, size, cost, sidechain } = ctx;
  const start = Math.max(0, size - want);
  const from = start > 0 ? start - 1 : 0; // the byte before the window says whether it begins on a line
  const buffer = readRange(fd, from, size, cost);
  let offset = start - from;
  let base = start;
  if (start > 0 && buffer[0] !== LF) {
    const lf = buffer.indexOf(LF, 1);
    if (lf < 0) return null;
    offset = lf + 1;
    base = from + offset;
  }
  const reader = createConversationReader(null, { sidechain, initialCwd: base === 0 ? null : headCwd(ctx), fromStart: base === 0, compact: true });
  const { end } = feedComplete(reader, buffer.subarray(offset), base, cost);
  return { reader, base, end, messages: reader.emitted() };
}

function coldScan(ctx) {
  const { o, size } = ctx;
  let scan = scanWindow(ctx, o.coldBytes);
  // A huge last line (an image, a big tool result) can fill the whole window: look further back once.
  if ((!scan || scan.messages.length === 0) && size > o.coldBytes) scan = scanWindow(ctx, o.coldBytes * COLD_FACTOR) ?? scan;
  if (!scan) throw new ReadError("line-too-large");
  return scan;
}

// The newest whole line groups (all the messages of one line stay together) that fit `keep` messages and `budget`
// bytes. -> { kept, dropped }. The newest group alone not fitting the budget is "line-too-large": the reader can't
// show it, and must not move the chat past it.
export function newestGroups(messages, keep, budget) {
  const groups = [];
  for (const m of messages) {
    const last = groups.at(-1);
    if (last && last[0].seq === m.seq) last.push(m);
    else groups.push([m]);
  }
  let from = groups.length;
  let count = 0;
  let size = 0;
  for (let g = groups.length - 1; g >= 0; g--) {
    const groupSize = groups[g].reduce((n, m) => n + bytesOf(m) + 1, 0);
    if (from === groups.length && groupSize > budget) throw new ReadError("line-too-large");
    if (from < groups.length && (count + groups[g].length > keep || size + groupSize > budget)) break;
    count += groups[g].length;
    size += groupSize;
    from = g;
  }
  return { kept: groups.slice(from).flat(), dropped: from > 0 };
}

// The identity to save: the file's now (its first HEAD_MAX bytes, or all of a smaller file).
function freshIdentity(ctx) {
  const headLen = Math.min(ctx.size, HEAD_MAX);
  return identityOf(ctx.stat, headLen, sha1(readRange(ctx.fd, 0, headLen, ctx.cost)));
}
// A small file that has grown is hashed over a longer start from now on (the epoch stays: it is the same file).
const grownIdentity = (ctx, saved) => (saved.headLen < HEAD_MAX && ctx.size > saved.headLen ? freshIdentity(ctx) : saved);

function checkpointFor(ctx, { epoch, identity, base, fromStart, end, reader }, planSig, sessionSig) {
  const start = Math.max(0, end - HEAD_MAX);
  const tailGuard = { start, length: end - start, hash: sha1(readRange(ctx.fd, start, end, ctx.cost)) };
  return { v: 1, file: ctx.o.file, sidechain: ctx.sidechain, identity, epoch, base, fromStart, end, tailGuard, reader: { ...reader.state(), planSig, sessionSig }, at: Date.now() };
}

// A full read: the end of the file parsed from scratch. The epoch of `ckpt` stays when the window reaches back to where
// the chat's history ended (nothing is lost between them); otherwise a new epoch tells the chat to start over.
function fullRead(ctx, ckpt) {
  const scan = coldScan(ctx);
  const keep = Boolean(ckpt) && scan.base <= ckpt.end;
  const epoch = keep ? ckpt.epoch : newEpoch();
  const identity = keep ? grownIdentity(ctx, ckpt.identity) : freshIdentity(ctx);
  const { reader, base, end } = scan;
  const plan = reader.plan();
  const session = reader.session();
  const head = { schemaVersion: 3, kind: "full", epoch, end, size: ctx.size, cwd: reader.cwd(), plan, session, replaceFrom: null };
  const spare = bytesOf({ ...head, messages: [], coverage: { fromStart: false, start: ctx.size, end }, cost: { bytes: 0, parseMs: 0, lines: 0 }, cache: "unavailable" }) + 64;
  const { kept, dropped } = newestGroups(scan.messages, KEEP, ctx.o.outMax - spare);
  const fromStart = base === 0 && !dropped;
  const response = { ...head, messages: kept, coverage: { fromStart, start: dropped ? kept[0].seq : base, end } };
  const checkpoint = checkpointFor(ctx, { epoch, identity, base, fromStart: base === 0, end, reader }, signature(plan), signature(session));
  const answered = finish(ctx, response, checkpoint);
  try {
    pruneCache(ctx.o.state.dir, Date.now(), ctx.o.state.name);
  } catch {}
  return answered;
}

// What was appended since the checkpoint's `end`, as upserts; null when it doesn't fit an answer (a full read then).
function deltaRead(ctx, ckpt) {
  const { o, size } = ctx;
  const buffer = readRange(ctx.fd, ckpt.end, size, ctx.cost);
  const reader = createConversationReader(ckpt.reader, { sidechain: ctx.sidechain, compact: true });
  const { end } = feedComplete(reader, buffer, ckpt.end, ctx.cost);
  const plan = reader.plan();
  const session = reader.session();
  const planSig = signature(plan);
  const sessionSig = signature(session);
  const response = {
    schemaVersion: 3, kind: "delta", epoch: ckpt.epoch, end, size, cwd: reader.cwd(), messages: reader.emitted(),
    ...(planSig !== ckpt.reader.planSig ? { plan } : {}), ...(sessionSig !== ckpt.reader.sessionSig ? { session } : {}),
  };
  if (bytesOf(response) + 128 > o.outMax) return null;
  const identity = grownIdentity(ctx, ckpt.identity);
  // Nothing new that is complete (a line still being written): the checkpoint stays as it is.
  const checkpoint = end === ckpt.end && identity === ckpt.identity ? null
    : checkpointFor(ctx, { epoch: ckpt.epoch, identity, base: ckpt.base, fromStart: ckpt.fromStart, end, reader }, planSig, sessionSig);
  return finish(ctx, response, checkpoint);
}

// The file must be what it was when the snapshot was taken (only appended to): else "changed". Then the checkpoint is
// written (atomically; when it can't be, the answer still goes and says cache: "unavailable", so the next read is full).
function finish(ctx, response, checkpoint) {
  const now = statSync(ctx.o.file, { bigint: true });
  if (now.dev !== ctx.stat.dev || now.ino !== ctx.stat.ino || fstatSync(ctx.fd, { bigint: true }).size < ctx.stat.size) throw new ReadError("changed");
  const cache = checkpoint ? (saveCheckpoint(ctx.o.state.full, checkpoint) ? "ok" : "unavailable") : "ok";
  return { ...response, cost: costOf(ctx.cost), ...(response.kind === "same" ? {} : { cache }) };
}

// The command line after --v3 -> options, or null for anything that is not understood.
export function parseCli(args) {
  const o = { file: null, state: null, since: null, epoch: null, verify: false, page: false, before: null, count: null };
  const numbers = new Set(["since", "before", "count"]);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--verify") o.verify = true;
    else if (flag === "--page") o.page = true;
    else if (["--file", "--state", "--since", "--epoch", "--before", "--count"].includes(flag)) {
      const value = args[++i];
      const key = flag.slice(2);
      if (value === undefined || (numbers.has(key) && !/^\d{1,15}$/.test(value))) return null;
      o[key] = numbers.has(key) ? Number(value) : value;
    } else return null;
  }
  return o;
}

export function runCli(args) {
  const options = parseCli(args);
  const out = options ? readV3(options) : failure("invalid-args", { bytes: 0, parseMs: 0, lines: 0 });
  process.stdout.write(JSON.stringify(out));
}
