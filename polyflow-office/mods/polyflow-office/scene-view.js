// A floor drawn from its approved picture: the empty room, furniture sprites and people sorted by where their
// feet are, doors that slide open when someone comes near, and the parts that react to whoever works there
// (rack doors, drawers, chairs, holograms, the reception alarm, the coffee machine). Picture px times the camera scale.
import { div, image } from "gpui-kit";
import { jobIn, spritePath } from "./lib.js";
import { floorPose } from "./floor-crowd.js";
import { cameraFrame } from "./camera.js";
import { contactShadow, motion, nameTag, personTip } from "./labels.js";
import { POUR_MS, openDoors } from "./scene-plan.js";

const ART_ROOT = "mods/polyflow-office/art";
const MINI_DIR = "mods/polyflow-office/art/mini";
const SIGN_FONT = "Silkscreen";
const PERSON = { w: 100, h: 133 }; // the side-view minis at the mockup's scale (about as tall as the bar counter)
const CAST = { w: 130, h: 170, dir: "mods/polyflow-office/art/people" }; // the floor-view people (150 px standing)
// A spot's pose -> the floor-view animation (talk turns to its side).
const CAST_POSE = { idle: "idle", talk: "talk", use: "use", "sit-relax": "sit-sofa", "sit-type": "sit-desk" };
const DOOR_MS = 450;

// The picture to draw: the big floor-view person when the job has one (walking in four directions), else the mini
// (walking sideways only; an up/down leg keeps the side it was heading to).
function sprite(view, agent, p, { pose, at }) {
  const job = jobIn(agent.tab_name, view.assigned);
  const walking = pose.startsWith("walk-");
  const cast = job ? view.cast?.[job] : null;
  if (cast) {
    let name = walking ? pose : agent.status === "blocked" ? "blocked" : CAST_POSE[p.goal.pose] ?? "idle";
    if (name === "talk") name = `talk-${p.goal.face === "l" ? "l" : "r"}`;
    return { src: `${CAST.dir}/${job}-${cast}-${name}.gif`, at, walking, size: CAST, big: true };
  }
  let facing = p.goal.face ?? "r";
  if (walking) {
    const end = p.walk.points[p.walk.points.length - 1];
    facing = at.facing === "l" || at.facing === "r" ? at.facing : end.x < at.x ? "l" : "r";
  }
  const shown = walking ? "walk" : agent.status === "blocked" ? "talk" : p.goal.pose;
  if (job && view.minis?.jobs?.has(job)) {
    const v = view.minis.versions?.[job];
    return { src: `${MINI_DIR}/${job}${v ? `-${v}` : ""}-${shown}-${facing}.gif`, at, walking, size: PERSON };
  }
  return { src: spritePath(job, agent.status), at, walking, size: PERSON };
}

// Is any part of the person's box (here or where the leg ends, plus a margin) inside the viewport?
function inView(view, s, x, y, size, leg) {
  const { cam, size: port } = view;
  if (!port) return true;
  const pad = size.w * s;
  const spans = (px, py) => {
    const left = cam.x + (px - size.w / 2) * s;
    const top = cam.y + (py - size.h) * s;
    return left + size.w * s + pad > 0 && left - pad < port.w && top + (size.h + 18) * s + pad > 0 && top - pad < port.h;
  };
  return spans(x, y) || (leg !== null && spans(leg.x, leg.y));
}

