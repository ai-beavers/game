// Mrs. Beaver's rules as a player meets them: a hiding place picked anew each visit with her flower on the way, the
// quest's steps in order, and the Use key's offers only close by with free paws, on land.
import { expect, test } from "bun:test";
import { placeAll, SPAWN } from "../../world/place.ts";
import { heightAt, pondRatio, RIM, SITE, slopeAt, WATER_LEVEL } from "../../world/terrain.ts";
// Where the Shop stands (src/features/shop/index.ts SHOP; that file needs a browser), turned to face the Clearing.
const SHOP = { x: -9.5, z: 8.5 }, FACING = Math.atan2(0 - SHOP.x, 2 - SHOP.z);
/** A point in the Shop's frame (building.ts toWorld), in the world. */
const shopToWorld = (x: number, z: number) => ({ x: SHOP.x + x * Math.cos(FACING) + z * Math.sin(FACING), z: SHOP.z - x * Math.sin(FACING) + z * Math.cos(FACING) });
// In front of the Shop: the post of its sign (building.ts SIGN) and the Calendar board, 2.4 m wide, mirrored across
// the path from the sign and turned the other way (calendar.ts AT).
const SIGN_POST = shopToWorld(1.6, 2.7 + 1.6), BOARD = shopToWorld(-1.6 - 0.85, 2.7 + 1.6), BOARD_YAW = FACING + 0.35;
const BOARD_ENDS = [-1.25, 1.25].map((t) => ({ x: BOARD.x + Math.cos(BOARD_YAW) * t, z: BOARD.z - Math.sin(BOARD_YAW) * t }));
/** m from p to the Calendar board's face, end to end. */
const toBoard = (p: { x: number; z: number }) => {
  const [a, b] = BOARD_ENDS as [{ x: number; z: number }, { x: number; z: number }], dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
};
import { POST } from "../trade/place.ts";
import { BENDS, done, FIND, FLOWER, GNAW, find, gnaw, HIDING, HOME, offered, pick, REACH, rows, take, wayHome } from "./rules.ts";

