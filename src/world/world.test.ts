// Tests for the world's rules: the shape of the ground, where things are placed, and how Rapier's heightfield maps
// rows and columns (terrain.ts relies on it). Run: bun test src/world
import { describe, expect, test } from "bun:test";
import RAPIER from "@dimforge/rapier3d-compat";
import { placeAll, SPAWN } from "./place.ts";
import { dayAt } from "../features/sky/clock.ts";
import { BASIN, groundAt, groundColliders, heightAt, HILL, POND, pondRatio, RIM, SHELF, SITE, slopeAt, sunsetGap, WATER_LEVEL } from "./terrain.ts";

describe("heightAt", () => {
  test("the pond is about 1.2 m deep in its middle", () => {
    expect(heightAt(POND.x, POND.z)).toBeCloseTo(WATER_LEVEL - 1.2, 2);
    expect(heightAt(POND.x + 0.5, POND.z - 0.5)).toBeLessThan(WATER_LEVEL - 1.1);
  });
  test("the pond is about 8 m across at the water line", () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const at = (r: number) => heightAt(POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r);
      expect(at(3.3)).toBeLessThan(WATER_LEVEL);
      expect(at(5)).toBeGreaterThan(WATER_LEVEL);
    }
  });
  test("the shore is shallow enough to walk in and out (< 30°)", () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) for (let r = 2; r < 5.5; r += 0.25) {
      const x = POND.x + Math.cos(a) * r, z = POND.z + Math.sin(a) * r;
      if (pondRatio(x, z) > SHELF + 0.05) expect(slopeAt(x, z)).toBeLessThan(Math.tan((30 * Math.PI) / 180));
    }
  });
  test("a basin about 3 m deep on the south side, with room to dive; the shallows along the bank stay", () => {
    let deepest = 0, room = 0, shelf = 0;
    for (let x = POND.x - 4.5; x < POND.x + 4.5; x += 0.1) for (let z = POND.z - 4.5; z < POND.z + 4.5; z += 0.1) {
      const h = heightAt(x, z);
      deepest = Math.min(deepest, h);
      if (h < WATER_LEVEL - 2.5) room += 0.01;
      if (pondRatio(x, z) >= SHELF) shelf = Math.min(shelf, h);
    }
    expect(deepest).toBeLessThan(WATER_LEVEL - 2.9);
    expect(deepest).toBeGreaterThan(WATER_LEVEL - 3.4);
    expect(room).toBeGreaterThan(2.5); // m² deeper than 2.5 m
    expect(heightAt(BASIN.x, BASIN.z)).toBeLessThan(WATER_LEVEL - 2.5);
    expect(BASIN.z).toBeLessThan(POND.z - 1.5); // south of the middle: the lodge stands there, the dam at the west shore
    expect(shelf).toBeGreaterThan(WATER_LEVEL - 0.6); // the old bowl's shore, untouched
  });
  test("the bed stays up where the lodge stands and where the dam meets the water", () => {
    for (let r = 0; r <= 1.25; r += 0.05) for (let a = 0; a < Math.PI * 2; a += 0.1)
      expect(heightAt(POND.x + 0.6 + Math.cos(a) * r, POND.z + Math.sin(a) * r)).toBeGreaterThan(WATER_LEVEL - POND.depth - 0.15);
    expect(heightAt(SITE.x + 1.1 + 1, SITE.z)).toBeGreaterThan(WATER_LEVEL - 1);
  });
  test("the building site is flat", () => {
    const heights: number[] = [];
    for (let x = -1.2; x <= 1.2; x += 0.3) for (let z = -1.2; z <= 1.2; z += 0.3)
      if (Math.hypot(x, z) <= 1.2) heights.push(heightAt(SITE.x + x, SITE.z + z));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.02);
    expect(Math.min(...heights)).toBeGreaterThan(WATER_LEVEL);
  });
  test("the hill is about 3 m high, walkable from the clearing (≤ 25°) and steep on its far side", () => {
    expect(heightAt(HILL.x, HILL.z)).toBeGreaterThan(2.8);
    const toward = { x: -HILL.x, z: -HILL.z }, length = Math.hypot(toward.x, toward.z);
    let steepest = 0, far = 0;
    for (let r = 0; r < 9; r += 0.2) {
      steepest = Math.max(steepest, slopeAt(HILL.x + (toward.x / length) * r, HILL.z + (toward.z / length) * r));
      far = Math.max(far, slopeAt(HILL.x - (toward.x / length) * r, HILL.z - (toward.z / length) * r));
    }
    expect(steepest).toBeLessThan(Math.tan((25 * Math.PI) / 180));
    expect(far).toBeGreaterThan(1); // more than 45°
  });
  test("the edge is higher than the middle, all round; lower where the evening sun goes down", () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
      const x = Math.cos(a) * (RIM + 7), z = Math.sin(a) * (RIM + 7);
      expect(heightAt(x, z)).toBeGreaterThan(heightAt(0, 0) + (sunsetGap(x, z) > 0 ? 0.8 : 2.5));
    }
  });
  test("the evening sun, 6° to 17° high, reaches the middle of the clearing over the bank", () => {
    for (const hour of [18.5, 19, 19.5]) {
      const sun = dayAt(hour).sun, from = heightAt(0, 0) + 0.1;
      for (let s = 1; s < 70; s += 0.5) expect(heightAt(sun.x * s, sun.z * s)).toBeLessThan(from + sun.y * s);
    }
  });
});

