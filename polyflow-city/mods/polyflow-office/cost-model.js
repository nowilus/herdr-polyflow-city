// What the office's readers cost, counted: processes started, files read, bytes, time. Pure (no herdr imports), so it
// runs in node tests; cost-meter.js binds it to Herdr (files, timers). Counting is per owner: every chat window, the
// office tower and the agent tree make a meter of their own with createMeter() and flush it under a writer id of their
// own, so nothing is added up twice. Nothing here goes into Herdr's shared state (a change there redraws every mod).

export const WINDOW_SEC = 60; // the sliding window of "per minute" figures, in one-second buckets
export const WRITER_TTL_MS = 5 * 60 * 1000; // a writer that stopped flushing leaves the file after this
export const FILE_MAX_BYTES = 4096; // metrics.json never grows past this (UTF-8 bytes)
export const FLUSH_MS = 30000; // one flush attempt cycle
export const HEARTBEAT_MS = 2 * 60 * 1000; // an unchanged writer still flushes this often, so its entry doesn't expire

// What one call can add up. Everything but `procs` defaults to 0; `procs` defaults to 1 (a call is a process).
const FIELDS = ["procs", "bytes", "parseMs", "reads", "responseBytes", "wallMs", "full", "delta", "same"];
const ROWS_KIND = "rows"; // meterRows() counts here: rows measured by the list's measuring layer

const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
const zeros = () => Object.fromEntries(FIELDS.map((f) => [f, 0]));

// UTF-8 length of a string without Buffer or TextEncoder (the mod's engine has neither promised). A surrogate pair is
// one 4-byte character; a lone surrogate counts 3 (what encoding writes for U+FFFD).
export function utf8Length(text) {
  const s = String(text ?? "");
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

// A meter that counts nothing: the default for callers that were given none.
export const NO_METER = { meter() {}, meterRows() {}, meterSnapshot: () => ({ perMin: {}, rows: 0 }) };

// A fresh meter. now() is the clock (injected in tests). Per kind there are WINDOW_SEC one-second buckets, never a list
// of events, so a busy reader costs the same memory as an idle one.
//   meter(kind, { procs = 1, bytes, parseMs, reads, responseBytes, wallMs, full, delta, same })
//   meterRows(n)            rows measured
//   meterSnapshot(nowMs)    { perMin: { [kind]: { ...FIELDS } }, rows }: what happened in the last WINDOW_SEC seconds
export function createMeter(now = () => Date.now()) {
  const rings = new Map(); // kind -> (bucket | null)[WINDOW_SEC]; bucket = { sec, ...FIELDS }
  const bucketOf = (kind, sec) => {
    const ring = rings.get(kind) ?? rings.set(kind, new Array(WINDOW_SEC).fill(null)).get(kind);
    const at = sec % WINDOW_SEC;
    if (ring[at]?.sec !== sec) ring[at] = { sec, ...zeros() };
    return ring[at];
  };
  const meter = (kind, amounts = {}) => {
    const b = bucketOf(String(kind), Math.floor(now() / 1000));
    for (const f of FIELDS) b[f] += f === "procs" ? (amounts.procs === undefined ? 1 : num(amounts.procs)) : num(amounts[f]);
  };
  const meterRows = (n) => meter(ROWS_KIND, { procs: 0, reads: n });
  // An event of second `s` is in the window of second `t` when t - s is 0..WINDOW_SEC-1: it expires at exactly 60 s.
  const meterSnapshot = (nowMs = now()) => {
    const sec = Math.floor(nowMs / 1000);
    const perMin = {};
    let rows = 0;
    for (const [kind, ring] of rings) {
      const total = zeros();
      for (const b of ring) {
        if (!b || sec - b.sec < 0 || sec - b.sec >= WINDOW_SEC) continue;
        for (const f of FIELDS) total[f] += b[f];
      }
      if (kind === ROWS_KIND) rows = total.reads;
      else perMin[kind] = total;
    }
    return { perMin, rows };
  };
  return { meter, meterRows, meterSnapshot };
}

// Count one call that starts a process (or any async job): the start counts at once (also when it then fails), the
// time and the size of its answer when it ends. run() resolves to something with a stdout, or rejects. Counts once.
export async function metered(cost, kind, run, now = () => Date.now()) {
  cost.meter(kind, { procs: 1 });
  const started = now();
  try {
    const r = await run();
    cost.meter(kind, { procs: 0, wallMs: now() - started, responseBytes: utf8Length(r?.stdout) });
    return r;
  } catch (error) {
    cost.meter(kind, { procs: 0, wallMs: now() - started });
    throw error;
  }
}

// ---- metrics.json: one small shared file, one entry per writer ----
// { v: 1, partial, partialAt?, writers: { [writerId]: { role, at, perMin: { [kind]: { [field]: n (only the non-zero) } }, rows } } }

// A snapshot's figures without the zeros, so the file stays small.
function compact(perMin) {
  const out = {};
  for (const [kind, fields] of Object.entries(perMin && typeof perMin === "object" ? perMin : {})) {
    const kept = {};
    for (const f of FIELDS) if (num(fields?.[f]) > 0) kept[f] = Math.round(num(fields[f]));
    if (Object.keys(kept).length) out[String(kind).slice(0, 16)] = kept;
  }
  return out;
}

// The entries of an old file that may stay: well-formed and not older than WRITER_TTL_MS (nor from far in the future).
function liveWriters(raw, nowMs) {
  const out = {};
  const writers = raw && typeof raw === "object" && raw.writers && typeof raw.writers === "object" ? raw.writers : {};
  for (const [id, w] of Object.entries(writers)) {
    if (!w || typeof w !== "object" || typeof w.role !== "string" || !Number.isFinite(w.at)) continue;
    if (nowMs - w.at > WRITER_TTL_MS || w.at - nowMs > WRITER_TTL_MS) continue;
    out[id] = { role: w.role.slice(0, 12), at: w.at, perMin: compact(w.perMin), rows: Math.round(num(w.rows)) };
  }
  return out;
}

// The file after `writerId` put its entry in. entry: { role, perMin, rows } (a snapshot). Entries older than 5 min go;
// when the file would be over FILE_MAX_BYTES the oldest other entries go next, and the file says `partial` (the
// totals it gives are then not complete; the mark stays for 5 min, so a writer that was dropped is not forgotten).
export function mergeMetrics(raw, writerId, entry, nowMs) {
  const id = String(writerId).replace(/[^\w-]/g, "").slice(0, 40) || "writer";
  const writers = { ...liveWriters(raw, nowMs), [id]: { role: String(entry?.role ?? "chat").slice(0, 12), at: nowMs, perMin: compact(entry?.perMin), rows: Math.round(num(entry?.rows)) } };
  const stuck = raw?.partial === true && Number.isFinite(raw.partialAt) && nowMs - raw.partialAt < WRITER_TTL_MS;
  let partialAt = stuck ? raw.partialAt : null;
  const file = () => ({ v: 1, partial: partialAt !== null, ...(partialAt !== null ? { partialAt } : {}), writers });
  const others = Object.keys(writers).filter((w) => w !== id).sort((a, b) => writers[a].at - writers[b].at);
  while (utf8Length(JSON.stringify(file())) > FILE_MAX_BYTES && others.length) {
    delete writers[others.shift()];
    partialAt = nowMs;
  }
  if (utf8Length(JSON.stringify(file())) > FILE_MAX_BYTES) {
    writers[id] = { ...writers[id], perMin: {} };
    partialAt = nowMs;
  }
  return file();
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// One flush of `entry` into the file through io = { read(): text | null, write(text, expected): Promise }, where write
// rejects when the file changed since `expected` (Herdr's compare-and-set). At most two attempts, and it stops at the
// first success: a retry never makes more than one successful write per cycle. Resolves to the file written, or null.
export async function flushMetrics(io, writerId, entry, now = () => Date.now()) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const expected = await io.read();
    const next = mergeMetrics(parse(expected), writerId, entry, now());
    try {
      await io.write(JSON.stringify(next), expected);
      return next;
    } catch {
      // Stale snapshot: another writer got in first. Read again and merge our entry into theirs.
    }
  }
  return null;
}

