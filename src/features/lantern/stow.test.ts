// When the lantern comes out of the backpack and goes back, as a player sees it: whether it is drawn, and how far
// the left paw has reached back (Motion.reachBack). Frames of 1/60 s.
import { expect, test } from "bun:test";
import { newMotion } from "../../player/state.ts";
import { busy, newStow, stepStow } from "./stow.ts";

const dt = 1 / 60;
/** Runs `seconds` with the given dark and busy; returns the highest reach seen and whether it ended drawn. */
function play(s: ReturnType<typeof newStow>, seconds: number, dark: number, busy = false) {
  let most = 0;
  for (let t = 0; t < seconds; t += dt) { stepStow(s, dt, dark, busy); most = Math.max(most, s.reach); }
  return { most, drawn: s.drawn, reach: s.reach };
}

test("a game starts with the lantern out at night and in the backpack by day, without a motion", () => {
  const night = newStow(0.9), day = newStow(0);
  expect([night.drawn, night.reach, day.drawn, day.reach]).toEqual([true, 0, false, 0]);
});

test("at dusk the paw reaches back and brings the lantern; at dawn it puts it back", () => {
  const s = newStow(0);
  const dusk = play(s, 2, 0.3);
  expect(dusk.most).toBeGreaterThan(0.95);
  expect([dusk.drawn, dusk.reach]).toEqual([true, 0]);
  const dawn = play(s, 2, 0.01);
  expect(dawn.most).toBeGreaterThan(0.95);
  expect([dawn.drawn, dawn.reach]).toEqual([false, 0]);
});

test("the lantern appears at the backpack, not before the paw gets there", () => {
  const s = newStow(0);
  let first = -1;
  for (let t = 0; t < 2 && !s.drawn; t += dt) { stepStow(s, dt, 0.3, false); first = s.reach; }
  expect(s.drawn).toBe(true);
  expect(first).toBeGreaterThan(0.95);
});

test("between dusk and dawn it keeps what it did: no taking out and putting away over and over", () => {
  const s = newStow(0);
  expect(play(s, 2, 0.1).most).toBe(0); // dim, not yet dusk
  play(s, 2, 0.2);
  for (const dark of [0.1, 0.06, 0.12, 0.08]) expect(play(s, 2, dark)).toEqual({ most: 0, drawn: true, reach: 0 });
});

test("a busy beaver waits, and a switch it becomes busy in finishes at once", () => {
  const s = newStow(0);
  expect(play(s, 3, 0.5, true)).toEqual({ most: 0, drawn: false, reach: 0 });
  play(s, 0.3, 0.5); // on its way back
  expect(s.reach).toBeGreaterThan(0);
  stepStow(s, dt, 0.5, true);
  expect([s.drawn, s.reach]).toEqual([true, 0]);
});

test("busy after the paw has been to the backpack, the switch still finishes the way it was going, once", () => {
  const s = newStow(0);
  play(s, 0.8, 0.5); // the lantern out, the paw on its way down
  expect(s.drawn).toBe(true);
  stepStow(s, dt, 0.5, true);
  expect([s.drawn, s.reach]).toEqual([true, 0]);
  expect(play(s, 3, 0.5)).toEqual({ most: 0, drawn: true, reach: 0 }); // not again after landing
});

test("busy: an action, the tail slap, in the air, swimming, diving, sitting or crawling; standing on the ground is not", () => {
  const ground = { ...newMotion(), grounded: true };
  expect(busy(ground, false)).toBe(false);
  for (const m of [{ ...ground, action: "gnaw" as const }, { ...ground, actionProgress: 0.4 }, { ...ground, grounded: false },
    { ...ground, swimming: 1 }, { ...ground, low: "sit" as const }, { ...ground, low: "crawl" as const }]) expect(busy(m, false)).toBe(true);
  expect(busy(ground, true)).toBe(true);
});
