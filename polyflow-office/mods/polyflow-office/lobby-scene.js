// The LOBBY drawn like its approved mockup: the empty room (art/lobby/shell-v1.png) with every piece of furniture
// as its own sprite at the mockup's position, the street door and the elevator. Scene data (scene-plan.js).

import { ROOM, scenePlan } from "./scene-plan.js";

// Sprites (art/lobby/<art>.png). x, y: top-left; depth: the feet line they stand on (people behind it are hidden
// by it, people in front of it hide it). Wall things have depth 0. block: the floor band nobody walks through.
const OBJECTS = Object.freeze([
  { id: "back-bar", art: "back-bar", x: 908, y: 249, w: 193, h: 111, depth: 0 },
  { id: "neon", art: "neon", x: 466, y: 290, w: 105, h: 51, depth: 0, pulse: true },
  { id: "poster", art: "poster", x: 812, y: 246, w: 78, h: 67, depth: 0 },
  { id: "vending", art: "vending", x: 88, y: 280, w: 95, h: 191, depth: 470, block: [88, 430, 182, 472] },
  { id: "reception", art: "reception", x: 223, y: 380, w: 185, h: 102, depth: 482, block: [223, 440, 407, 486] },
  { id: "alert-screen", art: "alert-screen", x: 260, y: 318, w: 95, h: 82, depth: 483, part: "alarm" },
  { id: "sofa", art: "sofa", x: 432, y: 373, w: 164, h: 97, depth: 470, block: [432, 438, 598, 474] },
  { id: "side-table", art: "side-table", x: 603, y: 373, w: 40, h: 95, depth: 468, block: [603, 448, 645, 470], pulse: true },
  { id: "plant", art: "plant", x: 806, y: 369, w: 56, h: 93, depth: 462, block: [806, 430, 862, 466] },
  { id: "bar", art: "bar-counter", x: 875, y: 380, w: 260, h: 119, depth: 499, block: [875, 452, 1140, 502] },
  { id: "coffee", art: "coffee", x: 1050, y: 333, w: 42, h: 62, depth: 500, part: "coffee" },
]);

// Signs drawn by the mod (same plates as in the mockup).
const SIGNS = Object.freeze([
  { text: "HELP", x: 265, y: 252 },
  { text: "LOUNGE", x: 472, y: 242 },
  { text: "BAR", x: 965, y: 222 },
]);

// Doors: two leaves sliding apart inside the doorway. at: the floor point in front of the door.
const DOORS = Object.freeze({
  entrance: { x: 660, y: 278, w: 105, h: 164, art: "entrance-leaf", split: true, at: { x: 712, y: 492 } },
  lift: { ...ROOM.lift, art: "lift-leaf", split: true },
});

// Where people work or rest, in picture px. dy lifts the sprite (a sofa seat); face: which way they look.
const SPOTS = [
  { id: "help-1", x: 330, y: 532, station: "help", pose: "talk", face: "r" },
  { id: "help-2", x: 398, y: 536, station: "help", pose: "idle", face: "l" },
  { id: "sofa-1", x: 486, y: 484, dy: -46, station: "lounge", pose: "sit-relax", face: "r" },
  { id: "sofa-2", x: 556, y: 484, dy: -46, station: "lounge", pose: "sit-relax", face: "r" },
  { id: "bar-1", x: 958, y: 540, station: "lounge", pose: "talk", face: "r", bar: true },
  { id: "bar-2", x: 1062, y: 540, station: "lounge", pose: "talk", face: "l", bar: true },
  { id: "table-1", x: 652, y: 540, station: "lounge", pose: "idle", face: "l" },
  { id: "vending-1", x: 214, y: 520, station: "lounge", pose: "idle", face: "l" },
];

export const LOBBY = Object.freeze({
  floor: "lobby", no: 1, art: "lobby", w: ROOM.w, h: ROOM.h, shell: "shell-v1", walk: ROOM.walk,
  objects: OBJECTS, signs: SIGNS, doors: DOORS, spots: SPOTS,
});

export const lobbyPlan = () => scenePlan(LOBBY);
