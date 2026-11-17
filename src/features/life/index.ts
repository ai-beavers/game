// The "life" feature: the animals of the clearing that notice the beaver. A school of fish in the pond, songbirds on the
// ground and on logs, two birds of prey circling high, butterflies over the meadow, dragonflies over the reeds, frogs
// at the shore and a pair of mallards on the water.
//
//   createGame(canvas, [create])      on its own (lab/life.html), or in FEATURES with the rest
//   (await create(game)).animals      the animals' state, for a lab camera; see brain.ts for what each holds
//
// How they decide lives in brain.ts (pure, tested), what they look like in shapes.ts. Here the two meet: once per
// picture the brains step (not while stage.paused) and every animal's place and pose is written into one
// InstancedMesh per kind. Fewer animals at lower settings.quality.
import * as THREE from "three";
import type { CreateFeature, Feature } from "../../game.ts";
import { seeded } from "../../world/noise.ts";
import { placeAll } from "../../world/place.ts";
import { POND, RIM } from "../../world/terrain.ts";
import {
  circling, makeBirds, makeDucks, makeFlyers, makeFrogs, makeSchool, shoreSpots, stepBirds, stepButterflies, stepDragonflies,
  stepDucks, stepFrogs, stepSchool, type Land, type Perch, type Splash, type Threat,
} from "./brain.ts";
import { animalMesh, birdShape, butterflyShape, dragonflyShape, duckShape, fishShape, frogShape, ringMesh } from "./shapes.ts";

const COUNTS = {
  low: { fish: 5, birds: 3, raptors: 1, butterflies: 3, dragonflies: 2, frogs: 3, ducks: 2 },
  medium: { fish: 8, birds: 4, raptors: 1, butterflies: 5, dragonflies: 3, frogs: 4, ducks: 2 },
  high: { fish: 12, birds: 6, raptors: 2, butterflies: 8, dragonflies: 5, frogs: 5, ducks: 2 },
};
const MAX = COUNTS.high, RINGS = 10;
// Somewhat larger than life, so they read at play distance: a songbird of 22 cm (a smaller one hides in the grass),
// a butterfly of 13 cm, a dragonfly of 10 cm.
const BIRD_SIZE = 1.3, RAPTOR_SIZE = 4, BUTTERFLY_SIZE = 1.5, DRAGONFLY_SIZE = 1.3;

