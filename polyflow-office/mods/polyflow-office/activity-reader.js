// Reads the activity hook's records (data/polyflow-office/activity/<terminal>.json) into view.activity
// and keeps them current. polyflow-agents keeps a byte-identical copy.
import { agents, appHome, readTextFile, watchFolder } from "herdr";
import { meteredExec, meteredRead } from "./cost-meter.js";
import { watchPaths } from "./folder-watch.js";
import { subagentsDecision, subagentsWatchFolder, touchesSubagents } from "./subagents-watch.js";

// Each follower counts its reads and runs on view.cost (cost-model.js createMeter), when its owner made one.
const OWN_DIR = `${appHome()}/data/polyflow-office`;
// The office's own window (SCREEN) runs with a home of its own; its launcher leaves the main home's path here,
// because the agents' hooks keep writing there.
const SOURCE_FILE = `${OWN_DIR}/source-home.txt`;
const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const REFRESH_MS = 10000;

function parse(text) {
  try {
    const r = JSON.parse(text);
    return r !== null && typeof r === "object" && typeof r.at === "number" ? r : null;
  } catch {
    return null;
  }
}

// The Herdr home the agents' hooks write to (the main one, also from the office's own SCREEN window).
async function sourceRoot(cost, kind) {
  const src = (await meteredRead(cost, kind, SOURCE_FILE).catch(() => null))?.trim();
  return src ? src.replace(/[\\/]+$/, "") : appHome();
}

const SUBAGENTS_TICK_MS = 1000; // a decision only: no process unless subagents-watch.js says a read is due
const SUBAGENTS_MAP_MS = 3000; // which session each agent is in (one small file each)
const CLAUDE_SESSION = /[\\/]\.claude[\\/].+\.jsonl$/i;
const parseAny = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// Follow the internal subagents of every local Claude Code agent (hooks/subagents.mjs): view.subagents =
// { [agent address]: [{ id, description, type, status, record }] }, replaced when it changes. Rounds run only while
// visible() says the view is on screen, one at a time. Which session each agent is in is read every SUBAGENTS_MAP_MS
// (small files); its helper process runs only when subagents-watch.js says so: a write under the session's subagents
// folder (the watcher) or a control read. An agent whose helper failed to answer keeps its last list (a failure is not
// "no subagents"). opts.stillMine(): asked after the round's awaits, before anything is taken in: false (the lease went
// to another reader) drops the round. opts.now: the clock (tests). -> { stop() }: ends the timer and the watchers; a
// round that is still running changes nothing after it.
export function followSubagents(view, cx, visible = () => true, onChange = () => {}, { stillMine = () => true, now = Date.now } = {}) {
  view.subagents = view.subagents ?? {};
  const watched = new Map(); // address -> { transcript, watch, dirtyAt, lastStart, lastControl }
  let busy = false;
  let stopped = false;
  let mappedAt = -Infinity;
  let root = null;
  let watchCx = null; // the watchers keep a context: an AsyncContext of their own, never a host call's
  cx.spawn((acx) => {
    watchCx = acx;
  });

  // Which session each local Claude agent is in. A new agent, or another session (/clear), is watched and read at once;
  // an agent that is gone (or no longer in a Claude session) is let go.
  const remap = async (cost) => {
    root = await sourceRoot(cost, "subagents");
    const seen = new Set();
    for (const a of agents()) {
      if (!LOCAL_ID.test(a.address)) continue;
      const session = parseAny(await meteredRead(cost, "subagents", `${root}/data/polyflow-office/sessions/${a.address}.json`).catch(() => null));
      const transcript = session?.transcript;
      if (typeof transcript !== "string" || !CLAUDE_SESSION.test(transcript)) continue;
      seen.add(a.address);
      if (stopped || watched.get(a.address)?.transcript === transcript) continue;
      watched.get(a.address)?.watch.stop();
      const entry = { transcript, watch: null, dirtyAt: null, lastStart: null, lastControl: null };
      entry.watch = watchCx
        ? watchPaths(watchCx, subagentsWatchFolder(transcript), (p) => touchesSubagents(transcript, p), () => {
          entry.dirtyAt = entry.dirtyAt ?? now();
        })
        : { stop() {}, ensure() {} };
      watched.set(a.address, entry);
    }
    for (const [address, entry] of watched) {
      if (seen.has(address)) continue;
      entry.watch.stop();
      watched.delete(address);
    }
  };

  // Each tick's own context starts the round: the one this function got is not kept.
  const poll = (tick) => {
    if (stopped || busy || !visible()) return;
    busy = true;
    tick.spawn(async (cx) => {
      try {
        const cost = view.cost;
        if (now() - mappedAt >= SUBAGENTS_MAP_MS) {
          mappedAt = now();
          await remap(cost);
        }
        const next = {};
        for (const [address, e] of watched) {
          const had = view.subagents[address];
          const d = subagentsDecision({ dirtyAt: e.dirtyAt, lastStart: e.lastStart, lastControl: e.lastControl, now: now(), hasList: Boolean(had) });
          if (!d.run || stopped) {
            if (had) next[address] = had;
            continue;
          }
          e.lastStart = now();
          e.lastControl = e.lastStart; // every read is a whole one: the control deadline counts from it
          e.dirtyAt = null; // a write during the read wakes the next one
          e.watch.ensure(); // a watcher that ended by itself (no folder yet) starts again with the control read
          const r = await meteredExec(cost, "subagents", "node", [`${root}/mods/polyflow-office/hooks/subagents.mjs`, e.transcript]).catch(() => null);
          const list = r?.code === 0 ? parseAny(r.stdout)?.subagents : null;
          if (Array.isArray(list)) {
            if (list.length) next[address] = list;
          } else if (had) next[address] = had; // no answer: its last list stays
        }
        if (stopped || !stillMine()) return;
        if (JSON.stringify(next) !== JSON.stringify(view.subagents)) {
          view.subagents = next;
          onChange(next);
          cx.notify();
        }
      } finally {
        busy = false;
      }
    });
  };
  poll(cx);
  const task = cx.timer.every(SUBAGENTS_TICK_MS, (tick) => poll(tick));
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      task.cancel();
      for (const entry of watched.values()) entry.watch.stop();
      watched.clear();
    },
  };
}

