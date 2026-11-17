// Tests for the player's pure logic: jump timing, the carry sequence, the Motion bookkeeping. bun test src/player
import { describe, expect, test } from "bun:test";
import { jumpStarts, newAction, newJump, newMotion, stepAction, trackMotion, turnTowards, type ActionState } from "./state.ts";

const dt = 1 / 60;

describe("jump", () => {
  test("starts in the step the key goes down, once per press", () => {
    const s = newJump();
    expect(jumpStarts(s, dt, true, false, true)).toBe(false);
    expect(jumpStarts(s, dt, true, true, true)).toBe(true);
    expect(jumpStarts(s, dt, true, true, true)).toBe(false); // held: no second jump
  });
  test("coyote time: 0.1 s after leaving the ground, not later", () => {
    const s = newJump();
    jumpStarts(s, dt, true, false, true);
    for (let i = 0; i < 5; i++) jumpStarts(s, dt, false, false, true);
    expect(jumpStarts(s, dt, false, true, true)).toBe(true); // 6 steps = 0.1 s
    const late = newJump();
    jumpStarts(late, dt, true, false, true);
    for (let i = 0; i < 7; i++) jumpStarts(late, dt, false, false, true);
    expect(jumpStarts(late, dt, false, true, true)).toBe(false);
  });
  test("buffer: a press up to 0.1 s before landing jumps on landing", () => {
    const s = newJump();
    expect(jumpStarts(s, dt, false, true, true)).toBe(false);
    for (let i = 0; i < 4; i++) jumpStarts(s, dt, false, false, true);
    expect(jumpStarts(s, dt, true, false, true)).toBe(true);
    const early = newJump();
    jumpStarts(early, dt, false, true, true);
    for (let i = 0; i < 8; i++) jumpStarts(early, dt, false, false, true);
    expect(jumpStarts(early, dt, true, false, true)).toBe(false);
  });
  test("no jump when not allowed (swimming, busy)", () => {
    expect(jumpStarts(newJump(), dt, true, true, false)).toBe(false);
  });
});

describe("carrying", () => {
  const run = (s: ActionState, seconds: number) => {
    const events: string[] = [];
    for (let t = 0; t < seconds - 1e-9; t += dt) { const e = stepAction(s, dt, false, true); if (e) events.push(e); }
    return events;
  };
  test("pickup → carrying → drop", () => {
    const s = newAction();
    stepAction(s, dt, true, false);
    expect(s.action).toBe("none"); // nothing in reach
    stepAction(s, dt, true, true);
    expect(s.action).toBe("pickup");
    expect(run(s, 0.49)).toEqual([]);
    expect(s.carrying).toBe(false);
    expect(run(s, 0.02)).toEqual(["grab"]);
    expect(s.carrying).toBe(true);
    run(s, 0.5);
    expect(s.action).toBe("none");
    stepAction(s, dt, true, true);
    expect(s.action).toBe("drop");
    expect(run(s, 0.6)).toEqual(["release"]);
    expect(s).toEqual({ action: "none", progress: 0, carrying: false });
  });
  test("E during an action does nothing", () => {
    const s = newAction();
    stepAction(s, dt, true, true);
    stepAction(s, dt, true, true);
    expect(s.action).toBe("pickup");
    expect(s.progress).toBeCloseTo(dt / 1.0);
  });
});

describe("motion", () => {
  const facts = (o: Partial<Parameters<typeof trackMotion>[2]> = {}) =>
    ({ moved: 0, vertical: 0, turning: 0, grounded: true, afloat: false, act: newAction(), ...o });
  test("distance only on the ground; air time and landing", () => {
    const m = newMotion();
    trackMotion(m, dt, facts({ moved: 0.02 }));
    expect(m.distance).toBeCloseTo(0.02);
    expect(m.speed).toBeCloseTo(1.2);
    trackMotion(m, dt, facts({ moved: 0.02, grounded: false, vertical: -3 }));
    trackMotion(m, dt, facts({ moved: 0.02, grounded: false, vertical: -4 }));
    expect(m.distance).toBeCloseTo(0.02);
    expect(m.airTime).toBeCloseTo(2 * dt);
    trackMotion(m, dt, facts());
    expect(m.airTime).toBe(0);
    expect(m.sinceLanding).toBe(0);
    expect(m.landingSpeed).toBe(4);
    trackMotion(m, dt, facts());
    expect(m.sinceLanding).toBeCloseTo(dt);
    expect(m.time).toBeCloseTo(5 * dt);
  });
  test("swimming eases over half a second", () => {
    const m = newMotion();
    for (let i = 0; i < 15; i++) trackMotion(m, dt, facts({ grounded: false, afloat: true }));
    expect(m.swimming).toBeCloseTo(0.5);
    expect(m.airTime).toBe(0);
    for (let i = 0; i < 30; i++) trackMotion(m, dt, facts({ grounded: false, afloat: true }));
    expect(m.swimming).toBe(1);
  });
  test("anger is left alone", () => {
    const m = newMotion();
    m.anger = 0.7;
    trackMotion(m, dt, facts());
    expect(m.anger).toBe(0.7);
  });
});

test("turnTowards goes the short way", () => {
  expect(turnTowards(3, -3, 1)).toBeCloseTo(3 + (2 * Math.PI - 6));
  expect(turnTowards(0, 2, 0.5)).toBe(0.5);
});
