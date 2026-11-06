// Floors drawn from their approved pictures share one shape of data (a "scene") and one plan builder.
// Pure functions (no herdr / gpui-kit), so node can test them.
//
// A scene: { floor, no, art (folder under art/), w, h, shell (picture name), walk (the floor people walk on),
//   objects: [{ id, art, x, y, w, h, depth, block?: [x0, y0, x1, y1], pulse?, part? }],
//   signs: [{ text, x, y }],
//   doors: { lift: { x, y, w, h, art, at, display }, entrance?: { ... } },
//   spots: [{ id, x, y, station, pose, face, object?, dy?, bar? }] }
// Coordinates are the picture's pixels; a person's (x, y) is where their feet stand.

export const GRID = 24;

// The shell every floor shares (the same room, camera and elevator as the LOBBY picture).
export const ROOM = Object.freeze({
  w: 1536,
  h: 1024,
  walk: Object.freeze({ top: 470, bottom: 890, leftTop: 112, leftBottom: 70, rightTop: 1330, rightBottom: 1460 }),
  lift: Object.freeze({ x: 1274, y: 308, w: 74, h: 142, at: { x: 1311, y: 492 }, display: { x: 1287, y: 248, w: 48, h: 30 } }),
});
export const DOOR_NEAR_PX = 70; // a door opens while someone is this close to it
export const POUR_MS = 2600; // the coffee machine pours this long, then the cup is in the hand

// Which doors of a scene stand open: anyone (where `posOf(person)` puts them) within DOOR_NEAR_PX of the door.
export function openDoors(scene, people, posOf) {
  const out = {};
  for (const [id, d] of Object.entries(scene.doors)) {
    out[id] = Object.values(people).some((p) => {
      const at = posOf(p);
      return Math.hypot(at.x - d.at.x, at.y - d.at.y) < DOOR_NEAR_PX;
    });
  }
  return out;
}

function onFloor(walk, x, y) {
  if (y < walk.top || y > walk.bottom) return false;
  const f = (y - walk.top) / (walk.bottom - walk.top);
  return x > walk.leftTop + (walk.leftBottom - walk.leftTop) * f && x < walk.rightTop + (walk.rightBottom - walk.rightTop) * f;
}

const toPx = (c, r) => ({ x: c * GRID + GRID / 2, y: r * GRID + GRID / 2 });
const toCell = (x, y) => ({ c: Math.floor(x / GRID), r: Math.floor(y / GRID) });

// The scene as a plan for the floor crowd and pathing: GRID px cells over the picture, furniture bands blocked.
export function scenePlan(scene) {
  const cols = Math.ceil(scene.w / GRID);
  const rows = Math.ceil(scene.h / GRID);
  const blocked = new Set();
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const { x, y } = toPx(c, r);
      const inBlock = scene.objects.some((o) => o.block && x >= o.block[0] && x <= o.block[2] && y >= o.block[1] && y <= o.block[3]);
      if (!onFloor(scene.walk, x, y) || inBlock) blocked.add(`${c},${r}`);
    }
  }
  const spots = scene.spots.map((s) => {
    const cell = toCell(s.x, s.y);
    const centre = toPx(cell.c, cell.r);
    return { ...s, c: cell.c, r: cell.r, dx: s.x - centre.x, dy: s.y - centre.y, raise: -(s.dy ?? 0), object: s.object ?? s.id };
  });
  const lift = toCell(scene.doors.lift.at.x, scene.doors.lift.at.y);
  const entrance = scene.doors.entrance ? toCell(scene.doors.entrance.at.x, scene.doors.entrance.at.y) : null;
  return { floor: scene.floor, scene, cols, rows, blocked, spots, objects: scene.objects, labels: [], lift, entrance, spawn: lift, toPx, toCell };
}
