// Tests for the build feature's rules: state changes, trees, wood, the dam plan, goals. Run: bun test src/features/build
import { describe, expect, test } from "bun:test";
import {
  apply, BITES_TO_SPLIT, bitesToFell, CACHE, CACHE_AT, cachePlan, crestHeight, DAM, damPlan, goals, growth, live, load, LODGE, lodgeGrow, moundHeight, newState,
  POND_RISE, pondLevel, pondRise, profile, REGROW, SLOTS, SPROUT, STICKS, woodFrom,
} from "./rules.ts";
import { heightAt, POND, WATER_LEVEL } from "../../world/terrain.ts";
import { placeAll } from "../../world/place.ts";

describe("changes", () => {
  test("a tree goes bitten, felled, resting, split, in that order only", () => {
    const s = newState();
    expect(apply(s, { type: "split", tree: 2 })).toBe(false);
    expect(apply(s, { type: "bite", tree: 2 })).toBe(true);
    expect(s.trees[2]!.bites).toBe(1);
    expect(apply(s, { type: "rest", tree: 2, at: [0, 0, 0], turn: [0, 0, 0, 1] })).toBe(false);
    expect(apply(s, { type: "fell", tree: 2, direction: 1 })).toBe(true);
    expect(apply(s, { type: "fell", tree: 2, direction: 2 })).toBe(false);
    expect(apply(s, { type: "bite", tree: 2 })).toBe(false); // falling: nothing to bite
    expect(apply(s, { type: "rest", tree: 2, at: [1, 2, 3], turn: [0, 0, 0, 1] })).toBe(true);
    for (let k = 0; k < BITES_TO_SPLIT; k++) apply(s, { type: "bite", tree: 2 });
    expect(s.trees[2]!.splitBites).toBe(BITES_TO_SPLIT);
    expect(apply(s, { type: "split", tree: 2 })).toBe(true);
    expect(apply(s, { type: "split", tree: 2 })).toBe(false);
    expect(apply(s, { type: "bite", tree: 2 })).toBe(false);
  });
  test("a tree whose wood went grows back, to be felled and split again; its wood then lies where it lay", () => {
    const s = newState(), fell = (direction: number, at: [number, number, number]) => {
      expect(apply(s, { type: "bite", tree: 2 })).toBe(true);
      expect(apply(s, { type: "fell", tree: 2, direction })).toBe(true);
      expect(apply(s, { type: "rest", tree: 2, at, turn: [0, 0, 0, 1] })).toBe(true);
      for (let k = 0; k < BITES_TO_SPLIT; k++) apply(s, { type: "bite", tree: 2 });
    };
    expect(apply(s, { type: "grow", tree: 2 })).toBe(false); // standing: nothing to grow back
    fell(1, [1, 0, 1]);
    expect(apply(s, { type: "grow", tree: 2 })).toBe(false); // lying, not wood yet
    expect(apply(s, { type: "split", tree: 2 }, 1000)).toBe(true);
    expect(s.trees[2]!.gone).toBe(1000);
    expect(live(s.trees[2])).toBeUndefined(); // only the stump
    expect(apply(s, { type: "bite", tree: 2 })).toBe(false);
    expect(apply(s, { type: "grow", tree: 2 })).toBe(true); // no clock here: the server's admit checks when
    expect(apply(s, { type: "grow", tree: 2 })).toBe(false);
    expect(live(s.trees[2])).toEqual({ bites: 0, splitBites: 0 });
    fell(2, [5, 0, 5]);
    expect(s.trees[2]!.fell).toBe(1); // the first fall still says where the first wood came from
    expect(apply(s, { type: "split", tree: 2 }, 2000)).toBe(true);
    expect(s.trees[2]).toEqual({ bites: 1, fell: 2, rest: { at: [5, 0, 5], turn: [0, 0, 0, 1] }, splitBites: BITES_TO_SPLIT, split: true, gone: 2000 });
    expect(goals(s)[2]!.done).toBe(true);
    expect(live(undefined)).toEqual({ bites: 0, splitBites: 0 }); // never touched: a fresh tree
  });
  test("the sapling shows at SPROUT and is full grown at REGROW", () => {
    expect(growth(0)).toBe(0);
    expect(growth(SPROUT)).toBe(0);
    expect(growth((SPROUT + REGROW) / 2)).toBeCloseTo(0.5);
    expect(growth(REGROW)).toBe(1);
    expect(growth(REGROW * 9)).toBe(1);
  });
  test("each stick goes into the dam once, into the next slot, up to SLOTS, then LODGE onto the lodge, then CACHE into the cache", () => {
    const s = newState();
    expect(apply(s, { type: "place", slot: 0, stick: "w1" })).toBe(true);
    expect(apply(s, { type: "place", slot: 1, stick: "w1" })).toBe(false);
    expect(apply(s, { type: "place", slot: 0, stick: "w2" })).toBe(true); // stale slot from another player: next free
    expect(s.dam).toEqual(["w1", "w2"]);
    for (let k = 0; k < 70; k++) apply(s, { type: "place", slot: k, stick: `d${k}` });
    expect(s.dam).toHaveLength(SLOTS + LODGE + CACHE);
  });
  test("a saved state comes back; a broken one gives a fresh state", () => {
    const s = newState();
    apply(s, { type: "find" });
    apply(s, { type: "fell", tree: 1, direction: 0.5 });
    expect(load(JSON.stringify(s))).toEqual(s);
    expect(load("{oops")).toEqual(newState());
    expect(load(null)).toEqual(newState());
    expect(load(JSON.stringify({ version: 9 }))).toEqual(newState());
    // Saved before trees grew back: a tree gone into wood starts its count when loaded.
    const old = { ...newState(), trees: { 3: { bites: 6, fell: 0, rest: { at: [0, 0, 0], turn: [0, 0, 0, 1] }, splitBites: 4, split: true } } };
    const before = Date.now(), back = load(JSON.stringify(old));
    expect(back.trees[3]!.gone).toBeGreaterThanOrEqual(before);
    expect(back.trees[3]!.gone).toBeLessThanOrEqual(Date.now());
  });
  test("a game saved in a world with more trees keeps all but the trees this world lacks", () => {
    const s = newState();
    apply(s, { type: "find" });
    apply(s, { type: "bite", tree: 2 });
    apply(s, { type: "fell", tree: 12, direction: 0.5 });
    apply(s, { type: "bite", tree: 13 });
    apply(s, { type: "fell", tree: 30, direction: 1.2 });
    apply(s, { type: "place", slot: 0, stick: "t30:1" });
    const here = load(JSON.stringify(s), 13);
    expect(Object.keys(here.trees)).toEqual(["2", "12"]);
    expect([here.found, here.dam]).toEqual([true, ["t30:1"]]); // the dam keeps its stick: it is drawn as a plain one
    expect(load(JSON.stringify(s))).toEqual(s); // without a count: as saved
    expect(Object.keys(load(JSON.stringify({ ...newState(), trees: { "-1": { bites: 1, splitBites: 0 }, x: { bites: 1, splitBites: 0 }, 1.5: { bites: 1, splitBites: 0 } } }), 13).trees)).toEqual([]);
  });
});

