// One main-office CAS writer; SCREEN only reads from the launcher's source home.
import { appHome, readTextFile, writeTextFile } from "herdr";
import { sourceHome } from "./chat-io.js";

const POLL_MS = 4000;
const prefsPath = home => `${home.replace(/[\\/]+$/, "")}/data/polyflow-office/prefs.json`;
const homeKey = home => {
  const path = home.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[A-Za-z]:\//.test(path) ? path.toLowerCase() : path;
};

export function parsePrefs(text) {
  try {
    const p = JSON.parse(text);
    return p?.v === 1 && typeof p.calm === "boolean" && Number.isFinite(p.at) ? p : null;
  } catch { return null; }
}

export function startOfficePrefs(cx, { screen, getCalm, applyCalm, onError }) {
  let stopped = false;
  let busy = false;
  let asyncCx = null;
  let errorShown = false;
  let pendingCalm = Boolean(getCalm());
  let revision = 1; // Publish the already-persisted local setting on startup too.

  const report = error => {
    if (stopped || errorShown) return;
    errorShown = true;
    onError?.(`CALM sync: ${String(error?.message ?? error)}`);
    asyncCx.notify();
  };
  const recovered = () => {
    if (!errorShown) return;
    errorShown = false;
    onError?.(null); // Clear only the prefs diagnostic after a good read/write.
    asyncCx.notify();
  };

  const write = () => {
    if (stopped || busy || !asyncCx) return;
    busy = true;
    asyncCx.spawn(async () => {
      let attempted = revision;
      try {
        while (!stopped) {
          let written;
          // The host rejects a stale CAS snapshot. Re-read once; never spin on a failing file.
          for (let attempt = 0; attempt < 2; attempt++) {
            const previous = await readTextFile(prefsPath(appHome()));
            if (stopped) return;
            attempted = revision;
            const text = JSON.stringify({ v: 1, calm: pendingCalm, at: Date.now() });
            try {
              await writeTextFile(prefsPath(appHome()), text, previous);
              written = attempted;
              break;
            } catch (error) {
              if (stopped) return;
              if (attempt === 1) throw error;
            }
          }
          if (stopped) return;
          recovered();
          if (revision === written) return;
        }
      } catch (error) {
        report(error);
      } finally {
        busy = false;
        // A request received during a failed attempt still gets its own bounded attempt.
        if (!stopped && revision !== attempted) write();
      }
    });
  };

  const read = () => {
    if (stopped || busy || !asyncCx) return;
    busy = true;
    asyncCx.spawn(async () => {
      try {
        const home = await sourceHome();
        if (stopped) return;
        if (homeKey(home) === homeKey(appHome())) {
          throw new Error("Start SCREEN with the SCREEN button: source-home.txt is missing or points to this window.");
        }
        const text = await readTextFile(prefsPath(home));
        if (stopped) return;
        const prefs = parsePrefs(text);
        if (!prefs) throw new Error("prefs.json is missing or invalid; keeping the last CALM setting.");
        recovered();
        if (prefs.calm !== getCalm()) {
          applyCalm(prefs.calm); // Local shared only; never request a write from this reader.
          asyncCx.notify();
        }
      } catch (error) {
        report(error);
      } finally {
        busy = false;
      }
    });
  };

  const timer = screen ? cx.timer.every(POLL_MS, read) : null;
  // Only this retained AsyncContext may be used by later request()/timer callbacks.
  cx.spawn(context => {
    asyncCx = context;
    if (!stopped) (screen ? read : write)();
  });
  return {
    request(calm) {
      if (stopped || screen) return;
      pendingCalm = Boolean(calm);
      revision++;
      write();
    },
    stop() {
      stopped = true;
      timer?.cancel();
    },
  };
}