// What changed in a snapshot, as text: unchanged figures need no flush (until the heartbeat).
export const flushKey = (snapshot) => JSON.stringify([compact(snapshot.perMin), Math.round(num(snapshot.rows))]);
export const shouldFlush = (last, key, nowMs) => last.key !== key || nowMs - last.at >= HEARTBEAT_MS;

// ---- text for the SESSION section ----

const READER_KINDS = ["transcript", "page"];
const sumOf = (perMin, kinds, field) => kinds.reduce((n, k) => n + (perMin?.[k]?.[field] ?? 0), 0);

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${n < 10 * 1024 ? (n / 1024).toFixed(1) : Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// This window's own reader: "reader: 4 reads/min · 18 KB/min". Bytes read are not known for the older reader: "—".
export function readerLine(snapshot) {
  const perMin = snapshot?.perMin ?? {};
  const bytes = sumOf(perMin, READER_KINDS, "bytes");
  return `reader: ${sumOf(perMin, READER_KINDS, "procs")} reads/min · ${bytes > 0 ? `${formatBytes(bytes)}/min` : "—"}`;
}

const ALL_LABELS = [["chat", ["transcript", "page"]], ["act", ["activity"]], ["sub", ["subagents"]], ["meta", ["meta"]], ["git", ["git"]]];

// Every window and follower together, from metrics.json: "all: 22 proc/min (chat 4 · act 0 · sub 0 · meta 12 · git 6)",
// with " · partial" when the file had to leave writers out. null when no writer is in it.
export function allLine(raw, nowMs) {
  const writers = Object.values(liveWriters(raw, nowMs));
  if (writers.length === 0) return null;
  const parts = ALL_LABELS.map(([label, kinds]) => [label, writers.reduce((n, w) => n + sumOf(w.perMin, kinds, "procs"), 0)]);
  const total = parts.reduce((n, [, v]) => n + v, 0);
  const partial = raw?.partial === true && Number.isFinite(raw.partialAt) && nowMs - raw.partialAt < WRITER_TTL_MS;
  return `all: ${total} proc/min (${parts.map(([l, v]) => `${l} ${v}`).join(" · ")})${partial ? " · partial" : ""}`;
}
