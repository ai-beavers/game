import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Ray } from "@babylonjs/core/Culling/ray.js";
import { Scene } from "@babylonjs/core/scene.js";
import { material } from "../../world/models.ts";
import { hex } from "../../world/color.ts";
// The "life" feature: the animals of the clearing that notice the beaver. A school of fish in the pond, songbirds on the
// ground and on logs, two birds of prey circling high, butterflies over the meadow, dragonflies over the reeds, frogs
// at the shore and a pair of mallards on the water; by the hour the larger ones: deer at the forest's edge at dusk and
// dawn, an owl in the far trees at night. A tail slap (the tailSlap event) sends them all off at once
// (brain.ts: startle); the feature tells how many with the startled event.
//
//   createGame(canvas, [create])      on its own, or in FEATURES with the rest
//   (await create(game)).animals      the animals' state; see brain.ts for what each holds
//   window.life                       the same, and `heard`: the calls to sound (src/features/audio plays them)
//
// How they decide lives in brain.ts (pure, tested), what they look like in shapes.ts. Here the two meet: once per
// picture the brains step (not while stage.paused) and every animal's place and pose is written into one
// Babylon thin instance batch per kind. Fewer animals at lower settings.quality. Deer and owl are drawn (and
// stepped) only in their hours: outside them their batches are switched off.
import type { CreateFeature, Feature } from "../../game.ts";
import { seeded } from "../../world/noise.ts";
import { placeAll } from "../../world/place.ts";
import { BASIN, POND, RIM, groundAt } from "../../world/terrain.ts";
import {
  circling, deerHours, makeBirds, makeDeer, makeDucks, makeFlyers, makeFrogs, makeOwl, makeSchool, owlHours, shoreSpots, startle, stepBirds,
  stepButterflies, stepDeer, stepDragonflies, stepDucks, stepFrogs, stepOwl, stepSchool, type Land, type Perch, type Splash, type Threat,
} from "./brain.ts";
import { makeDeep, startleDeep, stepDeep, type Bed } from "./deep.ts";
import {
  animalMesh, bedShape, bigFishShape, birdShape, butterflyShape, deerShape, dragonflyShape, duckShape, fishShape, frogShape, lightAnimal, minnowShape, owlShape, striderShape,
} from "./shapes.ts";
import { sunAt } from "../sky/clock.ts";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { DepthRenderer } from "@babylonjs/core/Rendering/depthRenderer.js";

const COUNTS = {
  low: { fish: 5, birds: 3, raptors: 1, butterflies: 3, dragonflies: 2, frogs: 3, ducks: 2, deer: 2, school: 14, carp: 1, crayfish: 1, mussels: 4, snails: 2, striders: 3 },
  medium: { fish: 8, birds: 4, raptors: 1, butterflies: 5, dragonflies: 3, frogs: 4, ducks: 2, deer: 3, school: 22, carp: 1, crayfish: 2, mussels: 6, snails: 3, striders: 5 },
  high: { fish: 12, birds: 6, raptors: 2, butterflies: 8, dragonflies: 5, frogs: 5, ducks: 2, deer: 4, school: 32, carp: 2, crayfish: 2, mussels: 8, snails: 4, striders: 8 },
};
const MAX = COUNTS.high, RINGS = 10;
// Somewhat larger than life, so they read at play distance: a songbird of 22 cm (a smaller one hides in the grass),
// a butterfly of 13 cm, a dragonfly of 10 cm.
const BIRD_SIZE = 1.3, RAPTOR_SIZE = 4, BUTTERFLY_SIZE = 1.5, DRAGONFLY_SIZE = 1.3;
// A roe deer a metre at the shoulder; an owl drawn large like the birds of prey, 1.3 m: both read on a stream at the
// forest's edge, 20 m off.
const DEER_SIZE = 1.35, OWL_SIZE = 3.4;
// Down in the basin: a school of 11 cm fish, a pike of 75 cm, a carp of 50; the small things on the bed and the striders a little larger than
// life, so they read on a stream.
const MINNOW_SIZE = 1.3, PIKE_SIZE = 0.75, CARP_SIZE = 0.5, CRAYFISH_SIZE = 1.3, MUSSEL_SIZE = 1.2, SNAIL_SIZE = 1.4, STRIDER_SIZE = 1.8;
const NEAR_POND = 10; // m from the pond's edge: closer than this, the pond's own animals are stepped and drawn

