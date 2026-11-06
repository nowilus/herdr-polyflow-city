// The tower overview as a scene: the empty building shell, then every piece of furniture as its own object with
// the spots where people stand, sit or work. Pure data plus small lookups (no herdr / gpui-kit), so node can test it.
// Coordinates are the picture's pixels (1536x1024). An object's x is its centre, its foot stands on the floor line;
// a spot's dx is from the object's centre and dy lifts the person's feet (a sofa seat, a stool).
// Scale: a standing person is 112 px tall (1.75 m), so 64 px is a metre.

export const SCENE_W = 1536;
export const SCENE_H = 1024;

// Top to bottom. top: the ceiling, y: the floor line people stand on.
export const FLOORS = Object.freeze({
  server: { top: 118, y: 294 },
  research: { top: 314, y: 490 },
  dev: { top: 510, y: 686 },
  lobby: { top: 706, y: 896 },
});
export const FLOOR_ORDER = Object.freeze(["server", "research", "dev", "lobby"]);

export const ROOM = Object.freeze({ x0: 140, x1: 1290 });

// The glass elevator: the cabin rides in the shaft right of the rooms; each floor has a doorway with two leaves.
export const LIFT = Object.freeze({
  x: 1386, // cabin centre, in the shell's glass shaft
  cabin: { w: 84, h: 126 },
  door: { x: 1302, w: 56, h: 128, display: 30 }, // doorway in the wall between room and shaft; the floor display above
  waitX: 1250, // where people wait for the cabin, facing the doors
  waitGap: 34, // the next one waits this much further left
  capacity: 2,
  seats: [-10, 10], // where riders stand in the cabin, from its centre
});

// Where new people come in: the lobby's front door.
export const ENTRANCE_X = 750;

const spot = (station, dx, pose, face = "r", dy = 0) => ({ station, dx, dy, pose, face });

