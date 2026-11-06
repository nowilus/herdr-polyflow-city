// The living tower: who of each floor is drawn, which spot they take, and how they walk, wait for the elevator,
// ride it and settle. Pure functions (no herdr / gpui-kit), so node can test them.
// Coordinates are the scene's picture pixels (tower-scene.js); the renderer scales them.
//
// A person's phase: walk (on a floor toward toX, then "at" a spot or "wait" at the lift), at, wait, enter (stepping
// into the cabin), ride (inside the cabin). Walking out of the cabin is a walk that starts at the cabin.
import { ENTRANCE_X, LIFT, ROOM, spotsFor, spotsOf } from "./tower-scene.js";
import { liftClock, liftDecide, newLift } from "./lift.js";

export const WALK_PX_PER_MS = 0.12;
export const SHOWN_MAX = 3;
export const ENTER_MS = Math.round((LIFT.x - LIFT.waitX) / WALK_PX_PER_MS);
const STAND_GAP = 70;

// Who of a floor is drawn: the ones that need the person first, then the focused one, then the working ones.
export function pickShown(entries, max = SHOWN_MAX) {
  const rank = ({ agent }) => (agent.status === "blocked" ? 0 : agent.focused ? 1 : agent.status === "working" ? 2 : 3);
  return [...entries].sort((a, b) => rank(a) - rank(b) || String(a.agent.address).localeCompare(String(b.agent.address))).slice(0, max);
}

const goalAt = (s) => ({ floor: s.floor, x: s.x, dy: s.dy, pose: s.pose, face: s.face, object: s.object, spot: s.id });