async function activityDir() {
  const src = (await readTextFile(SOURCE_FILE).catch(() => null))?.trim();
  return src ? `${src.replace(/[\\/]+$/, "")}/data/polyflow-office/activity` : `${OWN_DIR}/activity`;
}

// One read of every local agent's record (remote agents' hooks write on their own machine).
async function readAll(dir, cost) {
  const out = {};
  for (const a of agents()) {
    if (!LOCAL_ID.test(a.address)) continue;
    const text = await meteredRead(cost, "activity", `${dir}/${a.address}.json`).catch(() => null);
    out[a.address] = text === null ? null : parse(text);
  }
  return out;
}

// One agent's record, read now: for a view that shows a single agent (the agent card) and needs no follower.
let cardDir = null; // where the records are: looked up once (source-home.txt is written before the window starts)
export async function readActivity(address) {
  if (typeof address !== "string" || !LOCAL_ID.test(address)) return null;
  cardDir = cardDir ?? (await activityDir());
  const text = await readTextFile(`${cardDir}/${address}.json`).catch(() => null);
  return text === null ? null : parse(text);
}

// Start following: view.activity is replaced (never mutated) when it changes, then the view redraws.
// One read at a time; changes that arrive meanwhile ask for one more read after it, so an older read can
// never land after a newer one.
export function followActivity(view, cx) {
  view.activity = view.activity ?? {};
  let dir = null;
  let reading = false;
  let again = false;
  let watching = false;
  const reload = () => {
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    cx.spawn(async (cx) => {
      do {
        again = false;
        dir = dir ?? (await activityDir());
        const next = await readAll(dir, view.cost);
        if (JSON.stringify(next) !== JSON.stringify(view.activity)) {
          view.activity = next;
          cx.notify();
        }
      } while (again);
      reading = false;
    });
  };
  // The folder may not exist until the first hook runs; the timer retries the watch.
  const watch = () => {
    if (watching) return;
    watching = true;
    cx.spawn(async () => {
      dir = dir ?? (await activityDir());
      let quick = 0;
      for (;;) {
        const started = Date.now();
        let changed;
        try {
          changed = await watchFolder(dir);
        } catch {
          break;
        }
        quick = Date.now() - started < 500 && (changed ?? []).length === 0 ? quick + 1 : 0;
        if (quick >= 3) break;
        reload();
      }
      watching = false;
    });
  };
  reload();
  watch();
  // Records go stale by time alone, so look again now and then even when nothing is written.
  cx.timer.every(REFRESH_MS, () => {
    reload();
    watch();
    cx.notify();
  });
}
