// People in the 3/4 view of one floor: everyone on the floor gets a spot of their station (or a place to wait
// near it), walks there along the grid and settles in the spot's pose; people leaving the floor walk to the
// elevator and vanish, new ones step out of it. Pure functions (no herdr / gpui-kit), so node can test them.
import { walkable } from "./grid.js";
import { corners, findPath, nearestFree } from "./pathing.js";

export const FLOOR_WALK_PX_PER_MS = 0.13; // matches the 8-frame stride of the floor-view people

const WAIT_RADIUS = 6; // a waiting person keeps their cell while it is within this many cells of the station
const key = (c, r) => `${c},${r}`;

// Goals for everyone on the floor: { address: { c, r, dx, pose, spot, station } }.
// A person keeps the spot they had when it still fits; desks of the person's own space come first;
// with no spot left they wait on the nearest free cell by the station.
export function floorGoals(plan, entries, previous = {}) {
  const goals = {};
  const takenSpots = new Set();
  const takenCells = new Set();
  const take = (address, s, station) => {
    takenSpots.add(s.id);
    takenCells.add(key(s.c, s.r));
    goals[address] = { c: s.c, r: s.r, dx: s.dx ?? 0, dy: s.dy ?? 0, raise: s.raise ?? 0, pose: s.pose, face: s.face ?? null, spot: s.id, object: s.object ?? null, station, bar: Boolean(s.bar) };
  };
  const waiting = [];
  const ordered = [...entries].sort((a, b) => String(a.agent.address).localeCompare(String(b.agent.address)));
  // Keep last tick's spots first, so nobody is pushed out by a newcomer.
  for (const { agent, station } of ordered) {
    const was = previous[agent.address]?.goal?.spot;
    const s = was && plan.spots.find((x) => x.id === was && x.station === station);
    if (s && !takenSpots.has(s.id)) take(agent.address, s, station);
  }
  for (const { agent, station } of ordered) {
    if (goals[agent.address]) continue;
    const free = plan.spots.filter((s) => s.station === station && !takenSpots.has(s.id));
    const s = free.find((x) => x.space === undefined || x.space === (agent.space || "")) ?? free[0];
    if (s) take(agent.address, s, station);
    else waiting.push({ agent, station });
  }
  // Waiters come after every spot is given out. One who already stands on a free cell near the station stays
  // there (no hopping about when somebody else comes or goes); the others take the nearest free cell.
  const stay = (address, cell, station) => {
    takenCells.add(key(cell.c, cell.r));
    goals[address] = { c: cell.c, r: cell.r, dx: 0, dy: 0, pose: "idle", face: null, spot: null, station };
  };
  const nearOf = (station) => plan.spots.find((x) => x.station === station) ?? plan.lift;
  const rest = [];
  for (const w of waiting) {
    const was = previous[w.agent.address]?.goal;
    const near = nearOf(w.station);
    const keeps = was && was.spot === null && was.station === w.station && !was.leaving && walkable(plan, was.c, was.r)
      && !takenCells.has(key(was.c, was.r)) && Math.abs(was.c - near.c) + Math.abs(was.r - near.r) <= WAIT_RADIUS;
    if (keeps) stay(w.agent.address, was, w.station);
    else rest.push(w);
  }
  for (const { agent, station } of rest) {
    const near = nearOf(station);
    stay(agent.address, nearestFree(plan, { c: near.c, r: near.r + 1 }, takenCells) ?? plan.lift, station);
  }
  return goals;
}

// floorGoals, recomputed only when who stands at which station (and their space) or the plan changes.
// cache: the last { plan, key, goals } or null; returns the cache to keep.
export function cachedGoals(cache, plan, entries, previous) {
  const k = entries.map(({ agent, station }) => `${agent.address}\u0000${station}\u0000${agent.space || ""}`).join("|");
  if (cache && cache.plan === plan && cache.key === k) return cache;
  return { plan, key: k, goals: floorGoals(plan, entries, previous) };
}

