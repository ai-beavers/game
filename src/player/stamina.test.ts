// Tests for the stamina rules, as a player meets them: how long a run lasts, the walk when it is gone, and how fast it
// comes back at rest and while gnawing. bun test src/player
import { describe, expect, test } from "bun:test";
import { newStamina, stepStamina, type Stamina } from "./stamina.ts";

const dt = 1 / 60;
const onLand = { onLand: true, gnawing: false };
/** Seconds of steps until the allowed run drops below what was asked (tired), at most `limit`. */
const runFor = (s: Stamina, run: number, limit = 60, ground = onLand) => {
  let t = 0;
  while (t < limit && stepStamina(s, dt, run, ground) >= run) t += dt;
  return t;
};

describe("stamina", () => {
  test("a full run empties a full stamina in about six seconds", () => {
    expect(runFor(newStamina(), 1)).toBeCloseTo(6, 0);
  });
  test("a half-pushed run lasts about twice as long", () => {
    expect(runFor(newStamina(), 0.5)).toBeCloseTo(12, 0);
  });
  test("tired, it may not run until a third is back, then runs as asked again", () => {
    const s = newStamina();
    runFor(s, 1);
    expect(s.tired).toBe(true);
    let t = 0;
    while (stepStamina(s, dt, 1, onLand) === 0) t += dt;
    expect(t).toBeCloseTo(8 / 3, 1); // a third of the 8 s it takes to refill from empty, run key held all along
    expect(s.tired).toBe(false);
    expect(stepStamina(s, dt, 0.7, onLand)).toBe(0.7);
  });
  test("at rest an empty stamina is full again in about eight seconds", () => {
    const s = newStamina();
    runFor(s, 1);
    let t = 0;
    while (s.level < 1) { stepStamina(s, dt, 0, onLand); t += dt; }
    expect(t).toBeCloseTo(8, 0);
  });
  test("gnawing a tree refills it three times as fast", () => {
    const s = newStamina();
    runFor(s, 1);
    let t = 0;
    while (s.level < 1) { stepStamina(s, dt, 0, { onLand: true, gnawing: true }); t += dt; }
    expect(t).toBeCloseTo(8 / 3, 1);
  });
  test("afloat or in the air a run never drains it", () => {
    const s = newStamina();
    expect(runFor(s, 1, 30, { onLand: false, gnawing: false })).toBeCloseTo(30, 0);
    expect(s.level).toBe(1);
  });
  test("a run in a jump neither drains nor rests it", () => {
    const s = newStamina();
    runFor(s, 1, 3);
    const before = s.level;
    for (let t = 0; t < 0.5; t += dt) stepStamina(s, dt, 1, { onLand: false, gnawing: false });
    expect(s.level).toBe(before);
  });
});