describe("placement", () => {
  const layout = placeAll();
  const wet = (s: { x: number; z: number }) => heightAt(s.x, s.z) <= WATER_LEVEL || pondRatio(s.x, s.z) < 1.1;
  test("is the same every time", () => expect(placeAll()).toEqual(layout));
  test("has what the world promises", () => {
    expect(layout.tree.length).toBeGreaterThanOrEqual(8);
    expect(layout.tree.length).toBeLessThanOrEqual(15);
    expect(layout.tree.some((t) => Math.hypot(t.x - POND.x, t.z - POND.z) < POND.radius + 3)).toBe(true);
    expect(layout.crate).toHaveLength(3);
    expect(layout.stick).toHaveLength(20);
    expect(layout.reed.length).toBeGreaterThan(10);
  });
  test("nothing dry stands in the pond, nothing solid on the site", () => {
    for (const s of [...layout.tree, ...layout.stump, ...layout.log, ...layout.rock, ...layout.crate, ...layout.stick]) expect(wet(s)).toBe(false);
    for (const s of [...layout.tree, ...layout.stump, ...layout.log, ...layout.rock])
      expect(Math.hypot(s.x - SITE.x, s.z - SITE.z)).toBeGreaterThan(SITE.radius);
  });
  test("reeds grow at the water's edge", () => {
    for (const s of layout.reed) expect(Math.abs(heightAt(s.x, s.z) - WATER_LEVEL)).toBeLessThan(0.4);
  });
  test("sticks lie on dry ground inside the clearing, with the sizes asked for", () => {
    for (const s of layout.stick) {
      expect(heightAt(s.x, s.z)).toBeGreaterThan(WATER_LEVEL);
      expect(Math.hypot(s.x, s.z)).toBeLessThan(RIM);
      expect(s.scale).toBeGreaterThanOrEqual(0.5);
      expect(s.scale).toBeLessThanOrEqual(0.8);
      expect(s.thickness!).toBeGreaterThanOrEqual(0.03);
      expect(s.thickness!).toBeLessThanOrEqual(0.05);
    }
  });
  test("rocks and a sunken log lie down in the deep basin", () => {
    expect(layout.bedRock.length).toBeGreaterThanOrEqual(3);
    expect(layout.sunkenLog).toHaveLength(1);
    for (const s of [...layout.bedRock, ...layout.sunkenLog]) expect(heightAt(s.x, s.z)).toBeLessThan(WATER_LEVEL - 1.2);
  });
  test("the spawn is clear and dry", () => {
    expect(wet(SPAWN)).toBe(false);
    for (const s of [...layout.tree, ...layout.rock, ...layout.stump, ...layout.log]) expect(Math.hypot(s.x - SPAWN.x, s.z - SPAWN.z)).toBeGreaterThan(1.5);
  });
});

