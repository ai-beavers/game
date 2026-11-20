// The real player on the real ground colliders, swimming towards the shore: it climbs out anywhere along it, at the
// low pond, half risen and full; the lodge and a rock on the shore still stop it, and swimming along the shore it
// stays in the water. And a toss over the meadow. Only what a player sees: afloat or on foot, and where. bun test src/player/shore
import { beforeAll, describe, expect, test } from "bun:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import RAPIER from "@dimforge/rapier3d-compat";
import type { Stage } from "../engine.ts";
import { groundAt, groundColliders, POND, WATER_LEVEL } from "../world/terrain.ts";
import { POND_RISE } from "../features/build/rules.ts";
import { TOSS_SPEED, TOSS_UP } from "../features/bear/rules.ts";
import { createPlayerControls, type PlayerControls } from "./index.ts";
import type { Input } from "./input.ts";
import { SLAP_HIT, SLAP_TIME } from "./state.ts";

const dt = 1 / 60;
const LOW = WATER_LEVEL - POND_RISE, FULL = WATER_LEVEL;

beforeAll(async () => {
  await RAPIER.init();
  const g = globalThis as unknown as { window?: EventTarget };
  g.window ??= new EventTarget(); // the keyboard and the camera listen on it
});

/** A world with the ground's colliders, the pond at `level`, and the player; `extra` adds colliders. */
function setUp(level: number, extra?: (physics: RAPIER.World) => void) {
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  physics.timestep = dt;
  groundColliders(physics);
  extra?.(physics);
  scene.metadata = { water: { level } }; // the live level (src/world/water.ts); the world's own stays WATER_LEVEL
  const camera = new FreeCamera("follow", new Vector3(0, 2, 0), scene);
  const stage = { engine, scene, camera, physics, canvas: new EventTarget(), paused: false, timeScale: 1, bind() {}, unbind() {} } as unknown as Stage;
  const player = createPlayerControls(stage, { spawn: new Vector3(POND.x, groundAt(POND.x, POND.z), POND.z), waterLevel: WATER_LEVEL });
  physics.step();
  // The move input that walks the beaver along the world's (dx, dz), relative to the camera as the player's is.
  let way: { x: number; z: number } | undefined;
  player.keys.add({ read(into: Input) {
    const fx = -Math.sin(player.camera.yaw), fz = -Math.cos(player.camera.yaw);
    into.move.x = way ? fx * way.z - fz * way.x : 0;
    into.move.y = way ? fx * way.x + fz * way.z : 0;
    return into;
  } });
  type Way = { x: number; z: number };
  const run = (seconds: number, to?: Way | (() => Way), until?: () => boolean) => {
    for (let t = 0; t < seconds && !until?.(); t += dt) { way = typeof to === "function" ? to() : to; player.step(dt); physics.step(); }
    way = undefined;
  };
  return { player, run };
}

/** Where the shore is along bearing a at this level: the first point out from the middle that is dry. */
function shoreAt(a: number, level: number) {
  for (let r = 2; r < 8; r += 0.02) if (groundAt(POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r) > level) return r;
  return 8;
}

/** Puts the beaver swimming along bearing a, a little out from where the water gets deep enough to swim in, and lets
 *  it settle at floating depth. */
function swimmingAt(w: ReturnType<typeof setUp>, a: number, level: number) {
  let r = shoreAt(a, level);
  while (r > 1 && level - groundAt(POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r) < 0.7) r -= 0.02;
  r -= 0.3;
  const x = POND.x + Math.cos(a) * r, z = POND.z + Math.sin(a) * r;
  w.player.teleport(x, Math.max(groundAt(x, z), level - 0.3), z, Math.atan2(Math.cos(a), Math.sin(a)));
  w.run(0.8);
}

const onLand = (p: PlayerControls, level: number) => !p.afloat && groundAt(p.feet.x, p.feet.z) > level;
const out = (p: PlayerControls) => Math.hypot(p.feet.x - POND.x, p.feet.z - POND.z);

