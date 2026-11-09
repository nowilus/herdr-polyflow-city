// Screen-space geometry of the E battery; independent of host, camera zoom and drawing.
import { energyOf } from "./energy.js";

export const CALM_KEY = "polyflow-office.calm";

export function energyPill(meta, scale = 1, opts = {}) {
  const k = Math.max(0.75, Math.min(1, Number.isFinite(scale) ? scale : 1));
  const energy = energyOf(meta, undefined, { stale: opts.stale === true || meta?.stale === true });
  return {
    w: opts.compact ? 56 : Math.round(96 * k), h: opts.compact ? 14 : Math.round(20 + (k - 0.75) * 32),
    fillPct: energy.freePct ?? 0, text: energy.freePct === null ? "—" : `${energy.freePct}%`,
    level: energy.level, dim: energy.stale || energy.level === "unknown",
  };
}

// Stable address order, no mutation. Move each overlapping pill up by its own height + a 2 px gap.
export function placeEnergyPills(items) {
  const placed = [];
  for (const item of [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const next = { ...item };
    const overlaps = (p) => next.x < p.x + p.w && next.x + next.w > p.x && next.y < p.y + p.h + 2 && next.y + next.h + 2 > p.y;
    while (placed.some(overlaps)) next.y -= next.h + 2;
    placed.push(next);
  }
  return placed;
}