describe("trees", () => {
  test("thicker trunks take more bites, 6 to 10", () => {
    expect(bitesToFell(0.1)).toBe(6);
    expect(bitesToFell(0.25)).toBeGreaterThan(bitesToFell(0.15));
    expect(bitesToFell(0.9)).toBe(10);
  });
  test("a tree yields one or two logs and four to six sticks, the same every time", () => {
    for (const trunk of [1.5, 3, 5]) {
      const wood = woodFrom(3, trunk, 0.2);
      const logs = wood.filter((p) => p.kind === "log"), sticks = wood.filter((p) => p.kind === "stick");
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs.length).toBeLessThanOrEqual(2);
      expect(sticks.length).toBeGreaterThanOrEqual(4);
      expect(sticks.length).toBeLessThanOrEqual(6);
      for (const l of logs) expect(l.along + l.length / 2).toBeLessThanOrEqual(trunk + 0.01);
      for (const s of sticks) { expect(s.length).toBeGreaterThanOrEqual(0.5); expect(s.length).toBeLessThanOrEqual(0.8); }
      expect(woodFrom(3, trunk, 0.2)).toEqual(wood);
    }
  });
  test("twenty lying sticks and three trees are enough for the dam", () => {
    const fromTrees = [0, 1, 2].map((i) => woodFrom(i, 2, 0.2).filter((p) => p.kind === "stick").length).reduce((a, b) => a + b);
    expect(20 + fromTrees).toBeGreaterThanOrEqual(SLOTS);
  });
});

