// When the beaver does a Stare: after a minute of nobody touching the controls, eased up slowly, and released at once
// (within RELEASE s) by any input or by a moment where a stare is not allowed. Fixed frames of 1/60 s.
import { expect, test } from "bun:test";
import { newStare, RELEASE, stepStare, THRESHOLD } from "./stare.ts";

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