function person(view, s, address, p, t, now, pose) {
  const agent = view.agentsBy[address];
  if (!agent) return null;
  const { src, at, walking, size, big } = sprite(view, agent, p, pose);
  if (!src) return null;
  // The raise of a sitting mini is far inside the margin, so it is left out here.
  if (!inView(view, s, at.x, at.y, size, walking && view.mounted.has(address) ? p.walk.points[at.leg] : null)) return null;
  // Minis lie on the sofa seat, lifted onto it; the big people sit on it with their feet on the floor.
  const raise = walking || big ? 0 : p.goal.raise ?? 0;
  const mounted = view.mounted.has(address);
  const leg = walking && mounted ? p.walk.points[at.leg] : null;
  const tx = leg ? leg.x : at.x;
  const ty = leg ? leg.y : at.y;
  const ms = leg ? Math.max(1, Math.round(p.walk.start + p.walk.legs[at.leg] - now)) : 1;
  const bubble = agent.status === "blocked" ? "!" : agent.status === "done" ? "zZz" : null;
  const cup = !walking && p.goal.bar && now - p.walk.end > POUR_MS;
  const el = div().id(`lp-${address}`).absolute().flex().flex_col().items_center()
    .left((tx - size.w / 2) * s).top((ty - raise - size.h) * s).w(size.w * s).h((size.h + 18) * s)
    .transition("left", { duration: ms, easing: "linear" }).transition("top", { duration: ms, easing: "linear" })
    .cursor_pointer().on_click((_e, cx) => view.onPerson(address, cx))
    .on_mouse_down("right", (_e, cx) => (view.onPersonMenu ?? view.onPerson)(address, cx))
    .tooltip(personTip(agent, address, view.doing?.(address)))
    .child(contactShadow((size.w / 2) * s, (size.h - 4) * s, size.w * 0.5 * s, 14 * s))
    .child(image(src).w(size.w * s).h(size.h * s))
    .child(nameTag(agent, address, t, Math.max(90, 160 * s)))
    .when(Boolean(bubble), (x) => x.child(
      motion(div().absolute().top(-18 * s).px(5 * s).bg(agent.status === "blocked" ? t.blocked : t.popover).text_color("#ffffff")
        .font_family(SIGN_FONT).text_size(Math.max(10, 13 * s)).child(bubble), "opacity", { from: 0.6, to: 1, period: 900 })))
    .when(cup, (x) => x.child(div().absolute().left(((p.goal.face === "l" ? size.w * 0.28 : size.w * 0.62)) * s).top(size.h * 0.52 * s)
      .w(9 * s).h(11 * s).bg("#e8e8e8").border(Math.max(1, s)).border_color("#c58b4a")));
  // A walker glides to the end of the leg until the next render, so it is sorted by where the leg ends.
  return { depth: leg ? leg.y : at.y, el };
}

// Who works where right now: object ids with a settled person, and when they sat down.
function occupied(view, now) {
  const out = new Map();
  for (const p of Object.values(view.people)) {
    if (!p.leaving && now >= p.walk.end && p.goal.object) out.set(p.goal.object, p.walk.end);
  }
  return out;
}

// Furniture as depth-sorted items. A part follows the object it belongs to (`of`): a rack door swings away and a
// drawer slides out while someone works there, a chair makes room for the sitter, holograms glow brighter.
function furniture(view, s, now, art) {
  const scene = view.plan.scene;
  const busy = occupied(view, now);
  const blocked = Object.keys(view.people).some((a) => view.agentsBy[a]?.status === "blocked");
  const pouring = Object.values(view.people).some((p) => p.goal.bar && !p.leaving && now >= p.walk.end && now - p.walk.end < POUR_MS);
  return scene.objects.map((o) => {
    // of: "*" reacts to anyone working on the floor (the research globe).
    const used = o.of === "*" ? busy.size > 0 : busy.has(o.of ?? o.id);
    const ms = (d) => (view.rescaled ? 1 : d); // a zoom or resize jumps, it doesn't replay the motion
    let img = image(`${art}/${o.art}.png`).absolute().left(o.x * s).top(o.y * s).w(o.w * s).h(o.h * s);
    img = img.id(`img-${o.id}`);
    if (o.pulse) img = motion(img, "opacity", { from: 0.75, to: 1, period: 1900 + (o.x % 7) * 230 });
    if (o.part === "holo") img = motion(img.opacity(used ? 1 : 0.55), "opacity", used ? { from: 0.7, to: 1, period: 900 } : { from: 0.35, to: 0.7, period: 2200 });
    if (o.part === "closed") img = img.opacity(used ? 0 : 1).transition("opacity", { duration: ms(450) });
    // A door seen edge-on as it swings open: it grows from the hinge while the closed front fades.
    if (o.part === "swing") img = img.w((used ? o.w : 0) * s).opacity(used ? 1 : 0)
      .transition("width", { duration: ms(450), easing: "ease-out" }).transition("opacity", { duration: ms(300) });
    if (o.part === "drawer") img = img.opacity(used ? 1 : 0).transition("opacity", { duration: ms(350) });
    if (o.part === "chair") img = img.opacity(used ? 0 : 1).transition("opacity", { duration: ms(250) });
    const parts = [img];
    if (o.part === "alarm" && blocked) {
      parts.push(motion(div().id(`alarm-${o.id}`).absolute().left((o.x + 8) * s).top((o.y + 6) * s).w((o.w - 16) * s).h((o.h - 32) * s).bg("#ff2a6d").opacity(0.35), "opacity", { from: 0.05, to: 0.55, period: 700 }));
    }
    if (o.part === "coffee" && pouring) {
      parts.push(motion(div().id(`pour-${o.id}`).absolute().left((o.x + o.w / 2 - 1) * s).top((o.y + o.h * 0.45) * s).w(Math.max(1, 3 * s)).h(14 * s).bg("#c58b4a"), "opacity", { from: 0.4, to: 1, period: 300 }));
    }
    if (o.glow && used) {
      const [gx, gy, gw, gh] = o.glow;
      parts.push(motion(div().id(`glow-${o.id}`).absolute().left(gx * s).top(gy * s).w(gw * s).h(gh * s).bg("#00e5ff").opacity(0.2), "opacity", { from: 0.08, to: 0.3, period: 1200 }));
    }
    return { depth: o.depth, el: div().id(`obj-${o.id}`).absolute().left(0).top(0).children(parts) };
  });
}

