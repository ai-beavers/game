// The "fx" feature: small effects that make the world answer to the beaver. Dust under its feet on bare earth and
// sand, blades kicked up when it runs through grass, a puff when it lands; a splash, rings and a wake in the pond,
// drops falling off when it climbs out; a tall splash or a puff of dust for a tail slap; dust when it drops a stick; motes drifting in the light near the camera and
// now and then a leaf falling under the trees. The work (src/features/build): chips from each bite, leaves shaken loose
// when a tree starts to fall, dust and leaves where it lands, splinters when it breaks, mud or a splash for each stick
// in the dam, a cheerful burst when the dam is finished. The weather (game.sky): rain splashing on the ground and the
// pond near the camera, wet footsteps that splash instead of raising dust; it also hands the sky's wind to the grass.
// Diving: a burst of bubbles as the beaver goes under, a trickle from its nose while it stays there (each rises and
// is gone at the surface), and its breath as a quiet ring of ten bubbles on the HUD that pop one by one.
//
//   const game = await createGame(canvas, [create]);      see src/game.ts
//   fxOf(game.stage.scene)?.splash(place, size)            for other features: a splash in the pond (size 1: a beaver
//   fxOf(game.stage.scene)?.ring(place, size)              jumping in; 0.2: a fish), a ring on the water (size: metres)
//
// All of it is one pool of particles (sim.ts) drawn in one call (particles.ts). Fewer particles at lower
// settings.quality; nothing moves while stage.paused. The pond's level is read each time (it rises behind the dam);
// what lies on the water follows it.
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { type Scene } from "@babylonjs/core/scene.js";
import { hex } from "../../world/color.ts";
import { bounds } from "../../world/models.ts";
import type { CreateFeature } from "../../game.ts";
import { grassOf } from "../../world/grass.ts";
import { placeAll } from "../../world/place.ts";
import { groundColor, slopeAt } from "../../world/terrain.ts";
import { Overlay, box as screenBox, hudLayout, onViewport } from "../hud/overlay.ts";
import { createParticles } from "./particles.ts";
import { advance, blank, FLOOR, KIND, MODE, spawn, type Particle } from "./sim.ts";

/** Particles at most, and how many of the steady ones (motes), per quality. */
const BUDGET = { low: { pool: 500, rate: 0.35 }, medium: { pool: 1200, rate: 0.65 }, high: { pool: 2400, rate: 1 } } as const;
const CAPACITY = BUDGET.high.pool;
const MOTES = 90; // at high quality
const SPRAY = new Color3(0.8, 0.86, 0.88);
const DUST = new Color3(0.5, 0.42, 0.31), WOOD = new Color3(0.62, 0.42, 0.22), WATER = new Color3(0.72, 0.8, 0.82);
const LEAF_COLORS = [0x6f7a2a, 0x8c7a2a, 0x9a6a26, 0x5f6b26].map((c) => hex(c));

const MUD = new Color3(0.2, 0.14, 0.08);
// A cheerful burst: gold, cream, sky blue, fresh green; brighter than any surface, so they glint even in the evening.
const CHEER = [0xffd24a, 0xfff2c8, 0x8fd0ff, 0x9be36a, 0xff9a5a].map((c) => hex(c).scale(1.8));
/** Rain splashes per second near the camera in full rain, at high quality. */
const RAIN_SPLASHES = 140;

const random = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** What the fx feature lets others do: splash(place, size) in the pond (1: a beaver jumping in), ring(place, size)
 *  on the water (size: metres across at the end). Both lie on the pond's surface as it is now. */
export interface Fx {
  splash(place: Vector3, size?: number): void;
  ring(place: Vector3, size?: number): void;
}
/** The fx of a scene, once the fx feature runs (as daylightOf for the light). */
export const fxOf = (scene: Scene) => scene.metadata.fx as Fx | undefined;

