// The animals' rules on the real ground: fish stay in the water, birds and insects above the ground, everything
// inside the rim, and fleeing takes each kind away from the beaver.
import { describe, expect, test } from "bun:test";
import { POND, RIM, WATER_LEVEL, heightAt } from "../../world/terrain.ts";
import { seeded } from "../../world/noise.ts";
import { dayAt } from "../sky/clock.ts";
import {
  circling, deerHours, depthAt, makeBirds, makeDeer, makeDucks, makeFlyers, makeFrogs, makeOwl, makeSchool, owlHours, shoreSpots, startle,
  stepBirds, stepButterflies, stepDeer, stepDragonflies, stepDucks, stepFrogs, stepOwl, stepSchool, type Land, type Threat,
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

describe("a tail slap", () => {
  test("sends every kind off at once, and they come back: ducks down on the pond, frogs to the shore", () => {
    const random = seeded(8), spots = shoreSpots(land, 20, random);
    const animals = { school: makeSchool(land, 10, random), birds: makeBirds(land, 4, [], random), frogs: makeFrogs(land, spots, 5, random), ducks: makeDucks(land, 2, random) };
    const step = () => {
      stepSchool(animals.school, land, away, DT, random);
      stepBirds(animals.birds, land, [], away, DT, random);
      stepFrogs(animals.frogs, land, spots, away, DT, random);
      stepDucks(animals.ducks, land, away, DT, random);
    };
    for (let i = 0; i < 60; i++) step();
    const slap = { x: POND.x, z: POND.z };
    for (const b of animals.birds) Object.assign(b, { x: slap.x + 4, z: slap.z + 4, y: heightAt(slap.x + 4, slap.z + 4) }); // one near the pond
    const n = startle(animals, land, [], slap, 9, random);
    expect(n).toBeGreaterThanOrEqual(animals.school.fish.length + animals.ducks.length + 1);
    expect(animals.school.fish.every((f) => f.fear === 1)).toBe(true);
    expect(animals.frogs.some((f) => f.state === "jump")).toBe(true);
    expect(animals.birds.every((b) => b.state === "fly")).toBe(true);
    let highest = 0;
    for (let i = 0; i < 60 * 12; i++) {
      step();
      for (const d of animals.ducks) {
        highest = Math.max(highest, d.air);
        expect(Math.hypot(d.x, d.z)).toBeLessThan(land.rim + 0.5);
        if (d.flying <= 0) expect(depthAt(land, d.x, d.z)).toBeGreaterThan(0.25);
      }
    }
    expect(highest).toBeGreaterThan(2); // they flew
    expect(animals.ducks.every((d) => d.flying === 0 && d.air === 0)).toBe(true); // and are back on the water
    for (let i = 0; i < 60 * 30; i++) step();
    expect(animals.frogs.every((f) => f.state === "sit")).toBe(true);
  });
});

describe("deer and owl, by the hour", () => {
  const dusk = { out: true, rain: false }, day = { out: false, rain: false }, nobody: Threat = { x: 200, y: 0, z: 200, speed: 0, swimming: false };
  const herdOut = (seed: number, count = 3) => {
    const random = seeded(seed), herd = makeDeer(land, count, random), spots = shoreSpots(land, 20, random);
    const step = (seconds: number, t: Threat = nobody, h = dusk) => { for (let i = 0; i < seconds * 30; i++) stepDeer(herd, land, [], spots, t, h, 1 / 30, random); };
    return { herd, step, random };
  };

  test("their hours: deer at dusk and dawn, the owl at night", () => {
    expect(deerHours(dayAt(19.5).sunHeight) && deerHours(dayAt(5.5).sunHeight)).toBe(true);
    expect(deerHours(dayAt(13).sunHeight) || deerHours(dayAt(0).sunHeight)).toBe(false);
    expect(owlHours(dayAt(23).sunHeight) && owlHours(dayAt(3).sunHeight)).toBe(true);
    expect(owlHours(dayAt(16).sunHeight) || owlHours(dayAt(19.5).sunHeight)).toBe(false);
  });

  test("stay in the forest outside their hours, come out to graze at the meadow's rim at dusk, on the ground", () => {
    const { herd, step } = herdOut(11);
    step(60, nobody, day);
    expect(herd.every((d) => d.state === "away")).toBe(true);
    let down = false;
    for (let s = 0; s < 60; s++) {
      step(1);
      for (const d of herd) if (d.state !== "away") expect(d.y + d.air).toBeGreaterThanOrEqual(heightAt(d.x, d.z) - 1e-6);
      down ||= herd.some((d) => d.head > 0.5); // heads down in the grass
    }
    expect(down).toBe(true);
    expect(herd.every((d) => d.state === "graze" || d.state === "walk" || d.state === "drink")).toBe(true);
    for (const d of herd) if (d.state === "graze") expect(Math.hypot(d.x, d.z)).toBeGreaterThan(land.rim - 5);
  });

  test("one walks down to the pond to drink", () => {
    const { herd, step } = herdOut(12);
    let drank = false;
    for (let s = 0; s < 240 && !drank; s++) {
      step(1);
      const d = herd[0]!;
      if (d.state !== "drink") continue;
      drank = true;
      expect(Math.hypot(d.x - POND.x, d.z - POND.z)).toBeLessThan(POND.radius + 2.5);
      expect(depthAt(land, d.x, d.z)).toBeLessThan(0); // standing on land
    }
    expect(drank).toBe(true);
  });

  test("lift their heads at a beaver walking near, bound off from one running at them, and come back when it is calm", () => {
    const { herd, step } = herdOut(13);
    step(60);
    const d = herd.find((o) => o.state === "graze")!, r = Math.hypot(d.x, d.z);
    const at = (k: number, speed: number): Threat => ({ x: d.x - d.x / r * k, y: 0.3, z: d.z - d.z / r * k, speed, swimming: false });
    step(1, at(8, 0.8));
    expect(d.alert).toBeGreaterThan(0.9);
    expect(d.head).toBeLessThan(0.2);
    expect(d.state).not.toBe("flee");
    const beaver = at(7, 2), before = Math.hypot(d.x - beaver.x, d.z - beaver.z);
    step(0.2, beaver);
    expect(d.state).toBe("flee");
    step(0.8, beaver);
    expect(Math.hypot(d.x - beaver.x, d.z - beaver.z)).toBeGreaterThan(before + 2);
    step(5);
    expect(herd.every((o) => o.state === "away" || o.state === "flee")).toBe(true); // the others went with it
    step(60);
    expect(herd.some((o) => o.state === "graze")).toBe(true);
  });

  test("a tail slap across the clearing sends them off", () => {
    const { herd, step, random } = herdOut(14);
    step(60);
    const animals = { school: makeSchool(land, 3, random), birds: [], frogs: [], ducks: [], deer: herd };
    const out = herd.filter((d) => d.state !== "away").length;
    expect(out).toBeGreaterThan(0);
    expect(startle(animals, land, [], { x: 0, z: 0 }, 4, random)).toBeGreaterThanOrEqual(out);
    expect(herd.every((d) => d.state === "flee" || d.state === "away")).toBe(true);
  });

  test("stay under the trees in rain, and go back in when their hours end", () => {
    const { herd, step } = herdOut(15);
    step(60);
    step(30, nobody, { out: true, rain: true });
    for (const d of herd) expect(Math.hypot(d.x, d.z)).toBeGreaterThan(land.rim + 2);
    step(60, nobody, day);
    expect(herd.every((d) => d.state === "away")).toBe(true);
  });

  test("the owl flies in at night, sits on a branch, calls, glides low across the clearing and leaves at dawn", () => {
    const random = seeded(16), owl = makeOwl(random), perches = [{ x: -20, y: 14, z: 3 }, { x: 18, y: 13, z: 10 }, { x: 2, y: 15, z: -21 }];
    const step = (seconds: number, night: boolean, each = () => {}) => { for (let i = 0; i < seconds * 30; i++) { stepOwl(owl, land, perches, night, 1 / 30, random); each(); } };
    step(10, false);
    expect(owl.state).toBe("away");
    step(15, true);
    expect(owl.state).toBe("sit");
    let lowest = Infinity;
    const sat = new Set<number>();
    step(300, true, () => {
      if (owl.state === "sit") sat.add(owl.perch);
      if (owl.state === "fly" && Math.hypot(owl.x, owl.z) < 10) lowest = Math.min(lowest, owl.y - heightAt(owl.x, owl.z));
      expect(owl.y).toBeGreaterThan(Math.max(heightAt(owl.x, owl.z), land.water));
    });
    expect(owl.calls).toBeGreaterThan(5);
    expect(sat.size).toBeGreaterThan(1);
    expect(lowest).toBeLessThan(9);
    step(30, false);
    expect(owl.state).toBe("away");
  });
});