// A door: two leaves inside its doorway, slid apart (along the wall: `slope` for a side wall) while anyone is near.
function door(view, s, id, d, open, art) {
  const ms = view.rescaled ? 1 : DOOR_MS;
  const half = d.w / 2;
  const slope = d.slope ?? 0;
  const leaf = (side) => {
    const shift = open ? (side === "l" ? -half + 3 : half - 3) : 0;
    return div().id(`${id}-leaf-${side}`).absolute().w(half * s).h(d.h * s)
      .left(((side === "l" ? 0 : half) + shift) * s).top(shift * slope * s)
      .transition("left", { duration: ms, easing: "ease-in-out" }).transition("top", { duration: ms, easing: "ease-in-out" })
      .child(image(`${art}/${d.split ? `${d.art}-${side}` : d.art}.png`).size_full());
  };
  return div().absolute().left(d.x * s).top(d.y * s).w(d.w * s).h(d.h * s).overflow_hidden().child(leaf("l")).child(leaf("r"));
}

function signs(scene, s, t) {
  return (scene.signs ?? []).map((g) => div().absolute().left(g.x * s).top(g.y * s).px(8 * s).py(3 * s).bg("#0b0d10e6").border(Math.max(1, 2 * s)).border_color(t.accent)
    .font_family(SIGN_FONT).text_size(Math.max(8, 17 * s)).text_color(t.accent).child(g.text));
}

// view: like renderFloor's, plus minis ({ jobs, versions }).
export function renderScene(view, t) {
  const { cam } = view;
  const s = cam.s;
  const now = view.now;
  const scene = view.plan.scene;
  const art = `${ART_ROOT}/${scene.art}`;
  const doors = Object.entries(scene.doors);
  const poses = new Map(Object.values(view.people).map((p) => [p, floorPose(p, now)])); // once per person
  const open = openDoors(scene, view.people, (p) => poses.get(p).at);
  const display = scene.doors.lift.display;
  const items = [...furniture(view, s, now, art), ...Object.entries(view.people).map(([a, p]) => person(view, s, a, p, t, now, poses.get(p))).filter(Boolean)]
    .sort((a, b) => a.depth - b.depth);
  const world = div().id("scene-world").absolute().left(cam.x).top(cam.y).w(scene.w * s).h(scene.h * s)
    .child(image(`${art}/${scene.shell}.png`).absolute().left(0).top(0).w(scene.w * s).h(scene.h * s))
    .children(doors.map(([id, d]) => door(view, s, id, d, open[id], art)))
    .when(Boolean(display), (x) => x.child(div().absolute().left(display.x * s).top(display.y * s).w(display.w * s).h(display.h * s).flex().items_center().justify_center()
      .font_family(SIGN_FONT).text_size(Math.max(8, 18 * s)).text_color(t.working).child(String(scene.no))))
    .children(signs(scene, s, t))
    .children(items.map((i) => i.el));
  return cameraFrame(view, world, t);
}
