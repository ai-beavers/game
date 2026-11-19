// Tests for the player's pure logic: jump timing, the carry sequence, diving and breath, the Motion bookkeeping. bun test src/player
import { describe, expect, test } from "bun:test";
import { BREATH, REFILL, RIDE_SPEED, SWIM_SPEED, rideKeys, SLAP_COOLDOWN, newDive, stepDive, TURN_ACCEL, jumpStarts, newAction, newJump, newMotion, newSlap, newSteering, slapHits, steer, stepAction, stepLow, stepSlap, trackMotion, turnTowards, type ActionState } from "./state.ts";

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

describe("steer", () => {
  /** Walking, the stick pushed to `to`: when facing is within 0.05 rad of it, the most the turn rate changed in a
   *  step, and how far it went past. */
  const turn = (to: number) => {
    const s = newSteering();
    s.speed = 0.8;
    let settled = NaN, kick = 0, over = 0, spin = 0;
    for (let i = 1; i < 120; i++) {
      steer(s, to, 1, 0.8, 6, 9, dt);
      kick = Math.max(kick, Math.abs(s.spin - spin));
      spin = s.spin;
      over = Math.max(over, s.facing - to);
      if (Number.isNaN(settled) && Math.abs(s.facing - to) < 0.05) settled = i * dt;
    }
    return { settled, kick, over };
  };
  test("the turn rate builds up instead of jumping to full (it jumped 10 rad/s in one step)", () => {
    for (const to of [0.3, Math.PI / 2, Math.PI]) expect(turn(to).kick).toBeLessThanOrEqual(TURN_ACCEL * dt + 1e-9);
  });
  test("it arrives without overshooting, about as quickly as the old 10 rad/s snap", () => {
    // the old turn settled after 0.083 s (45°), 0.167 s (90°), 0.317 s (180°)
    for (const [to, old] of [[Math.PI / 4, 0.083], [Math.PI / 2, 0.167], [Math.PI, 0.317]] as const) {
      const r = turn(to);
      expect(r.settled).toBeLessThanOrEqual(old + 0.02);
      expect(r.over).toBeLessThan(0.01);
    }
  });
  test("letting go stops the turn within a quarter radian", () => {
    const s = newSteering();
    for (let i = 0; i < 10; i++) steer(s, Math.PI, 1, 0.8, 6, 9, dt);
    const at = s.facing;
    for (let i = 0; i < 30; i++) steer(s, undefined, 0, 0.8, 6, 9, dt);
    expect(s.spin).toBe(0);
    expect(s.facing - at).toBeLessThan(0.25);
  });
});

describe("tail slap", () => {
  test("one strike per press, none while not held up, the next only after the cooldown", () => {
    const s = newSlap(), act = newAction();
    let m = newMotion(), hits = 0, steps = 0;
    const step = (pressed: boolean, allowed = true) => {
      stepSlap(s, dt, pressed, allowed);
      const before = { ...m };
      trackMotion(m, dt, { moved: 0, vertical: 0, turning: 0, grounded: true, afloat: false, act, slap: s.progress });
      if (slapHits(before, m)) hits++;
      steps++;
    };
    step(true, false);
    expect(s.progress).toBe(0); // in the air: nothing
    step(true);
    for (let i = 0; i < 60; i++) step(i === 30); // a press during the slap is not a second one
    expect(hits).toBe(1);
    expect(s.progress).toBe(0);
    step(true); // still cooling down
    expect(s.progress).toBe(0);
    while (steps * dt < SLAP_COOLDOWN + 0.05) step(false);
    step(true);
    expect(s.progress).toBeGreaterThan(0);
    m = { ...m, action: "pickup", actionProgress: 0.6 };
    expect(slapHits({ ...m, actionProgress: 0.4 }, m)).toBe(false); // a pickup's half way is not a slap
  });
});

