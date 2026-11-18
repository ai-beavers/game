// Tests for what a working bot does next (botmind.ts), and that the world it knows lays wood where it can be fetched.
import { describe, expect, test } from "bun:test";
import { apply, CACHE_AT, LODGE, newState, SLOTS, STICKS, type BuildChange, type BuildState } from "../build/rules.ts";
import { decide, milestone, overdue, yields, type Seen } from "./botmind.ts";
import { heading, loadWorld } from "./botworld.ts";

const trees = [{ x: 10, z: 0 }, { x: -10, z: 0 }, { x: 0, z: 12 }];
const seen = (more: Partial<Seen> = {}, changes: BuildChange[] = []): Seen => {
  const state: BuildState = newState();
  for (const c of changes) apply(state, c);
  return { state, trees, loose: [], others: [], touched: {}, me: { x: 0, z: 0, carry: -1 }, calm: false, site: { x: 0, z: 5, radius: 2 }, ...more };
};
const felled = (tree: number): BuildChange[] => [...Array(6).fill({ type: "bite", tree }), { type: "fell", tree, direction: 0 }, { type: "rest", tree, at: [0, 0, 0], turn: [0, 0, 0, 1] }];
const fill = (n: number): BuildChange[] => Array.from({ length: n }, (_, i) => ({ type: "place", slot: i, stick: `d${i}` }));

describe("decide", () => {
  test("alone: builds what it carries, fetches the nearest stick, else makes wood, else fells the nearest tree", () => {
    expect(decide(seen({ me: { x: 0, z: 0, carry: 3 } }))).toEqual({ kind: "build" });
    expect(decide(seen({ loose: [{ id: 1, x: 6, z: 0 }, { id: 2, x: 2, z: 1 }] }))).toEqual({ kind: "fetch", stick: 2 });
    expect(decide(seen({}, felled(2)))).toEqual({ kind: "split", tree: 2 });
    expect(decide(seen({ me: { x: -8, z: 0, carry: -1 } }))).toEqual({ kind: "fell", tree: 1 });
  });

  test("leaves to others what they are on: a tree bitten a moment ago, work another free player is closer to", () => {
    expect(decide(seen({ touched: { 0: 1 } }))).toEqual({ kind: "fell", tree: 1 });
    expect(decide(seen({ touched: { 0: 10 } }))).toEqual({ kind: "fell", tree: 0 });
    const near = { id: 7, x: 9, z: 0, carry: -1, action: "none" as const };
    expect(decide(seen({ others: [near] }))).toEqual({ kind: "fell", tree: 1 });
    expect(decide(seen({ others: [{ ...near, carry: 4 }] }))).toEqual({ kind: "fell", tree: 0 }); // its hands are full
    expect(decide(seen({ loose: [{ id: 1, x: 8, z: 0 }, { id: 2, x: -9, z: 0 }], others: [near] }))).toEqual({ kind: "fetch", stick: 2 });
  });

  test("stops making wood when the sticks lying about are enough for the rest, and rests when all is built", () => {
    const loose = Array.from({ length: 5 }, (_, i) => ({ id: i, x: 20, z: 0 }));
    const others = loose.map((s, i) => ({ id: 10 + i, x: 19.5, z: 0, carry: -1, action: "none" as const })); // each on its stick
    expect(decide(seen({ loose, others }, fill(STICKS - 5)))).toMatchObject({ kind: "wander" });
    expect(decide(seen({ loose, others }, fill(STICKS - 6)))).toEqual({ kind: "fell", tree: 0 });
    expect(decide(seen({}, fill(SLOTS + LODGE)))).toEqual({ kind: "fell", tree: 0 }); // the cache still wants sticks
    expect(decide(seen({}, fill(STICKS)))).toMatchObject({ kind: "wander" });
    expect(decide(seen({ me: { x: 0, z: 0, carry: 2 } }, fill(STICKS)))).toEqual({ kind: "leave" });
  });

  test("calm (a real player is in): fetches and leaves sticks at the dam, never builds, fells only when no wood is left", () => {
    expect(decide(seen({ calm: true, me: { x: 0, z: 0, carry: 3 } }))).toEqual({ kind: "leave" });
    expect(decide(seen({ calm: true, loose: [{ id: 1, x: 0, z: 5.5 }, { id: 2, x: 8, z: 0 }] }))).toEqual({ kind: "fetch", stick: 2 });
    expect(decide(seen({ calm: true, loose: [{ id: 1, x: 0, z: 5.5 }] }, felled(2)))).toEqual({ kind: "split", tree: 2 });
    expect(decide(seen({ calm: true, loose: [{ id: 1, x: 0, z: 5.5 }] }))).toMatchObject({ kind: "wander" });
    expect(decide(seen({ calm: true, me: { x: 0, z: 0, carry: 3 } }, fill(SLOTS + LODGE)))).toEqual({ kind: "leave" }); // the player dives it down
    expect(decide(seen({ calm: true }))).toEqual({ kind: "fell", tree: 0 });
  });
});