export const create = ((game) => {
  const { stage, world, player, settings, events } = game, { scene } = stage;
  const land: Land = { heightAt: world.heightAt, get water() { return world.waterLevel; }, rim: RIM - 2.5, pond: { x: POND.x, z: POND.z, radius: POND.radius } };
  // The basin's animals walk and lie on the ground as it is drawn (its triangles), not on the smooth heights: on the
  // steep slope the two differ by centimetres, and a mussel would vanish into it.
  const bedLand: Land = { heightAt: groundAt, get water() { return world.waterLevel; }, rim: land.rim, pond: land.pond };
  const layout = placeAll(), random = seeded(7);
  const reeds = layout.reed.map(({ x, z }) => ({ x, z }));
  // Logs, stumps and rocks stand out of the grass: where songbirds like to sit, and where they are seen.
  const perches = tops(scene, [...layout.log.flatMap((l) => [-0.5, 0.1, 0.6].map((along) => ({ ...l, along }))), ...layout.stump, ...layout.rock], land);
  // Frogs sit where they can be seen: not inside a clump of reeds.
  const shore = shoreSpots(land, 30, random).filter((s) => reeds.every((r) => Math.hypot(r.x - s.x, r.z - s.z) > 0.7));

  const meshes = {
    fish: animalMesh(scene, fishShape(), MAX.fish),
    birds: animalMesh(scene, birdShape(), MAX.birds + MAX.raptors),
    butterflies: animalMesh(scene, butterflyShape(), MAX.butterflies),
    dragonflies: animalMesh(scene, dragonflyShape(), MAX.dragonflies),
    frogs: animalMesh(scene, frogShape(), MAX.frogs),
    ducks: animalMesh(scene, duckShape(), MAX.ducks),
    deer: animalMesh(scene, deerShape(), MAX.deer),
    owl: animalMesh(scene, owlShape(), 1),
    minnows: animalMesh(scene, minnowShape(), MAX.school),
    bigfish: animalMesh(scene, bigFishShape(), 1 + MAX.carp),
    bed: animalMesh(scene, bedShape(), MAX.crayfish + MAX.mussels + MAX.snails),
    striders: animalMesh(scene, striderShape(), MAX.striders),
  };
  // The deep basin as its animals know it: the sunken log's top along it, the rocks on its bed, the weed's tufts (the
  // tallest blades of the meadow's batch, src/world/grass.ts).
  const sunken = layout.sunkenLog[0];
  const bed: Bed = {
    basin: { x: BASIN.x, z: BASIN.z, r: BASIN.along },
    log: sunken ? tops(scene, [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9].map((along) => ({ ...sunken, along })), land) : [],
    rocks: layout.bedRock.map((r) => ({ x: r.x, z: r.z, r: 0.45 * r.scale })),
    weed: weedTufts(scene),
  };
  // The trunks the deer walk round, and branches for the owl: at the top of the nearest far trees, so it sits against
  // the sky, on a branch of its own that sticks out of the crown towards the clearing.
  const trunks = (world.trees?.map((t) => t.place) ?? layout.tree).map(({ x, z }) => ({ x, z }));
  const crowns = (world.props?.tree ?? []).map((t) => t.getHierarchyBoundingVectors(true).max.y);
  const branches: Perch[] = layout.farTree.filter((t) => Math.hypot(t.x, t.z) < RIM + 8).map((t) => {
    const top = (crowns[t.variant % crowns.length] ?? 8) * t.scale - 0.35, r = Math.hypot(t.x, t.z);
    return { x: t.x * (1 - 0.4 / r), y: world.heightAt(t.x, t.z) + top, z: t.z * (1 - 0.4 / r) };
  });
  const rippleMaterial = material(scene, "ripple", 0xb7d6d5);
  const rings = Array.from({ length: RINGS }, () => {
    const ring = MeshBuilder.CreateTorus("life-ripple", { diameter: 1, thickness: 0.017, tessellation: 32 }, scene);
    ring.material = rippleMaterial;
    ring.isPickable = false;
    return ring;
  });
  const tint = (animal: ReturnType<typeof animalMesh>, colors: number[], from = 0, count = animal.tint.length / 4) => {
    for (let i = 0; i < count; i++) hex(colors[i % colors.length]!).toArray(animal.tint, (i + from) * 4);
    animal.mesh.thinInstanceBufferUpdated("tint");
  };
  tint(meshes.butterflies, [0xffe860, 0xff8a28, 0xffffff, 0x7aa0ff]);
  tint(meshes.dragonflies, [0x2a78e0, 0x30b890, 0xd0402a]);

  let n = COUNTS[settings.values.quality] ?? COUNTS.high;
  let animals = populate();
  function populate() {
    tint(meshes.birds, [0xffffff, 0xc8c0b8, 0xffe8d0, 0x6a6058], 0, n.birds);
    tint(meshes.birds, [0x9a8070, 0x806050], n.birds, n.raptors);
    return {
      school: makeSchool(land, n.fish, random),
      birds: makeBirds(land, n.birds, perches, random),
      butterflies: makeFlyers(land, n.butterflies, "butterfly", reeds, random),
      dragonflies: makeFlyers(land, n.dragonflies, "dragonfly", reeds, random),
      frogs: makeFrogs(land, shore, n.frogs, random),
      ducks: makeDucks(land, n.ducks, random),
      deer: makeDeer(land, n.deer, random),
      owl: makeOwl(random),
      deep: makeDeep(bedLand, bed, n, random),
    };
  }
  settings.on((values) => {
    const next = COUNTS[values.quality] ?? COUNTS.high;
    if (next !== n) { n = next; animals = populate(); }
  });

  const splashes: Splash[] = [], ringAge: number[] = Array(RINGS).fill(1), ringAt: Splash[] = Array.from({ length: RINGS }, () => ({ x: 0, z: 0, size: 0 }));
  const threat: Threat = { x: 0, y: 0, z: 0, speed: 0, swimming: false };
  let time = 0, nearPond = false, onBed = false;
  // The calls to sound, newest last (src/features/audio takes them); a few at most, should no one take them.
  const heard: { name: "owl" | "deer"; x: number; y: number; z: number }[] = [], call = (name: "owl" | "deer", at: { x: number; y: number; z: number }) => {
    heard.push({ name, x: at.x, y: at.y, z: at.z });
    if (heard.length > 4) heard.shift();
  };
  Object.assign(window, { life: { get animals() { return animals; }, heard } });
  const towards = new Vector3();

  const place = new Vector3(), size = Vector3.One(), turn = Quaternion.Identity(), matrix = Matrix.Identity();
  const put = (animal: ReturnType<typeof animalMesh>, i: number, x: number, y: number, z: number, heading: number, pitch = 0, roll = 0, scale = 1,
    a: [number, number, number, number] = [0, 0, 0, 0]) => {
    Quaternion.RotationYawPitchRollToRef(heading, pitch, roll, turn);
    Matrix.ComposeToRef(size.setAll(scale), turn, place.set(x, y, z), matrix);
    animal.mesh.thinInstanceSetMatrixAt(i, matrix, false);
    animal.anim.set(a, i * 4);
  };
  const done = (animal: ReturnType<typeof animalMesh>, count: number) => {
    animal.mesh.thinInstanceCount = count;
    animal.mesh.thinInstanceBufferUpdated("matrix");
    animal.mesh.thinInstanceBufferUpdated("aAnim");
  };

  // A tail slap, this beaver's or another player's: the alarm, heard across the pond, closer by on land.
  events.on("tailSlap", ({ place, water }) => {
    const count = startle(animals, land, perches, place, water ? 9 : 4, random, splashes) + (water ? startleDeep(animals.deep, bedLand, bed, place, 9, random) : 0);
    events.emit("startled", { place, count });
  });

  const feature: Feature & { animals: typeof animals } = {
    get animals() { return animals; },
    update(frame) {
      if (!stage.paused) {
        const at = player.node.position, speed = Math.hypot(player.velocity.x, player.velocity.z);
        // Faster than any beaver runs: a teleport (the tour hops), not a charge.
        Object.assign(threat, { x: at.x, y: at.y, z: at.z, speed: speed > 5 ? 0 : speed, swimming: player.motion.swimming > 0.5 });
        // The basin's animals only with a player near the pond; the small things on its bed only when someone looks
        // at it from under the water.
        nearPond = Math.hypot(at.x - POND.x, at.z - POND.z) < POND.radius + NEAR_POND;
        onBed = nearPond && (player.diving || !!(scene.metadata.underwater as { on: boolean } | undefined)?.on);
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
          stepLarger(dt);
          if (nearPond) stepDeep(animals.deep, bedLand, bed, threat, dt, random, onBed);
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

  /** Deer and owl, only in their hours (and until the last has gone back into the forest). */
  let fleeing = false;
  function stepLarger(dt: number) {
    const sky = game.sky, height = Math.asin(sunAt(sky?.hour ?? 16, towards).y) * 180 / Math.PI;
    const deerOut = deerHours(height), { deer, owl } = animals;
    if (deerOut || deer.some((d) => d.state !== "away")) {
      stepDeer(deer, land, trunks, shore, threat, { out: deerOut, rain: (sky?.rain ?? 0) > 0.35 }, dt, random);
      // A bark as the first bounds off (from the beaver or a tail slap), not one per deer.
      const first = deer.find((d) => d.state === "flee");
      if (first && !fleeing) call("deer", first);
      fleeing = !!first;
    }
    const calls = owl.calls;
    if (owlHours(height) || owl.state !== "away") stepOwl(owl, land, branches, owlHours(height), dt, random);
    if (owl.calls > calls) call("owl", owl);
  }

  function draw() {
    const water = land.water, camera = scene.activeCamera ?? stage.camera;
    const sky = scene.getLightByName("skylight");
    for (const animal of Object.values(meshes)) {
      animal.mesh.thinInstanceCount = animal.anim.length / 4;
      if (animal.more.length) continue;
      animal.material.setFloat("daylight", Math.min(1, sky?.intensity ?? 1))
        .setVector3("cameraPosition", camera.globalPosition).setFloat("waterLevel", water);
    }
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
      const dabble = d.speed < 0.08 ? Math.max(0, Math.sin(d.phase * 0.35 + i * 2)) ** 6 : 0, bob = (1 - d.wings) * 0.03;
      put(meshes.ducks, i, d.x, water - 0.02 + d.air + Math.sin(d.phase * 0.7) * 0.006 * (1 - d.wings), d.z, d.heading, Math.sin(d.phase * 0.5) * bob + dabble * 0.15 - 0.15 * d.wings,
        Math.sin(d.phase * 0.37) * bob, 1, [d.phase, d.wings, dabble, i % 2]);
    });
    done(meshes.ducks, animals.ducks.length);

    const deer = animals.deer.filter((d) => d.state !== "away"), owl = animals.owl;
    meshes.deer.mesh.setEnabled(deer.length > 0);
    meshes.owl.mesh.setEnabled(owl.state !== "away");
    if (deer.length || owl.state !== "away") {
      for (const animal of [meshes.deer, meshes.owl]) light(animal);
      deer.forEach((d, i) => {
        // Level with the slope it stands on; nose up as it takes off in a bound.
        const ahead = 0.4 * DEER_SIZE, sx = Math.sin(d.heading) * ahead, sz = Math.cos(d.heading) * ahead;
        const slope = Math.atan2(land.heightAt(d.x - sx, d.z - sz) - land.heightAt(d.x + sx, d.z + sz), 2 * ahead);
        put(meshes.deer, i, d.x, d.y + d.air + 0.012 * d.stride * Math.cos(d.phase * 2), d.z, d.heading, slope - 0.18 * d.bound * Math.cos(d.phase), 0, DEER_SIZE,
          [d.phase, d.stride, d.bound, d.head]);
        meshes.deer.more.set([d.look, d.ears[0], d.ears[1], d.tail], i * 4);
      });
      done(meshes.deer, deer.length);
      meshes.deer.mesh.thinInstanceBufferUpdated("aMore");
      put(meshes.owl, 0, owl.x, owl.y, owl.z, owl.heading, 0, owl.bank, OWL_SIZE, [owl.phase, owl.flap, owl.spread, owl.look]);
      meshes.owl.more.set([owl.state === "sit" ? 1 : 0, 0, 0, 0]);
      done(meshes.owl, 1);
      meshes.owl.mesh.thinInstanceBufferUpdated("aMore");
    }

    drawDeep();

    rings.forEach((ring, i) => {
      const at = ringAt[i]!, age = ringAge[i]!;
      ring.setEnabled(age < 1);
      ring.position.set(at.x, water + 0.01, at.z);
      ring.scaling.setAll(0.1 + at.size * (0.4 + age));
      ring.visibility = 1 - age;
    });
  }
  const light = (animal: ReturnType<typeof animalMesh>) => lightAnimal(scene, animal.material, land.water);

  // Under water every animal goes into the depth map posed as it is drawn (shapes.ts: depth), so the water's fog lies
  // on it by its own distance. The map is the under-water pass's (src/features/post), there once that feature runs.
  let depthPass = -1;
  // Above or under the surface goes by the camera that draws the picture, as it stands for it.
  scene.onBeforeCameraRenderObservable.add((camera) => {
    for (const animal of [meshes.minnows, meshes.bigfish]) animal.material.setVector3("cameraPosition", camera.globalPosition);
  });
  function drawDeep() {
    if (depthPass < 0) {
      const camera = stage.camera, map = (scene as unknown as { _depthRenderer?: Record<string, DepthRenderer> })._depthRenderer?.[camera.id]?.getDepthMap();
      if (map) { depthPass = map.renderPassId; for (const animal of Object.values(meshes)) animal.mesh.setMaterialForRenderPass(depthPass, animal.depth); }
    }
    const { school, hunter, carp, crayfish, mussels, snails, striders } = animals.deep, water = land.water;
    for (const animal of [meshes.minnows, meshes.bigfish, meshes.striders]) animal.mesh.setEnabled(nearPond);
    meshes.bed.mesh.setEnabled(onBed);
    if (!nearPond) return;
    for (const animal of [meshes.minnows, meshes.bigfish, meshes.striders, meshes.bed]) light(animal);
    // Rolled into the turn, so the flank catches the light.
    school.fish.forEach((f, i) => put(meshes.minnows, i, f.x, f.y, f.z, f.heading, -f.pitch, Math.max(-0.7, Math.min(0.7, -f.turn * 0.25)), MINNOW_SIZE,
      [f.phase, 0.004 + f.fear * 0.005, 0, 0]));
    done(meshes.minnows, school.fish.length);
    const still = hunter.state === "lurk" || hunter.state === "hide";
    put(meshes.bigfish, 0, hunter.x, hunter.y, hunter.z, hunter.heading, -hunter.pitch, 0, PIKE_SIZE, [hunter.phase, 0.01 + Math.min(hunter.speed, 2) * 0.02, still ? 1 : 0.3, 0]);
    meshes.bigfish.more.fill(0, 0, 4);
    carp.forEach((g, i) => {
      put(meshes.bigfish, i + 1, g.x, g.y, g.z, g.heading, g.pitch, 0, CARP_SIZE, [g.phase, 0.015 + g.speed * 0.05, g.state === "graze" ? 0.6 : 0.3, 0]);
      meshes.bigfish.more.set([1, 0, 0, 0], (i + 1) * 4);
    });
    done(meshes.bigfish, 1 + carp.length);
    meshes.bigfish.mesh.thinInstanceBufferUpdated("aMore");
    striders.forEach((s, i) => put(meshes.striders, i, s.x, water + 0.002, s.z, s.heading, 0, 0, STRIDER_SIZE, [s.phase, s.stroke, 0, 0]));
    done(meshes.striders, striders.length);
    if (!onBed) return;
    let k = 0;
    const kind = (w: number) => meshes.bed.more.set([0, 0, 0, w], k++ * 4);
    for (const c of crayfish) { put(meshes.bed, k, c.x, c.y, c.z, c.heading, 0, 0, CRAYFISH_SIZE, [c.phase, c.raise, c.walk, 0]); kind(0); }
    for (const m of mussels) { put(meshes.bed, k, m.x, m.y - 0.012, m.z, m.heading, m.tilt, 0, MUSSEL_SIZE, [0, m.open, 0, 0]); kind(1); }
    for (const s of snails) { put(meshes.bed, k, s.x, s.y, s.z, s.heading, 0, 0, SNAIL_SIZE, [s.phase, s.hide, 0, 0]); kind(2); }
    done(meshes.bed, k);
    meshes.bed.mesh.thinInstanceBufferUpdated("aMore");
  }
  draw();
  return feature;
}) satisfies CreateFeature;

/** The tufts of pondweed: the meadow's blades that stand taller than any grass, one point per tuft. */
function weedTufts(scene: Scene) {
  const out: { x: number; z: number }[] = [];
  for (const { m } of (scene.getMeshByName("grass") as Mesh | null)?.thinInstanceGetWorldMatrices() ?? []) {
    const x = m[12]!, z = m[14]!;
    if (Math.hypot(m[4]!, m[5]!, m[6]!) > 2 && out.every((w) => Math.hypot(w.x - x, w.z - z) > 0.4)) out.push({ x, z });
  }
  return out;
}

/** Where a bird can sit on things: the top of each, found by looking straight down at what is drawn there; `along`
 *  moves the point along a log. */
function tops(scene: Scene, things: { x: number; z: number; turn: number; along?: number }[], land: Land): Perch[] {
  const out: Perch[] = [];
  for (const { x: cx, z: cz, turn, along = 0 } of things) {
    const x = cx + Math.sin(turn) * along, z = cz + Math.cos(turn) * along, ground = land.heightAt(x, z);
    const hit = scene.pickWithRay(new Ray(new Vector3(x, ground + 1.5, z), Vector3.Down(), 1.4), mesh => mesh.isEnabled() && mesh.parent?.name === "scenery");
    if (hit?.pickedPoint) out.push({ x, y: hit.pickedPoint.y, z });
  }
  return out;
}
