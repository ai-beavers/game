// The animals' rules on the real ground: fish stay in the water, birds and insects above the ground, everything
// inside the rim, and fleeing takes each kind away from the beaver.
import { describe, expect, test } from "bun:test";
import { POND, RIM, WATER_LEVEL, heightAt } from "../../world/terrain.ts";
import { seeded } from "../../world/noise.ts";
import {
  circling, depthAt, makeBirds, makeDucks, makeFlyers, makeFrogs, makeSchool, shoreSpots, stepBirds, stepButterflies,
  stepDragonflies, stepDucks, stepFrogs, stepSchool, type Land, type Threat,
} from "./brain.ts";

const land: Land = { heightAt, water: WATER_LEVEL, rim: RIM - 2.5, pond: { x: POND.x, z: POND.z, radius: POND.radius } };
const DT = 1 / 60;
const away: Threat = { x: -12, y: 0.3, z: -12, speed: 0, swimming: false };
/** A beaver that runs a loop through the meadow and swims a loop through the pond. */
const roaming = (t: number): Threat => {
  const inPond = Math.floor(t / 20) % 2 === 1, a = t * 0.6;
  return inPond ? { x: POND.x + Math.cos(a) * 2, y: -0.2, z: POND.z + Math.sin(a) * 2, speed: 1, swimming: true }
    : { x: Math.cos(a) * 8, y: 0.3, z: Math.sin(a) * 8, speed: 2, swimming: false };
};
const distance = (t: Threat, list: { x: number; z: number }[]) => list.reduce((s, o) => s + Math.hypot(o.x - t.x, o.z - t.z), 0) / list.length;

describe("fish", () => {
  test("stay under the surface and above the floor, in the pond", () => {
    const random = seeded(1), school = makeSchool(land, 12, random);
    for (let i = 0; i < 60 * 80; i++) {
      stepSchool(school, land, roaming(i * DT), DT, random);
      for (const f of school.fish) {
        expect(f.y).toBeLessThan(land.water);
        expect(f.y).toBeGreaterThan(heightAt(f.x, f.z));
        expect(depthAt(land, f.x, f.z)).toBeGreaterThan(0.2);
      }
    }
  });
  test("dart away from a beaver swimming into them", () => {
    const random = seeded(2), school = makeSchool(land, 10, random);
    for (let i = 0; i < 120; i++) stepSchool(school, land, away, DT, random);
    const c = { x: school.fish.reduce((s, f) => s + f.x, 0) / 10, z: school.fish.reduce((s, f) => s + f.z, 0) / 10 };
    const beaver: Threat = { x: c.x + 0.8, y: -0.2, z: c.z, speed: 1, swimming: true };
    const before = distance(beaver, school.fish);
    for (let i = 0; i < 40; i++) stepSchool(school, land, beaver, DT, random);
    expect(distance(beaver, school.fish)).toBeGreaterThan(before + 0.3);
  });
});

describe("birds", () => {
  test("never inside the ground, never outside the rim", () => {
    const random = seeded(3), birds = makeBirds(land, 6, [], random);
    for (let i = 0; i < 60 * 120; i++) {
      stepBirds(birds, land, [], roaming(i * DT), DT, random);
      for (const b of birds) {
        expect(b.y).toBeGreaterThanOrEqual(heightAt(b.x, b.z) - 1e-6);
        expect(Math.hypot(b.x, b.z)).toBeLessThan(land.rim + 0.01);
      }
    }
    for (let t = 0; t < 600; t += 1.3) for (const i of [0, 1]) {
      const c = circling(t, i);
      expect(c.y).toBeGreaterThan(heightAt(c.x, c.z) + 8);
    }
  });
  test("fly up and land away from a beaver running at them", () => {
    const random = seeded(4), birds = makeBirds(land, 5, [], random), b = birds[0]!;
    const beaver: Threat = { x: b.x + 2, y: b.y, z: b.z, speed: 2, swimming: false };
    stepBirds(birds, land, [], beaver, DT, random);
    expect(b.state).toBe("fly");
    for (let i = 0; i < 60 * 8; i++) stepBirds(birds, land, [], beaver, DT, random);
    expect(b.state).toBe("ground");
    expect(Math.hypot(b.x - beaver.x, b.z - beaver.z)).toBeGreaterThan(5);
  });
});

describe("butterflies and dragonflies", () => {
  test("stay above ground and water, inside the rim", () => {
    const random = seeded(5), reeds = [{ x: POND.x + 3, z: POND.z }];
    const butterflies = makeFlyers(land, 8, "butterfly", reeds, random), dragonflies = makeFlyers(land, 5, "dragonfly", reeds, random);
    for (let i = 0; i < 60 * 60; i++) {
      const t = roaming(i * DT);
      stepButterflies(butterflies, land, t, DT, random);
      stepDragonflies(dragonflies, land, reeds, t, DT, random);
      for (const f of [...butterflies, ...dragonflies]) {
        expect(f.y).toBeGreaterThan(Math.max(heightAt(f.x, f.z), land.water));
        expect(Math.hypot(f.x, f.z)).toBeLessThanOrEqual(land.rim + 1e-6);
      }
    }
  });
});

describe("frogs", () => {
  test("jump into the water away from the beaver, never into the ground", () => {
    const random = seeded(6), spots = shoreSpots(land, 12, random), frogs = makeFrogs(land, spots, 5, random);
    expect(spots.length).toBeGreaterThanOrEqual(8);
    const f = frogs[0]!, start = { x: f.x, z: f.z };
    const beaver: Threat = { x: f.x + (f.x - POND.x) * 0.3, y: 0.2, z: f.z + (f.z - POND.z) * 0.3, speed: 0.8, swimming: false };
    for (let i = 0; i < 40; i++) stepFrogs(frogs, land, spots, beaver, DT, random);
    expect(f.state).not.toBe("sit");
    expect(Math.hypot(f.x - beaver.x, f.z - beaver.z)).toBeGreaterThan(Math.hypot(start.x - beaver.x, start.z - beaver.z));
    for (let i = 0; i < 60 * 60; i++) {
      stepFrogs(frogs, land, spots, roaming(i * DT), DT, random);
      for (const o of frogs) expect(o.y).toBeGreaterThanOrEqual(heightAt(o.x, o.z) - 1e-9);
    }
  });
});

describe("ducks", () => {
  test("stay on the water and paddle away from the beaver", () => {
    const random = seeded(7), ducks = makeDucks(land, 2, random);
    for (let i = 0; i < 60 * 20; i++) stepDucks(ducks, land, away, DT, random);
    const beaver: Threat = { x: ducks[0]!.x + 1.5, y: -0.2, z: ducks[0]!.z + 0.5, speed: 1, swimming: true };
    const before = distance(beaver, ducks);
    for (let i = 0; i < 60 * 3; i++) stepDucks(ducks, land, beaver, DT, random);
    expect(distance(beaver, ducks)).toBeGreaterThan(before);
    for (let i = 0; i < 60 * 120; i++) {
      stepDucks(ducks, land, roaming(i * DT), DT, random);
      for (const d of ducks) expect(depthAt(land, d.x, d.z)).toBeGreaterThan(0.25);
    }
  });
});
