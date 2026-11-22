// The physics helpers on Havok (src/physics.ts): what a feature relies on when it moves, hides and asks after bodies.
import { expect, test } from "bun:test";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { headless } from "./physics.testkit.ts";
import { ALL, GROUND, HEAVY, LOOSE, PhysicsMotionType, SLIPPING, SOLID, box, enable, isEnabled, place, regroup } from "./physics.ts";

test("a stick put somewhere is there at once, taken out it is in no query, put back it falls again", async () => {
  const { scene, physics } = await headless();
  physics.fixed(box(scene, 20, 0.5, 20), GROUND); // the ground's top at y = 0.5
  const stick = physics.body(new TransformNode("stick", scene), PhysicsMotionType.DYNAMIC, box(scene, 0.1, 0.1, 0.5), LOOSE);
  place(stick, { x: 3, y: 2, z: -1 }, Quaternion.Identity());
  const down = { x: 0, y: -1, z: 0 }, hit = () => physics.ray({ x: 3, y: 5, z: -1 }, down, 10, ALL);
  expect(hit()?.body).toBe(stick); // where it was put, before any step
  enable(stick, false);
  for (let i = 0; i < 30; i++) physics.step(1 / 60);
  expect(isEnabled(stick)).toBe(false);
  expect(hit()?.body).not.toBe(stick); // out of every query
  expect(stick.transformNode.position.y).toBeCloseTo(2, 3); // and held still: no gravity
  enable(stick, true);
  for (let i = 0; i < 90; i++) physics.step(1 / 60);
  expect(stick.transformNode.position.y).toBeLessThan(0.7); // fell onto the ground
  expect(stick.transformNode.position.y).toBeGreaterThan(0.5);
  expect(new Vector3(3, 0, -1).subtract(stick.transformNode.position.multiplyByFloats(1, 0, 1)).length()).toBeLessThan(0.1);
});

test("a heavy thing held up by a solid one slips through it once it is slipping, and lies on the ground", async () => {
  const { scene, physics } = await headless();
  physics.fixed(box(scene, 20, 0.5, 20), GROUND); // the ground's top at y = 0.5
  physics.fixed(box(scene, 1, 0.5, 1, { x: 0, y: 2, z: 0 }), SOLID); // a shelf, its top at y = 2.5
  const log = physics.body(new TransformNode("log", scene), PhysicsMotionType.DYNAMIC, box(scene, 0.3, 0.3, 0.3), HEAVY);
  place(log, { x: 0, y: 3, z: 0 }, Quaternion.Identity());
  const y = () => log.transformNode.position.y;
  for (let i = 0; i < 90; i++) physics.step(1 / 60);
  expect(y()).toBeCloseTo(2.8, 1); // at rest on the shelf
  regroup(log, SLIPPING);
  for (let i = 0; i < 120; i++) physics.step(1 / 60);
  expect(y()).toBeCloseTo(0.8, 1); // through the shelf, on the ground
});
