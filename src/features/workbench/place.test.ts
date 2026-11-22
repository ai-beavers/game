// Tests for where the workbench stands: on flat dry ground beside the trading post, clear of the post's spots and the
// ways to them, the bakery and its way, the building site, Mrs. Beaver's ways and everything the world placed, and
// worked at only from its working side. Run: bun test src/features/workbench
import { expect, test } from "bun:test";
import { heightAt, POND, SITE, WATER_LEVEL } from "../../world/terrain.ts";
import { placeAll, SPAWN } from "../../world/place.ts";
import { SHOP, SHOP_CLEAR } from "../shop/place.ts";
import { footprint as post, POST, standAt, FRONT as POST_FRONT } from "../trade/place.ts";
import { footprint as bakery, STAND as OVEN, FRONT as OVEN_FRONT } from "../bakery/place.ts";
import { PLACE as OLD_BEAVER } from "../old-beaver/rules.ts";
import { FLOWER, HIDING, TRACKS, wayHome } from "../mrs-beaver/rules.ts";
import { SPOTS as MUSHROOMS } from "../mushrooms/rules.ts";
import { atBench, BENCH, FRONT, footprint, STAND } from "./place.ts";

type Circle = { x: number; z: number; r: number };
const apart = (a: Circle, b: Circle) => Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
/** How far c keeps from the way a → b. */
const offWay = (c: Circle, a: { x: number; z: number }, b: { x: number; z: number }) => {
  let least = Infinity;
  for (let t = 0; t <= 1; t += 0.01) least = Math.min(least, apart(c, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, r: 0 }));
  return least;
};
const bench = footprint()[0]!;

test("the bench stands on flat dry ground, beside the trading post", () => {
  const rim = Array.from({ length: 8 }, (_, k) => ({ x: BENCH.x + Math.sin(k) * BENCH.radius, z: BENCH.z + Math.cos(k) * BENCH.radius }));
  const heights = [...rim, STAND].map((p) => heightAt(p.x, p.z));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.1);
  // As dry as the post's own ground, which lies low by the pond's south bank.
  expect(Math.min(...heights)).toBeGreaterThan(Math.max(WATER_LEVEL, heightAt(POST.x, POST.z)) - 0.01);
  expect(Math.hypot(BENCH.x - POND.x, BENCH.z - POND.z)).toBeGreaterThan(POND.radius + 3);
  const fromPost = Math.hypot(BENCH.x - POST.x, BENCH.z - POST.z);
  expect(fromPost).toBeLessThan(3.5); // beside it: seen from its counter
});

test("it keeps clear of the post's spots and the ways to them, the bakery and its way, and the clearing's others", () => {
  for (const p of post()) expect(apart(bench, p)).toBeGreaterThan(1);
  for (const i of [0, 1, 2]) {
    const stand = standAt(i), approach = { x: stand.x + POST_FRONT.x * 1.4, z: stand.z + POST_FRONT.z * 1.4 };
    expect(apart(bench, { ...stand, r: 0.6 }), `the post's spot ${i}`).toBeGreaterThan(0.6);
    expect(offWay(bench, SPAWN, approach), `the way to spot ${i}`).toBeGreaterThan(0.6);
    expect(offWay(bench, approach, stand), `the last steps to spot ${i}`).toBeGreaterThan(0.6);
  }
  for (const b of bakery()) expect(apart(bench, b)).toBeGreaterThan(3);
  expect(offWay(bench, SPAWN, { x: OVEN.x + OVEN_FRONT.x * 1.4, z: OVEN.z + OVEN_FRONT.z * 1.4 }), "the way to the bakery").toBeGreaterThan(0.6);
  expect(apart(bench, { ...SHOP, r: SHOP_CLEAR })).toBeGreaterThan(1);
  expect(apart(bench, { ...SITE, r: SITE.radius })).toBeGreaterThan(3);
  expect(apart(bench, { ...SPAWN, r: 1.5 })).toBeGreaterThan(0);
  for (const o of [OLD_BEAVER, ...HIDING, ...MUSHROOMS]) expect(apart(bench, { ...o, r: 1 }), JSON.stringify(o)).toBeGreaterThan(0);
  for (const o of [...FLOWER, ...TRACKS]) expect(apart(bench, { ...o, r: 1.6 }), JSON.stringify(o)).toBeGreaterThan(0);
  HIDING.forEach((h, i) => {
    const way = [h, ...wayHome(i)], legs = [...way.slice(1).map((b, k) => [way[k]!, b] as const), [FLOWER[i]!, TRACKS[i]!] as const];
    for (const [a, b] of legs) expect(offWay(bench, a, b), `her way from hiding place ${i}`).toBeGreaterThan(0.5);
  });
  const layout = placeAll();
  const solid = [...layout.tree.map((s) => ({ ...s, r: 0.6 })), ...layout.rock.map((s) => ({ ...s, r: 0.6 * s.scale })), ...layout.stump.map((s) => ({ ...s, r: 0.45 })),
    ...layout.log.map((s) => ({ ...s, r: 1.3 })), ...layout.crate.map((s) => ({ ...s, r: 0.4 })), ...layout.bush.map((s) => ({ ...s, r: 0.8 }))];
  for (const s of solid) for (const c of [bench, { ...STAND, r: 0.6 }])
    expect(apart(c, s), `something at ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`).toBeGreaterThan(0.3);
});

test("the bench is worked at only from its working side and within reach", () => {
  expect(atBench(STAND.x, STAND.z)).toBe(true);
  expect(atBench(STAND.x + FRONT.z * 0.3, STAND.z - FRONT.x * 0.3)).toBe(true);
  expect(atBench(STAND.x + FRONT.x * 1.5, STAND.z + FRONT.z * 1.5)).toBe(false); // too far out
  expect(atBench(2 * BENCH.x - STAND.x, 2 * BENCH.z - STAND.z)).toBe(false); // behind it
  expect(atBench(BENCH.x + 5, BENCH.z)).toBe(false);
});
