// Tests for where the Dance floor lies: far out in the meadow on dry, flat ground short of the bank, clear of the Pond,
// the building site, the Shop and the spawn and the ways between them, with nothing solid of the world's placement
// on it; and the world's placement as it was everywhere else. Run: bun test src/features/dance-floor
import { expect, test } from "bun:test";
import { heightAt, POND, RIM, SITE, slopeAt, WATER_LEVEL } from "../../world/terrain.ts";
import { placeAll, SPAWN } from "../../world/place.ts";
import { SHOP, SHOP_CLEAR } from "../shop/place.ts";
import { FLOOR } from "./place.ts";

const { x, z, half } = FLOOR;
/** Points over the floor and a step round it, every 0.25 m. */
const over = (margin: number) => {
  const out: { x: number; z: number }[] = [];
  for (let dx = -half - margin; dx <= half + margin + 1e-9; dx += 0.25) for (let dz = -half - margin; dz <= half + margin + 1e-9; dz += 0.25) out.push({ x: x + dx, z: z + dz });
  return out;
};
/** How far the segment a → b passes from the floor's middle. */
const offWay = (a: { x: number; z: number }, b: { x: number; z: number }) => {
  let least = Infinity;
  for (let t = 0; t <= 1; t += 0.01) least = Math.min(least, Math.hypot(a.x + (b.x - a.x) * t - x, a.z + (b.z - a.z) * t - z));
  return least;
};

test("the floor lies on dry, flat, walkable ground in the far meadow, short of the bank", () => {
  const heights = over(0.5).map((p) => heightAt(p.x, p.z));
  expect(Math.min(...heights)).toBeGreaterThan(WATER_LEVEL + 0.1);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.12); // flat enough to lie on without steps
  for (const p of over(0.5)) expect(slopeAt(p.x, p.z), `steep at ${p.x}, ${p.z}`).toBeLessThan(0.15);
  const out = Math.hypot(x, z) + half * Math.SQRT2;
  expect(Math.hypot(x, z)).toBeGreaterThan(20); // far out
  expect(out).toBeLessThan(RIM); // the far corner still short of the bank
});

test("it is far from the Pond, the building site, the Shop and the spawn, and off the ways between them", () => {
  expect(Math.hypot(x - POND.x, z - POND.z) - POND.radius).toBeGreaterThan(15);
  expect(Math.hypot(x - SITE.x, z - SITE.z)).toBeGreaterThan(20);
  expect(Math.hypot(x - SHOP.x, z - SHOP.z) - SHOP_CLEAR).toBeGreaterThan(25);
  expect(Math.hypot(x - SPAWN.x, z - SPAWN.z)).toBeGreaterThan(20);
  for (const [a, b] of [[SPAWN, POND], [SPAWN, SITE], [SPAWN, SHOP], [POND, SHOP], [SITE, SHOP]] as const)
    expect(offWay(a, b)).toBeGreaterThan(10);
});

test("nothing solid the world placed stands on the floor or the step round it", () => {
  const layout = placeAll();
  const solid = [...layout.tree.map((s) => ({ ...s, r: 0.6 })), ...layout.rock.map((s) => ({ ...s, r: 0.6 * s.scale })), ...layout.stump.map((s) => ({ ...s, r: 0.45 })),
    ...layout.log.map((s) => ({ ...s, r: 1.3 })), ...layout.crate.map((s) => ({ ...s, r: 0.4 })), ...layout.bush.map((s) => ({ ...s, r: 0.8 }))];
  for (const s of solid) {
    const dx = Math.max(0, Math.abs(s.x - x) - half), dz = Math.max(0, Math.abs(s.z - z) - half);
    expect(Math.hypot(dx, dz) - s.r, `something at ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`).toBeGreaterThan(0.8);
  }
});

test("the first clearing's trees keep their places and their indices, and so does every ring tree off the floor", () => {
  // From placeAll() before the floor came: the first of the first clearing's trees and of the ring's, and the count.
  const { tree } = placeAll();
  expect(tree.length).toBe(49);
  expect([+tree[0]!.x.toFixed(2), +tree[0]!.z.toFixed(2)]).toEqual([8.4, 8.9]);
  expect([+tree[37]!.x.toFixed(2), +tree[37]!.z.toFixed(2), +tree[39]!.x.toFixed(2), +tree[39]!.z.toFixed(2)]).toEqual([-7.66, 24.85, -8.6, -23.35]);
});
