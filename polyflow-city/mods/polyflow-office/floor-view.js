// The 3/4 view of one floor: tiles, the back wall with the elevator, furniture and people drawn in depth order
// (by where they stand), inside a camera the user zooms with the wheel and pans by dragging.
// Plan px (floor-plan.js) times the camera scale.
import { div, image } from "gpui-kit";

import { jobIn } from "./lib.js";
import { CELL } from "./grid.js";
import { cameraFrame } from "./camera.js";
import { floorPose } from "./floor-crowd.js";

const ART = "mods/polyflow-office/art";
const SIGN_FONT = "Silkscreen";
const PERSON = { w: 64, h: 96 };
const TILE = 96;
const WINDOW_COLS = new Set([1, 4, 7, 13, 16]);
// Furniture pictures (art/<kind>.png) and their size in plan px.
const SPRITE = {
  "server-rack": [48, 94], "test-bench": [96, 60], "data-shelf": [96, 74], comms: [96, 107], desk: [96, 73],
  "meeting-table": [144, 113], "help-console": [96, 87], bar: [144, 60], couch: [96, 53], vending: [48, 82],
  capsule: [48, 117], "plant-tube": [48, 89], "water-cooler": [48, 120],
};



function tiles(plan, s) {
  const out = [];
  for (let y = 2 * CELL; y < plan.rows * CELL; y += TILE) {
    for (let x = 0; x < plan.cols * CELL; x += TILE) {
      const alt = ((x + y) / TILE) % 2 === 1;
      out.push(image(`${ART}/${alt ? "floor-b" : "floor-a"}.png`).absolute().left(x * s).top(y * s).w(TILE * s).h(TILE * s).opacity(0.55));
    }
  }
  return out;
}

function backWall(plan, s, lift) {
  const out = [];
  for (let c = 0; c < plan.cols; c++) {
    const art = WINDOW_COLS.has(c) ? ["window", 107] : ["wall-front", 104];
    out.push(image(`${ART}/${art[0]}.png`).absolute().left(c * CELL * s).top((2 * CELL - art[1]) * s).w(CELL * s).h(art[1] * s));
  }
  out.push(image(`${ART}/elevator-doors.png`).absolute().left(lift.c * CELL * s).top((2 * CELL - 89) * s).w(CELL * s).h(89 * s));
  return out;
}

// Furniture as depth-sorted items: { depth, el }.
function furniture(plan, s) {
  return plan.objects.map((o) => {
    const [w, h] = SPRITE[o.kind] ?? [o.fw * CELL, o.fh * CELL];
    const bottom = (o.r + o.fh) * CELL;
    const left = o.c * CELL + (o.fw * CELL) / 2 - w / 2;
    return { depth: bottom, el: image(`${ART}/${o.kind}.png`).absolute().left(left * s).top((bottom - h) * s).w(w * s).h(h * s) };
  });
}

function signs(plan, s, t) {
  return plan.labels.map((l) =>
    div().absolute().left(l.c * CELL * s).top((l.r * CELL + 6) * s).px(Math.max(2, 6 * s)).py(Math.max(1, 3 * s))
      .bg(`${t.background}d9`).border_l(2).border_color(t.accent)
      .font_family(SIGN_FONT).text_size(Math.max(8, 14 * s)).text_color(t.accent).child(l.text));
}

function person(view, s, address, p, t) {
  const agent = view.agentsBy[address];
  if (!agent) return null;
  const job = jobIn(agent.tab_name, view.assigned);
  if (!job) return null;
  const { pose, at } = floorPose(p, view.now);
  const settled = pose === p.goal.pose;
  const shown = settled && agent.status === "blocked" ? "blocked" : pose;
  const mounted = view.mounted.has(address);
  // Glide along the current leg: target its end with the time left; the next leg starts on a later frame.
  const leg = settled || !mounted ? null : p.walk.points[at.leg];
  const tx = leg ? leg.x : at.x;
  const ty = leg ? leg.y : at.y;
  const ms = leg ? Math.max(1, Math.round(p.walk.start + p.walk.legs[at.leg] - view.now)) : 1;
  const bubble = agent.status === "blocked" ? "!" : agent.status === "done" ? "zZz" : null;
  const el = div().id(`fp-${address}`).absolute().flex().flex_col().items_center()
    .left((tx - PERSON.w / 2) * s).top((ty - PERSON.h) * s).w(PERSON.w * s).h((PERSON.h + 18) * s)
    .transition("left", { duration: ms, easing: "linear" }).transition("top", { duration: ms, easing: "linear" })
    .cursor_pointer().on_click((_e, cx) => view.onPerson(address, cx))
    .on_mouse_down("right", (_e, cx) => (view.onPersonMenu ?? view.onPerson)(address, cx))
    .child(image(`${ART}/floor/${job}-${shown}.gif`).w(PERSON.w * s).h(PERSON.h * s))
    .child(div().max_w(140 * s).truncate().font_family(SIGN_FONT).text_size(Math.max(7, 11 * s)).px(3 * s).bg(`${t.background}cc`)
      .text_color(agent.status === "blocked" ? t.blocked : t.foreground).child(agent.tab_name || address))
    .when(Boolean(bubble), (x) => x.child(
      div().absolute().top(-16 * s).px(5 * s).bg(agent.status === "blocked" ? t.blocked : t.popover).text_color("#ffffff")
        .font_family(SIGN_FONT).text_size(Math.max(8, 13 * s)).child(bubble).loop("opacity", { from: 0.6, to: 1, period: 900 })));
  return { depth: at.y, el };
}

// view: { plan, people, agentsBy, assigned, mounted, now, cam: { s, x, y }, size: { w, h }, title, onPerson,
//         onBack, onZoom(factor, point|null), onFit, onPanStart(pos), onPanMove(pos), onPanEnd }
export function renderFloor(view, t) {
  const { plan, cam } = view;
  const s = cam.s;
  const items = [...furniture(plan, s), ...Object.entries(view.people).map(([a, p]) => person(view, s, a, p, t)).filter(Boolean)]
    .sort((a, b) => a.depth - b.depth);
  const world = div().id("floor-world").absolute().left(cam.x).top(cam.y).w(plan.cols * CELL * s).h(plan.rows * CELL * s)
    .children(tiles(plan, s)).children(backWall(plan, s, plan.lift)).children(items.map((i) => i.el)).children(signs(plan, s, t));
  return cameraFrame(view, world, t);
}
