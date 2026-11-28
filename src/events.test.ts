// The per-step watcher: which game events a Motion's changes give. bun test src/events.test.ts
import { expect, test } from "bun:test";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { createEvents, watch } from "./events.ts";
import { newMotion, trackMotion, newAction } from "./player/state.ts";

const dt = 1 / 60;

/** Drives the watcher through steps of (grounded, afloat, vertical m/s) and counts the events. */
function run(steps: [boolean, boolean, number][]) {
  const motion = newMotion(), events = createEvents(), counts = { jump: 0, land: 0, enterWater: 0 };
  const notice = watch(motion, new Vector3(), events);
  const step = ([grounded, afloat, vertical]: [boolean, boolean, number]) => {
    trackMotion(motion, dt, { moved: 0, vertical, turning: 0, grounded, afloat, act: newAction() });
    notice();
  };
  step([true, false, 0]); // standing, before counting
  for (const name of ["jump", "land", "enterWater"] as const) events.on(name, () => counts[name]++);
  steps.forEach(step);
  return counts;
}
const air = (n: number, from: number): [boolean, boolean, number][] => Array.from({ length: n }, (_, i) => [false, false, from - 18 * dt * i]);

test("a jump, then a Double jump near its top: two jump events, one landing", () => {
  const counts = run([[true, false, 0], [true, false, 0], ...air(15, 4.8), ...air(30, 3.2), [true, false, 0]]);
  expect(counts).toEqual({ jump: 2, land: 1, enterWater: 0 });
});

test("a Double jump while falling fast is one jump event", () => {
  const counts = run([[true, false, 0], ...air(40, 0), ...air(20, 3.2), [true, false, 0]]);
  expect(counts.jump).toBe(1);
});

test("falling, landing and coming into the water give no jump", () => {
  expect(run([[true, false, 0], ...air(30, 0), [true, false, 0]]).jump).toBe(0);
  // the water stops the fall: the vertical speed rises, but the beaver is held up
  expect(run([[true, false, 0], ...air(30, 0), [false, true, -0.6], [false, true, -0.3], [false, true, 0]]).jump).toBe(0);
});
