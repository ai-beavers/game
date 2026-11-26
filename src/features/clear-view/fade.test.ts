import { expect, test } from "bun:test";
import { watch } from "./fade.ts";
import { bodyPoints, volume } from "./volumes.ts";

const crown = (x: number, y: number, z: number, r: number) =>
  volume({ x, y, z }, [{ x: r, y: 0, z: 0 }, { x: 0, y: r, z: 0 }, { x: 0, y: 0, z: r }], true, "crown");
const points = bodyPoints({ x: 0, y: 0, z: 0 });
const eye = { x: 0, y: 1, z: -4 };
/** The leaves to fade after looking for `seconds`, a frame every 1/60 s. */
const lookFor = (seconds: number, at: typeof eye, volumes: ReturnType<typeof crown>[]) => {
  const look = watch(), wanted = new Set<unknown>();
  for (let t = 0; t < seconds; t += 1 / 60) for (const v of look(1 / 60, at, points, volumes)) wanted.add(v.tag);
  return wanted;
};

test("a crown that hides the beaver only for a moment stays whole; one that hides it for half a second fades", () => {
  const between = crown(0, 0.6, -2, 1);
  expect(lookFor(0.3, eye, [between]).size).toBe(0);
  expect(lookFor(0.8, eye, [between]).has("crown")).toBe(true);
});

test("a crown the camera stands in fades at once", () => {
  expect(lookFor(0.05, eye, [crown(0, 1.5, -4.5, 1.2)]).has("crown")).toBe(true);
});

test("leaves beside the way, while the beaver is seen, never fade", () => {
  expect(lookFor(2, eye, [crown(4, 1, -2, 1)]).size).toBe(0);
});

test("the beaver hidden behind a trunk alone fades no leaves", () => {
  const look = watch(), trunk = () => true;
  let wanted = 0;
  for (let t = 0; t < 2; t += 1 / 60) wanted += look(1 / 60, eye, points, [crown(4, 1, -2, 1)], trunk).length;
  expect(wanted).toBe(0);
});
