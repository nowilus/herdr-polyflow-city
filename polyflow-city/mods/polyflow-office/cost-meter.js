// Herdr side of the cost meter (cost-model.js has the counting): counted exec / readTextFile, and the flush of one
// owner's figures into data/polyflow-office/metrics.json (in this process's own app home: a SCREEN window has its own
// home and sees only its own figures). polyflow-agents keeps a byte-identical copy.
import { appHome, exec, readTextFile, writeTextFile } from "herdr";
import { FLUSH_MS, NO_METER, flushKey, flushMetrics, metered, shouldFlush } from "./cost-model.js";

const METRICS_FILE = `${appHome()}/data/polyflow-office/metrics.json`;
const HEX = "0123456789abcdef";

// A random hex token (the mod's engine has no Node crypto): for a writer id.
export function randomToken(length = 16) {
  let out = "";
  for (let i = 0; i < length; i++) out += HEX[Math.floor(Math.random() * 16)];
  return out;
}

// exec, counted under `kind` (a process: counted before it starts, also when it fails to start).
export function meteredExec(cost, kind, command, args, options) {
  return metered(cost ?? NO_METER, kind, () => exec(command, args, options));
}

// readTextFile, counted under `kind` (no process, one read).
export function meteredRead(cost, kind, path) {
  (cost ?? NO_METER).meter(kind, { procs: 0, reads: 1 });
  return readTextFile(path);
}

const metricsIo = { read: () => readTextFile(METRICS_FILE).catch(() => null), write: (text, expected) => writeTextFile(METRICS_FILE, text, expected) };
const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// Flush one owner's meter every FLUSH_MS (one write per cycle at most; unchanged figures are only written now and then
// to keep the entry alive). role: "office" | "tree" | "chat". With { notify: true } the owner's view redraws after a
// cycle, so its SESSION line is current. Returns { stop(), all() }: all() is the last copy of the whole file seen.
// stop() ends the timer; the writer's entry just expires (nothing is written on close: that would add a write).
export function startMeterFlush(cx, role, localMeter, { notify = false } = {}) {
  const writerId = `${role}-${randomToken(12)}`;
  const last = { key: null, at: 0 };
  let busy = false;
  let stopped = false;
  let file = null;
  // The context of each tick is the one to use: the one startMeterFlush got is a plain Context and was good for one host call.
  const cycle = (tick) => {
    if (busy || stopped) return;
    busy = true;
    tick.spawn(async (cx) => {
      try {
        const now = Date.now();
        const snapshot = localMeter.meterSnapshot(now);
        const key = flushKey(snapshot);
        if (shouldFlush(last, key, now)) {
          const written = await flushMetrics(metricsIo, writerId, { role, ...snapshot });
          if (written) {
            file = written;
            last.key = key;
            last.at = Date.now();
          }
        } else file = parseJson(await metricsIo.read());
        if (notify && !stopped) cx.notify();
      } catch {
        // A metrics file that can't be written must never disturb the owner.
      } finally {
        busy = false;
      }
    });
  };
  const task = cx.timer.every(FLUSH_MS, (tick) => cycle(tick));
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      task.cancel();
    },
    all: () => file,
  };
}