// Goals for the shown people of one floor: { address: goal }, each on its own spot, never two on one.
// Two or more resting in the lobby: the first two meet at the bar and talk. No spot of the station left: stand by.
export function floorGoals(floorId, shown) {
  const taken = new Set();
  const goals = {};
  const take = (address, s) => { taken.add(s.id); goals[address] = goalAt(s); };
  const resting = floorId === "lobby" ? shown.filter((e) => e.station === "lounge") : [];
  if (resting.length >= 2) spotsFor("lobby", "bar").slice(0, 2).forEach((s, i) => take(resting[i].agent.address, s));
  let standing = 0;
  for (const { agent, station } of shown) {
    if (goals[agent.address]) continue;
    const s = spotsFor(floorId, station).find((x) => !taken.has(x.id)) ?? spotsOf(floorId).find((x) => !taken.has(x.id) && x.station === station);
    if (s) take(agent.address, s);
    else goals[agent.address] = { floor: floorId, x: ROOM.x0 + 60 + STAND_GAP * standing++, dy: 0, pose: "idle", face: "r", object: null, spot: null };
  }
  return goals;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const walkMs = (from, to) => Math.max(1, Math.round(Math.abs(to - from) / WALK_PX_PER_MS));
const sameGoal = (a, b) => Boolean(a && b) && a.floor === b.floor && a.x === b.x && a.pose === b.pose && a.face === b.face && a.dy === b.dy;
const moving = (p) => p.phase === "walk" || p.phase === "enter";

// Where a person is now on its floor line (picture px).
export function xAt(p, now) {
  if (!moving(p)) return p.x;
  return p.fromX + (p.toX - p.fromX) * clamp01((now - p.start) / p.dur);
}

function walk(p, floor, fromX, toX, now, dest, goal) {
  return { ...p, floor, x: fromX, fromX, toX, start: now, dur: walkMs(fromX, toX), end: now + walkMs(fromX, toX), phase: "walk", dest, goal, facing: toX >= fromX ? "r" : "l", dy: 0 };
}

const settle = (p, goal, now) => ({ ...p, floor: goal.floor, x: goal.x, phase: "at", pose: goal.pose, facing: goal.face, dy: goal.dy ?? 0, goal, since: now, dest: null });

// Head for the goal from where the person stands: straight to its spot, or to a free place in the lift queue.
function route(p, goal, now, ctx) {
  const from = xAt(p, now);
  if (goal.floor === p.floor) return { ...walk(p, p.floor, from, goal.x, now, "spot", goal), slot: null };
  const slot = p.dest === "lift" && p.slot != null ? p.slot : ctx.takeSlot(p.floor);
  return { ...walk(p, p.floor, from, LIFT.waitX - LIFT.waitGap * slot, now, "lift", goal), slot };
}

// One person, one tick. ctx: the lift as it is now plus what this tick changed (riders, door traffic, queues).
function personStep(p, goal, now, ctx, address) {
  if (!p) {
    if (!ctx.started) return settle({ address }, goal, now);
    return route({ address, floor: "lobby", x: ENTRANCE_X, phase: "at" }, goal, now, ctx);
  }
  const lift = ctx.lift;
  const open = lift.phase === "open";
  if (p.phase === "ride") {
    if (!(open && lift.floor === goal.floor)) return { ...p, goal };
    ctx.leave(address, now);
    return { ...walk(p, goal.floor, LIFT.x + p.seat, goal.x, now, "spot", goal), seat: null };
  }
  if (p.phase === "enter") return now >= p.end ? { ...p, phase: "ride", x: LIFT.x + p.seat, goal } : { ...p, goal };
  if (p.phase === "wait") {
    if (goal.floor === p.floor) return route({ ...p, dest: null }, goal, now, ctx);
    if (!(open && lift.floor === p.floor && ctx.hasRoom())) { ctx.wait(p.floor); return { ...p, goal }; }
    const seat = ctx.board(address, now);
    return { ...p, phase: "enter", fromX: p.x, toX: LIFT.x + seat, x: p.x, seat, slot: null, start: now, dur: ENTER_MS, end: now + ENTER_MS, facing: "r", goal };
  }
  if (!sameGoal(p.goal, goal)) return route(p, goal, now, ctx);
  if (p.phase === "walk" && now >= p.end) {
    if (p.dest === "lift") { ctx.wait(p.floor); return { ...p, x: p.toX, phase: "wait", facing: "r", pose: "idle" }; }
    return settle(p, goal, now);
  }
  return p;
}

export const newWorld = () => ({ people: {}, lift: newLift(), started: false });

// Everyone shown moves one tick toward their goal, then the lift decides. goals: { address: goal } of all floors.
export function advance(world, goals, now) {
  let lift = liftClock(world.lift, now);
  const riders = lift.riders.filter((a) => goals[a]);
  let busyUntil = lift.busyUntil;
  const waiting = {}; // floor -> how many stand at the doors (only they call the cabin)
  // Queue places already held, per floor, so a newcomer never takes someone's place whatever the order.
  const slots = {};
  for (const [a, p] of Object.entries(world.people)) {
    if (goals[a] && p.dest === "lift" && p.slot != null && (p.phase === "wait" || p.phase === "walk")) (slots[p.floor] ??= new Set()).add(p.slot);
  }
  const seats = new Set(riders.map((a) => world.people[a]?.seat));
  const ctx = {
    lift,
    started: world.started,
    takeSlot: (floor) => {
      const held = (slots[floor] ??= new Set());
      let i = 0;
      while (held.has(i)) i++;
      held.add(i);
      return i;
    },
    wait: (floor) => { waiting[floor] = (waiting[floor] ?? 0) + 1; },
    hasRoom: () => riders.length < LIFT.capacity,
    board: (address, t) => {
      riders.push(address);
      busyUntil = Math.max(busyUntil, t + ENTER_MS);
      const seat = LIFT.seats.find((s) => !seats.has(s)) ?? LIFT.seats[0];
      seats.add(seat);
      return seat;
    },
    leave: (address, t) => {
      riders.splice(riders.indexOf(address), 1);
      seats.delete(world.people[address]?.seat);
      busyUntil = Math.max(busyUntil, t + ENTER_MS);
    },
  };
  const people = {};
  for (const [address, goal] of Object.entries(goals)) people[address] = personStep(world.people[address], goal, now, ctx, address);
  lift = { ...lift, riders, busyUntil };
  const dests = riders.map((a) => people[a].goal.floor);
  lift = liftDecide(lift, { dests, waiting }, now);
  return { people, lift, started: true };
}

// What to draw for a person: where (floor line or cabin) and which animation.
export function poseOf(p) {
  if (p.phase === "walk" || p.phase === "enter") return "walk";
  if (p.phase === "at") return p.pose ?? "idle";
  return "idle";
}

// Who is at which object right now: { objectId: { address, pose, since } }; the renderer lights screens etc.
export function occupancy(people) {
  const out = {};
  for (const [address, p] of Object.entries(people)) {
    if (p.phase === "at" && p.goal?.object) out[p.goal.object] = { address, pose: p.pose, since: p.since };
  }
  return out;
}

// Where everyone is right now (not where they are heading): the floor of the person drawn, else their destination.
// Riders count as on the way. { here: { floor: n }, coming: { floor: n } }
export function presence(floors, people) {
  const here = {};
  const coming = {};
  for (const { floor, agents } of floors) {
    for (const { agent } of agents) {
      const p = people[agent.address];
      const at = !p ? floor.id : p.phase === "ride" ? null : p.floor;
      if (at) here[at] = (here[at] ?? 0) + 1;
      if (at !== floor.id) coming[floor.id] = (coming[floor.id] ?? 0) + 1;
    }
  }
  return { here, coming };
}
