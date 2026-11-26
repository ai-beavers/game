// Tests for the particle life in sim.ts: fades without pops, falling, landing, the pool.
import { expect, test } from "bun:test";
import { advance, alpha, blank, FLOOR, KIND, MODE, size, spawn } from "./sim.ts";

const flat = () => 0;

test("fades in from zero and out to zero", () => {
  const p = Object.assign(blank(), { alive: true, life: 1, fadeIn: 0.2, fadeOut: 0.3, a: 0.8 });
  expect(alpha(p)).toBe(0);
  p.age = 0.5;
  expect(alpha(p)).toBeCloseTo(0.8);
  p.age = 0.999;
  expect(alpha(p)).toBeLessThan(0.01);
});

test("grows from size to grow, easing out", () => {
  const p = Object.assign(blank(), { life: 1, size: 0.1, grow: 0.3 });
  expect(size(p)).toBeCloseTo(0.1);
  p.age = 0.5;
  expect(size(p)).toBeGreaterThan(0.2);
  p.age = 1;
  expect(size(p)).toBeCloseTo(0.3);
});

test("a drop vanishes softly where it meets the floor", () => {
  const p = Object.assign(blank(), { alive: true, kind: KIND.drop, floor: FLOOR.die, y: 0.02, vy: -2, gravity: 1, life: 5, fadeIn: 0 });
  advance(p, 1 / 60, flat);
  expect(p.y).toBe(0);
  const before = alpha(p);
  advance(p, 1 / 60, flat);
  expect(p.alive).toBe(true);
  expect(alpha(p)).toBeLessThan(before);
  for (let i = 0; i < 20; i++) advance(p, 1 / 60, flat);
  expect(p.alive).toBe(false);
});

test("a chip bounces once, then lies flat and still", () => {
  const p = Object.assign(blank(), { alive: true, kind: KIND.chip, floor: FLOOR.rest, y: 0.01, vy: -3, vx: 1, gravity: 1, life: 5, spin: 10 });
  advance(p, 1 / 60, flat);
  expect(p.vy).toBeGreaterThan(0);
  for (let i = 0; i < 120; i++) advance(p, 1 / 60, flat);
  expect(p.y).toBe(0);
  expect(p.spin).toBe(0);
  expect(p.mode).toBe(MODE.ground);
});

test("the pool hands out free particles up to its limit", () => {
  const pool = [blank(), blank(), blank()];
  expect(spawn(pool, 2)).toBe(pool[0]);
  expect(spawn(pool, 2)).toBe(pool[1]);
  expect(spawn(pool, 2)).toBeUndefined();
  pool[0]!.alive = false;
  expect(spawn(pool, 2)).toBe(pool[0]);
});
