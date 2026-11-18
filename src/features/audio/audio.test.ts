// Tests for the pure parts of the audio feature: the composer, the ground lookup, and that every recipe runs.
//
//   bun test src/features/audio
import { expect, test } from "bun:test";
import { heightAt, POND, WATER_LEVEL } from "../../world/terrain.ts";
import { findWater, groundAt } from "./ground.ts";
import { composer, HIGHEST, LOWEST, pitch } from "./music.ts";
import { SOUNDS } from "./sounds.ts";

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

/** Just enough of a BaseAudioContext to run a recipe (bun has no Web Audio): every node takes any call, and each
 *  source remembers when it starts and stops. */
function fakeContext() {
  const sources: { start?: number; stop?: number }[] = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ connect: (to: unknown) => to, gain: param(), frequency: param(), Q: param() });
  const source = () => {
    const times: { start?: number; stop?: number } = {};
    sources.push(times);
    return { ...node(), start(at: number) { times.start = at; }, stop(at: number) { times.stop = at; } };
  };
  const ctx = {
    sampleRate: 8000, currentTime: 0,
    createBuffer: (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource: source, createOscillator: source, createGain: node, createBiquadFilter: node,
  };
  return { ctx: ctx as unknown as BaseAudioContext, sources };
}

test("every sound, the tail slap's crack and thump among them, makes sources that start and stop in time", () => {
  for (const name of ["slap", "thump"] as const) expect(SOUNDS[name]).toBeDefined();
  for (const [name, recipe] of Object.entries(SOUNDS)) {
    const { ctx, sources } = fakeContext();
    recipe(ctx, {} as AudioNode, 1, 1);
    expect(sources.length, name).toBeGreaterThan(0);
    for (const s of sources) {
      expect(s.start!, name).toBeGreaterThanOrEqual(1);
      expect(s.stop!, name).toBeGreaterThan(s.start!);
      expect(s.stop!, name).toBeLessThan(6);
    }
  }
});
