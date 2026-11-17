// Tests for the pure parts of the audio feature: the composer and the ground lookup.
//
//   bun test src/features/audio
import { expect, test } from "bun:test";
import { heightAt, POND, WATER_LEVEL } from "../../world/terrain.ts";
import { findWater, groundAt } from "./ground.ts";
import { composer, HIGHEST, LOWEST, pitch } from "./music.ts";

test("the tune stays in range, moves in small steps and is slow", () => {
  const next = composer();
  let before = 2, time = 0, leaps = 0;
  for (let i = 0; i < 2000; i++) {
    const note = next();
    expect(note.degree).toBeGreaterThanOrEqual(LOWEST);
    expect(note.degree).toBeLessThanOrEqual(HIGHEST);
    if (Math.abs(note.degree - before) > 2) leaps++;
    before = note.degree;
    time += note.length;
  }
  expect(time / 2000).toBeGreaterThan(1.5);
  expect(leaps / 2000).toBeLessThan(0.1); // only phrase ends may jump further
});

test("pitch walks D major pentatonic", () => {
  expect(pitch(0)).toBeCloseTo(293.66, 1);
  expect(pitch(5)).toBeCloseTo(587.32, 1);
  expect(pitch(3) / pitch(0)).toBeCloseTo(2 ** (7 / 12), 5);
  expect(pitch(-5)).toBeCloseTo(146.83, 1);
});

test("the ground under the feet: water in the pond, shore at its edge, grass in the meadow", () => {
  const water = findWater(heightAt, WATER_LEVEL);
  expect(water.cells).toBeGreaterThan(100);
  expect(water.nearest(POND.x, POND.z).distance).toBeLessThan(0.5);
  expect(groundAt(heightAt, WATER_LEVEL, water, POND.x + 3.5, POND.z)).toBe("water");
  expect(groundAt(heightAt, WATER_LEVEL, water, POND.x + 4.6, POND.z)).toBe("shore");
  expect(groundAt(heightAt, WATER_LEVEL, water, 0, 0)).toBe("grass");
  expect(groundAt(heightAt, WATER_LEVEL, water, POND.x + 8, POND.z)).toBe("grass");
});