// kind: what the renderer draws (asset or stand-in). layer: drawn behind people ("back") or over them ("front").
// parts: pieces that change with who is at the object (a screen, a rack door, a drawer).
export const OBJECTS = Object.freeze([
  // 04 SERVER: four racks with room to stand between them, a test bench by the lift.
  ...[540, 680, 820, 960].map((x, i) => ({
    id: `rack-${i + 1}`, floor: "server", kind: "server-rack", x, w: 54, h: 108, layer: "back",
    parts: ["rack-door", "leds"], spots: [spot("rack", -50, "use", "r")],
  })),
  { id: "test-bench", floor: "server", kind: "test-bench", x: 1130, w: 124, h: 78, layer: "back",
    parts: ["screen"], spots: [spot("test", -78, "use", "r"), spot("test", 78, "use", "l")] },
  { id: "server-plant-1", floor: "server", kind: "plant", x: 330, w: 44, h: 53, layer: "back", spots: [] },
  { id: "server-panel", floor: "server", kind: "status-panel", x: 1060, w: 40, h: 51, lift: 110, layer: "back", spots: [] },
  { id: "server-vent", floor: "server", kind: "vent", x: 420, w: 52, h: 32, lift: 128, layer: "back", spots: [] },
  { id: "server-cables", floor: "server", kind: "cable-tray", x: 760, w: 104, h: 55, lift: 118, layer: "back", spots: [] },
  { id: "server-crates", floor: "server", kind: "crates", x: 220, w: 96, h: 72, layer: "back", spots: [] },

  // 03 RESEARCH: archive shelves with drawers, the holo globe, two comms consoles.
  ...[500, 650].map((x, i) => ({
    id: `shelf-${i + 1}`, floor: "research", kind: "data-shelf", x, w: 124, h: 130, layer: "back",
    parts: ["drawer"], spots: [spot("archive", i === 0 ? -20 : 20, "use", i === 0 ? "r" : "l")],
  })),
  { id: "holo-globe", floor: "research", kind: "holo-pedestal", x: 830, w: 44, h: 71, layer: "back", parts: ["holo"], spots: [] },
  ...[1010, 1170].map((x, i) => ({
    id: `comms-${i + 1}`, floor: "research", kind: "comms", x, w: 92, h: 97, layer: "back",
    parts: ["screen"], spots: [spot("comms", -70, "use", "r")],
  })),
  { id: "research-capsule", floor: "research", kind: "capsule", x: 225, w: 128, h: 70, layer: "back", spots: [] },
  { id: "research-poster", floor: "research", kind: "poster", x: 930, w: 72, h: 53, lift: 95, layer: "back", spots: [] },
  { id: "research-screen", floor: "research", kind: "wall-screen", x: 1090, w: 102, h: 66, lift: 104, pulse: true, layer: "back", spots: [] },
  { id: "research-plant-1", floor: "research", kind: "plant", x: 345, w: 44, h: 53, layer: "back", spots: [] },

  // 02 DEV: three desks (the sitting pose brings its own chair), the planning table.
  ...[480, 650, 820].map((x, i) => ({
    id: `desk-${i + 1}`, floor: "dev", kind: "desk", x, w: 104, h: 47, layer: "back",
    parts: ["screen"], spots: [spot("desk", -66, "sit-type", "r")],
  })),
  { id: "meeting", floor: "dev", kind: "meeting-table", x: 1100, w: 170, h: 64, layer: "back",
    parts: ["holo"], spots: [spot("meeting", -118, "talk", "r"), spot("meeting", 118, "talk", "l")] },
  { id: "dev-screen", floor: "dev", kind: "wall-screen", x: 584, w: 102, h: 66, lift: 90, pulse: true, layer: "back", spots: [] },
  { id: "dev-poster", floor: "dev", kind: "poster", x: 800, w: 72, h: 53, lift: 92, layer: "back", spots: [] },
  { id: "dev-cooler", floor: "dev", kind: "water-cooler", x: 335, w: 34, h: 74, layer: "back", spots: [] },
  { id: "dev-lamp", floor: "dev", kind: "floor-lamp", x: 922, w: 40, h: 114, layer: "back", spots: [] },
  { id: "dev-neon", floor: "dev", kind: "neon-frame", x: 1100, w: 78, h: 43, lift: 124, pulse: true, layer: "back", spots: [] },
  { id: "dev-plant-1", floor: "dev", kind: "plant", x: 260, w: 44, h: 53, layer: "back", spots: [] },

  // 01 LOBBY: the help desk, the bar with its coffee machine, the sofa.
  { id: "help-desk", floor: "lobby", kind: "help-desk", x: 400, w: 130, h: 97, layer: "back",
    parts: ["alarm"], spots: [spot("help", -84, "sit-type", "r")] },
  { id: "back-bar", floor: "lobby", kind: "back-bar", x: 990, w: 190, h: 94, lift: 64, layer: "back", spots: [] },
  { id: "bar", floor: "lobby", kind: "bar-counter", x: 990, w: 160, h: 72, layer: "back",
    parts: ["coffee"], spots: [spot("bar", -58, "talk", "r"), spot("bar", 58, "talk", "l")] },
  { id: "sofa", floor: "lobby", kind: "sofa", x: 580, w: 150, h: 69, layer: "back",
    spots: [spot("lounge", -38, "sit-relax", "r", 30), spot("lounge", 36, "sit-relax", "r", 30)] },
  { id: "sofa-front", floor: "lobby", kind: "sofa-front", x: 580, w: 150, h: 26, layer: "front", spots: [] },
  { id: "lobby-vending", floor: "lobby", kind: "vending", x: 195, w: 80, h: 120, layer: "back", spots: [] },
  { id: "lobby-side-table", floor: "lobby", kind: "side-table", x: 680, w: 40, h: 63, layer: "back", spots: [] },
  { id: "lobby-neon", floor: "lobby", kind: "neon-frame", x: 580, w: 78, h: 43, lift: 96, pulse: true, layer: "back", spots: [] },
  { id: "lobby-poster", floor: "lobby", kind: "poster", x: 840, w: 72, h: 53, lift: 100, layer: "back", spots: [] },
  { id: "lobby-plant-1", floor: "lobby", kind: "plant", x: 860, w: 44, h: 53, layer: "back", spots: [] },
]);

// Every spot of a floor, with its own id and absolute x.
export function spotsOf(floorId) {
  return OBJECTS.filter((o) => o.floor === floorId).flatMap((o) =>
    o.spots.map((s, i) => ({ ...s, id: `${o.id}#${i}`, object: o.id, floor: floorId, x: o.x + s.dx })),
  );
}

// The floor's spots that serve a station; the lobby's lounge also lists the bar (two resting people meet there).
export function spotsFor(floorId, station) {
  return spotsOf(floorId).filter((s) => s.station === station);
}

// The cabin's top edge when it stands at a floor.
export const cabinTop = (floorId) => FLOORS[floorId].y - LIFT.cabin.h;
