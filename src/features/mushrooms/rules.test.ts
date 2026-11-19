// The mushrooms' rules as a player meets them: where they grow, what the Use key offers there, and what eating too
// many too quickly does to the view.
import { expect, test } from "bun:test";
import { placeAll, SPAWN } from "../../world/place.ts";
import { heightAt, pondRatio, POND, SITE, slopeAt, WATER_LEVEL } from "../../world/terrain.ts";
import { FLOWER, HIDING } from "../mrs-beaver/rules.ts";
import { SHOP } from "../shop/place.ts";
import { POST } from "../trade/place.ts";
import { dawn, dizzy, eat, fresh, offered, REACH, SPOTS, step, passedDawn, type Mushrooms } from "./rules.ts";

const FACING = Math.atan2(0 - SHOP.x, 2 - SHOP.z);
const shopToWorld = (x: number, z: number) => ({ x: SHOP.x + x * Math.cos(FACING) + z * Math.sin(FACING), z: SHOP.z - x * Math.sin(FACING) + z * Math.cos(FACING) });
const BOARD = shopToWorld(-1.6 - 0.85, 2.7 + 1.6); // the Calendar board in front of the Shop (calendar.ts AT)
const near = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** Runs the rules for s seconds of game time in small steps, as the game does. */
const wait = (m: Mushrooms, s: number) => { for (let t = 0; t < s; t += 0.1) step(m, 0.1); };
/** What the Use key offers standing right at spot i with free paws, on land. */
const at = (i: number) => SPOTS.map((_, k) => (k === i ? 0.3 : 9));
const free = { carrying: false, afloat: false };

test("five or six mushroom spots, each at the foot of a tree from the layout, outside its trunk", () => {
  expect(SPOTS.length).toBeGreaterThanOrEqual(5);
  expect(SPOTS.length).toBeLessThanOrEqual(6);
  const trees = placeAll().tree;
  for (const s of SPOTS) {
    const tree = Math.min(...trees.map((t) => near(t, s)));
    expect(tree).toBeGreaterThan(0.7); // clear of the trunk's collider
    expect(tree).toBeLessThan(1.3); // and still beside it
  }
});

test("every spot is on dry, level land, clear of the pond, the site, the dam, the shop, the board, the post, the spawn, the sticks and Mrs. Beaver's places", () => {
  const layout = placeAll(), dam = { x: SITE.x + 1.1, z: SITE.z };
  for (const s of SPOTS) {
    expect(heightAt(s.x, s.z)).toBeGreaterThan(WATER_LEVEL + 0.1);
    expect(slopeAt(s.x, s.z)).toBeLessThan(0.25);
    expect(pondRatio(s.x, s.z)).toBeGreaterThan(2);
    expect(near(s, POND)).toBeGreaterThan(POND.radius + 3);
    expect(near(s, SITE)).toBeGreaterThan(5);
    expect(near(s, dam)).toBeGreaterThan(5);
    expect(near(s, SHOP)).toBeGreaterThan(6);
    expect(near(s, BOARD)).toBeGreaterThan(3);
    expect(near(s, POST)).toBeGreaterThan(4);
    expect(near(s, SPAWN)).toBeGreaterThan(4);
    for (const h of HIDING) expect(near(s, h)).toBeGreaterThan(3); // her pen
    for (const f of FLOWER) expect(near(s, f)).toBeGreaterThan(2.5);
    // No stick so close that the Use key would pick the stick up instead; nothing laid out on it.
    for (const t of layout.stick) expect(near(s, t)).toBeGreaterThan(2);
    for (const t of [...layout.rock, ...layout.stump, ...layout.log, ...layout.crate]) expect(near(s, t)).toBeGreaterThan(1.5);
  }
});