export const create: CreateFeature = (game) => {
  const { stage, world, player, events, settings } = game;
  const pool: Particle[] = Array.from({ length: CAPACITY }, blank);
  const drawn = createParticles(stage, world, CAPACITY);
  let budget: (typeof BUDGET)[keyof typeof BUDGET] = BUDGET.high;
  settings.on((values) => { budget = BUDGET[values.quality]; });
  const groundAt = (x: number, z: number) => world.heightAt(x, z);
  const surfaceAt = (x: number, z: number) => Math.max(world.heightAt(x, z), world.waterLevel);
  const trees = placeAll().tree; // shortcut: the world does not tell where its trees stand; same layout as createWorld uses

  /** A new particle, or none when the pool for this quality is full. */
  const make = (fields: Partial<Particle>) => {
    const p = spawn(pool, budget.pool);
    if (p) Object.assign(p, { seed: Math.random(), rot: random(0, Math.PI * 2) }, fields);
    return p;
  };
  /** How many of something to make at this quality: at least one when any is wanted. */
  const many = (n: number) => Math.max(n > 0 ? 1 : 0, Math.round(n * budget.rate));

  // ---- what the ground is made of where a foot comes down -------------------------------------------------------
  const tint = new Color3();
  const surface = (x: number, z: number) => {
    const h = world.heightAt(x, z);
    groundColor(x, z, h, slopeAt(x, z), tint);
    const green = tint.g / (tint.r + 0.001);
    return { bare: green < 1.2, grass: green > 1.3, color: tint };
  };
  /** Dust is the ground's colour, paler: fine, dry and in the air. */
  const dustColor = (ground: Color3) => Color3.Lerp(ground, DUST, 0.65);

  const forward = new Vector3(), side = new Vector3();
  const facing = () => {
    forward.set(Math.sin(player.node.rotation.y), 0, Math.cos(player.node.rotation.y));
    side.set(forward.z, 0, -forward.x); // the beaver's left
  };

  function puff(at: Vector3, color: Color3, n: number, spread: number, big: number, life = 0.9) {
    for (let i = 0; i < many(n); i++) {
      const a = random(0, Math.PI * 2), out = random(0.3, 1) * spread, s = random(0.6, 1) * big;
      make({
        kind: KIND.puff, x: at.x + Math.cos(a) * 0.05, y: at.y + s * 0.4, z: at.z + Math.sin(a) * 0.05,
        vx: Math.cos(a) * out, vy: random(0.1, 0.3) * spread + 0.08, vz: Math.sin(a) * out, drag: 2.6, gravity: -0.01,
        life: life * random(0.8, 1.2), fadeIn: 0.06, fadeOut: life * 0.7, size: s * 0.5, grow: s * 1.5, spin: random(-0.6, 0.6),
        r: color.r, g: color.g, b: color.b, a: 0.55,
      });
    }
  }

  function kickGrass(at: Vector3, ground: Color3) {
    for (let i = 0; i < many(3); i++) {
      const blade = Math.random() < 0.6, a = random(0, Math.PI * 2), c = ground.scale(blade ? 1.3 : 2.2);
      make({
        kind: blade ? KIND.blade : KIND.seed, floor: FLOOR.rest, x: at.x, y: at.y + 0.04, z: at.z,
        vx: Math.cos(a) * 0.4 - forward.x * 0.3, vy: random(0.8, 1.4), vz: Math.sin(a) * 0.4 - forward.z * 0.3,
        gravity: 0.35, drag: 1.8, spin: random(-8, 8), life: random(0.8, 1.3), fadeIn: 0.05, fadeOut: 0.4,
        size: blade ? random(0.04, 0.06) : 0.012, grow: blade ? 0.05 : 0.012, squash: blade ? 0.35 : 1, r: c.r, g: c.g, b: c.b, a: 0.95,
      });
    }
  }

  function drops(at: Vector3, n: number, up: number, out: number, spread = 0.15) {
    for (let i = 0; i < many(n); i++) {
      const a = random(0, Math.PI * 2), r = random(0, spread), o = random(0.3, 1) * out;
      make({
        kind: KIND.drop, mode: MODE.streak, floor: FLOOR.die, x: at.x + Math.cos(a) * r, y: at.y + random(0, 0.05), z: at.z + Math.sin(a) * r,
        vx: Math.cos(a) * o, vy: random(0.5, 1) * up, vz: Math.sin(a) * o, gravity: 1, drag: 0.3,
        life: 2, fadeIn: 0.03, fadeOut: 0.1, size: random(0.016, 0.03), grow: 0.014,
        r: WATER.r, g: WATER.g, b: WATER.b, a: 0.75,
      });
    }
  }

  function ring(x: number, z: number, from: number, to: number, life: number, strength = 0.5) {
    make({
      kind: KIND.ring, mode: MODE.water, x, y: world.waterLevel, z, life, fadeIn: 0.12, fadeOut: life * 0.75, size: from, grow: to, rot: 0,
      r: 0.7, g: 0.76, b: 0.76, a: strength * 0.7,
    });
  }

  function foam(x: number, z: number, vx: number, vz: number, s: number) {
    make({
      kind: KIND.foam, mode: MODE.water, x, y: world.waterLevel, z, vx, vz, drag: 1.5, life: random(1.2, 1.8), fadeIn: 0.2, fadeOut: 1,
      size: s * 0.6, grow: s * 1.6, r: 0.75, g: 0.8, b: 0.8, a: 0.3,
    });
  }

  function chips(at: Vector3, n: number) {
    for (let i = 0; i < many(n); i++) {
      const a = random(-1.2, 1.2), shade = random(0.8, 1.25);
      const dir = forward.scale(-0.3).addInPlace(side.scale(Math.sin(a) * 1.1));
      make({
        kind: KIND.chip, floor: FLOOR.rest, x: at.x, y: at.y, z: at.z,
        vx: dir.x * random(0.6, 1.4), vy: random(0.8, 1.8), vz: dir.z * random(0.6, 1.4), gravity: 0.8, drag: 0.6,
        spin: random(-14, 14), life: random(2.5, 4), fadeIn: 0.03, fadeOut: 1, size: random(0.03, 0.05), grow: 0.04,
        squash: random(0.35, 0.6), r: WOOD.r * shade, g: WOOD.g * shade, b: WOOD.b * shade, a: 1,
      });
    }
  }

  /** Where a drop comes down: a tiny ring on the water, a dark wet spot on the ground. */
  function splat(p: Particle) {
    if (world.heightAt(p.x, p.z) < world.waterLevel - 0.03) { if (Math.random() < 0.3) ring(p.x, p.z, 0.02, 0.18, 0.7, 0.3); return; }
    make({
      kind: KIND.seed, mode: MODE.ground, x: p.x, y: world.heightAt(p.x, p.z), z: p.z, life: random(2, 3), fadeIn: 0.05, fadeOut: 1.5,
      size: random(0.04, 0.07), grow: 0.07, r: 0.03, g: 0.025, b: 0.02, a: 0.6,
    });
  }

  // ---- events --------------------------------------------------------------------------------------------------
  const inWater = (place: Vector3) => world.heightAt(place.x, place.z) < world.waterLevel - 0.04;

  events.on("footstep", ({ place, side: foot, speed }) => {
    facing();
    const at = place.add(side.scale(foot === "L" ? 0.1 : -0.1)).addInPlace(forward.scale(0.05));
    if (inWater(at)) { at.y = world.waterLevel; drops(at, 3 + speed * 2, 1.0, 0.3, 0.06); ring(at.x, at.z, 0.08, 0.5, 1.0, 0.35); return; }
    const ground = surface(at.x, at.z);
    at.y = world.heightAt(at.x, at.z);
    const run = speed > 1.3, wet = game.sky?.wet ?? 0;
    // Wet ground splashes under the foot and raises no dust.
    if (wet > 0.15) {
      drops(at, (3 + speed * 2) * wet, 0.6 + speed * 0.25, 0.3, 0.06);
      make({ kind: KIND.ring, mode: MODE.ground, x: at.x, y: at.y, z: at.z, life: 0.45, fadeIn: 0.02, fadeOut: 0.3, size: 0.05, grow: 0.22, r: 1.4, g: 1.5, b: 1.6, a: 0.45 * wet });
      if (wet > 0.5) return;
    }
    if (ground.bare) puff(at, dustColor(ground.color), run ? 3 : 2, run ? 0.4 : 0.2, run ? 0.28 : 0.18);
    else if (ground.grass && run) kickGrass(at, ground.color);
  });

  events.on("land", ({ place, speed }) => {
    if (inWater(place)) { drops(new Vector3(place.x, world.waterLevel, place.z), speed * 6, speed * 0.4, 0.5); ring(place.x, place.z, 0.2, 1.0, 1.4, 0.45); return; }
    const ground = surface(place.x, place.z), strength = Math.min(1, speed / 6);
    if (strength < 0.15) return;
    const color = ground.bare ? dustColor(ground.color) : Color3.Lerp(dustColor(ground.color), DUST, 0.3).scale(0.9);
    puff(new Vector3(place.x, world.heightAt(place.x, place.z), place.z), color, 6 + strength * 10, 0.8 + strength * 1.8, 0.22 + strength * 0.3, 1.3);
    if (ground.grass) { facing(); kickGrass(place, ground.color); }
  });

  /** A splash in the pond; size 1 is a beaver jumping in hard, 0.2 a fish. Bigger sizes spread wider. */
  function splash(place: Vector3, size = 1) {
    const at = new Vector3(place.x, world.waterLevel, place.z), hard = Math.min(1.5, size), wide = Math.sqrt(size);
    drops(at, (30 + 40 * hard) * Math.min(1, size + 0.2), 1.2 + hard * 2.2, (0.6 + hard * 0.8) * wide, 0.3 * wide);
    puff(at, SPRAY, (5 + hard * 5) * Math.min(1, size + 0.3), (0.5 + hard * 0.6) * wide, (0.25 + hard * 0.2) * wide, 0.7);
    ring(at.x, at.z, 0.3 * wide, 1.6 * wide, 1.6, 0.6);
    ring(at.x, at.z, 0.15 * wide, 1.0 * wide, 1.3, 0.4);
    for (let i = 0; i < 6; i++) { const a = i * 1.05, r = 0.25 * wide; foam(at.x + Math.cos(a) * r, at.z + Math.sin(a) * r, Math.cos(a) * 0.4 * wide, Math.sin(a) * 0.4 * wide, 0.3 * wide); }
  }
  const fx: Fx = {
    splash,
    ring: (place, size = 1) => ring(place.x, place.z, size * 0.1, size, 0.8 + size * 0.6, 0.45),
  };
  stage.scene.metadata.fx = fx;

  events.on("enterWater", ({ place, speed }) => splash(place, Math.min(1, 0.3 + speed / 4)));

  // A tail slap: on the water a tall splash and rings running far out, the alarm seen across the pond; on land a
  // low puff of dust (or grass flung up) round the tail.
  events.on("tailSlap", ({ place, water }) => {
    if (water && inWater(place)) {
      splash(place, 1.4);
      for (let i = 0; i < 3; i++) ring(place.x, place.z, 0.4, 2.2 + i * 1.3, 1.8 + i * 0.5, 0.55 - i * 0.1);
      return;
    }
    const at = new Vector3(place.x, world.heightAt(place.x, place.z), place.z), ground = surface(at.x, at.z);
    puff(at, Color3.Lerp(dustColor(ground.color), DUST, 0.3), 7, 0.7, 0.22, 1.1);
    if (ground.grass) { facing(); kickGrass(at, ground.color); }
  });

  let dripping = 0;
  events.on("leaveWater", () => { dripping = 2.5; });
  events.on("drop", ({ place }) => {
    facing();
    const at = place.add(forward.scale(0.45));
    if (inWater(at)) { ring(at.x, at.z, 0.05, 0.5, 1, 0.4); return; }
    at.y = world.heightAt(at.x, at.z);
    puff(at, dustColor(surface(at.x, at.z).color), 3, 0.3, 0.16, 0.8);
  });

  // ---- the work: felling, breaking, building (src/features/build) ------------------------------------------------
  /** The crown of a standing tree: the box its model fills, in the world. */
  const crowns = new Map<number, ReturnType<typeof bounds>>();
  const crownOf = (i: number) => {
    let box = crowns.get(i);
    const tree = world.trees?.[i];
    if (!box && tree) crowns.set(i, box = bounds(tree.model, tree.matrix));
    return box;
  };

  function leaves(x: number, y: number, z: number, n: number, spread: number, push: Vector3, up: number) {
    for (let i = 0; i < many(n); i++) {
      const c = LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)]!, a = random(0, Math.PI * 2), r = random(0, spread);
      make({
        kind: KIND.leaf, floor: FLOOR.rest, x: x + Math.cos(a) * r, y: y + random(-0.3, 0.3) * spread, z: z + Math.sin(a) * r,
        vx: push.x * random(0.5, 1.2) + Math.cos(a) * random(0, 0.6), vy: random(0.2, 1) * up, vz: push.z * random(0.5, 1.2) + Math.sin(a) * random(0, 0.6),
        gravity: 0.06, drag: 1.2, flutter: 1.6, spin: random(-2, 2),
        life: random(8, 14), fadeIn: 0.15, fadeOut: 3, size: random(0.08, 0.11), grow: 0.09, squash: 0.6, r: c.r, g: c.g, b: c.b, a: 1,
      });
    }
  }

  // Chips from the bite: on the bark, on the beaver's side of the trunk, flying back and to the sides.
  const bite = new Vector3();
  events.on("gnaw", ({ place, tree, progress }) => {
    facing();
    const feet = player.node.position, away = Math.hypot(feet.x - place.x, feet.z - place.z), radius = world.trees?.[tree]?.radius ?? 0.2;
    bite.copyFrom(place);
    if (away > 0.01) bite.x += ((feet.x - place.x) / away) * Math.min(radius, away), bite.z += ((feet.z - place.z) / away) * Math.min(radius, away);
    chips(bite, 7 + 6 * progress);
    puff(bite, WOOD, 1, 0.2, 0.08, 0.5);
  });

  const push = new Vector3();
  events.on("treeFalls", ({ tree, direction }) => {
    const box = crownOf(tree);
    if (!box) return;
    const { center: middle, size } = box;
    leaves(middle.x, box.max.y - size.y * 0.3, middle.z, 30, Math.max(size.x, size.z) * 0.4, direction.scale(0.6), 0.3);
  });

  events.on("treeLands", ({ place, tree, speed }) => {
    const s = clamp(speed / 12);
    if (inWater(place)) { splash(place, 0.8 + 1.4 * s); return; }
    const at = new Vector3(place.x, world.heightAt(place.x, place.z), place.z), ground = surface(at.x, at.z), wet = game.sky?.wet ?? 0;
    // Dust thrown up all round the crown and higher than its leaves, or the crown hides it.
    const box = crownOf(tree), reach = box ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5 : 1.5;
    const color = Color3.Lerp(dustColor(ground.color), DUST, 0.3);
    for (let i = 0; i < many((14 + 26 * s) * (1 - 0.6 * wet)); i++) {
      const a = random(0, Math.PI * 2), r = random(0.4, 1.25) * reach, out = random(0.4, 1.2) * (0.6 + s), big = random(0.6, 1) * (0.5 + 0.6 * s);
      const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
      make({
        kind: KIND.puff, x, y: world.heightAt(x, z) + random(0.1, 0.5), z, vx: Math.cos(a) * out, vy: random(0.4, 1) * (0.6 + s), vz: Math.sin(a) * out,
        drag: 1.8, gravity: -0.01, life: random(1.8, 2.6), fadeIn: 0.05, fadeOut: 1.6, size: big * 0.5, grow: big * 1.8, spin: random(-0.5, 0.5),
        r: color.r, g: color.g, b: color.b, a: 0.5,
      });
    }
    leaves(at.x, at.y + 0.8, at.z, 18 + 30 * s, reach * 0.8, push.set(0, 0, 0), 1.5 + 2 * s);
    if (ground.grass) { facing(); kickGrass(at, ground.color); kickGrass(at, ground.color); }
  });

  // Splinters where the trunk breaks: longer and faster than chips, a little dust.
  events.on("treeSplits", ({ place }) => {
    const at = place.clone();
    at.y = Math.max(at.y, world.heightAt(at.x, at.z) + 0.15);
    for (let i = 0; i < many(28); i++) {
      const a = random(0, Math.PI * 2), o = random(0.8, 2.4), shade = random(0.85, 1.3);
      make({
        kind: KIND.chip, floor: FLOOR.rest, x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * o, vy: random(1.5, 3.2), vz: Math.sin(a) * o,
        gravity: 0.8, drag: 0.5, spin: random(-16, 16), life: random(3, 5), fadeIn: 0.02, fadeOut: 1.2, size: random(0.05, 0.09), grow: 0.07,
        squash: random(0.18, 0.3), r: WOOD.r * shade * 1.15, g: WOOD.g * shade * 1.1, b: WOOD.b * shade, a: 1,
      });
    }
    at.y = world.heightAt(at.x, at.z);
    puff(at, dustColor(surface(at.x, at.z).color), 8, 0.9, 0.3, 1.2);
  });

  // A stick into the dam: a splash where it meets the water, a pat of mud where it lies on the bank. Into the food cache
  // on the pond's bed: a cloud of silt stirred up and bubbles rising from the pile.
  events.on("stickPlaced", ({ place }) => {
    if (place.y < world.waterLevel - 0.5) {
      puff(new Vector3(place.x, world.heightAt(place.x, place.z), place.z), MUD, 8, 0.5, 0.3, 1.6);
      for (let i = 0; i < many(18); i++) bubble(place.x, place.y + 0.1, place.z, 0.3, random(0.02, 0.05));
      return;
    }
    if (inWater(place) || place.y < world.waterLevel + 0.05) { splash(place, 0.35); return; }
    const at = new Vector3(place.x, world.heightAt(place.x, place.z), place.z);
    puff(at, MUD, 4, 0.4, 0.2, 0.8);
    for (let i = 0; i < many(9); i++) {
      const a = random(0, Math.PI * 2), o = random(0.3, 0.8);
      make({
        kind: KIND.seed, floor: FLOOR.rest, x: at.x, y: at.y + 0.05, z: at.z, vx: Math.cos(a) * o, vy: random(0.8, 1.5), vz: Math.sin(a) * o,
        gravity: 1, drag: 0.4, life: random(1.5, 2.5), fadeIn: 0.02, fadeOut: 0.8, size: random(0.025, 0.04), grow: 0.03,
        r: MUD.r, g: MUD.g, b: MUD.b, a: 1,
      });
    }
  });

  // Half the dam: a handful of leaves thrown up over it, a small cheer on the way.
  events.on("stickPlaced", ({ place, count, total }) => { if (count * 2 === total) leaves(place.x, place.y + 0.3, place.z, 30, 0.3, push.set(0, 0, 0), 3); });

  // The dam holds: a fountain of bright bits and leaves over it, and rings running out over the pond.
  events.on("damFinished", ({ place }) => {
    const at = place.clone();
    for (let i = 0; i < many(120); i++) {
      const c = CHEER[Math.floor(Math.random() * CHEER.length)]!, a = random(0, Math.PI * 2), o = random(0.4, 1.8);
      make({
        kind: Math.random() < 0.3 ? KIND.leaf : KIND.seed, floor: FLOOR.rest, x: at.x + random(-0.4, 0.4), y: at.y + 0.3, z: at.z + random(-0.4, 0.4),
        vx: Math.cos(a) * o, vy: random(3.5, 6), vz: Math.sin(a) * o, gravity: 0.35, drag: 0.9, flutter: 0.8, spin: random(-6, 6),
        life: random(3, 4.5), fadeIn: 0.05, fadeOut: 1.2, size: random(0.05, 0.08), grow: 0.06, squash: 0.6, r: c.r, g: c.g, b: c.b, a: 1,
      });
    }
    const pond = world.pond;
    if (pond) for (let i = 0; i < 4; i++) ring(pond.x + random(-1, 1), pond.z + random(-1, 1), 0.3, 2.5 + i, 2.5 + i * 0.4, 0.5);
  });

  // ---- motes: a box of air in front of the camera, each mote wrapped back in when it drifts out -----------------
  const motes: Particle[] = [];
  const BOX = 5; // metres across, centred AHEAD metres in front of the camera
  const AHEAD = 3.2;
  const box = new Vector3(), look = new Vector3();
  const fillMotes = () => {
    // Motes shine in the light of day: none float in the rain, few in the night.
    const want = Math.round(MOTES * budget.rate * (1 - (game.sky?.rain ?? 0)) * (1 - 0.8 * (game.sky?.dark ?? 0)));
    while (motes.length > want) motes.pop()!.alive = false;
    while (motes.length < want) {
      const p = make({
        kind: KIND.mote, x: box.x + random(-1, 1) * BOX / 2, y: box.y + random(-1, 1) * BOX / 2, z: box.z + random(-1, 1) * BOX / 2,
        life: Infinity, fadeIn: 2, fadeOut: 0, size: random(0.018, 0.03), grow: 0, gravity: 0,
        // Brighter than any diffuse surface: a mote throws sunlight forward. In shadow the shadow map darkens it.
        r: 2.6, g: 2.4, b: 1.9, a: 0,
      });
      if (!p) break;
      p.grow = p.size;
      motes.push(p);
    }
  };
  const wrap = (v: number, centre: number) => centre + ((((v - centre + BOX / 2) % BOX) + BOX) % BOX) - BOX / 2;
  function moveMotes(dt: number, time: number) {
    look.copyFrom(stage.camera.getForwardRay().direction);
    stage.camera.position.addToRef(look.scale(AHEAD), box);
    box.y = stage.camera.position.y + 0.2; // eye height: seen against trees, not grass
    fillMotes();
    for (const p of motes) {
      const s = p.seed * 60;
      p.vx = Math.sin(time * 0.21 + s) * 0.05 + 0.03;   // a slow breeze, each its own way
      p.vy = Math.sin(time * 0.17 + s * 1.3) * 0.03 + 0.004;
      p.vz = Math.cos(time * 0.19 + s * 0.7) * 0.05;
      p.x = wrap(p.x + p.vx * dt, box.x); p.y = wrap(p.y + p.vy * dt, box.y); p.z = wrap(p.z + p.vz * dt, box.z);
      // Fades out towards the edge of the box, so wrapping never shows; none below the ground or in the water.
      const edge = Math.max(Math.abs(p.x - box.x), Math.abs(p.y - box.y), Math.abs(p.z - box.z)) / (BOX / 2);
      const above = p.y - surfaceAt(p.x, p.z);
      const twinkle = 0.75 + 0.25 * Math.sin(time * (1.3 + p.seed * 2) + s);
      p.a = 0.6 * twinkle * (1 - edge * edge * edge) * Math.min(1, Math.max(0, above / 0.3)) * Math.min(1, Math.max(0, (Math.hypot(p.x - stage.camera.position.x, p.y - stage.camera.position.y, p.z - stage.camera.position.z) - 0.4) / 0.6));
    }
  }

  // ---- leaves: now and then one from a tree near the camera ---------------------------------------------------
  let nextLeaf = 1.5;
  function leaf(x: number, y: number, z: number) {
    const c = LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)]!;
    make({
      kind: KIND.leaf, floor: FLOOR.rest, x, y, z, vy: -0.3, gravity: 0.06, drag: 1.2, flutter: 1.6, spin: random(-1.5, 1.5),
      life: 22, fadeIn: 0.8, fadeOut: 3, size: random(0.08, 0.11), grow: 0.09, squash: 0.6, r: c.r, g: c.g, b: c.b, a: 1,
    });
  }
  drawn.mesh.metadata = { leaf }; // for the lab: a leaf at a chosen place

  function dropLeaf() {
    const eye = stage.camera.position;
    look.copyFrom(stage.camera.getForwardRay().direction);
    // Trees in front of the camera, not too far: a leaf nobody sees is wasted.
    const near = trees.filter((t) => Math.hypot(t.x - eye.x, t.z - eye.z) < 11 && (t.x - eye.x) * look.x + (t.z - eye.z) * look.z > 1);
    if (!near.length) return;
    const t = near[Math.floor(Math.random() * near.length)]!, a = random(0, Math.PI * 2), r = random(0.4, 1.8) * t.scale;
    leaf(t.x + Math.cos(a) * r, world.heightAt(t.x, t.z) + random(2.6, 4) * t.scale, t.z + Math.sin(a) * r);
  }

  // ---- diving: bubbles, and the breath on the HUD ----------------------------------------------------------------
  /** A bubble: a ring facing the camera (the only such ring), rising, wobbling, gone at the surface. */
  function bubble(x: number, y: number, z: number, spread: number, big: number) {
    make({
      kind: KIND.ring, mode: MODE.face, x: x + random(-spread, spread), y: y + random(-spread, spread) * 0.5, z: z + random(-spread, spread),
      vx: random(-0.15, 0.15), vy: random(0.1, 0.35), vz: random(-0.15, 0.15), gravity: -0.06, drag: 1.4, flutter: 0.4,
      life: 5, fadeIn: 0.05, fadeOut: 0.3, size: random(0.4, 1) * big, grow: random(0.6, 1.2) * big, r: 1.3, g: 1.45, b: 1.45, a: 0.8,
    });
  }
  let breathing = 0, wasDiving = false;
  function diving(dt: number) {
    const at = player.node.position, under = world.waterLevel - at.y > 0.5;
    if (player.diving && !wasDiving) { facing(); for (let i = 0; i < many(26); i++) bubble(at.x + forward.x * 0.2, at.y + 0.35, at.z + forward.z * 0.2, 0.25, 0.05); }
    wasDiving = player.diving;
    if (!under) return;
    breathing -= dt * budget.rate;
    if (breathing > 0) return;
    breathing = random(0.25, 0.7); // a few at a time from the nose, now and then
    facing();
    for (let i = 0; i < 1 + Math.floor(Math.random() * 3); i++) bubble(at.x + forward.x * 0.45, at.y + 0.33, at.z + forward.z * 0.45, 0.02, random(0.015, 0.03));
  }
  // Ten bubbles in a shallow arc above the bottom middle (over the hints), shown only while the breath is not full; each pops (grows,
  // fades) as its tenth of the breath goes. Babylon draws them on the HUD; the overlay's label tells screen readers.
  const BUBBLES = 10, breathRing = new Overlay(stage, "breath", false, 3);
  const dots: ReturnType<Overlay["rect"]>[] = [];
  onViewport(stage, () => {
    breathRing.clear(); dots.length = 0; const b = hudLayout(stage).breath; // its home in the HUD's bottom centre (hud/style.ts)
    for (let i = 0; i < BUBBLES; i++) {
      const a = (i / (BUBBLES - 1) - 0.5) * 1.1, x = b.x + b.w / 2 + Math.sin(a) * 90, y = b.y + b.h - 7 - Math.cos(a) * 30;
      const dot = breathRing.rect(`breath-${i}`, screenBox(x - 7, y - 7, 14, 14), "rgba(220,240,240,.18)", 7);
      dot.color = "rgba(240,250,250,.85)"; dot.thickness = 1.5;
      dots.push(dot);
    }
  });
  let shownBreath = 1, ringAlpha = 0, said = -1;
  function breath(dt: number) {
    const b = player.breath;
    shownBreath += (b - shownBreath) * Math.min(1, dt * 8);
    ringAlpha += ((b < 0.999 ? 1 : 0) - ringAlpha) * Math.min(1, dt * (b < 0.999 ? 6 : 1.5));
    breathRing.group.alpha = ringAlpha;
    breathRing.show(ringAlpha > 0.01);
    dots.forEach((dot, i) => {
      const left = Math.max(0, Math.min(1, shownBreath * BUBBLES - i)); // 1 full … 0 gone
      dot.alpha = left; dot.scaleX = dot.scaleY = 1 + 0.6 * (1 - left);
    });
    const n = Math.ceil(b * BUBBLES);
    if (n !== said) { said = n; breathRing.dom.setAttribute("aria-label", `breath ${n} of ${BUBBLES}`); }
  }

  // ---- what goes on while the beaver swims, gnaws, drips -------------------------------------------------------
  let wake = 0, bob = 0, drip = 0, time = 0;

  function steady(dt: number) {
    const m = player.motion, at = player.node.position;
    facing();
    // Swimming or wading: rings and a soft wake.
    const depth = world.waterLevel - world.heightAt(at.x, at.z), wet = m.swimming >= 0.5 || (depth > 0.1 && at.y < world.waterLevel);
    if (wet && world.waterLevel - at.y < 0.5) { // under, it leaves no rings on the surface
      const speed = player.velocity.length();
      bob -= dt;
      if (bob <= 0) { bob = speed > 0.2 ? 0.55 : 1.1; ring(at.x - forward.x * 0.15, at.z - forward.z * 0.15, 0.32, speed > 0.2 ? 0.8 : 0.9, 1.6, speed > 0.2 ? 0.3 : 0.22); }
      if (speed > 0.15) {
        wake -= dt * Math.min(1.5, speed);
        if (wake <= 0) {
          wake = 0.07;
          for (const s of [-1, 1]) {
            const x = at.x - forward.x * 0.25 + side.x * s * 0.2, z = at.z - forward.z * 0.25 + side.z * s * 0.2;
            foam(x, z, side.x * s * 0.25 - forward.x * 0.05, side.z * s * 0.25 - forward.z * 0.05, 0.16);
          }
        }
      }
    }
    // Dripping after climbing out.
    if (dripping > 0) {
      dripping -= dt;
      drip -= dt * budget.rate * (0.4 + dripping / 2.5);
      while (drip <= 0) {
        drip += 0.02;
        const a = random(0, Math.PI * 2), r = random(0.18, 0.3);
        make({
          kind: KIND.drop, mode: MODE.streak, floor: FLOOR.die, x: at.x + Math.cos(a) * r, y: at.y + random(0.15, 0.55), z: at.z + Math.sin(a) * r,
          vx: player.velocity.x * 0.6, vy: -0.2, vz: player.velocity.z * 0.6, gravity: 1, life: 1.5, fadeIn: 0.05, fadeOut: 0.1,
          size: random(0.01, 0.016), grow: 0.012, r: WATER.r, g: WATER.g, b: WATER.b, a: 0.7,
        });
      }
    }
  }

  // ---- rain: drops landing near the camera, a crown of droplets on the ground, a small ring on the pond --------
  let raining = 0;
  function rain(dt: number, amount: number) {
    raining += dt * amount * RAIN_SPLASHES * budget.rate;
    if (raining < 1) return;
    const eye = stage.camera.position;
    look.copyFrom(stage.camera.getForwardRay().direction);
    const heading = Math.atan2(look.x, look.z);
    for (; raining >= 1; raining--) {
      // In front of the camera, denser near it: the splashes seen are the ones made.
      const a = heading + random(-1, 1) * 0.9, r = 0.8 + 9 * Math.random() ** 1.6, x = eye.x + Math.sin(a) * r, z = eye.z + Math.cos(a) * r;
      const h = world.heightAt(x, z);
      if (h < world.waterLevel - 0.03) { ring(x, z, 0.015, random(0.1, 0.2), 0.55, 0.32); continue; }
      // A crown of droplets and a ripple of wet light on the ground.
      make({ kind: KIND.ring, mode: MODE.ground, x, y: h, z, life: 0.3, fadeIn: 0.02, fadeOut: 0.22, size: 0.02, grow: random(0.08, 0.13), r: 1.4, g: 1.5, b: 1.6, a: 0.45 });
      for (let i = 0; i < 3; i++) {
        const d = random(0, Math.PI * 2), o = random(0.2, 0.5);
        const p = make({
          kind: KIND.drop, mode: MODE.streak, floor: FLOOR.die, x, y: h + 0.01, z, vx: Math.cos(d) * o, vy: random(0.7, 1.2), vz: Math.sin(d) * o,
          gravity: 1, life: 0.45, fadeIn: 0.02, fadeOut: 0.1, size: random(0.016, 0.024), grow: 0.014, r: 1.5, g: 1.6, b: 1.7, a: 0.85, // glints of the sky
        });
        if (p) p.landed = true; // no wet spot for each: the ground is wet already
      }
    }
  }

  const grass = grassOf(stage.scene);

  return {
    update(dt) {
      // The grass sways with the sky's wind; without the sky it keeps the breeze it was tuned with.
      if (grass && game.sky) grass.value = game.sky.wind;
      if (!stage.paused) {
        time += dt;
        steady(dt);
        diving(dt);
        breath(dt);
        rain(dt, game.sky?.rain ?? 0);
        nextLeaf -= dt * budget.rate;
        if (nextLeaf <= 0) { nextLeaf = random(2.5, 6); dropLeaf(); }
        moveMotes(dt, time);
        for (const p of pool) {
          if (!p.alive || p.kind === KIND.mote) continue;
          if (p.mode === MODE.water) p.y = world.waterLevel; // rings and foam lie on the pond as it is now
          else if (p.kind === KIND.ring && p.mode === MODE.face && !p.vanish && p.y > world.waterLevel - 0.02) { // a bubble at the surface
            p.vanish = 14;
            if (p.size > 0.025) ring(p.x, p.z, 0.03, 0.25, 0.8, 0.3);
          }
          advance(p, dt, p.kind === KIND.drop ? surfaceAt : groundAt);
          if (p.kind === KIND.drop && p.vanish && !p.landed) { p.landed = true; splat(p); }
        }
        for (const p of motes) p.age += dt;
      }
      drawn.write(pool, stage.scene.activeCamera ?? stage.camera);
    },
  };
};