describe("the food cache", () => {
  const diver = { id: 7, x: CACHE_AT.x + 0.3, z: CACHE_AT.z, carry: 4, action: "none" as const };
  test("once the lodge stands, a stick goes down to the cache; one at the pile at a time, the others wait their turn", () => {
    const me = { x: 0, z: 0, carry: 3 };
    expect(decide(seen({ me }, fill(SLOTS + LODGE)))).toEqual({ kind: "cache" });
    expect(decide(seen({ me }, fill(SLOTS + LODGE - 1)))).toEqual({ kind: "build" }); // the lodge first
    expect(decide(seen({ me, others: [diver] }, fill(SLOTS + LODGE)))).toEqual({ kind: "wait" });
    expect(decide(seen({ me, others: [{ ...diver, carry: -1 }] }, fill(SLOTS + LODGE)))).toEqual({ kind: "cache" }); // it wedged its stick: free
    expect(decide(seen({ me, others: [{ ...diver, x: CACHE_AT.x + 3 }] }, fill(SLOTS + LODGE)))).toEqual({ kind: "cache" }); // still on its way
    expect(decide(seen({ me: { ...me, x: CACHE_AT.x, z: CACHE_AT.z }, others: [diver] }, fill(SLOTS + LODGE)))).toEqual({ kind: "cache" }); // I am nearer
    expect(decide(seen({ others: [diver] }, fill(SLOTS + LODGE)))).toEqual({ kind: "fell", tree: 0 }); // empty hands: fetch, make wood
  });
});

describe("between jobs", () => {
  const done = fill(STICKS), player = { id: 5, x: 2, z: 0, carry: -1, action: "none" as const, real: true };
  test("looks at a real player who comes close, not at a bot", () => {
    expect(decide(seen({ others: [player] }, done))).toEqual({ kind: "look", at: 5 });
    expect(decide(seen({ others: [{ ...player, real: false }] }, done))).toMatchObject({ kind: "wander" });
    expect(decide(seen({ others: [{ ...player, x: 6 }] }, done))).toMatchObject({ kind: "wander" });
  });
  test("slaps, dives, swims or walks by the dice; slaps seldom, and more seldom still at the forest's edge", () => {
    expect(decide(seen({ roll: 0.1, sinceSlap: 60 }, done))).toEqual({ kind: "wander", how: "slap" });
    expect(decide(seen({ roll: 0.1, sinceSlap: 20 }, done))).toEqual({ kind: "wander", how: "dive" });
    expect(decide(seen({ roll: 0.1, sinceSlap: 60, me: { x: 13, z: 0, carry: -1 } }, done))).toEqual({ kind: "wander", how: "dive" });
    expect(decide(seen({ roll: 0.1, sinceSlap: 400, me: { x: 13, z: 0, carry: -1 } }, done))).toEqual({ kind: "wander", how: "slap" });
    expect(decide(seen({ roll: 0.5 }, done))).toEqual({ kind: "wander", how: "swim" });
    expect(decide(seen({ roll: 0.9 }, done))).toEqual({ kind: "wander", how: "walk" });
  });
  test("says something only when the dam, the lodge or the cache is finished", () => {
    expect([...Array(STICKS + 1).keys()].map(milestone).filter(Boolean)).toEqual(["Dam's done!", "The lodge stands.", "Cache is full. Ready for winter."]);
  });
});

