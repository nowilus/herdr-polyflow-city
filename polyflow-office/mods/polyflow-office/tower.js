// The tower overview, drawn as layers: the empty building shell, furniture behind people, the floors' hover/click
// zones with their signs, the people (walking on a floor or riding in the cabin), the cabin's front frame, the
// elevator doors of every floor and furniture in front of people. Picture px (tower-scene.js), scaled to the fit.
import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { jobIn, spritePath } from "./lib.js";
import { poseOf, presence, xAt } from "./crowd.js";
import { DOOR_MS, doorsOpen } from "./lift.js";
import { ENTRANCE_X, FLOORS, FLOOR_ORDER, LIFT, OBJECTS, ROOM, SCENE_H, SCENE_W, cabinTop } from "./tower-scene.js";
import { ART_DIR, holdsCup, renderObjects } from "./tower-props.js";
import { motion, nameTag, personTip } from "./labels.js";

export const TOWER = Object.freeze({ w: SCENE_W, h: SCENE_H });

const SIGN_FONT = "Silkscreen";
const MINI = { w: 84, h: 112, dir: "mods/polyflow-office/art/mini" };
const FRONT = { w: 84, h: 112 };
const BUBBLE = { blocked: "!", talk: "..." };
const FLOOR_NO = { server: 4, research: 3, dev: 2, lobby: 1 };
const SHAFT = { x0: LIFT.x - 62, x1: LIFT.x + 62 };

const rect = (px, x, y, w, h, bg) => div().absolute().left(px(x)).top(px(y)).w(px(w)).h(px(h)).bg(bg);

// Until the painted shell is installed: night sky, slabs, empty rooms with ceiling lights, the glass shaft.
function shellStandIn(px, t) {
  const els = [rect(px, 0, 0, SCENE_W, SCENE_H, "#07090c"), rect(px, ROOM.x0 - 30, FLOORS.server.top - 40, SHAFT.x1 - ROOM.x0 + 60, 40, "#1c222a")];
  for (const id of FLOOR_ORDER) {
    const f = FLOORS[id];
    els.push(rect(px, ROOM.x0, f.top, ROOM.x1 - ROOM.x0, f.y - f.top, "#10141a"));
    els.push(rect(px, ROOM.x0 - 30, f.y, SHAFT.x1 - ROOM.x0 + 60, 20, "#1c222a"), rect(px, ROOM.x0 - 30, f.y, SHAFT.x1 - ROOM.x0 + 60, 3, `${t.accent}99`));
    for (let x = ROOM.x0 + 80; x < ROOM.x1 - 60; x += 200) els.push(rect(px, x, f.top + 4, 90, 4, `${t.accent}cc`));
  }
  const top = FLOORS.server.top - 40;
  els.push(rect(px, SHAFT.x0, top, SHAFT.x1 - SHAFT.x0, FLOORS.lobby.y - top, "#0a1a20").border(Math.max(1, px(3))).border_color("#00e5ff66"));
  els.push(rect(px, 0, FLOORS.lobby.y + 20, SCENE_W, SCENE_H - FLOORS.lobby.y - 20, "#0b0e12"));
  return els;
}

// minis: { jobs: Set, versions: { job: "v2" } }; a redrawn job gets new file names (Herdr caches images by name).
function personSprite(job, agentStatus, pose, facing, minis) {
  if (job && minis.jobs.has(job)) {
    const version = minis.versions[job];
    return { src: `${MINI.dir}/${job}${version ? `-${version}` : ""}-${pose}-${facing}.gif`, ...MINI };
  }
  const src = spritePath(job, agentStatus);
  return src ? { src, ...FRONT } : null;
}

// Where the cabin is headed and how long until it gets there.
function cabinMotion(lift, now) {
  const moving = lift.phase === "moving";
  return { floor: moving ? lift.to : lift.floor, left: moving ? Math.max(1, Math.round(lift.end - now)) : 1 };
}