export const create = ((game) => {
  const { stage, world, player, settings } = game, { scene } = stage;
  const land: Land = { heightAt: world.heightAt, get water() { return world.waterLevel; }, rim: RIM - 2.5, pond: { x: POND.x, z: POND.z, radius: POND.radius } };
  const layout = placeAll(), random = seeded(7);
  const reeds = layout.reed.map(({ x, z }) => ({ x, z }));
  // Logs, stumps and rocks stand out of the grass: where songbirds like to sit, and where they are seen.
  const perches = tops(scene, [...layout.log.flatMap((l) => [-0.5, 0.1, 0.6].map((along) => ({ ...l, along }))), ...layout.stump, ...layout.rock], land);
  // Frogs sit where they can be seen: not inside a clump of reeds.
  const shore = shoreSpots(land, 30, random).filter((s) => reeds.every((r) => Math.hypot(r.x - s.x, r.z - s.z) > 0.7));

  const meshes = {
    fish: animalMesh(fishShape(), MAX.fish),
    birds: animalMesh(birdShape(), MAX.birds + MAX.raptors),
    butterflies: animalMesh(butterflyShape(), MAX.butterflies),
    dragonflies: animalMesh(dragonflyShape(), MAX.dragonflies),
    frogs: animalMesh(frogShape(), MAX.frogs),
    ducks: animalMesh(duckShape(), MAX.ducks),
  };
  meshes.fish.renderOrder = 2; // after the pond's surface: seen through it
  for (const m of [meshes.birds, meshes.frogs, meshes.ducks]) m.castShadow = true;
  for (const m of Object.values(meshes)) { m.receiveShadow = true; scene.add(m); }
  const rings = ringMesh(RINGS);
  scene.add(rings);

  // Colours per animal: plain and greyer sparrows, a dark one; brown birds of prey; four kinds of butterfly; blue, green
  // and red dragonflies.
  const tint = (mesh: THREE.InstancedMesh, colors: number[], from = 0, count = mesh.count) => {
    for (let i = 0; i < count; i++) mesh.setColorAt(from + i, new THREE.Color(colors[i % colors.length]!));
  };
  tint(meshes.birds, [0xffffff, 0xc8c0b8, 0xffe8d0, 0x6a6058], 0, MAX.birds);
  tint(meshes.birds, [0x9a8070, 0x806050], MAX.birds, MAX.raptors);
  tint(meshes.butterflies, [0xffe860, 0xff8a28, 0xffffff, 0x7aa0ff]);
  tint(meshes.dragonflies, [0x2a78e0, 0x30b890, 0xd0402a]);

  let n = COUNTS[settings.values.quality] ?? COUNTS.high;
  let animals = populate();
  function populate() {
    return {
      school: makeSchool(land, n.fish, random),
      birds: makeBirds(land, n.birds, perches, random),
      butterflies: makeFlyers(land, n.butterflies, "butterfly", reeds, random),
      dragonflies: makeFlyers(land, n.dragonflies, "dragonfly", reeds, random),
      frogs: makeFrogs(land, shore, n.frogs, random),
      ducks: makeDucks(land, n.ducks, random),
    };
  }
  settings.on((values) => {
    const next = COUNTS[values.quality] ?? COUNTS.high;
    if (next !== n) { n = next; animals = populate(); }
  });

  const splashes: Splash[] = [], ringAge: number[] = Array(RINGS).fill(1), ringAt: Splash[] = Array.from({ length: RINGS }, () => ({ x: 0, z: 0, size: 0 }));
  const threat: Threat = { x: 0, y: 0, z: 0, speed: 0, swimming: false };
  let time = 0;

  const matrix = new THREE.Matrix4(), place = new THREE.Vector3(), turn = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, "YXZ"), size = new THREE.Vector3();
  const put = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, heading: number, pitch = 0, roll = 0, scale = 1,
    a: [number, number, number, number] = [0, 0, 0, 0]) => {
    mesh.setMatrixAt(i, matrix.compose(place.set(x, y, z), turn.setFromEuler(euler.set(pitch, heading, roll)), size.setScalar(scale)));
    (mesh.userData.anim as THREE.InstancedBufferAttribute).set(a, i * 4);
  };
  const done = (mesh: THREE.InstancedMesh, count: number) => {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    (mesh.userData.anim as THREE.InstancedBufferAttribute).needsUpdate = true;
  };

  const feature: Feature & { animals: typeof animals } = {
    get animals() { return animals; },
    update(frame) {
      if (!stage.paused) {
        const at = player.node.position;
        Object.assign(threat, { x: at.x, y: at.y, z: at.z, speed: Math.hypot(player.velocity.x, player.velocity.z), swimming: player.motion.swimming > 0.5 });
        // Small steps, so a slow frame does not throw a fish out of the pond.
        for (let left = frame; left > 1e-4; left -= 1 / 30) {
          const dt = Math.min(left, 1 / 30);
          time += dt;
          stepSchool(animals.school, land, threat, dt, random, splashes);
          stepBirds(animals.birds, land, perches, threat, dt, random);
          stepButterflies(animals.butterflies, land, threat, dt, random);
          stepDragonflies(animals.dragonflies, land, reeds, threat, dt, random);
          stepFrogs(animals.frogs, land, shore, threat, dt, random, splashes);
          stepDucks(animals.ducks, land, threat, dt, random, splashes);
          for (let i = 0; i < RINGS; i++) ringAge[i] = Math.min(1, ringAge[i]! + dt / (0.6 + ringAt[i]!.size * 1.6));
          while (splashes.length) {
            const oldest = ringAge.indexOf(Math.max(...ringAge));
            ringAt[oldest] = splashes.shift()!;
            ringAge[oldest] = 0;
          }
        }
      }
      draw();
    },
  };

  function draw() {
    const water = land.water;
    animals.school.fish.forEach((f, i) => put(meshes.fish, i, f.x, f.y, f.z, f.heading, 0, 0, 1, [f.phase, 0.006 + f.fear * 0.012, 0, 0]));
    done(meshes.fish, animals.school.fish.length);

    animals.birds.forEach((b, i) => {
      const climb = b.state === "fly" ? -0.25 : 0;
      put(meshes.birds, i, b.x, b.y, b.z, b.heading, b.peck * 0.75 + climb, 0, BIRD_SIZE, [b.phase, b.flap, b.spread, 0]);
    });
    for (let i = 0; i < n.raptors; i++) {
      const c = circling(time, i);
      put(meshes.birds, n.birds + i, c.x, c.y, c.z, c.heading, 0, c.bank, RAPTOR_SIZE, [time * 9 + i, c.flap * 0.4, 1, 1]);
    }
    done(meshes.birds, n.birds + n.raptors);

    animals.butterflies.forEach((f, i) => put(meshes.butterflies, i, f.x, f.y, f.z, f.heading, -0.2, 0, BUTTERFLY_SIZE, [f.phase, 0, 0, 0]));
    done(meshes.butterflies, animals.butterflies.length);
    animals.dragonflies.forEach((f, i) => put(meshes.dragonflies, i, f.x, f.y, f.z, f.heading, 0, 0, DRAGONFLY_SIZE, [f.phase, 0, 0, 0]));
    done(meshes.dragonflies, animals.dragonflies.length);

    animals.frogs.forEach((f, i) => put(meshes.frogs, i, f.x, f.y, f.z, f.heading, f.state === "jump" ? -0.6 * f.stretch : f.state === "swim" ? 0.25 : 0,
      0, 1, [f.phase, f.stretch, 0, 0]));
    done(meshes.frogs, animals.frogs.length);

    animals.ducks.forEach((d, i) => {
      const dabble = d.speed < 0.08 ? Math.max(0, Math.sin(d.phase * 0.35 + i * 2)) ** 6 : 0;
      put(meshes.ducks, i, d.x, water + Math.sin(d.phase * 0.7) * 0.006, d.z, d.heading, Math.sin(d.phase * 0.5) * 0.03 + dabble * 0.15,
        Math.sin(d.phase * 0.37) * 0.03, 1, [d.phase, 0, dabble, i % 2]);
    });
    done(meshes.ducks, animals.ducks.length);

    const age = rings.userData.age as THREE.InstancedBufferAttribute;
    for (let i = 0; i < RINGS; i++) {
      const s = ringAt[i]!;
      rings.setMatrixAt(i, matrix.compose(place.set(s.x, water + 0.004, s.z), turn.identity(), size.setScalar(0.1 + s.size * (0.4 + ringAge[i]! * 0.8))));
      age.setX(i, ringAge[i]!);
    }
    rings.instanceMatrix.needsUpdate = age.needsUpdate = true;
  }
  draw();
  return feature;
}) satisfies CreateFeature;

/** Where a bird can sit on things: the top of each, found by looking straight down at what is drawn there; `along`
 *  moves the point along a log. */
function tops(scene: THREE.Scene, things: { x: number; z: number; turn: number; along?: number }[], land: Land): Perch[] {
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), out: Perch[] = [];
  const solid = scene.children.filter((o) => !["grass", "water", "ground"].includes(o.name) && !o.name.startsWith("life-"));
  for (const { x: cx, z: cz, turn, along = 0 } of things) {
    const x = cx + Math.sin(turn) * along, z = cz + Math.cos(turn) * along, ground = land.heightAt(x, z);
    ray.set(new THREE.Vector3(x, ground + 1.5, z), down);
    ray.far = 1.4;
    const hit = ray.intersectObjects(solid, true).find((h) => h.point.y > ground + 0.1 && h.point.y < ground + 1.2);
    if (hit) out.push({ x, y: hit.point.y, z });
  }
  return out;
}
