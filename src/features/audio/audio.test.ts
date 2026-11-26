// Tests for the pure parts of the audio feature: the composer, the ground lookup, and that every recipe runs; with
// Chrome at hand, the loudness plan too (each sound rendered offline and measured, as tools/listen.ts does).
//
//   bun test src/features/audio
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { measure, render } from "../../../tools/listen.ts";
import { heightAt, POND, WATER_LEVEL } from "../../world/terrain.ts";
import { findWater, groundAt } from "./ground.ts";
import { composer, HIGHEST, LOWEST, pitch } from "./music.ts";
import { carried } from "./mix.ts";
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

// ---- the loudness plan, measured: the game's own sound rendered offline in headless Chrome (bun tools/listen.ts) ----

/** How loud each one-shot may be at the camera, at the default volume: LUFS of its loudest 400 ms (M max). */
const BANDS: [low: number, high: number, names: string[]][] = [
  [-16, -9, ["fanfare", "chime"]], // milestones: the loudest, a few LU over the scene
  [-20, -11, ["slap", "splash", "crash", "crack", "creak"]], // the alarm and the big moments
  [-27, -17, ["land", "thump", "shake", "bite", "place", "drop", "pickup", "jump", "murmur", "squeak", "chirp"]], // the beaver at work, the Old Beaver's murmur, the River kit's calls
  [-30, -22, ["stepGrass", "stepShore", "stepWater", "paddle"]], // under the ambience
  [-41, -22, ["owl", "deer", "cricket", "frog", "tick", "plip", "bird", "lap", "crackle", "doze"]], // the world around, far off or many, and the River kit asleep
];
const SCENES = ["noonQuiet", "noon", "fell", "dam", "slap", "underwater"];
const chrome = existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
/** How long a measured render may take: about 20 s on an idle machine, over a minute on a busy one (builders and
 *  their tours side by side). The limit ends a render that hangs; it says nothing about speed. */
const LIMIT = 300_000; // ms

test.skipIf(!chrome)("every one-shot sits in its loudness band, ends in time, has no DC and never clips", async () => {
  const names = BANDS.flatMap(([, , n]) => n);
  const { out, names: all } = await render(names.map((name) => ({ kind: "recipe", name })));
  expect(names.toSorted()).toEqual(all.recipes.toSorted()); // a new recipe needs a band
  for (const [low, high, list] of BANDS) for (const name of list) {
    const m = measure(out.get(`recipe:${name}`)!);
    expect(m.max, name).toBeGreaterThan(low);
    expect(m.max, name).toBeLessThan(high);
    expect(m.peak, name).toBeLessThan(-1);
    expect(Math.abs(m.dc), name).toBeLessThan(1e-3);
    expect(m.end, name).toBeGreaterThan(0.1); // silent before its window ends, reverb and all
  }
}, LIMIT);

test.skipIf(!chrome)("the full mix: about -16 LUFS at the default volume, peaks under -1 dBFS at full volume, no loop heard", async () => {
  const jobs = SCENES.map((name) => ({ kind: "scene" as const, name }));
  const [usual, full] = [await render(jobs), await render(jobs, { volume: 1 })];
  for (const name of SCENES) {
    const m = measure(usual.out.get(`scene:${name}`)!), loud = measure(full.out.get(`scene:${name}`)!);
    expect(m.integrated, name).toBeGreaterThan(-19);
    expect(m.integrated, name).toBeLessThan(-13);
    expect(loud.peak, name).toBeLessThan(-1);
    expect(loud.clipped, name).toBe(0);
    expect(Math.abs(m.dc), name).toBeLessThan(1e-3);
    expect(Math.abs(m.repeat), name).toBeLessThan(0.5); // the noise beds do not repeat every 2 s
  }
}, LIMIT);

test("the meters: a full-scale 1 kHz sine at 48 kHz reads -3 LUFS and 0 dBFS", () => {
  const rate = 48000, left = new Float32Array(rate * 2).map((_, i) => Math.sin((2 * Math.PI * 1000 * i) / rate));
  const m = measure({ rate, left, right: new Float32Array(left.length) });
  expect(m.integrated).toBeCloseTo(-3.0, 0);
  expect(m.peak).toBeCloseTo(0, 1);
  expect(m.centroid).toBeGreaterThan(950);
  expect(m.centroid).toBeLessThan(1050);
});

test("a talking voice: full beside the speaker, half at twice the distance, faint at the edge of earshot and gone a little beyond", () => {
  const dB = (d: number) => 20 * Math.log10(carried(d, 20));
  expect(carried(1, 20)).toBe(1);
  expect(carried(3, 20)).toBe(1);
  expect(dB(6)).toBeCloseTo(-6, 0); // the open-air law while the words can be followed
  expect(dB(8)).toBeLessThan(-7);
  expect(dB(8)).toBeGreaterThan(-10);
  expect(dB(15)).toBeLessThan(-20); // words no longer followed
  expect(dB(20)).toBeLessThan(-40); // where he breaks off: as good as nothing
  expect(carried(22, 20)).toBe(0);
  expect(carried(60, 20)).toBe(0); // across the clearing: nothing
  for (let d = 1; d < 30; d += 0.5) expect(carried(d + 0.5, 20), `${d} m`).toBeLessThanOrEqual(carried(d, 20)); // never louder farther off
});