function cabinLayer(view, px, part) {
  const { floor, left } = cabinMotion(view.world.lift, view.now);
  const { w, h } = LIFT.cabin;
  const el = div().id(`cabin-${part}`).absolute().left(px(LIFT.x - w / 2)).top(px(cabinTop(floor))).w(px(w)).h(px(h))
    .transition("top", { duration: left, easing: "ease-in-out" });
  const asset = part === "back" ? "lift-cabin" : "lift-front";
  if (view.assets.has(asset)) return el.child(image(`${ART_DIR}/${asset}.png`).size_full());
  if (part === "back") return el.bg("#12262e").child(div().absolute().left(px(10)).top(px(10)).w(px(w - 20)).h(px(4)).bg("#00e5ff"));
  return el.border(Math.max(2, px(5))).border_color("#fcee0a");
}

// The doorway of one floor: two glass leaves sliding apart while the cabin stands there, the floor display above.
function doorway(view, px, floorId, t) {
  const { x, w, h, display } = LIFT.door;
  const y = FLOORS[floorId].y;
  const open = doorsOpen(view.world.lift, floorId);
  const half = w / 2;
  const art = view.assets.has("lift-leaf");
  const leaf = (side) => {
    const el = div().id(`leaf-${floorId}-${side}`).absolute().top(0).w(px(half)).h_full()
      .left(px(side === "l" ? (open ? -half + 3 : 0) : open ? w - 3 : half))
      .transition("left", { duration: DOOR_MS, easing: "ease-in-out" });
    return art ? el.child(image(`${ART_DIR}/lift-leaf.png`).size_full()) : el.bg("#0f2d36e0").border(Math.max(1, px(2))).border_color("#00e5ff99");
  };
  const lift = view.world.lift;
  const shown = lift.phase === "moving" ? lift.to : lift.floor;
  const fx = x - half - 10;
  const fy = y - h - display;
  const frame = view.assets.has("lift-frame")
    ? image(`${ART_DIR}/lift-frame.png`).absolute().left(px(fx)).top(px(fy)).w(px(w + 20)).h(px(h + display))
    : div().absolute().left(px(fx)).top(px(fy)).w(px(w + 20)).h(px(h + display)).border(Math.max(1, px(3))).border_color(t.accent);
  return [
    div().absolute().left(px(x - half)).top(px(y - h)).w(px(w)).h(px(h)).overflow_hidden().child(leaf("l")).child(leaf("r")),
    frame,
    div().absolute().left(px(x - 14)).top(px(fy + 4)).w(px(28)).h(px(display - 10))
      .flex().items_center().justify_center().font_family(SIGN_FONT).text_size(Math.max(7, px(15))).text_color(lift.phase === "moving" ? t.accent : t.working)
      .when(lift.phase === "moving", (el) => motion(el, "opacity", { from: 0.4, to: 1, period: 600 }))
      .child(String(FLOOR_NO[shown])),
  ];
}