describe("the ground as drawn and collided", () => {
  test("follows heightAt within 0.1 m all over the pond, the basin's walls too", () => {
    let worst = 0;
    for (let x = POND.x - 5; x < POND.x + 5; x += 0.02) for (let z = POND.z - 5; z < POND.z + 5; z += 0.02)
      if (pondRatio(x, z) < 1.3) worst = Math.max(worst, Math.abs(groundAt(x, z) - heightAt(x, z)));
    expect(worst).toBeLessThan(0.1);
  });
  test("its colliders are where it is drawn, and a beaver set down anywhere in the pond stays on the bed", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    groundColliders(world);
    world.step();
    for (let x = POND.x - 4.4; x < POND.x + 4.4; x += 0.37) for (let z = POND.z - 4.4; z < POND.z + 4.4; z += 0.37) {
      const hit = world.castRay(new RAPIER.Ray({ x, y: 20, z }, { x: 0, y: -1, z: 0 }), 40, true)!;
      expect(Math.abs(20 - hit.timeOfImpact - groundAt(x, z))).toBeLessThan(0.002);
    }
    // As the player's capsule (src/player/index.ts: 1 m tall, 0.45 m wide, a gap of 0.02 m), set down as teleport()
    // does at heightAt (the game's teleports use groundAt, placement rules heightAt), then dived straight down for a
    // second, then swum level a second: it stays on the bed. A capsule that starts a few cm too deep falls through the heightfield: on the old
    // 0.5 m grid, set down on the basin's wall, it ended 3.9 m under the bed.
    const HEIGHT = 1, RADIUS = 0.225, OFFSET = 0.02;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const capsule = world.createCollider(RAPIER.ColliderDesc.capsule(HEIGHT / 2 - RADIUS, RADIUS), body);
    const controller = world.createCharacterController(OFFSET);
    let lowest = Infinity;
    for (let x = POND.x - 4; x < POND.x + 4; x += 0.29) for (let z = POND.z - 4; z < POND.z + 4; z += 0.29) {
      if (pondRatio(x, z) > 1) continue;
      const at = { x, y: heightAt(x, z) + HEIGHT / 2 + OFFSET, z };
      body.setTranslation(at, true);
      world.step();
      const a = x * 7 + z * 3;
      for (let i = 0; i < 60; i++) {
        controller.computeColliderMovement(capsule, i < 30 ? { x: 0, y: -0.1, z: 0 } : { x: 0.06 * Math.cos(a), y: 0, z: 0.06 * Math.sin(a) });
        const moved = controller.computedMovement();
        at.x += moved.x; at.y += moved.y; at.z += moved.z;
        body.setTranslation(at, true);
        world.step();
      }
      lowest = Math.min(lowest, at.y - HEIGHT / 2 - OFFSET - groundAt(at.x, at.z));
    }
    expect(lowest).toBeGreaterThan(-0.05);
    // The camera's ball, cast level from the basin's floor (along a grid line too), meets the wall.
    const ball = new RAPIER.Ball(0.18);
    for (const x of [4.5, 4.53]) {
      const hit = world.castShape({ x, y: groundAt(x, 3) + 0.5, z: 3 }, { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: -1 }, ball, 0, 3, true);
      expect(hit?.time_of_impact).toBeLessThan(1);
    }
  });
});

test("Rapier's heightfield: rows run along z, columns along x, column by column, centred", async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }), n = 3, heights = new Float32Array(n * n);
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) heights[row + col * n] = row + 10 * col;
  world.createCollider(RAPIER.ColliderDesc.heightfield(n - 1, n - 1, heights, { x: 2, y: 1, z: 4 }));
  world.step();
  const down = (x: number, z: number) => 50 - world.castRay(new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 100, true)!.timeOfImpact;
  expect(down(-1, -2)).toBeCloseTo(0); // row 0, column 0
  expect(down(1, -2)).toBeCloseTo(20); // last column: +x
  expect(down(-1, 2)).toBeCloseTo(2); // last row: +z
});
