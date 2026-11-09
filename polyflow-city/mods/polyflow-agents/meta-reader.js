// Reads the agents' energy data (model, effort, context) and the account limits into view.meta and keeps them
// current: one process per round (hooks/agent-meta.mjs) for every live local terminal, asked every few seconds while
// the view is on screen. polyflow-agents keeps a byte-identical copy.
import { agents, appHome, terminals } from "herdr";
import { meteredExec, meteredRead } from "./cost-meter.js";
import { liveLocalTerminals, metaFrom } from "./energy.js";

const SOURCE_FILE = `${appHome()}/data/polyflow-office/source-home.txt`;
export const META_MS = 5000;

// The Herdr home the agents' hooks write to (the main one, also from the office's own SCREEN window).
async function sourceRoot(cost) {
  const src = (await meteredRead(cost, "meta", SOURCE_FILE).catch(() => null))?.trim();
  return src ? src.replace(/[\\/]+$/, "") : appHome();
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// Start following. view.meta = { agents, limits, at } is replaced (never mutated) when the content changes (`at` is
// when it was read, and does not count as a change); onChange(next) lets the owner share it. visible(): asked
// before each round. One round at a time. No live local terminal: nothing is asked and what is known stays.
export function followMeta(view, cx, visible = () => true, onChange = () => {}) {
  view.meta = view.meta ?? null;
  let busy = false;
  const poll = () => {
    if (busy || !visible()) return;
    const ids = liveLocalTerminals(agents(), terminals());
    if (ids.length === 0) return;
    busy = true;
    cx.spawn(async (cx) => {
      try {
        const root = await sourceRoot(view.cost);
        const r = await meteredExec(view.cost, "meta", "node", [`${root}/mods/polyflow-office/hooks/agent-meta.mjs`, root, ...ids]).catch(() => null);
        const read = r?.code === 0 ? metaFrom(parse(r.stdout)) : null;
        if (read && JSON.stringify(read) !== JSON.stringify({ agents: view.meta?.agents, limits: view.meta?.limits })) {
          view.meta = { ...read, at: Date.now() };
          onChange(view.meta);
          cx.notify();
        }
      } finally {
        busy = false;
      }
    });
  };
  poll();
  cx.timer.every(META_MS, poll);
}