test("each visit picks one of the three hiding places from the random number given, and starts on the flower step", () => {
  expect(HIDING).toHaveLength(3);
  expect(pick(0)).toEqual({ place: 0, step: "flower", gnawed: 0 });
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

test("from every hiding place a way of straight legs over dry land leads home, past nothing laid out solid", () => {
  const layout = placeAll();
  const solid = [...layout.tree.map((s) => ({ s, r: 0.8 })), ...layout.rock.map((s) => ({ s, r: 0.5 * s.scale + 0.3 })),
    ...layout.stump.map((s) => ({ s, r: 0.6 })), ...layout.log.map((s) => ({ s, r: 1.3 })), ...layout.crate.map((s) => ({ s, r: 0.5 })),
    { s: SHOP, r: 3.5 }, { s: POST, r: 1.6 }, { s: SIGN_POST, r: 0.4 }];
  expect(Math.hypot(HOME.x - SITE.x, HOME.z - SITE.z)).toBeLessThan(SITE.radius + 2);
  expect(BENDS).toHaveLength(HIDING.length);
  HIDING.forEach((p, i) => {
    const way = wayHome(i);
    expect(way.at(-1)).toEqual(HOME);
    expect(way.length).toBeLessThanOrEqual(2); // home straight, or round one bend
    let from = p, walked = 0;
    for (const to of way) {
      for (let t = 0; t <= 1; t += 0.01) {
        const x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
        expect(heightAt(x, z)).toBeGreaterThan(WATER_LEVEL + 0.03);
        expect(pondRatio(x, z)).toBeGreaterThan(1.2);
        for (const { s, r } of solid) expect(Math.hypot(s.x - x, s.z - z)).toBeGreaterThan(r);
        expect(toBoard({ x, z })).toBeGreaterThan(0.4); // she walks past the board, not through it
      }
      walked += Math.hypot(to.x - from.x, to.z - from.z);
      from = to;
    }
    expect(walked).toBeLessThan(Math.hypot(HOME.x - p.x, HOME.z - p.z) + 1); // a bend is no long way round
  });
});

test("every flower spot lies on dry land, clear of the pond, the site, the dam, the shop, the post and the spawn, about halfway to its hiding place", () => {
  expect(FLOWER).toHaveLength(HIDING.length);
  const layout = placeAll(), dam = { x: SITE.x + 1.1, z: SITE.z }; // the dam: on the shore, from the site towards the pond
  FLOWER.forEach((f, i) => {
    const h = HIDING[i]!, dx = h.x - HOME.x, dz = h.z - HOME.z, len = Math.hypot(dx, dz);
    const along = ((f.x - HOME.x) * dx + (f.z - HOME.z) * dz) / len / len, off = Math.abs((f.x - HOME.x) * dz - (f.z - HOME.z) * dx) / len;
    expect(along).toBeGreaterThan(0.35);
    expect(along).toBeLessThan(0.65);
    expect(off).toBeLessThan(0.6);
    expect(heightAt(f.x, f.z)).toBeGreaterThan(WATER_LEVEL + 0.1);
    expect(pondRatio(f.x, f.z)).toBeGreaterThan(2);
    expect(Math.hypot(f.x - SITE.x, f.z - SITE.z)).toBeGreaterThan(4);
    expect(Math.hypot(f.x - dam.x, f.z - dam.z)).toBeGreaterThan(4);
    expect(Math.hypot(f.x - SHOP.x, f.z - SHOP.z)).toBeGreaterThan(5);
    expect(Math.hypot(f.x - POST.x, f.z - POST.z)).toBeGreaterThan(4);
    expect(Math.hypot(f.x - SPAWN.x, f.z - SPAWN.z)).toBeGreaterThan(3);
    // Nothing laid out on it, and no stick so close that the Use key would pick the stick up instead.
    for (const s of [...layout.tree, ...layout.rock, ...layout.stump, ...layout.log, ...layout.bush, ...layout.crate]) expect(Math.hypot(s.x - f.x, s.z - f.z)).toBeGreaterThan(1.5);
    for (const s of layout.stick) expect(Math.hypot(s.x - f.x, s.z - f.z)).toBeGreaterThan(2);
  });
});

test("the steps advance only in order, each change true exactly once", () => {
  const quest = pick(0.4);
  expect(find(quest, 1)).toBe(false); // at her pen before the flower: nothing
  expect(gnaw(quest, 5)).toBe(false); // gnawing before she is found: nothing
  expect(quest).toEqual({ place: 1, step: "flower", gnawed: 0 });
  expect(take(quest)).toBe(true);
  expect(take(quest)).toBe(false);
  expect(quest.step).toBe("find");
  expect(gnaw(quest, 5)).toBe(false);
  expect(find(quest, 5)).toBe(false); // too far from the pen to have found her
  expect(find(quest, 3.5)).toBe(true);
  expect(find(quest, 3.5)).toBe(false);
  expect(take(quest)).toBe(false); // the flower is in the paws already
  expect(quest).toEqual({ place: 1, step: "gnaw", gnawed: 0 });
});

test("gnawing adds up across releases and frees her exactly once, after about three seconds", () => {
  const quest = pick(0);
  take(quest); find(quest, 1);
  expect(gnaw(quest, 1)).toBe(false);
  expect(gnaw(quest, 1.5)).toBe(false); // let go and held again: the second hold goes on from the first
  expect(quest.step).toBe("gnaw");
  expect(quest.gnawed).toBeCloseTo(2.5);
  expect(gnaw(quest, 0.6)).toBe(true);
  expect(quest.step).toBe("freed");
  expect(gnaw(quest, 1)).toBe(false);
  expect(GNAW).toBeGreaterThanOrEqual(2.5);
  expect(GNAW).toBeLessThanOrEqual(3.5);
});

test("the Use key offers the flower at the flower and the pen only once she is found, never with a stick or afloat", () => {
  const quest = pick(0), at = { flower: 9, pen: 9, carrying: false, afloat: false };
  expect(offered(quest, { ...at, flower: 1 })).toBe("flower");
  expect(offered(quest, { ...at, flower: 1.6 })).toBeUndefined(); // too far
  expect(offered(quest, { ...at, pen: 0.9 })).toBeUndefined(); // at the pen without the flower: nothing
  expect(offered(quest, { ...at, flower: 1, carrying: true })).toBeUndefined(); // a stick in the paws: Use does what it did
  expect(offered(quest, { ...at, flower: 1, afloat: true })).toBeUndefined();
  take(quest);
  expect(offered(quest, { ...at, flower: 1 })).toBeUndefined(); // the flower is gone
  expect(offered(quest, { ...at, pen: 0.9 })).toBeUndefined(); // not found yet
  find(quest, 0.9);
  expect(offered(quest, { ...at, pen: 0.9 })).toBe("gnaw");
  expect(offered(quest, { ...at, pen: 1.25 })).toBe("gnaw");
  expect(offered(quest, { ...at, pen: 1.6 })).toBeUndefined();
  expect(offered(quest, { ...at, pen: 0.9, carrying: true })).toBeUndefined();
  expect(offered(quest, { ...at, pen: 0.9, afloat: true })).toBeUndefined();
  gnaw(quest, GNAW);
  expect(offered(quest, { ...at, pen: 0.9 })).toBeUndefined(); // freed: nothing more of hers
  expect(FIND).toBeGreaterThan(REACH);
});

test("the checklist ticks one more step with each step done, and shows the steps that fit", () => {
  const quest = pick(0);
  expect(done(quest)).toBe(0);
  take(quest);
  expect(done(quest)).toBe(1);
  find(quest, 0);
  expect(done(quest)).toBe(2);
  gnaw(quest, GNAW);
  expect(done(quest)).toBe(3);
  expect(rows(0, true)).toEqual([0, 1, 2]);
  expect(rows(1, false)).toEqual([1]); // too little room: only the step at hand
  expect(rows(3, true)).toEqual([]); // freed: only the one line "Mrs. Beaver found"
});
