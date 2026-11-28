// Tests for the Dance floor's rules as a player meets them: on the floor or not, dancing or not, how loud the beat is,
// which tiles glow and how brightly. Run: bun test src/features/dance-floor
import { expect, test } from "bun:test";
import { FLOOR } from "./place.ts";
import { brightness, DANCE_AFTER, dances, EARSHOT, lit, loudness, onFloor, stepStill, type Facts } from "./rules.ts";

const { x, z, half } = FLOOR;

test("a beaver is on the floor up to its edges and off it just beyond", () => {
  expect(onFloor(x, z)).toBe(true);
  expect(onFloor(x + half - 0.05, z - half + 0.05)).toBe(true);
  expect(onFloor(x + half + 0.1, z)).toBe(false);
  expect(onFloor(x, z - half - 0.1)).toBe(false);
  expect(onFloor(0, 0)).toBe(false);
});

/** A beaver standing still on the floor with empty paws, on land; `over` changes one thing. */
const facts = (over: Partial<Facts> = {}): Facts => ({ x, z, grounded: true, afloat: false, moving: false, acting: false, holding: false, riding: false, ...over });
/** `seconds` of steps of 1/60 s with the same facts: how long it has stood still for dancing. */
const stand = (f: Facts, seconds: number, still = 0) => { for (let t = 0; t < seconds; t += 1 / 60) still = stepStill(still, 1 / 60, f); return still; };

test("standing still on the floor with empty paws, the beaver starts to dance after a moment", () => {
  expect(dances(stand(facts(), 0.1))).toBe(false); // just stopped: not yet
  expect(dances(stand(facts(), DANCE_AFTER + 0.1))).toBe(true);
});

test("moving stops the dance at once", () => {
  const dancing = stand(facts(), 2);
  expect(dances(stepStill(dancing, 1 / 60, facts({ moving: true })))).toBe(false);
});

test("it never dances off the floor, carrying a stick or a good, riding, sitting, crawling, in the air, afloat or at work", () => {
  for (const over of [{ x: x + FLOOR.half + 0.5 }, { holding: true }, { riding: true }, { low: "sit" as const }, { low: "crawl" as const },
    { grounded: false }, { afloat: true }, { acting: true }])
    expect(dances(stand(facts(over), 3)), JSON.stringify(over)).toBe(false);
});

test("the beat is full on the floor, falls with distance and is silent out of earshot", () => {
  expect(loudness(x, z)).toBe(1);
  expect(loudness(x + FLOOR.half, z)).toBe(1); // at the edge
  const near = loudness(x + FLOOR.half + 3, z), far = loudness(x + FLOOR.half + 10, z);
  expect(near).toBeLessThan(1);
  expect(far).toBeLessThan(near);
  expect(far).toBeGreaterThan(0);
  expect(loudness(x + FLOOR.half + EARSHOT, z)).toBe(0);
  expect(loudness(-1.5, -3)).toBe(0); // the spawn: out of earshot
});

test("some tiles are lit and some dark at every beat, and the pattern changes from beat to beat", () => {
  const tiles = FLOOR.tiles * FLOOR.tiles;
  let changes = 0;
  for (let beat = 0; beat < 64; beat++) {
    const now = lit(beat + 0.5), next = lit(beat + 1.5);
    expect(now.length).toBe(tiles);
    const on = now.filter(Boolean).length;
    expect(on).toBeGreaterThan(0);
    expect(on).toBeLessThan(tiles);
    expect(lit(beat + 0.1)).toEqual(lit(beat + 0.9)); // within a beat it holds
    if (now.some((l, i) => l !== next[i])) changes++;
  }
  expect(changes).toBe(64);
});

test("the tiles glow by day and brighter from dusk to dawn", () => {
  expect(brightness(0)).toBeGreaterThan(0);
  expect(brightness(1)).toBeGreaterThan(brightness(0) * 1.5);
  expect(brightness(0.5)).toBeGreaterThan(brightness(0));
});