function floorZone(view, px, entry, t, counts) {
  const { floor, agents } = entry;
  const present = counts.here[floor.id] ?? 0;
  const coming = counts.coming[floor.id] ?? 0;
  const f = FLOORS[floor.id];
  const blocked = agents.filter((x) => x.agent.status === "blocked").length;
  const done = agents.filter((x) => x.agent.status === "done").length;
  const hovered = view.hover === floor.id;
  const shown = view.shownCount?.[floor.id] ?? 0;
  return div().id(`floor-${floor.id}`).absolute().left(px(ROOM.x0)).top(px(f.top)).w(px(ROOM.x1 - ROOM.x0)).h(px(f.y - f.top))
    .border(hovered ? 2 : 0).border_color(t.accent).bg(hovered ? "#fcee0a10" : "#00000000").cursor_pointer()
    .on_hover((h, cx) => view.onHover(h ? floor.id : view.hover === floor.id ? null : view.hover, cx))
    .on_click((_e, cx) => view.onPick(floor.id, cx))
    .child(
      v_flex().absolute().left(px(22)).top(px(18)).gap(px(6)).px(px(10)).py(px(6)).bg(`${t.background}d9`).border_l(2).border_color(t.accent)
        .child(div().font_family(SIGN_FONT).text_size(Math.max(9, px(22))).text_color(t.accent).child(`0${floor.no} // ${floor.label}`))
        .child(
          h_flex().gap(px(14)).font_family(SIGN_FONT).text_size(Math.max(8, px(16)))
            .child(div().text_color(present ? t.foreground : t.dim).child(`${present} ${present === 1 ? "AGENT" : "AGENTS"}`))
            .when(coming > 0, (el) => el.child(div().text_color(t.working).child(`+${coming} ON THE WAY`)))
            .when(blocked > 0, (el) => el.child(motion(div().px(px(6)).bg(t.blocked).text_color("#ffffff").child(`! ${blocked}`), "opacity", { from: 0.6, to: 1, period: 900 })))
            .when(done > 0, (el) => el.child(div().text_color(t.done).child(`DONE ${done}`))),
        ),
    )
    // Hovered: say what a click does.
    .when(hovered, (el) => el.child(
      div().absolute().right(px(30)).bottom(px(14)).px(8).py(4).bg(t.accent).font_family("Chakra Petch").text_size(12).text_color("#0b0d10")
        .child("OPEN FLOOR >"),
    ))
    // The lobby's front door: where a new agent comes in, so that is where one is invited.
    .when(floor.id === "lobby" && Boolean(view.onInvite), (el) => el.child(
      div().id("invite").absolute().left(px(ENTRANCE_X - ROOM.x0 - 90)).top(px(18)).px(px(10)).py(px(5)).bg(`${t.background}d9`)
        .border(1).border_color(t.accent).font_family(SIGN_FONT).text_size(Math.max(10, px(18))).text_color(t.accent).cursor_pointer()
        .hover((s) => s.bg(t.accent).text_color("#0b0d10"))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); view.onInvite(cx); })
        .tooltip("Start a new agent: it walks in through this door")
        .child("+ INVITE AGENT"),
    ))
    // More people than drawn: "+N" lists everyone of the floor.
    .when(agents.length > shown, (el) => el.child(
      div().id(`more-${floor.id}`).absolute().right(px(120)).top(px(18)).px(px(8)).py(px(4)).bg(`${t.background}d9`).border(1).border_color(t.border)
        .font_family(SIGN_FONT).text_size(Math.max(10, px(20))).text_color(t.foreground).cursor_pointer()
        .hover((s) => s.border_color(t.accent).text_color(t.accent))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); view.onMore(floor.id, cx); })
        .tooltip("Everyone on this floor")
        .child(`+${agents.length - shown}`),
    ));
}

// Something in the hand: a cup at the bar once poured, a data disk at the archive.
function handItem(p, now, px, sprite) {
  const object = p.phase === "at" ? p.goal?.object ?? "" : "";
  const cup = object === "bar" && holdsCup({ since: p.since }, now);
  const disk = object.startsWith("shelf-");
  if (!cup && !disk) return null;
  const dx = p.facing === "l" ? -30 : 18;
  return div().absolute().left(px(sprite.w / 2 + dx)).top(px(sprite.h * 0.42)).w(px(cup ? 10 : 12)).h(px(cup ? 12 : 9))
    .bg(cup ? "#e8e8e8" : "#00e5ff").border(Math.max(1, px(1))).border_color(cup ? "#c58b4a" : "#fcee0a");
}