const sameGoal = (a, b) => Boolean(a && b) && a.c === b.c && a.r === b.r && a.pose === b.pose;
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

// A walk along points (plan px) starting at `now`.
function walkAlong(points, now) {
  const legs = [0];
  for (let i = 1; i < points.length; i++) legs.push(legs[i - 1] + dist(points[i - 1], points[i]) / FLOOR_WALK_PX_PER_MS);
  return { points, legs, start: now, end: now + legs[legs.length - 1] };
}

// Where a person is at `now`: position, which leg they walk and their facing (d, u, l, r).
export function posAt(p, now) {
  const { points, legs, start } = p.walk;
  const t = now - start;
  if (points.length === 1 || t >= legs[legs.length - 1]) return { ...points[points.length - 1], leg: -1, facing: p.facing ?? "d" };
  let i = 1;
  while (i < legs.length - 1 && t > legs[i]) i++;
  const a = points[i - 1];
  const b = points[i];
  const f = legs[i] === legs[i - 1] ? 1 : (t - legs[i - 1]) / (legs[i] - legs[i - 1]);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "r" : "l") : dy > 0 ? "d" : "u";
  return { x: a.x + dx * f, y: a.y + dy * f, leg: i, facing };
}

// Head from where the person is now (or the floor's way in) to a cell, ending at the spot's exact offset.
function routeTo(plan, p, target, dx, dy, now, spawn = plan.spawn) {
  const here = p ? posAt(p, now) : plan.toPx(spawn.c, spawn.r);
  // Step onto the nearest free cell centre first, so no leg cuts across a piece of furniture.
  const rounded = plan.toCell(here.x, here.y);
  const fromCell = walkable(plan, rounded.c, rounded.r) ? rounded : nearestFree(plan, rounded, new Set()) ?? rounded;
  const path = findPath(plan, fromCell, target) ?? [fromCell];
  const pts = [{ x: here.x, y: here.y }, ...corners(path).map((cell) => plan.toPx(cell.c, cell.r))];
  const last = pts[pts.length - 1];
  pts[pts.length - 1] = { x: last.x + dx, y: last.y + dy };
  return walkAlong(pts.filter((q, i) => i === 0 || dist(pts[i - 1], q) > 0.5), now);
}

// One tick for everyone on (or leaving) the floor. started: false on the view's first tick, when people are
// simply placed at their goals. spawnOf(address): the cell a newcomer comes in at (default: the floor's).
export function stepFloor(plan, people, goals, now, started, spawnOf = () => plan.spawn) {
  const next = {};
  for (const [address, goal] of Object.entries(goals)) {
    const p = people[address];
    if (!started && !p) {
      const at = plan.toPx(goal.c, goal.r);
      next[address] = { goal, walk: walkAlong([{ x: at.x + goal.dx, y: at.y + (goal.dy ?? 0) }], now), facing: goal.face ?? "u" };
    } else if (!p || p.leaving || !sameGoal(p.goal, goal)) {
      const walk = routeTo(plan, p, goal, goal.dx, goal.dy ?? 0, now, p ? plan.spawn : spawnOf(address));
      next[address] = { goal, walk, facing: p?.facing ?? "d" };
    } else {
      next[address] = p;
    }
  }
  // Those no longer on the floor walk to the elevator and vanish there.
  for (const [address, p] of Object.entries(people)) {
    if (goals[address]) continue;
    if (p.leaving) {
      if (now < p.walk.end) next[address] = p;
      continue;
    }
    next[address] = { ...p, leaving: true, goal: { c: plan.lift.c, r: plan.lift.r, dx: 0, dy: 0, pose: "idle", spot: null }, walk: routeTo(plan, p, plan.lift, 0, 0, now) };
  }
  return next;
}

// The animation to draw: a walk in the facing direction, else the goal's pose.
export function floorPose(p, now) {
  const at = posAt(p, now);
  return at.leg === -1 ? { pose: p.goal.pose, at } : { pose: `walk-${at.facing}`, at };
}
