// SERVER, RESEARCH and DEV drawn like their approved per-floor mockups: each floor's empty room
// (art/<floor>/shell-v1.png) with every piece of furniture as its own sprite at the mockup's position, measured in
// the mockup's pixels. Scene data for scene-plan.js. The LOBBY lives in lobby-scene.js.
import { scenePlan } from "./scene-plan.js";
import { LOBBY } from "./lobby-scene.js";

const W = 1536;
const H = 1024;
const box = (x, y, w, h) => ({ x, y, w, h });

// The elevator door of the right-hand wall: its two leaves (cut from the mockup) slide apart along the wall.
const sideLift = (x, y, w, h, at) => ({ lift: { ...box(x, y, w, h), art: "lift-leaf", split: true, slope: 0.53, at } });

// A piece of furniture standing on the floor: depth = its foot line, block = the band of floor it covers.
const stand = (id, art, x, y, w, h, extra = {}) => ({ id, art, x, y, w, h, depth: y + h, block: [x, y + h - 40, x + w, y + h + 3], ...extra });
// A part drawn with an object (a door, a drawer, a chair, a hologram): no floor of its own.
const part = (id, art, x, y, w, h, depth, extra) => ({ id, art, x, y, w, h, depth, ...extra });

const RACKS = [[378, 90], [528, 86], [666, 86], [796, 86]];

export const SERVER = Object.freeze({
  floor: "server", no: 4, art: "server", w: W, h: H, shell: "shell-v1",
  walk: { top: 560, bottom: 900, leftTop: 70, leftBottom: 25, rightTop: 1245, rightBottom: 1395 },
  objects: [
    stand("crates", "crates", 95, 358, 167, 190),
    stand("plant", "plant", 265, 388, 70, 152),
    ...RACKS.flatMap(([x, w], i) => [
      stand(`rack-${i + 1}`, "rack", x, 290, w, 265),
      // Closed, the rack shows its glass door; while someone works there the door swings open beside it.
      part(`rack-closed-${i + 1}`, "rack-closed", x, 290, w, 265, 556, { part: "closed", of: `rack-${i + 1}` }),
      part(`rack-door-${i + 1}`, "rack-door", x + w - 6, 316, 30, 225, 557, { part: "swing", of: `rack-${i + 1}` }),
    ]),
    stand("bench", "bench-v2", 930, 372, 280, 188, { glow: [1125, 382, 54, 34], of: "bench" }),
  ],
  signs: [],
  doors: sideLift(1264, 318, 56, 282, { x: 1240, y: 612 }),
  spots: [
    ...RACKS.map(([x, w], i) => ({ id: `rack-${i + 1}-s`, object: `rack-${i + 1}`, x: x + w / 2, y: 598, station: "rack", pose: "use" })),
    { id: "bench-1", object: "bench", x: 1010, y: 602, station: "test", pose: "use" },
    { id: "bench-2", object: "bench", x: 1140, y: 602, station: "test", pose: "use" },
  ],
});

export const RESEARCH = Object.freeze({
  floor: "research", no: 3, art: "research", w: W, h: H, shell: "shell-v1",
  walk: { top: 582, bottom: 805, leftTop: 50, leftBottom: 15, rightTop: 1290, rightBottom: 1385 },
  objects: [
    stand("capsule", "capsule", 65, 440, 180, 140),
    stand("plant", "plant", 258, 465, 47, 95),
    stand("shelf-1", "shelf", 307, 308, 155, 267),
    part("drawer-1", "drawer", 322, 508, 92, 68, 577, { part: "drawer", of: "shelf-1" }),
    stand("shelf-2", "shelf", 483, 308, 155, 267),
    part("drawer-2", "drawer", 498, 508, 92, 68, 577, { part: "drawer", of: "shelf-2" }),
    stand("pedestal", "pedestal", 687, 450, 80, 150),
    part("globe", "globe", 673, 345, 105, 110, 601, { part: "holo", of: "*" }),
    stand("comms-1", "comms", 830, 428, 162, 177, { glow: [893, 455, 72, 50] }),
    stand("comms-2", "comms", 1043, 428, 162, 177, { glow: [1106, 455, 72, 50] }),
  ],
  signs: [],
  doors: sideLift(1236, 315, 92, 280, { x: 1262, y: 615 }),
  spots: [
    { id: "archive-1", object: "shelf-1", x: 385, y: 620, station: "archive", pose: "use" },
    { id: "archive-2", object: "shelf-2", x: 560, y: 620, station: "archive", pose: "use" },
    { id: "comms-1-s", object: "comms-1", x: 911, y: 645, station: "comms", pose: "use" },
    { id: "comms-2-s", object: "comms-2", x: 1124, y: 645, station: "comms", pose: "use" },
  ],
});

// Desks: [desk x, desk w, chair x, chair w] per row; the back row stands further away, so it is drawn smaller.
const BACK = { y: 343, h: 154, chairY: 430, chairH: 90, row: [[268, 147, 300, 58], [455, 157, 472, 60], [655, 143, 683, 58]] };
const FRONT = { y: 585, h: 170, chairY: 685, chairH: 95, row: [[160, 193, 200, 68], [425, 185, 468, 68], [685, 198, 738, 70]] };

function desks() {
  return [BACK, FRONT].flatMap((r, ri) => r.row.flatMap(([x, w, cx, cw], i) => {
    const n = ri * 3 + i + 1;
    return [
      stand(`desk-${n}`, "desk", x, r.y, w, r.h, { glow: [x + w * 0.33, r.y + 6, w * 0.33, r.h * 0.22] }),
      part(`chair-${n}`, "chair", cx, r.chairY, cw, r.chairH, r.chairY + r.chairH, { part: "chair", of: `desk-${n}` }),
    ];
  }));
}

function deskSpots() {
  return [BACK, FRONT].flatMap((r, ri) => r.row.map(([, , cx, cw], i) => {
    const n = ri * 3 + i + 1;
    return { id: `desk-${n}-s`, object: `desk-${n}`, x: cx + cw / 2, y: r.chairY + r.chairH - 2, station: "desk", pose: "sit-type" };
  }));
}

export const DEV = Object.freeze({
  floor: "dev", no: 2, art: "dev", w: W, h: H, shell: "shell-v1",
  walk: { top: 500, bottom: 905, leftTop: 60, leftBottom: 20, rightTop: 1240, rightBottom: 1430 },
  objects: [
    stand("plant", "plant", 85, 343, 80, 152),
    stand("cooler", "cooler", 180, 345, 50, 137),
    ...desks(),
    stand("lamp", "lamp", 820, 318, 40, 180, { pulse: true }),
    stand("meeting", "table", 900, 445, 280, 130),
    part("holo", "holo", 975, 320, 120, 150, 576, { part: "holo", of: "meeting" }),
  ],
  signs: [],
  doors: sideLift(1267, 343, 50, 225, { x: 1235, y: 600 }),
  spots: [
    ...deskSpots(),
    { id: "meeting-1", object: "meeting", x: 885, y: 515, station: "meeting", pose: "talk", face: "r" },
    { id: "meeting-2", object: "meeting", x: 1195, y: 515, station: "meeting", pose: "talk", face: "l" },
    { id: "meeting-3", object: "meeting", x: 1040, y: 615, station: "meeting", pose: "idle" },
  ],
});

const SCENES = { lobby: LOBBY, server: SERVER, research: RESEARCH, dev: DEV };

export const sceneFor = (floorId) => SCENES[floorId] ?? null;
export const planFor = (floorId) => (SCENES[floorId] ? scenePlan(SCENES[floorId]) : null);
