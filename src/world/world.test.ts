// Tests for the world's rules: the shape of the ground, where things are placed, and how Rapier's heightfield maps
// rows and columns (terrain.ts relies on it). Run: bun test src/world
import { describe, expect, test } from "bun:test";
import RAPIER from "@dimforge/rapier3d-compat";
import { placeAll, SPAWN } from "./place.ts";
import { heightAt, HILL, POND, pondRatio, RIM, SITE, slopeAt, WATER_LEVEL } from "./terrain.ts";

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
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) for (let r = 2; r < 5.5; r += 0.25)
      expect(slopeAt(POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r)).toBeLessThan(Math.tan((30 * Math.PI) / 180));
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
  test("the edge is higher than the middle, all round", () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16)
      expect(heightAt(Math.cos(a) * (RIM + 7), Math.sin(a) * (RIM + 7))).toBeGreaterThan(heightAt(0, 0) + 2.5);
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
  test("the spawn is clear and dry", () => {
    expect(wet(SPAWN)).toBe(false);
    for (const s of [...layout.tree, ...layout.rock, ...layout.stump, ...layout.log]) expect(Math.hypot(s.x - SPAWN.x, s.z - SPAWN.z)).toBeGreaterThan(1.5);
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
