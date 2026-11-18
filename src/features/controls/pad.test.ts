// Tests for the pure controls logic: dead zones, a gamepad to an Input, and which source steers (player/input.ts).
import { expect, test } from "bun:test";
import { merge, newInput, newReading, notice } from "../../player/input.ts";
import { BUTTON, deadZone, firstPad, padInput, stickSpeed, WALK_PUSH, type PadLike } from "./pad.ts";

const pad = (axes: number[], pressed: number[] = [], values: Record<number, number> = {}): PadLike => ({
  axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: values[i] ?? +pressed.includes(i) })),
});

test("dead zone: rest is still, a push past it starts near 0, full push is 1, direction kept", () => {
  expect(deadZone(0.1, -0.1)).toEqual({ x: 0, y: 0 });
  expect(Math.hypot(...Object.values(deadZone(0.2, 0)))).toBeLessThan(0.05);
  const full = deadZone(0.7, 0.7);
  expect(Math.hypot(full.x, full.y)).toBeCloseTo(1, 5);
  expect(full.x).toBeCloseTo(full.y, 5);
  expect(deadZone(0, 0.565).y).toBeCloseTo(0.5, 2);
});

test("left stick: up is forward, speed follows the push, all the way runs", () => {
  const input = padInput(pad([0, -1]), newInput());
  expect(input.move.x).toBeCloseTo(0);
  expect(input.move.y).toBeCloseTo(1);
  expect(input.run).toBeCloseTo(1);
  const slight = padInput(pad([0.4, 0]), newInput()); // 0.29 past the dead zone: a slow walk
  expect(slight.move.x).toBeGreaterThan(0.5);
  expect(slight.move.x).toBeLessThan(0.65);
  expect(slight.run).toBe(0);
});

test("stick speed: walk grows to full at WALK_PUSH, then run grows to 1, direction kept", () => {
  expect(stickSpeed(0, 0)).toEqual({ x: 0, y: 0, run: 0 });
  expect(stickSpeed(WALK_PUSH / 2, 0)).toEqual({ x: 0.5, y: 0, run: 0 });
  const walk = stickSpeed(0, WALK_PUSH);
  expect(walk.y).toBeCloseTo(1); expect(walk.run).toBeCloseTo(0);
  const between = stickSpeed(0.75 * 0.6, 0.75 * 0.8); // pushed 0.75
  expect(Math.hypot(between.x, between.y)).toBeCloseTo(1);
  expect(between.x / between.y).toBeCloseTo(0.75);
  expect(between.run).toBeCloseTo(0.5);
  expect(stickSpeed(0, -1).run).toBeCloseTo(1);
});

test("buttons: A jumps, X uses, B dives, RB slaps, LB and triggers run, d-pad moves", () => {
  expect(padInput(pad([0, 0], [BUTTON.a]), newInput()).jump).toBe(true);
  expect(padInput(pad([0, 0], [BUTTON.x]), newInput()).act).toBe(true);
  const dive = padInput(pad([0, 0], [BUTTON.b]), newInput());
  expect(dive.dive).toBe(true);
  expect(dive.act).toBe(false); // B no longer uses: it is the dive's
  expect(padInput(pad([0, 0], [BUTTON.lb]), newInput()).run).toBe(1);
  const slap = padInput(pad([0, 0], [BUTTON.rb]), newInput());
  expect(slap.slap).toBe(true);
  expect(slap.run).toBe(0); // RB no longer runs: it is the tail's
  expect(padInput(pad([0, 0], [BUTTON.x]), newInput()).slap).toBe(false);
  expect(padInput(pad([0, 0], [], { [BUTTON.rt]: 0.2 }), newInput()).run).toBe(0);
  expect(padInput(pad([0, 0], [], { [BUTTON.rt]: 0.5 }), newInput()).run).toBe(1);
  expect(padInput(pad([0, 0], [BUTTON.up]), newInput()).run).toBe(0); // the d-pad walks
  expect(padInput(pad([0, 0], [BUTTON.left]), newInput()).move).toEqual({ x: -1, y: 0 });
  expect(padInput(pad([0, 0]), newInput())).toEqual(newInput());
});

test("first connected pad", () => {
  expect(firstPad([null, { connected: false } as Gamepad])).toBeUndefined();
  const real = { connected: true } as Gamepad;
  expect(firstPad([null, real])).toBe(real);
  expect(firstPad(undefined)).toBeUndefined();
});

test("the last source used steers; an idle one cancels nothing; buttons of all count", () => {
  const keys = newReading(), stick = newReading(), into = newInput();
  const step = (tick: number) => { notice(keys, tick); notice(stick, tick); return merge(into, [keys, stick]); };
  keys.input.move.y = 1;
  expect(step(1).move.y).toBe(1);
  stick.input.move.x = 0.5; // the stick comes in later: it steers
  expect(step(2).move).toEqual({ x: 0.5, y: 0 });
  expect(step(3).move).toEqual({ x: 0.5, y: 0 }); // both held, nothing new: still the stick
  keys.input.move.y = 0; keys.input.move.x = -1; // the keys change: they steer again
  expect(step(4).move).toEqual({ x: -1, y: 0 });
  keys.input.move.x = 0; // let go: the stick, still held, steers
  expect(step(5).move).toEqual({ x: 0.5, y: 0 });
  stick.input.move.x = 0; stick.input.jump = true; keys.input.run = 1;
  const both = step(6);
  expect(both.move).toEqual({ x: 0, y: 0 });
  expect(both.jump).toBe(true);
  expect(both.run).toBe(1);
  keys.input.run = 0; stick.input.run = 0.4; // the most run of any source
  expect(step(7).run).toBe(0.4);
});
