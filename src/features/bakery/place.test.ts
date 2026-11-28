// Tests for where the bakery stands: on flat dry open ground, clear of the trading post, the Shop, the building site,
// the spawn, Mrs. Beaver's ways and everything the world placed, and the oven fed only from in front of it. Run: bun test src/features/bakery
import { expect, test } from "bun:test";
import { heightAt, POND, SITE, WATER_LEVEL } from "../../world/terrain.ts";
import { placeAll, SPAWN } from "../../world/place.ts";
import { SHOP, SHOP_CLEAR } from "../shop/place.ts";
import { footprint as post } from "../trade/place.ts";
import { POLE } from "../flag/state.ts"; // the Flag
import { PLACE as OLD_BEAVER } from "../old-beaver/rules.ts";
import { FLOWER, HIDING, TRACKS, wayHome } from "../mrs-beaver/rules.ts";
import { SPOTS as MUSHROOMS } from "../mushrooms/rules.ts";
import { atOven, footprint, FRONT, HUT, STAND } from "./place.ts";

const apart = (a: { x: number; z: number; r: number }, b: { x: number; z: number; r: number }) => Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;

test("the hut stands on flat dry ground", () => {
  const points = [...footprint(), STAND];
  const heights = points.map((p) => heightAt(p.x, p.z));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.12);
  expect(Math.min(...heights)).toBeGreaterThan(WATER_LEVEL + 0.15);
  expect(Math.hypot(HUT.x - POND.x, HUT.z - POND.z)).toBeGreaterThan(POND.radius + 4);
});

test("its footprint keeps clear of the trading post, the Shop, the building site, the spawn and the clearing's others", () => {
  for (const c of footprint()) {
    for (const p of post()) expect(apart(c, p)).toBeGreaterThan(3);
    expect(apart(c, { ...SHOP, r: SHOP_CLEAR })).toBeGreaterThan(1);
    expect(apart(c, { ...SITE, r: SITE.radius })).toBeGreaterThan(4);
    expect(apart(c, { ...SPAWN, r: 2.5 })).toBeGreaterThan(0);
    for (const o of [POLE, OLD_BEAVER, ...HIDING, ...MUSHROOMS]) expect(apart(c, { ...o, r: 1 }), JSON.stringify(o)).toBeGreaterThan(0);
    // Mrs. Beaver's flowers and tracks, and her ways home and out (from her flower to her tracks): she walks past it.
    for (const o of [...FLOWER, ...TRACKS]) expect(apart(c, { ...o, r: 1.6 }), JSON.stringify(o)).toBeGreaterThan(0);
    HIDING.forEach((h, i) => {
      const way = [h, ...wayHome(i)], legs = [...way.slice(1).map((b, k) => [way[k]!, b] as const), [FLOWER[i]!, TRACKS[i]!] as const];
      for (const [a, b] of legs) for (let t = 0; t <= 1; t += 0.01)
        expect(apart(c, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, r: 0 }), `her way from hiding place ${i}`).toBeGreaterThan(0.5);
    });
  }
  const layout = placeAll();
  const solid = [...layout.tree.map((s) => ({ ...s, r: 0.6 })), ...layout.rock.map((s) => ({ ...s, r: 0.6 * s.scale })), ...layout.stump.map((s) => ({ ...s, r: 0.45 })),
    ...layout.log.map((s) => ({ ...s, r: 1.3 })), ...layout.crate.map((s) => ({ ...s, r: 0.4 })), ...layout.bush.map((s) => ({ ...s, r: 0.8 }))];
  for (const s of solid) for (const c of [...footprint(), { ...STAND, r: 0.6 }])
    expect(apart(c, s), `something at ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`).toBeGreaterThan(0.3);
});

test("the oven is fed only from in front of it and within reach", () => {
  expect(atOven(STAND.x, STAND.z)).toBe(true);
  expect(atOven(STAND.x + FRONT.z * 0.3, STAND.z - FRONT.x * 0.3)).toBe(true);
  expect(atOven(STAND.x + FRONT.x * 1.5, STAND.z + FRONT.z * 1.5)).toBe(false); // too far out
  expect(atOven(2 * HUT.x - STAND.x, 2 * HUT.z - STAND.z)).toBe(false); // behind the hut
  expect(atOven(HUT.x + 5, HUT.z)).toBe(false);
});
