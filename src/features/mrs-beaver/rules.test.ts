// Mrs. Beaver's rules as a player meets them: a hiding place picked anew each visit, freed once, and the Use key's
// offer only close to the pen with free paws, on land.
import { expect, test } from "bun:test";
import { placeAll } from "../../world/place.ts";
import { heightAt, pondRatio, RIM, SITE, slopeAt, WATER_LEVEL } from "../../world/terrain.ts";
// Where the Shop stands (src/features/shop/index.ts SHOP; that file needs a browser).
const SHOP = { x: -9.5, z: 8.5 };
import { POST } from "../trade/place.ts";
import { free, HIDING, HOME, offered, pick } from "./rules.ts";

test("each visit picks one of the three hiding places from the random number given", () => {
  expect(HIDING).toHaveLength(3);
  expect(pick(0)).toEqual({ place: 0, state: "missing" });
  expect(pick(0.5).place).toBe(1);
  expect(pick(0.99).place).toBe(2);
  expect(pick(1).place).toBe(2); // a random number at its very top stays in the list
});

test("every hiding place is on dry land just inside the bank, clear of the pond, the site, the shop and the post", () => {
  for (const p of HIDING) {
    const r = Math.hypot(p.x, p.z);
    expect(r).toBeGreaterThan(RIM - 4);
    expect(r).toBeLessThan(RIM - 1.5);
    expect(heightAt(p.x, p.z)).toBeGreaterThan(WATER_LEVEL + 0.1);
    expect(slopeAt(p.x, p.z)).toBeLessThan(0.25);
    expect(pondRatio(p.x, p.z)).toBeGreaterThan(2);
    expect(Math.hypot(p.x - SITE.x, p.z - SITE.z)).toBeGreaterThan(8);
    expect(Math.hypot(p.x - SHOP.x, p.z - SHOP.z)).toBeGreaterThan(6);
    expect(Math.hypot(p.x - POST.x, p.z - POST.z)).toBeGreaterThan(8);
  }
});

test("the pen stands clear of the trees, rocks, stumps, logs, bushes and sticks laid out round it (a stick in reach would take the Use key)", () => {
  const layout = placeAll();
  const things = [...layout.tree.map((s) => ({ s, r: 2 })), ...layout.rock.map((s) => ({ s, r: 1 })), ...layout.stump.map((s) => ({ s, r: 1 })),
    ...layout.log.map((s) => ({ s, r: 1.8 })), ...layout.bush.map((s) => ({ s, r: 1.2 })), ...layout.stick.map((s) => ({ s, r: 2 }))];
  for (const p of HIDING) for (const { s, r } of things) expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThan(r);
});

test("from every hiding place a straight way over dry land leads home, past nothing laid out solid", () => {
  const layout = placeAll();
  const solid = [...layout.tree.map((s) => ({ s, r: 0.8 })), ...layout.rock.map((s) => ({ s, r: 0.5 * s.scale + 0.3 })),
    ...layout.stump.map((s) => ({ s, r: 0.6 })), ...layout.log.map((s) => ({ s, r: 1.3 })), ...layout.crate.map((s) => ({ s, r: 0.5 })),
    { s: SHOP, r: 3.5 }, { s: POST, r: 1.6 }];
  expect(Math.hypot(HOME.x - SITE.x, HOME.z - SITE.z)).toBeLessThan(SITE.radius + 2);
  for (const p of HIDING) for (let t = 0; t <= 1; t += 0.01) {
    const x = p.x + (HOME.x - p.x) * t, z = p.z + (HOME.z - p.z) * t;
    expect(heightAt(x, z)).toBeGreaterThan(WATER_LEVEL + 0.03);
    expect(pondRatio(x, z)).toBeGreaterThan(1.2);
    for (const { s, r } of solid) expect(Math.hypot(s.x - x, s.z - z)).toBeGreaterThan(r);
  }
});

test("she is freed once: missing, then freed for the rest of the visit", () => {
  const rescue = pick(0.4);
  expect(free(rescue)).toBe(true);
  expect(rescue).toEqual({ place: 1, state: "freed" });
  expect(free(rescue)).toBe(false);
  expect(rescue.state).toBe("freed");
});

test("the Use key offers to free her only within reach of the pen, with free paws, not afloat, while she is missing", () => {
  const rescue = pick(0), at = { carrying: false, afloat: false };
  expect(offered(rescue, { ...at, away: 0.9 })).toBe(true);
  expect(offered(rescue, { ...at, away: 1.25 })).toBe(true);
  expect(offered(rescue, { ...at, away: 1.6 })).toBe(false); // too far
  expect(offered(rescue, { ...at, away: 0.9, carrying: true })).toBe(false); // a stick in the paws: the Use key does what it did
  expect(offered(rescue, { ...at, away: 0.9, afloat: true })).toBe(false);
  free(rescue);
  expect(offered(rescue, { ...at, away: 0.9 })).toBe(false); // freed: nothing more of hers
});
