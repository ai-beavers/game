import { expect, test } from "bun:test";
import { BURN_SECONDS, dawnCame, raised, stepFlag, type Flag } from "./state.ts";

/** Runs the flag for `seconds` in steps of 1/60 s, nobody lighting it, no dawn. */
const run = (flag: Flag, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) flag = stepFlag(flag, 1 / 60, false, false);
  return flag;
};

test("a whole flag stays whole until it is lit, at any hour", () => {
  expect(run(raised(), 30)).toEqual({ state: "whole", burnt: 0 });
  expect(stepFlag(raised(), 1 / 60, true, false).state).toBe("burning");
});

test("it burns for about eight seconds from the bottom up, then is charred", () => {
  expect(BURN_SECONDS).toBe(8);
  const lit = stepFlag(raised(), 0, true, false);
  const half = run(lit, 4);
  expect(half.state).toBe("burning");
  expect(half.burnt).toBeGreaterThan(0.45);
  expect(half.burnt).toBeLessThan(0.55);
  expect(run(lit, 7.9).state).toBe("burning");
  expect(run(lit, 8.1)).toEqual({ state: "charred", burnt: 1 });
});

test("lighting a burning or charred flag does nothing more", () => {
  const burning = run(stepFlag(raised(), 0, true, false), 2);
  expect(stepFlag(burning, 0, true, false)).toEqual(burning);
  const charred = run(burning, 10);
  expect(stepFlag(charred, 1 / 60, true, false)).toEqual(charred);
});

test("a fresh flag is raised at the next dawn, not before", () => {
  const charred = run(stepFlag(raised(), 0, true, false), 9);
  expect(stepFlag(charred, 1 / 60, false, true)).toEqual(raised());
  expect(stepFlag(raised(), 1 / 60, false, true)).toEqual(raised());
});

test("dawn comes when the hour enters the early morning, by the clock running or set", () => {
  expect(dawnCame(4.99, 5.01)).toBe(true);
  expect(dawnCame(13, 5.6)).toBe(true); // the hour set to dawn
  expect(dawnCame(5.5, 5.6)).toBe(false); // lit at dawn: the next dawn is a day away
  expect(dawnCame(12, 12.1)).toBe(false);
  expect(dawnCame(23.9, 0.1)).toBe(false);
});