describe("swimming to the shore", () => {
  for (const [name, level] of [["the low pond", LOW], ["a pond half risen", (LOW + FULL) / 2], ["the full pond", FULL]] as const)
    test(`it climbs out anywhere along it: ${name}`, () => {
      const w = setUp(level), stuck: string[] = [];
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2, land = { x: Math.cos(a), z: Math.sin(a) };
        swimmingAt(w, a, level);
        expect(w.player.afloat).toBe(true);
        w.run(4, land, () => onLand(w.player, level));
        w.run(0.3, land); // and on: it walks, it does not slide back in
        if (!onLand(w.player, level)) stuck.push(`bearing ${a.toFixed(2)}: ${out(w.player).toFixed(2)} m out, the shore at ${shoreAt(a, level).toFixed(2)}`);
      }
      expect(stuck).toEqual([]);
    }, 30_000);

  // The lodge's mound (src/features/build/dam.ts: a convex hull of an ellipsoid 2.5 m wide, 3.9 m tall) in the middle,
  // its top 0.3 m out of the water: within a climb's reach, but not the ground. It may stand on its flank under water,
  // as it always could, never out of the water on top.
  const lodge = (physics: RAPIER.World) => {
    const points: number[] = [];
    for (let i = 0; i <= 8; i++) for (let j = 0; j < 16; j++) {
      const t = (i / 8) * Math.PI, p = (j / 16) * Math.PI * 2;
      points.push(Math.sin(t) * Math.cos(p) * 1.25, Math.cos(t) * 1.95, Math.sin(t) * Math.sin(p) * 1.25);
    }
    physics.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(points))!.setTranslation(POND.x, FULL + 0.3 - 1.95, POND.z));
  };
  test("the lodge still stops it: it never climbs out onto it", () => {
    const w = setUp(FULL, lodge);
    for (const a of [0, Math.PI / 2, Math.PI]) {
      w.player.teleport(POND.x + Math.cos(a) * 1.9, FULL - 0.3, POND.z + Math.sin(a) * 1.9);
      w.run(0.8);
      w.run(3, { x: -Math.cos(a), z: -Math.sin(a) });
      expect(w.player.feet.y).toBeLessThan(FULL - 0.2);
      expect(out(w.player)).toBeGreaterThan(0.6);
    }
  });

  test("a rock on the shore still stops it: it never climbs onto it, nor past it", () => {
    const a = 0, x = POND.x + shoreAt(a, FULL) - 0.6, z = POND.z;
    // A block of rock 1.6 m across with upright sides, its top 0.3 m out of the water, from the dry shore out to where the
    // water is swimming deep (rocks are convex hulls too).
    const rock = (physics: RAPIER.World) => physics.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array([
      -0.8, -0.6, -0.8, 0.8, -0.6, -0.8, -0.8, -0.6, 0.8, 0.8, -0.6, 0.8, -0.8, 0.3, -0.8, 0.8, 0.3, -0.8, -0.8, 0.3, 0.8, 0.8, 0.3, 0.8,
    ]))!.setTranslation(x, FULL, z));
    const w = setUp(FULL, rock);
    swimmingAt(w, a, FULL);
    expect(w.player.afloat).toBe(true);
    w.run(3, { x: 1, z: 0 });
    expect(w.player.afloat).toBe(true);
    expect(w.player.feet.y).toBeLessThan(FULL - 0.2);
    expect(w.player.feet.x).toBeLessThan(x - 0.8);
  });

  // (On the low pond's south side it may come to stand on the lip of the basin's wall, in the shallows: still in the water.)
  test("swimming along the shore, it stays in the water", () => {
    const left: string[] = [];
    for (const level of [LOW, FULL]) {
      const w = setUp(level);
      for (const a of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) {
        swimmingAt(w, a, level);
        const r = out(w.player);
        // round the pond, anticlockwise, as far out as it started
        w.run(3, () => {
          const b = Math.atan2(w.player.feet.z - POND.z, w.player.feet.x - POND.x), off = out(w.player) - r;
          return { x: -Math.sin(b) - Math.cos(b) * off, z: Math.cos(b) - Math.sin(b) * off };
        });
        if (w.player.feet.y > level - 0.2 || groundAt(w.player.feet.x, w.player.feet.z) > level) left.push(`bearing ${a.toFixed(2)} at ${level}: ${out(w.player).toFixed(2)} m out, ${(level - w.player.feet.y).toFixed(2)} deep (from ${r.toFixed(2)})`);
      }
    }
    expect(left).toEqual([]);
  });
});

