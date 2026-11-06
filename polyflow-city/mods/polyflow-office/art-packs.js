// Which art packs are complete. A manifest only says what should exist; Herdr caches an image path that was missing
// once and never retries it, so the mod must not point at a file that isn't there. Pure (no herdr imports): the
// caller passes the manifests and the list of files that really exist (art/index.json, written by scripts/art-index.mjs).
import { sceneFor } from "./floor-scenes.js";

export const MINI_POSES = Object.freeze(["idle", "sit-type", "sit-relax", "use", "talk", "walk"]);
export const PEOPLE_ANIMS = Object.freeze(["walk-r", "walk-l", "walk-d", "walk-u", "idle", "talk-r", "talk-l", "blocked", "sit-sofa", "use", "sit-desk"]);
const VERSION = /^v[0-9]+$/;

export const miniFiles = (job, version) => MINI_POSES.flatMap((p) => ["r", "l"].map((f) => `art/mini/${job}${version ? `-${version}` : ""}-${p}-${f}.gif`));
export const personFiles = (job, version) => PEOPLE_ANIMS.map((a) => `art/people/${job}-${version}-${a}.gif`);

// Every picture a scene draws: the shell, each object and each door (a split door is two leaves).
export function sceneFiles(scene) {
  const dir = `art/${scene.art}`;
  const doors = Object.values(scene.doors ?? {}).flatMap((d) => (d.split ? [`${d.art}-l`, `${d.art}-r`] : [d.art]));
  const names = [scene.shell, ...scene.objects.map((o) => o.art), ...doors];
  return [...new Set(names)].map((n) => `${dir}/${n}.png`);
}

const allIn = (have, files) => files.every((f) => have.has(f));
const isObject = (x) => x && typeof x === "object" && !Array.isArray(x);
const isText = (x) => typeof x === "string";

// manifests: { minis: {jobs, versions}, people: {versions}, scenes: {ready}, tower: {assets} } (any may be missing).
// files: relative paths that exist (art/...) or null when unknown. Returns the same shapes, only the complete part.
// Unknown files: nothing is trusted, so the mod falls back to stand-ins as when a manifest is missing.
export function completePacks({ minis, people, scenes, tower } = {}, files) {
  const have = new Set(Array.isArray(files) ? files : []);

  const miniVersions = isObject(minis?.versions) ? minis.versions : {};
  const okJobs = (Array.isArray(minis?.jobs) ? minis.jobs : []).filter(isText)
    .filter((j) => allIn(have, miniFiles(j, VERSION.test(miniVersions[j]) ? miniVersions[j] : undefined)));
  const outMinis = {
    jobs: okJobs,
    versions: Object.fromEntries(okJobs.filter((j) => VERSION.test(miniVersions[j])).map((j) => [j, miniVersions[j]])),
  };

  const castVersions = isObject(people?.versions) ? people.versions : {};
  const outPeople = {
    versions: Object.fromEntries(Object.entries(castVersions).filter(([j, v]) => /^[a-z]+$/.test(j) && VERSION.test(v) && allIn(have, personFiles(j, v)))),
  };

  const outScenes = {
    ready: (Array.isArray(scenes?.ready) ? scenes.ready : []).filter((f) => {
      const scene = isText(f) ? sceneFor(f) : null;
      return scene && allIn(have, sceneFiles(scene));
    }),
  };

  const outTower = { assets: (Array.isArray(tower?.assets) ? tower.assets : []).filter((a) => isText(a) && have.has(`art/tower/${a}.png`)) };

  return { minis: outMinis, people: outPeople, scenes: outScenes, tower: outTower };
}