test("the Use key offers a mushroom within reach of it, not beyond, never with a stick, afloat or once it is eaten", () => {
  const m = fresh();
  expect(offered(m, { distances: at(2), ...free })).toBe(2);
  const edge = SPOTS.map((_, k) => (k === 2 ? REACH - 0.01 : 9));
  expect(offered(m, { distances: edge, ...free })).toBe(2);
  expect(offered(m, { distances: SPOTS.map((_, k) => (k === 2 ? REACH + 0.1 : 9)), ...free })).toBeUndefined();
  expect(offered(m, { distances: at(2), carrying: true, afloat: false })).toBeUndefined();
  expect(offered(m, { distances: at(2), carrying: false, afloat: true })).toBeUndefined();
  eat(m, 2);
  expect(offered(m, { distances: at(2), ...free })).toBeUndefined();
  expect(REACH).toBeGreaterThan(0.6);
  expect(REACH).toBeLessThan(1.5);
});

test("eating a spot marks it eaten until dawn, and dawn brings every spot back", () => {
  const m = fresh();
  eat(m, 0); eat(m, 3);
  expect(m.eaten).toEqual(SPOTS.map((_, i) => i === 0 || i === 3));
  expect(eat(m, 0)).toBe(false); // nothing left there to eat
  dawn(m);
  expect(m.eaten.every((e) => !e)).toBe(true);
  expect(offered(m, { distances: at(0), ...free })).toBe(0);
});

test("one or two mushrooms do nothing to the view; a third within two minutes makes it dizzy", () => {
  const m = fresh();
  expect(eat(m, 0)).toBe(false);
  wait(m, 50);
  expect(eat(m, 1)).toBe(false);
  wait(m, 60);
  expect(dizzy(m)).toBe(0);
  expect(eat(m, 2)).toBe(true);
  wait(m, 1);
  expect(dizzy(m)).toBeGreaterThan(0);
});

test("three mushrooms with long waits between them never make the view dizzy", () => {
  const m = fresh();
  for (const i of [0, 1, 2, 3]) {
    expect(eat(m, i)).toBe(false);
    wait(m, 70);
    expect(dizzy(m)).toBe(0);
  }
});

test("the dizzy view fades in over about 2 s, holds about 20 s, then fades out over about 5 s", () => {
  const m = fresh();
  eat(m, 0); eat(m, 1); eat(m, 2);
  wait(m, 1);
  expect(dizzy(m)).toBeGreaterThan(0.1);
  expect(dizzy(m)).toBeLessThan(0.9);
  wait(m, 1.2);
  expect(dizzy(m)).toBe(1);
  wait(m, 19);
  expect(dizzy(m)).toBe(1); // 21 s in: still held
  wait(m, 3);
  expect(dizzy(m)).toBeGreaterThan(0);
  expect(dizzy(m)).toBeLessThan(1); // fading out
  wait(m, 4);
  expect(dizzy(m)).toBe(0); // about 27 s in all, the view is clear
});

test("another mushroom while dizzy starts the full strength again", () => {
  const m = fresh();
  eat(m, 0); eat(m, 1); eat(m, 2);
  wait(m, 20);
  dawn(m);
  expect(eat(m, 3)).toBe(true); // a fourth, while the view is dizzy
  wait(m, 18);
  expect(dizzy(m)).toBe(1); // 38 s in: held again
  wait(m, 12);
  expect(dizzy(m)).toBe(0);
  // And eaten while fading out, the view comes back up smoothly, never jumping.
  const n = fresh();
  eat(n, 0); eat(n, 1); eat(n, 2);
  wait(n, 24);
  const fading = dizzy(n);
  expect(fading).toBeLessThan(1);
  expect(eat(n, 3)).toBe(true);
  step(n, 0.05);
  expect(Math.abs(dizzy(n) - fading)).toBeLessThan(0.1);
  wait(n, 3);
  expect(dizzy(n)).toBe(1);
});

test("dawn is passed when the hour goes over it, also across midnight, and not otherwise", () => {
  expect(passedDawn(4.9, 5.1)).toBe(true);
  expect(passedDawn(23.9, 5.5)).toBe(true); // a long jump of the clock over midnight and dawn
  expect(passedDawn(5.1, 5.2)).toBe(false);
  expect(passedDawn(12, 13)).toBe(false);
  expect(passedDawn(23.9, 0.1)).toBe(false);
});
