import { expect, test } from "bun:test";
import { bodyPoints, enter, inside, sight, volume } from "./volumes.ts";

const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number, round = false) =>
  volume({ x, y, z }, [{ x: hx, y: 0, z: 0 }, { x: 0, y: hy, z: 0 }, { x: 0, y: 0, z: hz }], round);
const feet = { x: 0, y: 0, z: 0 }, points = bodyPoints(feet);

test("volumes: a box or a round crown in the way, a turned one, the start inside", () => {
  const crate = box(0, 0.5, 2, 0.5, 0.5, 0.5);
  expect(enter(crate, { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0.5, z: 4 })).toBeCloseTo(0.375);
  expect(enter(crate, { x: 2, y: 0.5, z: 0 }, { x: 2, y: 0.5, z: 4 })).toBe(Infinity);
  expect(enter(crate, { x: 0, y: 0.5, z: 2 }, { x: 0, y: 0.5, z: 4 })).toBe(0);
  // The corner of a crown's box is air: the ellipsoid lets that ray by.
  expect(enter(box(0, 0, 0, 1, 1, 1, true), { x: -2, y: 0.9, z: 0.9 }, { x: 2, y: 0.9, z: 0.9 })).toBe(Infinity);
  expect(enter(box(0, 0, 0, 1, 1, 1), { x: -2, y: 0.9, z: 0.9 }, { x: 2, y: 0.9, z: 0.9 })).toBeCloseTo(0.25);
  // A log lying turned 45°: thin across, long along.
  const s = Math.SQRT1_2, log = volume({ x: 0, y: 0, z: 0 }, [{ x: 2 * s, y: 0, z: 2 * s }, { x: 0, y: 0.2, z: 0 }, { x: -0.2 * s, y: 0, z: 0.2 * s }]);
  expect(inside(log, { x: 1.2, y: 0, z: 1.2 })).toBe(true);
  expect(inside(log, { x: 1.2, y: 0, z: -1.2 })).toBe(false);
  expect(inside(log, { x: 0, y: 0.35, z: 0 }, 0.2)).toBe(true); // grown by a margin
});

test("the beaver is hidden behind stacked crates, seen past them, and a crown round it does not count", () => {
  const eye = { x: 0, y: 1, z: -5 }, crates = box(0, 0.75, -2.5, 0.8, 0.75, 0.3);
  expect(sight(eye, points, [crates]).seen).toBe(false);
  expect(sight(eye, points, [box(3, 0.75, -2.5, 0.8, 0.75, 0.3)]).seen).toBe(true);
  expect(sight(eye, points, [box(0, 0.5, 0, 1.5, 1, 1.5)]).seen).toBe(true); // among reeds: no camera move helps
  expect(sight(eye, points, [box(0, 1, -5, 1, 1, 1, true)]).within).toBe(true); // the camera in a bush
  expect(sight(eye, points, [], (_, p) => p.y < 0.4).seen).toBe(true); // the ground hides the feet only
});
