// Furniture of the tower: each object drawn from its art (art/tower/<kind>.png) when installed, else as a stand-in
// built from blocks, plus its live parts (screens, rack doors, drawers, the coffee machine) that follow who is there.
// All sizes are picture px; `px` scales them to the panel.
import { div, image } from "gpui-kit";
import { FLOORS } from "./tower-scene.js";
import { motion } from "./labels.js";

export const ART_DIR = "mods/polyflow-office/art/tower";
export { POUR_MS } from "./scene-plan.js";
import { POUR_MS } from "./scene-plan.js";

const C = { body: "#161b22", edge: "#2a323d", cyan: "#00e5ff", yellow: "#fcee0a", red: "#ff2a6d", glass: "#0f2d36", green: "#57df9c" };

const box = (px, x, y, w, h, bg, border = null) => {
  const el = div().absolute().left(px(x)).top(px(y)).w(px(w)).h(px(h)).bg(bg);
  return border ? el.border(Math.max(1, px(2))).border_color(border) : el;
};

// Stand-ins: a few blocks per kind, inside the object's box (x0, y0 = its top-left).
const STAND_IN = {
  "server-rack": (px, o, x0, y0) => [box(px, x0, y0, o.w, o.h, C.body, C.cyan), ...[0.2, 0.45, 0.7].map((f) => box(px, x0 + 6, y0 + o.h * f, o.w - 12, 4, C.edge))],
  "test-bench": (px, o, x0, y0) => [box(px, x0, y0 + 14, o.w, 8, C.edge, C.yellow), box(px, x0 + 6, y0 + 22, 6, o.h - 22, C.edge), box(px, x0 + o.w - 12, y0 + 22, 6, o.h - 22, C.edge)],
  "data-shelf": (px, o, x0, y0) => [box(px, x0, y0, o.w, o.h, C.body, C.yellow), ...[0.25, 0.5, 0.75].map((f) => box(px, x0 + 6, y0 + o.h * f, o.w - 12, 3, C.yellow))],
  "holo-globe": (px, o, x0, y0) => [box(px, x0 + o.w / 2 - 18, y0 + o.h - 26, 36, 26, C.edge, C.cyan)],
  comms: (px, o, x0, y0) => [box(px, x0, y0 + 26, o.w, o.h - 26, C.body, C.cyan)],
  desk: (px, o, x0, y0) => [box(px, x0, y0, o.w, 8, C.edge, C.yellow), box(px, x0 + 4, y0 + 8, 6, o.h - 8, C.edge), box(px, x0 + o.w - 30, y0 + 8, 26, o.h - 8, C.body, C.edge), box(px, x0 + o.w / 2 + 4, y0 - 8, 6, 8, C.edge)],
  "meeting-table": (px, o, x0, y0) => [box(px, x0, y0, o.w, 10, C.edge, C.cyan), box(px, x0 + o.w / 2 - 20, y0 + 10, 40, o.h - 10, C.body, C.edge)],
  "help-desk": (px, o, x0, y0) => [box(px, x0, y0, o.w, o.h, C.body, C.red)],
  "back-bar": (px, o, x0, y0) => [box(px, x0, y0, o.w, 6, C.edge), box(px, x0, y0 + 30, o.w, 6, C.edge), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => box(px, x0 + 10 + i * 22, y0 - 18, 8, 18, i % 2 ? C.yellow : C.cyan))],
  "bar-counter": (px, o, x0, y0) => [box(px, x0, y0, o.w, o.h, C.body, C.edge), box(px, x0, y0 + 10, o.w, 4, C.yellow)],
  sofa: (px, o, x0, y0) => [box(px, x0 + 10, y0, o.w - 20, 30, C.body, C.edge), box(px, x0 + 10, y0 + 30, o.w - 20, 12, C.yellow), box(px, x0 + 10, y0 + 42, o.w - 20, o.h - 42, C.body)],
  "sofa-front": (px, o, x0, y0) => [box(px, x0, y0 - 14, 14, o.h + 14, C.body, C.edge), box(px, x0 + o.w - 14, y0 - 14, 14, o.h + 14, C.body, C.edge)],
  plant: (px, o, x0, y0) => [box(px, x0 + 8, y0 + o.h - 26, o.w - 16, 26, C.edge), box(px, x0 + 4, y0, o.w - 8, o.h - 26, "#1f6b3a")],
  crates: (px, o, x0, y0) => [box(px, x0, y0 + o.h / 2, o.w / 2, o.h / 2, C.edge, C.yellow), box(px, x0 + o.w / 2 + 4, y0 + o.h / 2, o.w / 2 - 4, o.h / 2, C.edge, C.yellow), box(px, x0 + 14, y0, o.w / 2, o.h / 2, C.edge, C.yellow)],
};

