// Tests for where the Lightbulb's post stands: beside the workbench, clear of its working side, the trading post's
// spots and the ways to them, the bakery's way, Mrs. Beaver's ways, flowers and tracks and everything the world
// placed; and the cord within reach only at the post's front. Run: bun test src/features/lightbulb
import { expect, test } from "bun:test";
import { heightAt, SITE, WATER_LEVEL } from "../../world/terrain.ts";
import { placeAll, SPAWN } from "../../world/place.ts";
import { SHOP, SHOP_CLEAR } from "../shop/place.ts";
import { footprint as tradingPost, spotFor, standAt, FRONT as POST_FRONT } from "../trade/place.ts";
import { footprint as bakery, STAND as OVEN, FRONT as OVEN_FRONT } from "../bakery/place.ts";
import { ALONG as BENCH_ALONG, atBench, BENCH, FRONT as BENCH_FRONT, STAND as BENCH_STAND, footprint as bench } from "../workbench/place.ts";
import { PLACE as OLD_BEAVER } from "../old-beaver/rules.ts";
import { FLOWER, HIDING, TRACKS, wayHome } from "../mrs-beaver/rules.ts";
import { SPOTS as MUSHROOMS } from "../mushrooms/rules.ts";
import { atCord, footprint, POST, STAND } from "./place.ts";

type Circle = { x: number; z: number; r: number };
const apart = (a: Circle, b: Circle) => Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
const offWay = (c: Circle, a: { x: number; z: number }, b: { x: number; z: number }) => {
  let least = Infinity;
  for (let t = 0; t <= 1; t += 0.01) least = Math.min(least, apart(c, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, r: 0 }));
  return least;
};
const post = footprint()[0]!;

test("the post stands on dry ground beside the workbench", () => {
  expect(heightAt(POST.x, POST.z)).toBeGreaterThan(WATER_LEVEL);
  expect(Math.abs(heightAt(STAND.x, STAND.z) - heightAt(POST.x, POST.z))).toBeLessThan(0.1);
  expect(Math.hypot(POST.x - BENCH.x, POST.z - BENCH.z)).toBeLessThan(1.6); // beside it: found from the bench
});

test("it keeps clear of the bench's working side, the trading post and the ways to it", () => {
  expect(apart(post, bench()[0]!)).toBeGreaterThan(0.3);
  // A beaver at the bench, and the last steps up to it from the spawn's side, keep their room.
  expect(apart(post, { ...BENCH_STAND, r: 0.35 })).toBeGreaterThan(0.25);
  expect(offWay(post, BENCH_STAND, { x: BENCH_STAND.x + BENCH_FRONT.x * 1.4, z: BENCH_STAND.z + BENCH_FRONT.z * 1.4 }), "the way to the bench").toBeGreaterThan(0.5);
  expect(offWay(post, SPAWN, { x: BENCH_STAND.x + BENCH_FRONT.x * 1.4, z: BENCH_STAND.z + BENCH_FRONT.z * 1.4 }), "the way from the spawn to the bench").toBeGreaterThan(0.5);
  // Off the counter's end: a thin pole, not a stump, so less room than the bench keeps, too little for a beaver to squeeze
  // through (the bots go round both).
  for (const p of tradingPost()) expect(apart(post, p)).toBeGreaterThan(0.4);
  for (const i of [0, 1, 2]) {
    const stand = standAt(i), approach = { x: stand.x + POST_FRONT.x * 1.4, z: stand.z + POST_FRONT.z * 1.4 };
    expect(apart(post, { ...stand, r: 0.6 }), `the post's spot ${i}`).toBeGreaterThan(0.6);
    expect(offWay(post, SPAWN, approach), `the way to spot ${i}`).toBeGreaterThan(0.6);
    expect(offWay(post, approach, stand), `the last steps to spot ${i}`).toBeGreaterThan(0.6);
  }
});

test("it keeps clear of the bakery, the clearing's others and everything the world placed", () => {
  for (const b of bakery()) expect(apart(post, b)).toBeGreaterThan(2);
  expect(offWay(post, SPAWN, { x: OVEN.x + OVEN_FRONT.x * 1.4, z: OVEN.z + OVEN_FRONT.z * 1.4 }), "the way to the bakery").toBeGreaterThan(0.6);
  expect(apart(post, { ...SHOP, r: SHOP_CLEAR })).toBeGreaterThan(1);
  expect(apart(post, { ...SITE, r: SITE.radius })).toBeGreaterThan(3);
  expect(apart(post, { ...SPAWN, r: 1.5 })).toBeGreaterThan(0);
  for (const o of [OLD_BEAVER, ...HIDING, ...MUSHROOMS]) expect(apart(post, { ...o, r: 1 }), JSON.stringify(o)).toBeGreaterThan(0);
  for (const o of [...FLOWER, ...TRACKS]) expect(apart(post, { ...o, r: 1.6 }), JSON.stringify(o)).toBeGreaterThan(0);
  HIDING.forEach((h, i) => {
    const way = [h, ...wayHome(i)], legs = [...way.slice(1).map((b, k) => [way[k]!, b] as const), [FLOWER[i]!, TRACKS[i]!] as const];
    for (const [a, b] of legs) expect(offWay(post, a, b), `her way from hiding place ${i}`).toBeGreaterThan(0.5);
  });
  const layout = placeAll();
  const solid = [...layout.tree.map((s) => ({ ...s, r: 0.6 })), ...layout.rock.map((s) => ({ ...s, r: 0.6 * s.scale })), ...layout.stump.map((s) => ({ ...s, r: 0.45 })),
    ...layout.log.map((s) => ({ ...s, r: 1.3 })), ...layout.crate.map((s) => ({ ...s, r: 0.4 })), ...layout.bush.map((s) => ({ ...s, r: 0.8 }))];
  for (const s of solid) for (const c of [post, { ...STAND, r: 0.6 }])
    expect(apart(c, s), `something at ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`).toBeGreaterThan(0.3);
});

test("the cord is in reach at the stand spot, not behind the post or further off", () => {
  expect(atCord(STAND.x, STAND.z)).toBe(true);
  expect(atCord(2 * POST.x - STAND.x, 2 * POST.z - STAND.z)).toBe(false); // behind the post
  expect(atCord(STAND.x + (STAND.x - POST.x) * 3, STAND.z + (STAND.z - POST.z) * 3)).toBe(false); // too far out
  expect(atCord(BENCH_STAND.x, BENCH_STAND.z)).toBe(false); // working at the bench is not pulling the cord
  expect(atCord(POST.x + 5, POST.z)).toBe(false);
});

test("where the cord is in reach, E does nothing else: not the bench, not the trading post", () => {
  for (let x = STAND.x - 1; x <= STAND.x + 1; x += 0.05) for (let z = STAND.z - 1; z <= STAND.z + 1; z += 0.05) {
    if (!atCord(x, z)) continue;
    expect(atBench(x, z), `at the bench too at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(false);
    expect(spotFor(x, z), `at the trading post too at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBeUndefined();
  }
});

test("walking up to the bench from its working side never comes within reach of the cord", () => {
  // The strip a beaver crosses on its last steps to the bench, as wide as it may stray from the straight way up.
  for (let out = 0; out <= 2; out += 0.05) for (let side = -0.45; side <= 0.45; side += 0.05) {
    const x = BENCH_STAND.x + BENCH_FRONT.x * out + BENCH_ALONG.x * side, z = BENCH_STAND.z + BENCH_FRONT.z * out + BENCH_ALONG.z * side;
    expect(atCord(x, z), `the cord in reach on the way to the bench at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(false);
  }
});
