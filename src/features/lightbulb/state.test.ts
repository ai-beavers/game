// Tests for the Lightbulb's switch and glow as a player meets them. Run: bun test src/features/lightbulb
import { expect, test } from "bun:test";
import { glow, PULL_SECONDS, pull, switchedOff, stepBulb, type Bulb } from "./state.ts";

/** The cord's pull played out: `seconds` of steps of 1/60 s. */
const run = (bulb: Bulb, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) bulb = stepBulb(bulb, 1 / 60);
  return bulb;
};

test("the bulb starts switched off, with no pull under way", () => {
  expect(switchedOff()).toEqual({ on: false, pulling: 0 });
});

test("one pull switches it on, a second one off again", () => {
  const once = run(pull(switchedOff()), PULL_SECONDS + 0.1);
  expect(once.on).toBe(true);
  expect(once.pulling).toBe(0);
  expect(run(pull(once), PULL_SECONDS + 0.1).on).toBe(false);
});

test("it switches as the cord is pulled, not after the tug", () => {
  const pulled = pull(switchedOff());
  expect(pulled.on).toBe(true);
  expect(pulled.pulling).toBeGreaterThan(0);
});

test("a pull while one is under way is ignored", () => {
  const pulled = run(pull(switchedOff()), PULL_SECONDS / 2);
  expect(pull(pulled)).toEqual(pulled);
  expect(run(pulled, PULL_SECONDS).pulling).toBe(0);
});

test("a switched-off bulb gives no glow, by day or at night", () => {
  expect(glow(false, 0)).toBe(0);
  expect(glow(false, 1)).toBe(0);
});

test("a lit bulb glows softly by day and brightly at night", () => {
  expect(glow(true, 0)).toBeGreaterThan(0);
  expect(glow(true, 1)).toBeGreaterThan(glow(true, 0) * 2);
  expect(glow(true, 0.5)).toBeGreaterThan(glow(true, 0));
});