// The object's box in picture px.
export function objectBox(o) {
  const y = FLOORS[o.floor].y - (o.lift ?? 0);
  return { x0: o.x - o.w / 2, y0: y - o.h, w: o.w, h: o.h };
}

function body(o, px, assets) {
  const { x0, y0, w, h } = objectBox(o);
  if (assets.has(o.kind)) {
    const img = image(`${ART_DIR}/${o.kind}.png`).absolute().left(px(x0)).top(px(y0)).w(px(w)).h(px(h));
    // Glowing things (wall screens, neon) breathe a little, each on its own beat.
    return [o.pulse ? motion(img, "opacity", { from: 0.7, to: 1, period: 1800 + (o.x % 7) * 230 }) : img];
  }
  return (STAND_IN[o.kind] ?? ((p) => [box(p, x0, y0, w, h, C.body, C.edge)]))(px, o, x0, y0);
}

// A screen that wakes up when used: always mounted, its brightness and scrolling lines fade in and out.
function screen(px, id, x, y, w, h, on, color = C.cyan) {
  const lines = motion(div().absolute().left(px(3)).top(0).w(px(w - 6)).h(px(h * 2)), "top", { from: 0, to: -px(h), period: 2400, easing: "linear" })
    .children([0, 1, 2, 3, 4, 5, 6, 7].map((i) => div().mt(px(3)).h(Math.max(1, px(2))).w(px((w - 6) * (0.4 + ((i * 37) % 50) / 100))).bg(color)));
  return div().id(`scr-${id}`).absolute().left(px(x)).top(px(y)).w(px(w)).h(px(h)).overflow_hidden().bg("#05080b").border(Math.max(1, px(2))).border_color(C.edge)
    .child(div().absolute().left(0).top(0).size_full().bg(color).opacity(on ? 0.22 : 0.04).transition("opacity", { duration: 400 }))
    .child(lines.opacity(on ? 1 : 0).transition("opacity", { duration: 400 }));
}

// A monitor standing on furniture: the monitor art (or a block) with its screen inside.
function monitor(px, id, x, bottom, on, assets) {
  const w = 46;
  const h = 25;
  if (!assets.has("monitor")) return [screen(px, id, x, bottom - 36, 52, 36, on)];
  return [image(`${ART_DIR}/monitor.png`).absolute().left(px(x)).top(px(bottom - h)).w(px(w)).h(px(h)), screen(px, id, x + 3, bottom - h + 1, w - 6, 16, on)];
}

