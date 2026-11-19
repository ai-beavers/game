// Where the canoe lies, where it is launched and where the beaver gets out, on a round pond of plain numbers.
import { expect, test } from "bun:test";
import { bankPlace, beside, floats, launch, wayOut } from "./place.ts";

// A pond 4 m round, 1.2 m deep in the middle, the bank rising gently beyond.
const pond = { x: 5, z: 5, radius: 4 }, spawn = { x: -1.5, z: -3 };
const heightAt = (x: number, z: number) => { const r = Math.hypot(x - pond.x, z - pond.z); return r < 4 ? -1.2 * (1 - (r / 4) ** 2) : 0.1 * (r - 4); };
const from = (p: { x: number; z: number }) => Math.hypot(p.x - pond.x, p.z - pond.z);

test("the canoe lies on the bank on the spawn's side, pulled up, its bow to the pond's middle", () => {
  const c = bankPlace(pond, spawn, heightAt, 0);
  expect(from(c)).toBeGreaterThan(4);
  expect(from(c)).toBeLessThan(5);
  expect(Math.hypot(c.x - spawn.x, c.z - spawn.z)).toBeLessThan(Math.hypot(pond.x - spawn.x, pond.z - spawn.z));
  const ahead = { x: c.x + Math.sin(c.heading), z: c.z + Math.cos(c.heading) };
  expect(from(ahead)).toBeCloseTo(from(c) - 1, 1);
  expect(floats(c, c.heading, heightAt, 0)).toBe(false); // on land
});

test("getting in, a canoe on the bank is pushed off to where it floats; one afloat stays where it is", () => {
  const c = bankPlace(pond, spawn, heightAt, 0), feet = launch(c, c.heading, heightAt, 0)!;
  expect(floats(feet, c.heading, heightAt, 0)).toBe(true);
  expect(Math.hypot(feet.x - c.x, feet.z - c.z)).toBeLessThan(4);
  const out = launch({ x: 5, z: 5 }, 0, heightAt, 0)!;
  expect(Math.hypot(out.x - 5, out.z - 5)).toBeLessThan(0.2);
});

test("getting out by the bank the feet go onto dry ground; out on the pond into the water beside the hull", () => {
  const c = bankPlace(pond, spawn, heightAt, 0), feet = launch(c, c.heading, heightAt, 0)!;
  const shore = wayOut(feet, c.heading + Math.PI, heightAt, 0); // turned round, bow to the bank
  expect(shore.outcome).toBe("bank");
  expect(heightAt(shore.x, shore.z)).toBeGreaterThan(0);
  const middle = wayOut({ x: 5, z: 5 }, 0, heightAt, 0);
  expect(middle.outcome).toBe("water");
  expect(Math.hypot(middle.x - 5, middle.z - 5)).toBeCloseTo(0.85, 2);
});

test("the risen pond floats a canoe further up the bank", () => {
  const feet = { x: 5, z: 5 + 3.6 };
  expect(floats(feet, Math.PI, heightAt, 0)).toBe(false);
  expect(floats(feet, Math.PI, heightAt, 0.6)).toBe(true);
});

test("getting out, it never steps onto a bank too steep to stand on", () => {
  // A steep bank rises just ahead of the bow, steep as far as it reaches; flat ground lies a little further off on its left (+x).
  const walled = (x: number, z: number) => x > 1.2 ? 0.1 : Math.max(-1, (z - 1.6) * 2);
  const out = wayOut({ x: 0, z: 0 }, 0, walled, 0);
  expect(out.outcome).toBe("bank");
  expect(out.x).toBeGreaterThan(1.2); // to the left, where it is flat
});

test("the beaver can get in beside the hull from stern to bow, not off its ends nor further out", () => {
  const canoe = { x: 0, z: 0, heading: 0 }; // bow to +z, 2 m long
  expect(beside({ x: 0.7, z: 0 }, canoe)).toBe(true);
  expect(beside({ x: -0.7, z: 0.9 }, canoe)).toBe(true);
  expect(beside({ x: 0, z: 1.8 }, canoe)).toBe(true); // just past the bow
  expect(beside({ x: 1.2, z: 0 }, canoe)).toBe(false);
  expect(beside({ x: 0, z: 2.2 }, canoe)).toBe(false);
});