// A toss (src/features/bear: the Bear's Swipe) on the same ground: the beaver flies in a low arc and stands again.
describe("tossed over the meadow", () => {
  test("it flies a few metres the way it was thrown, lands on its feet and walks on", () => {
    const w = setUp(FULL), x = 0, z = 24;
    w.player.teleport(x, groundAt(x, z), z);
    w.run(0.5);
    w.player.toss(TOSS_SPEED, 0, TOSS_UP);
    let top = 0, air = 0;
    w.run(2, undefined, () => { top = Math.max(top, w.player.feet.y - groundAt(w.player.feet.x, w.player.feet.z)); air += dt; return air > 0.1 && w.player.motion.grounded; });
    expect(w.player.motion.grounded).toBe(true);
    expect(w.player.feet.x - x).toBeGreaterThan(2);
    expect(w.player.feet.x - x).toBeLessThan(3.2);
    expect(Math.abs(w.player.feet.z - z)).toBeLessThan(0.1);
    expect(top).toBeGreaterThan(0.35);
    expect(top).toBeLessThan(0.8);
    // Landed, the throw is over: it stands, and walks where it is told.
    const landed = w.player.feet.x;
    w.run(0.5);
    expect(Math.abs(w.player.feet.x - landed)).toBeLessThan(0.05);
    w.run(1, { x: 0, z: 1 });
    expect(w.player.feet.z - z).toBeGreaterThan(0.3);
  });
});

// A tail slap at a foe (src/features/bear: the Bear while they fight) on the same ground: a leap, once round in the air.
describe("the leaping tail slap", () => {
  /** Slaps once and follows the slap to its end: how high it got, how long it was in the air, and how far round
   *  from `heading` the body was drawn as the tail struck and at the end, radians. */
  function slapOnce(w: ReturnType<typeof setUp>, heading: number) {
    let key = true, top = 0, air = 0, struck: number | undefined, began = false;
    w.player.keys.add({ read(into: Input) { into.slap = key; return into; } });
    const round = () => { w.player.update(dt, 1); return Math.atan2(Math.sin(w.player.node.rotation.y - heading), Math.cos(w.player.node.rotation.y - heading)); };
    w.run(2, undefined, () => {
      const m = w.player.motion;
      began ||= m.actionProgress > 0;
      if (began) key = false;
      top = Math.max(top, w.player.feet.y - groundAt(w.player.feet.x, w.player.feet.z));
      if (began && !m.grounded) air += dt;
      if (struck === undefined && m.actionProgress >= SLAP_HIT) struck = round();
      return began && m.actionProgress === 0;
    });
    return { top, air, struck: struck!, end: round() };
  }

  test("with a foe it leaps and faces it, its back is turned to it as the tail strikes, and it lands facing it", () => {
    const w = setUp(FULL), x = 0, z = 24;
    w.player.teleport(x, groundAt(x, z), z, Math.PI / 2); // looking along x
    w.run(0.5);
    w.player.foe = { x, z: z + 2 }; // ahead along z: heading 0
    const { top, air, struck, end } = slapOnce(w, 0);
    expect(top).toBeGreaterThan(1.1);
    expect(top).toBeLessThan(1.5);
    expect(air).toBeGreaterThan(SLAP_HIT * SLAP_TIME + 0.2); // still up well after the tail struck
    expect(air).toBeLessThan(SLAP_TIME);
    expect(Math.abs(struck)).toBeGreaterThan(Math.PI - 0.2); // half round: the tail towards the foe
    expect(Math.abs(end)).toBeLessThan(0.05);
    expect(w.player.motion.grounded).toBe(true);
    expect(Math.hypot(w.player.feet.x - x, w.player.feet.z - z)).toBeLessThan(0.3);
  });

  test("with no foe the tail slap stays what it was: on its feet, not turning", () => {
    const w = setUp(FULL), x = 0, z = 24;
    w.player.teleport(x, groundAt(x, z), z, 0);
    w.run(0.5);
    const { top, air, struck, end } = slapOnce(w, 0);
    expect([air, Math.abs(struck) < 0.01, Math.abs(end) < 0.01]).toEqual([0, true, true]);
    expect(top).toBeLessThan(0.05);
  });
});
