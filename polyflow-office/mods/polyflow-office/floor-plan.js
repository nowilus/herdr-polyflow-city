// The 3/4 view of one floor: a grid of 48 px cells with the back wall, the elevator, furniture and the spots
// where people work. Built from the floor and who is on it (DEV grows a desk group per space). Pure functions
// (no herdr / gpui-kit), so node can test them.
//
// A piece of furniture covers `fw` x `fh` cells from (c, r) and blocks them; its picture stands on the bottom edge
// of those cells, centred. A spot is a free cell where a person stands or sits, with the pose drawn there.

import { CELL, walkable } from "./grid.js";

export { CELL, walkable };
export const COLS = 20;
const MIN_ROWS = 12;
const WALL_ROWS = 2; // rows 0..1 are the back wall
export const LIFT = Object.freeze({ c: 10, r: WALL_ROWS }); // the cell in front of the elevator doors

const DESKS_PER_ROW = 3;
const DESK_STEP = 3; // a desk is 2 cells wide plus a 1-cell gap
const MIN_DESKS = 3;

const obj = (id, kind, c, r, fw = 1, fh = 1, spots = []) => ({ id, kind, c, r, fw, fh, spots });
const spot = (c, r, station, pose, extra = {}) => ({ c, r, station, pose, ...extra });

// Racks and benches; the people stand below them, working with their backs to us.
function serverFloor() {
  const objects = [];
  [2, 3, 4, 5, 6, 7, 12, 13, 14, 15, 16, 17].forEach((c) => objects.push(obj(`rack-${c}`, "server-rack", c, 3, 1, 1, [spot(c, 4, "rack", "use")])));
  [2, 5, 12, 15].forEach((c) => objects.push(obj(`bench-${c}`, "test-bench", c, 8, 2, 1, [spot(c, 9, "test", "use"), spot(c + 1, 9, "test", "use")])));
  objects.push(obj("plant-a", "plant-tube", 0, 3), obj("plant-b", "plant-tube", 19, 3), obj("cooler", "water-cooler", 19, 8));
  const labels = [{ text: "SERVER RACKS", c: 2, r: 2 }, { text: "TEST LAB", c: 2, r: 7 }];
  return { rows: MIN_ROWS, objects, labels };
}

function researchFloor() {
  const objects = [];
  [1, 3, 5, 7].forEach((c) => objects.push(obj(`shelf-${c}`, "data-shelf", c, 3, 2, 1, [spot(c, 4, "archive", "use"), spot(c + 1, 4, "archive", "use")])));
  [1, 3, 5].forEach((c) => objects.push(obj(`shelf-b-${c}`, "data-shelf", c, 7, 2, 1, [spot(c, 8, "archive", "use"), spot(c + 1, 8, "archive", "use")])));
  [12, 14, 16].forEach((c) => objects.push(obj(`comms-${c}`, "comms", c, 3, 2, 1, [spot(c, 4, "comms", "use"), spot(c + 1, 4, "comms", "use")])));
  objects.push(obj("capsule", "capsule", 18, 8), obj("plant-a", "plant-tube", 0, 9), obj("vending", "vending", 19, 3));
  const labels = [{ text: "ARCHIVE", c: 1, r: 2 }, { text: "COMMS", c: 12, r: 2 }];
  return { rows: MIN_ROWS, objects, labels };
}

// DEV: a group of desks per space (its name on a sign), rows added as the space grows; the meeting table on the right.
function devFloor(spaces) {
  const objects = [];
  const labels = [];
  let r = 3;
  for (const { id, name, count } of spaces.length ? spaces : [{ id: "", name: "DEV", count: 0 }]) {
    labels.push({ text: String(name || "SPACE").toUpperCase(), c: 1, r });
    const desks = Math.max(MIN_DESKS, Math.ceil(count / DESKS_PER_ROW) * DESKS_PER_ROW);
    for (let i = 0; i < desks; i++) {
      const c = 1 + (i % DESKS_PER_ROW) * DESK_STEP;
      const dr = r + 1 + Math.floor(i / DESKS_PER_ROW) * 3;
      objects.push(obj(`desk-${id}-${i}`, "desk", c, dr, 2, 1, [spot(c, dr + 1, "desk", "sit", { space: id, dx: CELL / 2 })]));
    }
    r += 1 + Math.ceil(desks / DESKS_PER_ROW) * 3;
  }
  const meeting = [spot(13, 6, "meeting", "idle"), spot(17, 6, "meeting", "idle"), ...[14, 15, 16].map((c) => spot(c, 7, "meeting", "use"))];
  objects.push(obj("meeting", "meeting-table", 14, 5, 3, 2, meeting));
  objects.push(obj("plant-a", "plant-tube", 19, 3), obj("cooler", "water-cooler", 19, 9));
  labels.push({ text: "MEETING", c: 14, r: 2 });
  return { rows: Math.max(MIN_ROWS, r + 1), objects, labels };
}

function lobbyFloor() {
  const objects = [
    obj("help", "help-console", 2, 4, 2, 1, [spot(2, 5, "help", "blocked"), spot(3, 5, "help", "blocked")]),
    obj("bar", "bar", 7, 4, 3, 1, [spot(7, 5, "lounge", "use"), spot(8, 5, "lounge", "use"), spot(9, 5, "lounge", "use")]),
    obj("couch-a", "couch", 13, 8, 2, 1, [spot(13, 9, "lounge", "idle"), spot(14, 9, "lounge", "idle")]),
    obj("couch-b", "couch", 16, 8, 2, 1, [spot(16, 9, "lounge", "idle"), spot(17, 9, "lounge", "idle")]),
    obj("vending", "vending", 17, 3), obj("capsule", "capsule", 19, 3),
    obj("plant-a", "plant-tube", 0, 3), obj("plant-b", "plant-tube", 11, 8),
  ];
  const labels = [{ text: "HELP", c: 2, r: 3 }, { text: "BAR", c: 7, r: 3 }, { text: "LOUNGE", c: 13, r: 7 }];
  return { rows: MIN_ROWS, objects, labels };
}

const key = (c, r) => `${c},${r}`;

// The plan of a floor. spaces (DEV only): [{ id, name, count }] in the order to draw them.
export function floorPlan(floorId, spaces = []) {
  const base = floorId === "server" ? serverFloor() : floorId === "research" ? researchFloor() : floorId === "dev" ? devFloor(spaces) : lobbyFloor();
  const blocked = new Set();
  for (let c = 0; c < COLS; c++) for (let r = 0; r < WALL_ROWS; r++) blocked.add(key(c, r));
  for (const o of base.objects) for (let c = o.c; c < o.c + o.fw; c++) for (let r = o.r; r < o.r + o.fh; r++) blocked.add(key(c, r));
  const spots = base.objects.flatMap((o) => o.spots.map((s, i) => ({ ...s, id: `${o.id}#${i}`, object: o.id })));
  return {
    floor: floorId, cols: COLS, rows: base.rows, objects: base.objects, labels: base.labels, spots, blocked, lift: LIFT, spawn: LIFT,
    toPx: cellPx,
    toCell: (x, y) => ({ c: Math.round((x - CELL / 2) / CELL), r: Math.round((y - CELL + 6) / CELL) }),
  };
}


// A cell's centre on the floor (where feet stand), in plan px.
export const cellPx = (c, r) => ({ x: c * CELL + CELL / 2, y: r * CELL + CELL - 6 });
