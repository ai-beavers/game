// The deep basin's animals on the real ground: the school stays in the water and together, parts round a diving
// beaver and closes behind it, scatters at a slap and reforms; the hunter lurks by the log, bolts into the weed and
// comes back; the crayfish backs off with raised claws and settles; mussels shut and open; striders keep to the edges.
import { describe, expect, test } from "bun:test";
import { BASIN, POND, RIM, WATER_LEVEL, heightAt } from "../../world/terrain.ts";
import { placeAll } from "../../world/place.ts";
import { seeded } from "../../world/noise.ts";
import { depthAt, type Land, type Threat } from "./brain.ts";
import {
  centre, makeCrayfish, makeDeep, makeDeepSchool, makeGrazer, makeHunter, makeMussels, makeStriders, reachOf, spread, startleDeep, stepCrayfish,
  stepDeepSchool, stepGrazer, stepHunter, stepMussels, stepStriders, type Bed,
} from "./deep.ts";

const land: Land = { heightAt, water: WATER_LEVEL, rim: RIM - 2.5, pond: { x: POND.x, z: POND.z, radius: POND.radius } };
const layout = placeAll(), log = layout.sunkenLog[0]!;
// As the game finds them (index.ts): the log's top along it, the rocks, the weed's tufts; here from the layout alone.
const bed: Bed = {
  basin: { x: BASIN.x, z: BASIN.z, r: BASIN.along },
  log: [-0.7, -0.35, 0, 0.35, 0.7].map((a) => {
    const x = log.x + Math.sin(log.turn) * a, z = log.z + Math.cos(log.turn) * a;
    return { x, y: heightAt(x, z) + 0.3, z };
  }),
  rocks: layout.bedRock.map((r) => ({ x: r.x, z: r.z, r: 0.3 * r.scale })),
  weed: [[-1.6, 0.2], [1.5, -0.3], [-0.5, -0.6], [0.9, 0.5]].map(([a, b]) => ({ x: BASIN.x + a!, z: BASIN.z + b! })).filter((w) => depthAt(land, w.x, w.z) > 1.2),
};
const DT = 1 / 60;
const ashore: Threat = { x: -12, y: 0.3, z: -12, speed: 0, swimming: false };
const diver = (x: number, y: number, z: number): Threat => ({ x, y: y - 0.25, z, speed: 0.6, swimming: true });

describe("the school in the deep", () => {
  test("stays in the water, over the bed, in deep water, and together", () => {
    const random = seeded(1), school = makeDeepSchool(land, bed, 30, random);
    for (let i = 0; i < 60 * 60; i++) {
      stepDeepSchool(school, land, bed, ashore, DT, random);
      for (const f of school.fish) {
        expect(f.y).toBeLessThan(land.water - 0.1);
        expect(f.y).toBeGreaterThan(heightAt(f.x, f.z));
        expect(depthAt(land, f.x, f.z)).toBeGreaterThan(0.5);
      }
    }
    expect(spread(school.fish)).toBeLessThan(0.45);
  });
  test("parts round a beaver swimming through it and closes behind it", () => {
    const random = seeded(2), school = makeDeepSchool(land, bed, 30, random);
    for (let i = 0; i < 60 * 10; i++) stepDeepSchool(school, land, bed, ashore, DT, random);
    const c = centre(school.fish), nearest = (t: Threat) => Math.min(...school.fish.map((f) => reachOf(t, f)));
    let closest = Infinity;
    // Through the middle of the school, at a beaver's diving pace.
    for (let i = 0; i < 60 * 3; i++) {
      const t = diver(c.x - 0.9 + i * DT * 0.6, c.y, c.z);
      stepDeepSchool(school, land, bed, t, DT, random);
      if (i > 60) closest = Math.min(closest, nearest(t));
    }
    expect(closest).toBeGreaterThan(0.3); // a hole round the beaver
    for (let i = 0; i < 60 * 8; i++) stepDeepSchool(school, land, bed, ashore, DT, random);
    expect(spread(school.fish)).toBeLessThan(0.45); // one school again
  });
  test("scatters at a tail slap and reforms", () => {
    const random = seeded(3), deep = makeDeep(land, bed, { school: 30, carp: 1, crayfish: 2, mussels: 6, snails: 3, striders: 4 }, random);
    for (let i = 0; i < 60 * 10; i++) stepDeepSchool(deep.school, land, bed, ashore, DT, random);
    const before = spread(deep.school.fish), c = centre(deep.school.fish);
    expect(startleDeep(deep, land, bed, { x: c.x + 0.3, z: c.z }, 9, random)).toBeGreaterThan(30);
    for (let i = 0; i < 60; i++) stepDeepSchool(deep.school, land, bed, ashore, DT, random);
    expect(spread(deep.school.fish)).toBeGreaterThan(before * 2);
    for (let i = 0; i < 60 * 15; i++) stepDeepSchool(deep.school, land, bed, ashore, DT, random);
    expect(spread(deep.school.fish)).toBeLessThan(0.45);
  });
});

