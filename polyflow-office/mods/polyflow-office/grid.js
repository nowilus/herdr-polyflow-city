// The walking grid every floor plan shares: a plan has cols, rows and a set of blocked "c,r" cells.
export const CELL = 48; // the grid floors' cell in px (picture floors use their own GRID)

export const walkable = (plan, c, r) => c >= 0 && r >= 0 && c < plan.cols && r < plan.rows && !plan.blocked.has(`${c},${r}`);

// Camera math (pure, so node can test it).
// Zoom 1 shows the whole floor; it can't go smaller (the picture stays put on its background).
export const ZOOM = Object.freeze({ min: 1, max: 3, step: 1.15 });

// The pan, kept so the picture always covers the view where it is bigger than the view and stays centred
// where it is not: the camera moves over the picture, the picture never slides around on the black.
export function clampPan(world, s, size, ox, oy) {
  const axis = (len, view, o) => {
    const slack = (len * s - view) / 2;
    return slack <= 0 ? 0 : Math.max(-slack, Math.min(slack, o));
  };
  return { ox: axis(world.w, size.w, ox), oy: axis(world.h, size.h, oy) };
}

// A floor's size in its own px: a picture scene, or the grid.
export const worldSize = (plan) => (plan.scene ? { w: plan.scene.w, h: plan.scene.h } : { w: plan.cols * CELL, h: plan.rows * CELL });

// The camera scale that fits the whole floor in the viewport.
export const fitScale = (plan, vw, vh) => Math.min(vw / worldSize(plan).w, vh / worldSize(plan).h);
