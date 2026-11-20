// When the beaver does a Stare: after a minute of nobody touching the controls, eased up slowly, and released at once
// (within RELEASE s) by any input or by a moment where a stare is not allowed. Fixed frames of 1/60 s.
import { expect, test } from "bun:test";
import { approaching, CREEP, creepSpeed, newStare, RELEASE, stepApproach, stepStare, THRESHOLD, TURN, STOP } from "./stare.ts";

const DT = 1 / 60;
/** Steps s for `seconds`, nobody touching anything, a stare allowed; the last weight. */
const leave = (s: ReturnType<typeof newStare>, seconds: number, dt = DT, allowed = true) => {
  let w = 0;
  for (let t = 0; t < seconds - 1e-9; t += dt) w = stepStare(s, dt, false, allowed);
  return w;
};

test("no stare before the minute is up, a full one a few seconds after", () => {
  const s = newStare();
  expect(leave(s, THRESHOLD - 0.1)).toBe(0);
  expect(leave(s, 0.5)).toBeGreaterThan(0);
  expect(leave(s, 0.5)).toBeLessThan(0.5); // a slow start, not a snap
  expect(leave(s, 6)).toBe(1);
});

test("any input lets a stare go within the release time, and the minute starts again", () => {
  const s = newStare();
  expect(leave(s, THRESHOLD + 6)).toBe(1);
  let w = stepStare(s, DT, true, true);
  for (let t = DT; t < RELEASE + 1e-9; t += DT) w = stepStare(s, DT, false, true);
  expect(w).toBe(0);
  expect(leave(s, THRESHOLD - 1)).toBe(0); // counted afresh from the input
  leave(s, THRESHOLD - 1);
  stepStare(s, DT, true, true); // touched just before the minute was up
  expect(leave(s, 2)).toBe(0);
});

test("where a stare is not allowed it never starts, and the count starts again", () => {
  const s = newStare();
  expect(leave(s, THRESHOLD * 3, DT, false)).toBe(0);
  leave(s, THRESHOLD - 1);
  leave(s, DT, DT, false);
  expect(leave(s, 2)).toBe(0);
  expect(leave(s, THRESHOLD + 6)).toBe(1);
  expect(leave(s, RELEASE, DT, false)).toBe(0); // and a stare under way is let go
});

test("the minute runs in the time it is given: a faster world waits less real time", () => {
  const s = newStare(), FAST = 4; // the fast tour's stage.timeScale: each picture of 1/60 s real time is 4/60 s of game time
  const frames = (n: number) => { let w = 0; for (let i = 0; i < n; i++) w = stepStare(s, DT * FAST, false, true); return w; };
  expect(frames(Math.floor(THRESHOLD / FAST * 60) - 30)).toBe(0); // half a real second short of a quarter minute
  expect(frames(6 * 60 / FAST)).toBe(1);
});

// The approach: once the stare is full and the body faces the camera, the beaver walks up to it, until its eyes are
// STOP from the lens or it cannot get any closer.
/** Steps a stare and its approach for `seconds`, the beaver `off` rad off the camera, its eyes at distance(t) m from
 *  the lens; whether it walks in the last frame. */
const creep = (s: ReturnType<typeof newStare>, seconds: number, off: number, distance: (t: number) => number, allowed = true) => {
  let walking = false;
  for (let t = 0; t < seconds - 1e-9; t += DT) { stepStare(s, DT, false, allowed); walking = stepApproach(s, DT, off, distance(t)); }
  return walking;
};

/** Left alone until the stare is full while still turning, then one frame facing the camera 4 m off: the approach starts. */
const faced = (s: ReturnType<typeof newStare>) => { creep(s, THRESHOLD + TURN + 1, 1, () => 4); return creep(s, DT, 0, () => 4); };

test("no approach until the beaver has turned to face the camera", () => {
  const s = newStare();
  expect(creep(s, THRESHOLD + 1, 0, () => 4)).toBe(false); // the stare still coming on
  expect(creep(s, TURN + 1, 1, () => 4)).toBe(false); // full, but still turning round
  expect(creep(s, DT, 0, () => 4)).toBe(true);
  expect(approaching(s)).toBe(true);
});

test("the approach stops with the eyes a hand's width from the lens, and the stare goes on", () => {
  const s = newStare();
  expect(faced(s)).toBe(true);
  expect(creep(s, 1, 0, (t) => 4 - t)).toBe(true); // half a metre a second, still far
  expect(creep(s, DT, 0, () => STOP - 0.01)).toBe(false); // arrived
  expect(creep(s, 5, 0, () => STOP - 0.01)).toBe(false);
  expect(stepStare(s, DT, false, true)).toBe(1);
  expect(approaching(s)).toBe(true); // the camera still holds for it
});

test("already that close to the lens, it stares without moving", () => {
  const s = newStare();
  expect(creep(s, THRESHOLD + TURN + 1, 0, () => STOP * 0.8)).toBe(false);
  expect(approaching(s)).toBe(true);
});

test("any input or a moment where a stare is not allowed ends the approach at once", () => {
  for (const end of ["touched", "not allowed"]) {
    const s = newStare();
    faced(s);
    expect(approaching(s)).toBe(true);
    stepStare(s, DT, end === "touched", end === "touched");
    expect(stepApproach(s, DT, 0, 3)).toBe(false);
    expect(approaching(s)).toBe(false); // the camera lets go in the same frame
    expect(creep(s, 2, 0, () => 3)).toBe(false); // and it does not start again by itself
  }
});

test("blocked on the way, it stops walking after about a second and stares on", () => {
  const s = newStare();
  faced(s);
  creep(s, 2, 0, (t) => 4 - 0.5 * t);
  expect(creep(s, 0.5, 0, () => 2)).toBe(true); // a moment against the tree: it still tries
  expect(creep(s, 1, 0, () => 2)).toBe(false);
  expect(creep(s, 3, 0, () => 2)).toBe(false);
  expect(stepStare(s, DT, false, true)).toBe(1);
  expect(approaching(s)).toBe(true);
});

test("the approach is a slow walk, slower still over its last stretch, and never stands still on the way", () => {
  expect(creepSpeed(4)).toBe(CREEP);
  expect(CREEP).toBeLessThan(1); // well under a walk
  expect(creepSpeed(STOP + 0.1)).toBeLessThan(CREEP);
  expect(creepSpeed(STOP + 0.01)).toBeGreaterThan(0);
});