describe("dive", () => {
  test("only afloat and while held; the breath lasts BREATH s under, then it surfaces until a fresh press", () => {
    const s = newDive();
    expect(stepDive(s, dt, true, false, false)).toBe(false); // on land: nothing
    expect(stepDive(s, dt, true, true, false)).toBe(true);
    expect(stepDive(s, dt, false, true, true)).toBe(false); // let go: up
    let t = 0;
    while (stepDive(s, dt, true, true, true)) t += dt;
    expect(t).toBeGreaterThan(BREATH - 0.1); // no harm, no hurry: about 20 s
    expect(t).toBeLessThan(BREATH + 0.1);
    for (let i = 0; i < 60; i++) expect(stepDive(s, dt, true, true, i > 30)).toBe(false); // held on: stays up
    stepDive(s, dt, false, true, false);
    expect(stepDive(s, dt, true, true, false)).toBe(true); // a fresh press at the surface: under again
    for (let i = 0; i * dt < REFILL; i++) stepDive(s, dt, false, true, false);
    expect(s.breath).toBe(BREATH); // all back after REFILL s at the surface
  });
});

describe("sit and crawl", () => {
  const on = { grounded: true, afloat: false, moving: false, acting: false, jumping: false };
  test("C sits only on land", () => {
    expect(stepLow(true, false, on)).toEqual({ low: "sit", slow: false });
    expect(stepLow(true, false, { ...on, grounded: false })).toEqual({ low: "none", slow: false }); // in the air
    expect(stepLow(true, false, { ...on, grounded: false, afloat: true }).low).toBe("none"); // afloat: C dives instead
    expect(stepLow(false, false, on).low).toBe("none");
  });
  test("moving gets a sitting beaver up: it walks", () => {
    expect(stepLow(true, false, { ...on, moving: true })).toEqual({ low: "none", slow: false });
  });
  test("Y crawls on land, moving or still, slowed; it wins over sit", () => {
    expect(stepLow(false, true, on)).toEqual({ low: "crawl", slow: true });
    expect(stepLow(false, true, { ...on, moving: true })).toEqual({ low: "crawl", slow: true });
    expect(stepLow(true, true, on)).toEqual({ low: "crawl", slow: true });
    expect(stepLow(true, true, { ...on, moving: true })).toEqual({ low: "crawl", slow: true });
  });
  test("an action or a jump gets it up while it lasts; still held, it goes low again after", () => {
    for (const busy of [{ acting: true }, { jumping: true }]) {
      expect(stepLow(true, false, { ...on, ...busy })).toEqual({ low: "none", slow: false });
      expect(stepLow(false, true, { ...on, ...busy })).toEqual({ low: "none", slow: false });
    }
    expect(stepLow(true, false, on).low).toBe("sit");
    expect(stepLow(false, true, on).low).toBe("crawl");
  });
  test("afloat it never goes low", () => {
    for (const grounded of [true, false]) for (const moving of [true, false])
      expect(stepLow(true, true, { ...on, grounded, moving, afloat: true })).toEqual({ low: "none", slow: false });
  });
});

describe("riding a canoe", () => {
  test("paddles faster than it swims, about as fast as it walks", () => {
    expect(RIDE_SPEED).toBeGreaterThan(SWIM_SPEED);
    expect(RIDE_SPEED).toBeGreaterThanOrEqual(0.8);
    expect(RIDE_SPEED).toBeLessThan(2);
  });
  test("jump, dive, crawl and the tail slap do nothing; moving and E still work", () => {
    const input = { move: { x: 0.3, y: 1 }, run: 1, jump: true, act: true, slap: true, dive: true, crawl: true };
    expect(rideKeys(input)).toEqual({ move: { x: 0.3, y: 1 }, run: 0, jump: false, act: true, slap: false, dive: false, crawl: false });
  });
  test("it sits in the canoe whatever is held, and moving does not get it up", () => {
    const riding = { grounded: true, afloat: false, moving: true, acting: false, jumping: false, riding: true };
    expect(stepLow(false, false, riding).low).toBe("sit");
    expect(stepLow(true, true, riding).low).toBe("sit");
    expect(stepLow(false, true, riding).slow).toBe(false);
  });
  test("paddling it sits and paddles, never walks a stride nor swims", () => {
    const m = newMotion(), act = newAction();
    m.swimming = 1;
    for (let i = 0; i < 60; i++) trackMotion(m, dt, { moved: 0.9 * dt, vertical: 0, turning: 0, grounded: true, afloat: false, act, ride: true });
    expect(m.low).toBe("sit");
    expect(m.paddle).toBe(true);
    expect(m.distance).toBe(0); // no footsteps
    expect(m.swimming).toBe(0);
    expect(m.speed).toBeCloseTo(0.9);
    trackMotion(m, dt, { moved: 0, vertical: 0, turning: 0, grounded: true, afloat: false, act });
    expect(m.paddle).toBeUndefined();
  });
});
