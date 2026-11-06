// Reads the activity hook's records (data/polyflow-office/activity/<terminal>.json) into view.activity
// and keeps them current. polyflow-agents keeps a byte-identical copy.
import { agents, appHome, readTextFile, watchFolder } from "herdr";

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

async function activityDir() {
  const src = (await readTextFile(SOURCE_FILE).catch(() => null))?.trim();
  return src ? `${src.replace(/[\\/]+$/, "")}/data/polyflow-office/activity` : `${OWN_DIR}/activity`;
}

// One read of every local agent's record (remote agents' hooks write on their own machine).
async function readAll(dir) {
  const out = {};
  for (const a of agents()) {
    if (!LOCAL_ID.test(a.address)) continue;
    const text = await readTextFile(`${dir}/${a.address}.json`).catch(() => null);
    out[a.address] = text === null ? null : parse(text);
  }
  return out;
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
        const next = await readAll(dir);
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