describe("meeting others", () => {
  const me = { id: 3, x: 0, y: 0, z: 0, f: 0 }, coming = { id: 1, x: 0, y: 0, z: 1, f: Math.PI, speed: 1, carry: -1, action: "none" as const };
  test("gives way to one coming head-on with a lower id; the other goes on, and nobody waits for one going the same way", () => {
    expect(yields(me, [coming])).toBe(true);
    expect(yields({ ...me, id: 0 }, [coming])).toBe(false); // it has the way
    expect(yields(me, [{ ...coming, f: 0 }])).toBe(false); // walking ahead of me
    expect(yields(me, [{ ...coming, speed: 0 }])).toBe(false); // standing: go round it
    expect(yields(me, [{ ...coming, z: 3 }])).toBe(false);
    expect(yields(me, [{ ...coming, y: -2 }])).toBe(false); // diving under me
  });
  test("the watchdog: a job that takes over a minute is stuck", () => {
    expect(overdue(20)).toBe(false);
    expect(overdue(61)).toBe(true);
  });
});

describe("the bot's world", async () => {
  const world = await loadWorld();
  test("every tree falls onto dry land off the site, and its wood lies there too", () => {
    world.trees.forEach((t, i) => {
      expect(t.need).toBeGreaterThanOrEqual(6);
      const rest = world.restFor(i, world.fallDirection(i));
      for (const { at } of world.woodOf(i, rest)) {
        expect(at[1]).toBeGreaterThan(world.level(SLOTS));
        expect(Math.hypot(at[0], at[2])).toBeLessThan(16);
      }
    });
  });
  test("builds where a player can: beside the dam, and within reach of the lodge", () => {
    const { origin, across, lodgeAt } = world.dam;
    expect(world.atDam(origin.x - across.x * 1.25, origin.z - across.z * 1.25)).toBe(true);
    expect(world.atLodge(lodgeAt.x - across.x * 1.7, lodgeAt.z - across.z * 1.7)).toBe(true);
    // Over the pile, off the lodge: down at the bed there it can wedge a stick in, at the surface not.
    const { spot } = world.cache;
    expect(Math.hypot(spot.x - lodgeAt.x, spot.z - lodgeAt.z)).toBeGreaterThan(1.25 + 0.25);
    expect(world.atCache(spot.x, world.groundAt(spot.x, spot.z, STICKS), spot.z)).toBe(true);
    expect(world.atCache(spot.x, world.level(SLOTS) - 0.3, spot.z)).toBe(false);
  });
  test("crates stand where the host last said, else where they wait", () => {
    const at = (crates?: Map<number, [number, number, number]>) => world.obstacles(newState(), crates).some((c) => Math.hypot(c.x - 9, c.z - 9) < 0.01);
    expect(at()).toBe(false);
    expect(at(new Map([[64, [9, 0, 9]]]))).toBe(true);
  });
  test("walks round what stands in the way, straight on when nothing does", () => {
    expect(heading({ x: 0, z: 0 }, { x: 0, z: 5 }, [])).toBeCloseTo(0);
    const round = heading({ x: 0, z: 0 }, { x: 0, z: 5 }, [{ x: 0, z: 1.5, r: 0.5 }]);
    expect(Math.abs(round)).toBeGreaterThan(0.4);
    expect(heading({ x: 0, z: 0 }, { x: 0, z: 5 }, [{ x: 3, z: 1.5, r: 0.5 }])).toBeCloseTo(0);
  });
});
