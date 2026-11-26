// Tests for reach.ts: the prompt agrees with the player about what E does.
import { expect, test } from "bun:test";
import { contextAction, stickInReach } from "./reach.ts";

const feet = { x: 0, y: 0, z: 0 };

test("a stick just in front is in reach, one behind is not", () => {
  expect(stickInReach(feet, 0, [{ x: 0, y: 0.02, z: 0.6 }])).toBe(0);
  expect(stickInReach(feet, 0, [{ x: 0, y: 0.02, z: -0.6 }])).toBe(-1);
  expect(stickInReach(feet, Math.PI, [{ x: 0, y: 0.02, z: -0.6 }])).toBe(0);
});

test("the nearest of two sticks wins", () => {
  expect(stickInReach(feet, 0, [{ x: 0.3, y: 0, z: 0.6 }, { x: 0.05, y: 0, z: 0.6 }])).toBe(1);
});

test("the key says drop while carrying, nothing while busy or in the air", () => {
  const near = [{ x: 0, y: 0, z: 0.6 }];
  expect(contextAction({ feet, facing: 0, carrying: false, ready: true, sticks: near })).toBe("pickup");
  expect(contextAction({ feet, facing: 0, carrying: true, ready: true, sticks: near })).toBe("drop");
  expect(contextAction({ feet, facing: 0, carrying: false, ready: false, sticks: near })).toBeUndefined();
  expect(contextAction({ feet, facing: 0, carrying: false, ready: true, sticks: [] })).toBeUndefined();
});
