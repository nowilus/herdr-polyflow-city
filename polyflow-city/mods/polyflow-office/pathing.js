// Shortest walks on a floor's grid (A*, four directions), plus the nearest free cell around a place.
// Pure functions (no herdr / gpui-kit), so node can test them.
import { walkable } from "./grid.js";

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (c, r) => `${c},${r}`;

// Cells from `from` to `to` inclusive, or null when there is no way. `from` and `to` may be on blocked cells
// (someone standing at a spot); everything between must be walkable.
export function findPath(plan, from, to) {
  const goal = key(to.c, to.r);
  const h = (c, r) => Math.abs(c - to.c) + Math.abs(r - to.r);
  const open = [{ c: from.c, r: from.r, g: 0, f: h(from.c, from.r) }];
  const came = new Map([[key(from.c, from.r), null]]);
  const cost = new Map([[key(from.c, from.r), 0]]);
  while (open.length) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i;
    const cur = open.splice(best, 1)[0];
    const k = key(cur.c, cur.r);
    if (k === goal) {
      const path = [];
      for (let at = k; at !== null; at = came.get(at)) {
        const [c, r] = at.split(",").map(Number);
        path.push({ c, r });
      }
      return path.reverse();
    }
    for (const [dc, dr] of STEPS) {
      const c = cur.c + dc;
      const r = cur.r + dr;
      const nk = key(c, r);
      if (nk !== goal && !walkable(plan, c, r)) continue;
      const g = cur.g + 1;
      if (g >= (cost.get(nk) ?? Infinity)) continue;
      cost.set(nk, g);
      came.set(nk, k);
      open.push({ c, r, g, f: g + h(c, r) });
    }
  }
  return null;
}

// Only the corners of a path (straight runs collapsed), so a walk is a few straight glides.
export function corners(path) {
  if (!path || path.length <= 2) return path ?? [];
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1];
    const b = path[i];
    const n = path[i + 1];
    const straight = (a.c === b.c && b.c === n.c) || (a.r === b.r && b.r === n.r);
    if (!straight) out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}

// The walkable cell nearest to `near` (breadth first) that `taken` doesn't hold, or null.
export function nearestFree(plan, near, taken) {
  const seen = new Set([key(near.c, near.r)]);
  const queue = [near];
  while (queue.length) {
    const cur = queue.shift();
    if (walkable(plan, cur.c, cur.r) && !taken.has(key(cur.c, cur.r))) return cur;
    for (const [dc, dr] of STEPS) {
      const c = cur.c + dc;
      const r = cur.r + dr;
      if (c < 0 || r < 0 || c >= plan.cols || r >= plan.rows || seen.has(key(c, r))) continue;
      seen.add(key(c, r));
      queue.push({ c, r });
    }
  }
  return null;
}
