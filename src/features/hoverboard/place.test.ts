// Where the Hoverboard lies after a reload, where the beaver steps off it and from where it can step on.
import { expect, test } from "bun:test";
import { heightAt, pathAt, WATER_LEVEL } from "../../world/terrain.ts";
import { SPAWN } from "../../world/place.ts";
import { homePlace, near, stepOff } from "./place.ts";

const flat = () => 0.2;
/** A straight path north through the spawn, 1 m either side of x = 0. */
const straight = (x: number) => (Math.abs(x) < 1 ? 1 : 0);

test("at home the Hoverboard lies on dry ground beside the path, near the spawn, along the path", () => {
  const home = homePlace(SPAWN, pathAt, heightAt, WATER_LEVEL);
  expect(Math.hypot(home.x - SPAWN.x, home.z - SPAWN.z)).toBeLessThan(3);
  expect(Math.hypot(home.x - SPAWN.x, home.z - SPAWN.z)).toBeGreaterThan(1);
  expect(pathAt(home.x, home.z)).toBeLessThan(0.1); // beside the path, not on it
  for (const [dx, dz] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) // the whole plank and round it on land
    expect(heightAt(home.x + dx!, home.z + dz!)).toBeGreaterThan(WATER_LEVEL + 0.1);
  expect(Math.abs(Math.sin(home.heading))).toBeLessThan(0.2); // the path runs north there
});

test("with water on one side of the path it lies on the other", () => {
  const wetWest = (x: number) => (x < -0.5 ? -1 : 0.2);
  const home = homePlace({ x: 0, z: 0 }, straight, wetWest, 0);
  expect(home.x).toBeGreaterThan(1);
  expect(wetWest(home.x)).toBeGreaterThan(0);
});

test("stepping off, the beaver lands beside the board on the side it faces", () => {
  const board = { x: 0, z: 0, heading: 0 }; // its nose to +z
  const toPlusX = stepOff(board, Math.PI / 2, flat, 0), toMinusX = stepOff(board, -Math.PI / 2, flat, 0);
  expect(toPlusX.x).toBeGreaterThan(0.5);
  expect(toMinusX.x).toBeLessThan(-0.5);
  for (const p of [toPlusX, toMinusX]) {
    expect(Math.abs(p.z)).toBeLessThan(0.3);
    expect(Math.abs(p.x)).toBeLessThan(1.2);
  }
});

test("stepping off towards water or something solid, it goes to the other side instead; always on land", () => {
  const board = { x: 0, z: 0, heading: 0 };
  const wetEast = (x: number) => (x > 0.4 ? -1 : 0.2);
  const off = stepOff(board, Math.PI / 2, wetEast, 0);
  expect(off.x).toBeLessThan(-0.5);
  const blocked = stepOff(board, Math.PI / 2, flat, 0, (x) => x < 0.3);
  expect(blocked.x).toBeLessThan(-0.5);
  const shore = (x: number) => (x > 0.4 || x < -1.2 ? -1 : 0.2); // dry a little way on the west only
  const far = stepOff(board, -Math.PI / 2, shore, 0);
  expect(shore(far.x)).toBeGreaterThan(0);
});

test("the beaver can step on from beside the board, not from a few metres away", () => {
  const board = { x: 0, z: 0, heading: 0 };
  expect(near({ x: 0.6, z: 0.2 }, board)).toBe(true);
  expect(near({ x: 0, z: 0.9 }, board)).toBe(true); // at its nose
  expect(near({ x: 2, z: 0 }, board)).toBe(false);
  expect(near({ x: 0, z: 2.5 }, board)).toBe(false);
});