describe("the hunter", () => {
  test("hangs still by the log, bolts into the weed from the beaver, and comes back once it has gone", () => {
    const random = seeded(4), school = makeDeepSchool(land, bed, 0, random), h = makeHunter(land, bed, random);
    for (let i = 0; i < 60 * 5; i++) stepHunter(h, land, bed, school, ashore, DT, random);
    expect(h.state).toBe("lurk");
    expect(Math.hypot(h.x - h.home.x, h.z - h.home.z)).toBeLessThan(0.1);
    expect(Math.hypot(h.x - log.x, h.z - log.z)).toBeLessThan(1);
    const t = diver(h.x + 1, h.y, h.z);
    for (let i = 0; i < 60 * 3; i++) stepHunter(h, land, bed, school, t, DT, random);
    expect(h.state).toBe("hide");
    expect(Math.min(...bed.weed.map((w) => Math.hypot(w.x - h.x, w.z - h.z)))).toBeLessThan(0.2);
    for (let i = 0; i < 60 * 40; i++) stepHunter(h, land, bed, school, ashore, DT, random);
    expect(h.state).toBe("lurk");
    for (let i = 0; i < 60 * 40; i++) {
      stepHunter(h, land, bed, school, ashore, DT, random);
      expect(h.y).toBeGreaterThan(heightAt(h.x, h.z));
      expect(h.y).toBeLessThan(land.water);
    }
  });
  test("strikes at a fish that comes close in front of it", () => {
    const random = seeded(5), school = makeDeepSchool(land, bed, 1, random), h = makeHunter(land, bed, random);
    const f = school.fish[0]!;
    Object.assign(f, { x: h.x + Math.sin(h.heading) * 0.8, y: h.y, z: h.z + Math.cos(h.heading) * 0.8 });
    let darted = false;
    for (let i = 0; i < 60 * 6 && !darted; i++) { stepHunter(h, land, bed, school, ashore, DT, random); darted = h.state === "dart"; }
    expect(darted).toBe(true);
  });
});

describe("the bed", () => {
  test("a crayfish backs away with raised claws, then settles", () => {
    const random = seeded(6), [c] = makeCrayfish(land, bed, 1, random);
    for (let i = 0; i < 60 * 5; i++) stepCrayfish([c!], land, ashore, DT, random);
    const from = { x: c!.x, z: c!.z }, t = diver(c!.x + 0.8, c!.y + 0.4, c!.z);
    for (let i = 0; i < 60; i++) stepCrayfish([c!], land, t, DT, random);
    expect(c!.state).toBe("back");
    expect(c!.raise).toBeGreaterThan(0.9);
    expect(Math.hypot(c!.x - t.x, c!.z - t.z)).toBeGreaterThan(Math.hypot(from.x - t.x, from.z - t.z));
    for (let i = 0; i < 60 * 8; i++) stepCrayfish([c!], land, ashore, DT, random);
    expect(c!.state).not.toBe("back");
    expect(c!.raise).toBeLessThan(0.1);
    expect(depthAt(land, c!.x, c!.z)).toBeGreaterThan(0.7);
  });
  test("mussels lie on the slope, shut as the beaver passes and open again", () => {
    const random = seeded(7), mussels = makeMussels(land, bed, 6, random);
    expect(mussels.length).toBe(6);
    const m = mussels[0]!;
    for (let i = 0; i < 30; i++) stepMussels(mussels, diver(m.x, m.y + 0.6, m.z), DT);
    expect(m.open).toBeLessThan(0.1);
    for (let i = 0; i < 60 * 14; i++) stepMussels(mussels, ashore, DT);
    expect(m.open).toBeGreaterThan(0.95);
  });
  test("a carp keeps to the bed in the water", () => {
    const random = seeded(8), g = makeGrazer(land, bed, random);
    let grazed = false;
    for (let i = 0; i < 60 * 120; i++) {
      stepGrazer(g, land, bed, ashore, DT, random);
      grazed ||= g.state === "graze";
      expect(g.y).toBeGreaterThan(heightAt(g.x, g.z));
      expect(g.y).toBeLessThan(land.water - 0.2);
    }
    expect(grazed).toBe(true);
  });
});

describe("water striders", () => {
  test("keep to the shallow edges, on the water, and skate off from the beaver", () => {
    const random = seeded(9), list = makeStriders(land, 6, random);
    expect(list.length).toBe(6);
    for (let i = 0; i < 60 * 60; i++) {
      stepStriders(list, land, ashore, DT, random);
      for (const s of list) expect(depthAt(land, s.x, s.z)).toBeGreaterThan(0.03);
    }
    const s = list[0]!, t: Threat = { x: s.x + 0.5, y: -0.2, z: s.z, speed: 0.5, swimming: true }, before = Math.hypot(s.x - t.x, s.z - t.z);
    for (let i = 0; i < 30; i++) stepStriders(list, land, t, DT, random);
    expect(Math.hypot(s.x - t.x, s.z - t.z)).toBeGreaterThan(before + 0.1);
  });
});