// One person, one element for its whole life (stable id), so walking, riding and stepping out all glide.
// part "body": the figure; part "label": its name tag (and bubble) in the same box, drawn in the top layer so no
// furniture, lift glass or door ever covers it.
function person(view, px, address, p, t, part) {
  const agent = view.agentsBy[address];
  const pose = poseOf(p);
  if (!agent) return null;
  const sprite = personSprite(jobIn(agent.tab_name, view.assigned), agent.status, pose, p.facing ?? "r", view.minis);
  if (!sprite) return null;
  const mounted = view.mounted.has(address);
  const now = view.now;
  let x;
  let base;
  let leftMs = 1;
  let topMs = 160;
  if (p.phase === "ride") {
    const motion = cabinMotion(view.world.lift, now);
    x = LIFT.x + p.seat;
    base = cabinTop(motion.floor) + LIFT.cabin.h;
    topMs = motion.left;
  } else {
    const glides = (p.phase === "walk" || p.phase === "enter") && mounted;
    x = glides ? p.toX : xAt(p, now);
    leftMs = glides ? Math.max(1, Math.round(p.end - now)) : 1;
    base = FLOORS[p.floor].y - (p.dy ?? 0);
  }
  const box = v_flex().id(`${part === "label" ? "tag" : "who"}-${address}`).absolute().items_center()
    .left(px(x - sprite.w / 2)).top(px(base - sprite.h)).w(px(sprite.w)).h(px(sprite.h + 22))
    .transition("left", { duration: leftMs, easing: "linear" })
    .transition("top", { duration: topMs, easing: p.phase === "ride" ? "ease-in-out" : "ease-out" });
  // Clicks: on the figure, and on the name tag itself. The label's box covers the figure too, so only its tag
  // listens (else one click would reach both layers and open two cards); each stops the press it handled.
  const clicks = (el) => el.cursor_pointer()
    .on_click((_e, cx) => { cx.stop_propagation(); view.onPerson(address, cx); })
    .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); (view.onPersonMenu ?? view.onPerson)(address, cx); })
    .tooltip(personTip(agent, address, view.doing?.(address)));
  if (part === "label") {
    const bubble = agent.status === "blocked" ? BUBBLE.blocked : pose === "talk" ? BUBBLE.talk : null;
    return box
      .when(Boolean(bubble), (el) =>
        el.child(motion(div().absolute().top(px(-26)).px(px(6)).bg(agent.status === "blocked" ? t.blocked : t.popover).text_color("#ffffff").font_family(SIGN_FONT).text_size(Math.max(8, px(16))).child(bubble), "opacity", { from: 0.6, to: 1, period: 900 })))
      .child(div().flex_none().h(px(sprite.h)))
      .child(clicks(div().id(`tag-click-${address}`).flex_none().child(nameTag(agent, address, t, 150))));
  }
  const item = handItem(p, now, px, sprite);
  return clicks(box)
    .child(image(sprite.src).w(px(sprite.w)).h(px(sprite.h)))
    .when(Boolean(item), (el) => el.child(item));
}

// Who rides (or steps into) the cabin: drawn behind its front glass; everyone else stands in front of the room.
const inCabin = (p) => p.phase === "ride" || p.phase === "enter";

// view: { fit, floors (byFloor), world {people, lift}, occupancy, assets, minis, mounted, assigned, agentsBy, hover, now,
//         shownCount, onPerson, onHover, onPick, onInvite }
export function renderTower(view, t) {
  const k = view.fit.w / SCENE_W;
  const px = (v) => v * k;
  const lobby = view.floors.find((f) => f.floor.id === "lobby");
  const ctx = { now: view.now, alarm: (lobby?.agents ?? []).some((e) => e.agent.status === "blocked") };
  const shell = view.assets.has("shell") ? [image(`${ART_DIR}/shell.png`).absolute().left(0).top(0).w(view.fit.w).h(view.fit.h)] : shellStandIn(px, t);
  const everyone = Object.entries(view.world.people);
  const bodies = (pick) => everyone.filter(([, p]) => pick(p)).map(([address, p]) => person(view, px, address, p, t, "body")).filter(Boolean);
  const labels = everyone.map(([address, p]) => person(view, px, address, p, t, "label")).filter(Boolean);
  const counts = presence(view.floors, view.world.people);
  return div().id("tower").relative().w(view.fit.w).h(view.fit.h).flex_none().overflow_hidden()
    .children(shell)
    .children(renderObjects(OBJECTS, "back", px, view.assets, view.occupancy, ctx))
    .child(cabinLayer(view, px, "back"))
    .children(view.floors.map((entry) => floorZone(view, px, entry, t, counts)))
    .children(bodies(inCabin))
    .child(cabinLayer(view, px, "front"))
    .children(FLOOR_ORDER.flatMap((id) => doorway(view, px, id, t)))
    .children(renderObjects(OBJECTS, "front", px, view.assets, view.occupancy, ctx))
    // The people in the rooms stand in front of everything, and every name tag is on top of it all.
    .children(bodies((p) => !inCabin(p)))
    .children(labels);
}
