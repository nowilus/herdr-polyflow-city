// The open floor's state on the office view: its plan, the people walking it, the camera and dragging.
// Works on the PolyflowOffice view (`view`), so main.js stays about the panel and the tower.
import { byFloor, FLOORS } from "./activity.js";
import { floorPlan } from "./floor-plan.js";
import { cachedGoals, posAt, stepFloor } from "./floor-crowd.js";
import { renderFloor } from "./floor-view.js";
import { ZOOM, clampPan, fitScale, worldSize } from "./camera.js";
import { POUR_MS, openDoors } from "./scene-plan.js";
import { newWorld } from "./crowd.js";
import { planFor as scenePlanFor } from "./floor-scenes.js";
import { renderScene } from "./scene-view.js";

export const FLOOR_TICK_MS = 80;

// Spaces of the people on DEV, as desk groups: [{ id, name, count }] by name.
function devSpaces(entries) {
  const by = new Map();
  for (const { agent } of entries) {
    const id = agent.space || "";
    const g = by.get(id) ?? { id, name: agent.space_name || "DEV", count: 0 };
    g.count += 1;
    by.set(id, g);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function openFloor(view, id) {
  view.openFloor = id;
  view.mounted = new Set(); // the tower starts fresh when it comes back
  view.floor = { plan: null, planKey: "", people: {}, started: false, goalCache: null, mounted: new Set(), stage: "", cam: { z: 1, ox: 0, oy: 0 }, drag: null, lastS: null };
}

// Back to the tower: it was paused while the floor was open, so it starts over from where everyone is now
// instead of replaying old trips.
export function closeFloor(view) {
  view.openFloor = null;
  view.floor = null;
  view.world = newWorld();
  view.mounted = new Set();
  view.stage = "";
}

function entriesOf(view, crew, now) {
  return byFloor(crew.agents, crew.activity, Math.floor(now / 1000)).find((f) => f.floor.id === view.openFloor)?.agents ?? [];
}

function planFor(view, entries) {
  // A floor whose pictures are installed (art/scenes.json) is drawn from them; the others on the grid.
  const pictured = view.scenes?.has(view.openFloor) ?? false;
  const spaces = view.openFloor === "dev" && !pictured ? devSpaces(entries) : [];
  const key = JSON.stringify([pictured, spaces]);
  if (key !== view.floor.planKey || !view.floor.plan) {
    view.floor.plan = (pictured && scenePlanFor(view.openFloor)) || floorPlan(view.openFloor, spaces);
    view.floor.planKey = key;
  }
  return view.floor.plan;
}

// Move everyone on the open floor; redraw when someone starts a new leg, settles or changes status.
export function floorTick(view, crew, cx) {
  if (!view.openFloor || !view.floor) return;
  const now = Date.now();
  const entries = entriesOf(view, crew, now);
  const plan = planFor(view, entries);
  const f = view.floor;
  // Someone new to the office comes in from the street (where the floor has an entrance); others by the elevator.
  view.everSeen ??= new Set(crew.agents.map((a) => a.address));
  const spawnOf = (address) => (view.everSeen.has(address) ? plan.spawn : plan.entrance ?? plan.spawn);
  // Goals only change with who stands at which station or the plan; in between the last ones stand.
  f.goalCache = cachedGoals(f.goalCache, plan, entries, f.people);
  f.people = stepFloor(plan, f.people, f.goalCache.goals, now, f.started, spawnOf);
  for (const a of crew.agents) view.everSeen.add(a.address);
  f.started = true;
  const who = Object.fromEntries(crew.agents.map((a) => [a.address, `${a.status}:${a.tab_name}`]));
  // Redraw on anything visible: a new leg, settling, status or name, a door opening, a cup being poured.
  const at = new Map(Object.values(f.people).map((p) => [p, posAt(p, now)])); // once per person, shared below
  const doors = plan.scene ? Object.values(openDoors(plan.scene, f.people, (p) => at.get(p))).map(Number).join("") : "";
  const stage = Object.entries(f.people)
    .map(([a, p]) => `${a}:${at.get(p).leg}:${p.goal.c},${p.goal.r},${p.goal.pose}:${f.mounted.has(a)}:${who[a]}:${p.walk.start}:${now - p.walk.end >= POUR_MS}`)
    .join("|") + `#${plan.rows}#${doors}`;
  if (stage !== f.stage) {
    f.stage = stage;
    cx.notify();
  }
}

// The camera: zoom relative to the fit, and the user's pan as an offset from the centred floor, so a resized
// panel or a growing floor stays centred.
function camera(view, plan, size) {
  const cam = view.floor.cam;
  const s = fitScale(plan, size.w, size.h) * cam.z;
  const world = worldSize(plan);
  // A resize or a smaller zoom may leave an old pan out of bounds: pull it back in.
  Object.assign(cam, clampPan(world, s, size, cam.ox, cam.oy));
  return { s, x: (size.w - world.w * s) / 2 + cam.ox, y: (size.h - world.h * s) / 2 + cam.oy };
}

// Zoom by `factor` around a point of the viewport (its centre when null), keeping that point still.
function zoom(view, plan, size, factor, point) {
  const cam = view.floor.cam;
  const before = camera(view, plan, size);
  cam.z = Math.min(ZOOM.max, Math.max(ZOOM.min, cam.z * factor));
  const s = fitScale(plan, size.w, size.h) * cam.z;
  const p = point ?? { x: size.w / 2, y: size.h / 2 };
  const x = p.x - (p.x - before.x) * (s / before.s);
  const y = p.y - (p.y - before.y) * (s / before.s);
  const world = worldSize(plan);
  Object.assign(cam, clampPan(world, s, size, x - (size.w - world.w * s) / 2, y - (size.h - world.h * s) / 2));
}

export function renderOpenFloor(view, crew, ctx, t) {
  const now = Date.now();
  const f = view.floor;
  const plan = f.plan ?? planFor(view, entriesOf(view, crew, now));
  const size = view.scene;
  const ui = view.uiZoom(); // events arrive in zoomed px
  const unzoom = (p) => (p ? { x: p.x / ui, y: p.y / ui } : null);
  const floorDef = FLOORS.find((x) => x.id === view.openFloor);
  const cam = camera(view, plan, size);
  // A new scale (zoom, resize, a growing floor) puts everyone where they are now; their walks resume next frame.
  const rescaled = f.lastS !== null && Math.abs(cam.s - f.lastS) > 1e-6;
  f.lastS = cam.s;
  const el = (plan.scene ? renderScene : renderFloor)({
    plan,
    people: f.people,
    agentsBy: ctx.agentsBy,
    assigned: ctx.assigned,
    minis: ctx.minis,
    rescaled,
    cast: ctx.cast,
    doing: ctx.doing,
    mounted: rescaled ? new Set() : f.mounted,
    now,
    cam,
    size,
    title: `0${floorDef?.no ?? ""} // ${floorDef?.label ?? ""}`,
    onPerson: ctx.onPerson,
    onPersonMenu: ctx.onPersonMenu,
    onInvite: view.openFloor === "lobby" ? ctx.onInvite : null,
    onBack: (cx) => { closeFloor(view); cx.notify(); },
    onZoom: (factor, point, cx) => { zoom(view, plan, size, factor, unzoom(point)); cx.notify(); },
    onFit: (cx) => { f.cam = { z: 1, ox: 0, oy: 0 }; cx.notify(); },
    onPanStart: (pos) => { if (f.cam.z > 1) f.drag = { from: unzoom(pos), ox: f.cam.ox, oy: f.cam.oy }; },
    canPan: f.cam.z > 1.001,
    onPanMove: (pos, cx) => {
      if (!f.drag) return;
      const p = unzoom(pos);
      const { ox, oy } = clampPan(worldSize(plan), fitScale(plan, size.w, size.h) * f.cam.z, size,
        f.drag.ox + p.x - f.drag.from.x, f.drag.oy + p.y - f.drag.from.y);
      if (Math.abs(ox - f.cam.ox) < 1 && Math.abs(oy - f.cam.oy) < 1) return;
      f.cam.ox = ox;
      f.cam.oy = oy;
      cx.notify();
    },
    onPanEnd: () => { f.drag = null; },
  }, t);
  f.mounted = rescaled ? new Set() : new Set(Object.keys(f.people));
  return el;
}
