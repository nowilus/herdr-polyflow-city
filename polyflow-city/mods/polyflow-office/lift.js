// The glass elevator: one cabin, doors that open and close, riders inside. A small state machine driven by the
// clock and by who waits where (crowd.js). Pure functions (no herdr / gpui-kit), so node can test them.
//
// phase: idle (doors shut, standing) -> opening -> open -> closing -> idle, or idle -> moving -> opening.
// start/end: when the current phase began and ends (ms).
import { FLOOR_ORDER, LIFT } from "./tower-scene.js";

export const DOOR_MS = 450;
export const HOLD_MS = 700; // doors stay open at least this long
export const FLOOR_MS = 900; // ride time per storey

const idx = (floor) => FLOOR_ORDER.indexOf(floor);

export const newLift = (floor = "lobby") => ({ floor, to: floor, phase: "idle", start: 0, end: 0, dir: 0, riders: [], busyUntil: 0 });

// Close the phase whose time is up.
export function liftClock(lift, now) {
  if (now < lift.end) return lift;
  if (lift.phase === "moving") return { ...lift, floor: lift.to, phase: "opening", start: now, end: now + DOOR_MS };
  if (lift.phase === "opening") return { ...lift, phase: "open", start: now, end: now };
  if (lift.phase === "closing") return { ...lift, phase: "idle", start: now, end: now };
  return lift;
}

// Choose what to do next. demand: { dests: floors riders want, waiting: { floor: how many wait there } }.
// Riders' floors and waiting people both call the cabin; the nearest call ahead in the direction of travel wins.
export function liftDecide(lift, demand, now) {
  const full = lift.riders.length >= LIFT.capacity;
  const waitingAt = (f) => !full && (demand.waiting[f] ?? 0) > 0;
  const wantedHere = demand.dests.includes(lift.floor) || waitingAt(lift.floor);
  if (lift.phase === "open") {
    if (wantedHere || now < Math.max(lift.start + HOLD_MS, lift.busyUntil)) return lift;
    return { ...lift, phase: "closing", start: now, end: now + DOOR_MS };
  }
  if (lift.phase !== "idle") return lift;
  if (wantedHere) return { ...lift, phase: "opening", start: now, end: now + DOOR_MS };
  const calls = [...new Set([...demand.dests, ...FLOOR_ORDER.filter(waitingAt)])];
  if (calls.length === 0) return lift;
  const here = idx(lift.floor);
  const ahead = calls.filter((f) => Math.sign(idx(f) - here) === lift.dir);
  const to = (ahead.length ? ahead : calls).reduce((a, b) => (Math.abs(idx(a) - here) <= Math.abs(idx(b) - here) ? a : b));
  const storeys = Math.abs(idx(to) - here);
  return { ...lift, to, dir: Math.sign(idx(to) - here), phase: "moving", start: now, end: now + storeys * FLOOR_MS };
}

// Doors of a floor are open (or opening) while the cabin stands there with its doors not shut.
export const doorsOpen = (lift, floor) => lift.floor === floor && (lift.phase === "opening" || lift.phase === "open");