describe("dam", () => {
  const plan = damPlan();
  test("has SLOTS places, the same every time, inside the dam's foot", () => {
    expect(plan).toHaveLength(SLOTS);
    expect(damPlan()).toEqual(plan);
    for (const s of plan) {
      expect(Math.abs(s.x)).toBeLessThan(DAM.base);
      expect(Math.abs(s.z)).toBeLessThan(DAM.length / 2);
      expect(s.y).toBeLessThanOrEqual(DAM.height);
    }
  });
  test("starts in the middle at the bottom and rises layer by layer", () => {
    expect(Math.abs(plan[0]!.z)).toBeLessThan(0.3);
    expect(plan[0]!.y).toBeLessThan(0.05);
    for (let i = 1; i < SLOTS; i++) expect(plan[i]!.y).toBeGreaterThanOrEqual(plan[i - 1]!.y);
    expect(plan[SLOTS - 1]!.y).toBeGreaterThan(0.25);
  });
  test("sticks cross at angles: no two neighbours lie the same way", () => {
    for (let i = 1; i < SLOTS; i++) expect(Math.abs(plan[i]!.yaw - plan[i - 1]!.yaw)).toBeGreaterThan(0.1);
  });
  test("the mound grows with the sticks and is walkable when done (< 40°)", () => {
    expect(moundHeight(0)).toBe(0);
    for (let n = 1; n <= SLOTS; n++) expect(crestHeight(n)).toBeGreaterThanOrEqual(crestHeight(n - 1));
    expect(crestHeight(SLOTS)).toBeCloseTo(DAM.height, 2);
    expect(Math.atan(DAM.height / (DAM.base - DAM.top)) * 180 / Math.PI).toBeLessThan(40);
    expect(Math.atan(DAM.height / ((DAM.length / 2) * (1 - DAM.top / DAM.base))) * 180 / Math.PI).toBeLessThan(40);
    expect(profile(0, 0)).toBe(1);
    expect(profile(DAM.base, 0)).toBe(0);
    expect(profile(0, DAM.length / 2)).toBe(0);
  });
  test("the pond rises with the dam, up to POND_RISE", () => {
    expect(pondRise(0)).toBe(0);
    expect(pondRise(SLOTS)).toBeCloseTo(POND_RISE);
    expect(pondRise(15)).toBeCloseTo(POND_RISE / 2);
    expect(pondRise(SLOTS + 5)).toBeCloseTo(POND_RISE);
  });
  test("the pond starts low and the finished dam fills it to the world's level, never above", () => {
    expect(pondLevel(0, 0)).toBeCloseTo(-POND_RISE);
    expect(pondLevel(0, SLOTS)).toBeCloseTo(0);
    expect(pondLevel(0.5, SLOTS + 3)).toBeCloseTo(0.5);
    for (let n = 1; n <= SLOTS; n++) expect(pondLevel(0, n)).toBeGreaterThan(pondLevel(0, n - 1));
  });
});

test("goals tick off with the state", () => {
  const s = newState();
  expect(goals(s).map((g) => g.done)).toEqual([false, false, false, false]);
  expect(goals(s)[3]!.text).toBe("Build the dam: 0 of 30");
  apply(s, { type: "find" });
  apply(s, { type: "fell", tree: 0, direction: 0 });
  apply(s, { type: "place", slot: 0, stick: "w0" });
  expect(goals(s).map((g) => g.done)).toEqual([true, true, false, false]);
  expect(goals(s)[3]!.text).toBe("Build the dam: 1 of 30");
  for (let k = 1; k < SLOTS + 2; k++) apply(s, { type: "place", slot: k, stick: `d${k}` });
  // The finished dam is not the end: the lodge comes next, counted on its own; the first steps are left behind.
  expect(goals(s).map((g) => [g.id, g.done])).toEqual([["dam", true], ["lodge", false]]);
  expect(goals(s)[0]!.text).toBe("Build the dam: 30 of 30");
  expect(goals(s)[1]!.text).toBe(`Build up the lodge: 2 of ${LODGE}`);
  // A world saved with the lodge standing (before there was a cache) loads into the cache's goal, at none of CACHE.
  for (let k = 0; k < LODGE - 2; k++) apply(s, { type: "place", slot: 0, stick: `x${k}` });
  expect(goals(load(JSON.stringify(s))).map((g) => [g.id, g.done])).toEqual([["dam", true], ["lodge", true], ["cache", false]]);
  expect(goals(s)[1]!.text).toBe(`Build up the lodge: ${LODGE} of ${LODGE}`);
  expect(goals(s)[2]!.text).toBe(`Stock the food cache: 0 of ${CACHE}`);
  for (let k = 0; k < CACHE + 3; k++) apply(s, { type: "place", slot: 0, stick: `x${LODGE + k}` });
  expect(goals(s).map((g) => [g.text, g.done])).toEqual([
    ["Build the dam: 30 of 30", true], [`Build up the lodge: ${LODGE} of ${LODGE}`, true], [`Stock the food cache: ${CACHE} of ${CACHE}`, true]]);
  expect(s.dam).toHaveLength(STICKS);
});