// Live parts, drawn over the body. who: the occupant (occupancy entry) or undefined; ctx: { now, alarm }.
const PARTS = {
  screen: (px, o, b, who, _ctx, assets) => {
    const on = Boolean(who);
    if (o.kind === "desk") return monitor(px, o.id, b.x0 + b.w * 0.3, b.y0 + 2, on, assets);
    if (o.kind === "comms") return assets.has("comms") ? [screen(px, o.id, b.x0 + b.w * 0.2, b.y0 + b.h * 0.1, b.w * 0.6, b.h * 0.26, on)] : [screen(px, o.id, b.x0 + 8, b.y0, b.w - 16, 30, on)];
    return monitor(px, o.id, b.x0 + b.w * 0.6, b.y0 + b.h * 0.3, on, assets);
  },
  leds: (px, o, b, who, _ctx, assets) => [0.22, 0.4, 0.58, 0.76].flatMap((f, j) => [0, 1, 2].map((i) => {
    const period = (who ? 260 : 700) + ((i * 7 + j * 13 + o.x) % 9) * (who ? 40 : 150);
    const x = assets.has(o.kind) ? b.x0 + b.w * 0.6 + i * 5 : b.x0 + 10 + i * 12;
    return motion(box(px, x, b.y0 + b.h * f, 3, 3, j % 3 === 2 ? C.yellow : C.cyan).opacity(0.7), "opacity", { from: 0.15, to: 1, period });
  })),
  // The rack's door folds away to the left while someone works at it.
  "rack-door": (px, o, b, who, _ctx, assets) => {
    const el = div().id(`door-${o.id}`).absolute().left(px(b.x0)).top(px(b.y0)).h(px(b.h)).w(px(who ? 8 : b.w)).overflow_hidden()
      .transition("width", { duration: 500, easing: "ease-in-out" });
    return [assets.has("rack-door")
      ? el.child(image(`${ART_DIR}/rack-door.png`).absolute().left(0).top(0).w(px(b.w)).h(px(b.h)))
      : el.bg("#0b0f14e6").border(Math.max(1, px(2))).border_color(C.cyan)];
  },
  // A drawer slides out of the shelf toward the person's side.
  drawer: (px, o, b, who, _ctx, assets) => {
    const w = 70;
    const toLeft = o.spots?.[0]?.face === "l";
    const out = toLeft ? b.x0 - w + 26 : b.x0 + b.w - 26;
    const el = div().id(`drawer-${o.id}`).absolute().top(px(b.y0 + b.h * 0.42)).h(px(25)).w(px(w))
      .left(px(who ? out : b.x0 + (b.w - w) / 2)).opacity(who ? 1 : 0)
      .transition("left", { duration: 450, easing: "ease-out" }).transition("opacity", { duration: 250 });
    return [assets.has("drawer") ? el.child(image(`${ART_DIR}/drawer.png`).size_full()) : el.bg(C.edge).border(Math.max(1, px(2))).border_color(C.yellow)];
  },
  holo: (px, o, b, who) => {
    const s = o.kind === "holo-pedestal" ? 64 : 50;
    return [motion(div().absolute().left(px(o.x - s / 2)).top(px(b.y0 - s - 4)).size(px(s)).rounded_full().border(Math.max(1, px(2))).border_color(C.cyan)
      .bg("#00e5ff22").opacity(who ? 0.9 : 0.4), "opacity", { from: who ? 0.55 : 0.25, to: who ? 1 : 0.5, period: who ? 900 : 2200 })];
  },
  // Over the desk's own screen (its upper part): dim red at rest, blinking while someone needs the person.
  alarm: (px, o, b, _who, ctx, assets) => {
    const [x, y, w, h] = assets.has(o.kind) ? [b.x0 + b.w * 0.2, b.y0 + 2, b.w * 0.6, b.h * 0.4] : [b.x0 + 20, b.y0 - 46, b.w - 40, 40];
    const el = div().absolute().left(px(x)).top(px(y)).w(px(w)).h(px(h));
    return [ctx.alarm ? motion(el.bg(C.red).opacity(0.5), "opacity", { from: 0.1, to: 0.7, period: 700 }) : el.bg("#00000066")];
  },
  coffee: (px, o, b, who, ctx, assets) => {
    const mx = b.x0 + b.w - 46;
    const machine = assets.has("coffee-machine")
      ? [image(`${ART_DIR}/coffee-machine.png`).absolute().left(px(mx)).top(px(b.y0 - 52)).w(px(34)).h(px(52))]
      : [box(px, mx, b.y0 - 40, 28, 40, C.edge, C.cyan), box(px, mx + 10, b.y0 - 30, 8, 4, C.yellow)];
    const pouring = who && ctx.now - who.since < POUR_MS;
    return pouring ? [...machine, motion(box(px, mx + 15, b.y0 - 26, 3, 14, "#c58b4a"), "opacity", { from: 0.4, to: 1, period: 300 })] : machine;
  },
};

// Everything of one layer ("back" or "front") of all floors; occupancy: { objectId: occupant }.
export function renderObjects(objects, layer, px, assets, occupancy, ctx) {
  return objects.filter((o) => o.layer === layer).flatMap((o) => {
    const b = objectBox(o);
    const who = occupancy[o.id];
    return [...body(o, px, assets), ...(o.parts ?? []).flatMap((part) => PARTS[part]?.(px, o, b, who, ctx, assets) ?? [])];
  });
}

// The cup in the hand of someone at the bar once the machine is done.
export const holdsCup = (who, now) => Boolean(who) && now - who.since >= POUR_MS;