test("the food cache lies deep beside the lodge, clear of its base, the basin's rocks and the sunken log", () => {
  const plan = cachePlan(), layout = placeAll(), log = layout.sunkenLog[0]!;
  expect(plan).toHaveLength(CACHE);
  expect(cachePlan()).toEqual(plan);
  const bed = heightAt(CACHE_AT.x, CACHE_AT.z);
  expect(bed).toBeLessThan(WATER_LEVEL - 2.5); // in the deep basin: only a dive gets there
  // The lodge (build/dam.ts) stands 0.6 m east of the pond's middle, its mound 2.5 m across at its widest (up by the
  // water; narrower down at the bed): the pile's sticks stay outside that.
  expect(Math.hypot(CACHE_AT.x - POND.x - 0.6, CACHE_AT.z - POND.z)).toBeGreaterThan(1.25 + 0.3);
  for (const p of plan) {
    const x = CACHE_AT.x + p.x, z = CACHE_AT.z + p.z;
    expect(Math.hypot(p.x, p.z)).toBeLessThan(0.3);
    for (const r of layout.bedRock) expect(Math.hypot(x - r.x, z - r.z) - 0.5 * r.scale).toBeGreaterThan(0.25);
    // The log, 2.2 m long, lies along its turn.
    const ux = Math.sin(log.turn), uz = Math.cos(log.turn), t = Math.max(-1.1, Math.min(1.1, (x - log.x) * ux + (z - log.z) * uz));
    expect(Math.hypot(x - log.x - ux * t, z - log.z - uz * t)).toBeGreaterThan(0.18 + 0.25);
  }
});

test("the lodge rises only once the dam holds, and is fully up with its last stick", () => {
  expect(lodgeGrow(0)).toBe(0);
  expect(lodgeGrow(SLOTS - 1)).toBe(0);
  expect(lodgeGrow(SLOTS)).toBeGreaterThan(0);
  for (let n = SLOTS + 1; n <= SLOTS + LODGE; n++) expect(lodgeGrow(n)).toBeGreaterThan(lodgeGrow(n - 1));
  expect(lodgeGrow(SLOTS + LODGE)).toBe(1);
  expect(lodgeGrow(SLOTS + LODGE + 3)).toBe(1);
});

describe("trading sticks away", () => {
  const felledAndSplit = (s: ReturnType<typeof newState>, tree: number) => {
    apply(s, { type: "bite", tree });
    apply(s, { type: "fell", tree, direction: 0 });
    apply(s, { type: "rest", tree, at: [0, 0, 0], turn: [0, 0, 0, 1] });
    for (let k = 0; k < BITES_TO_SPLIT; k++) apply(s, { type: "bite", tree });
    expect(apply(s, { type: "split", tree })).toBe(true);
  };
  test("a stick is traded once, and never one in the dam; one traded is never built in", () => {
    const s = newState();
    expect(apply(s, { type: "trade", stick: "w3" })).toBe(true);
    expect(s.traded).toEqual(["w3"]);
    expect(apply(s, { type: "trade", stick: "w3" })).toBe(false);
    expect(apply(s, { type: "place", slot: 0, stick: "w3" })).toBe(false);
    expect(apply(s, { type: "place", slot: 0, stick: "w4" })).toBe(true);
    expect(apply(s, { type: "trade", stick: "w4" })).toBe(false);
    expect(s.traded).toEqual(["w3"]);
  });
  test("an old saved game without traded sticks loads, and stays a version 1 game", () => {
    const old = JSON.stringify({ version: 1, trees: { 2: { bites: 3, splitBites: 0 } }, dam: ["w1"], found: true });
    const s = load(old);
    expect(s.traded).toEqual([]);
    expect(s.dam).toEqual(["w1"]);
    expect(apply(s, { type: "trade", stick: "w2" })).toBe(true);
    expect(load(JSON.stringify(s)).traded).toEqual(["w2"]);
  });
  test("a tree grown back brings its traded sticks back with it, never the world's own", () => {
    const s = newState();
    felledAndSplit(s, 2);
    felledAndSplit(s, 5);
    for (const stick of ["t2:3", "t2:4", "t5:3", "w7"]) expect(apply(s, { type: "trade", stick })).toBe(true);
    expect(apply(s, { type: "grow", tree: 2 })).toBe(true);
    expect(s.traded).toEqual(["t5:3", "w7"]);
    expect(apply(s, { type: "trade", stick: "t2:3" })).toBe(true); // back in the world: tradeable again
  });
});
