// Tests for what a working bot does next (botmind.ts), and that the world it knows lays wood where it can be fetched.
import { describe, expect, test } from "bun:test";
import { apply, LODGE, newState, SLOTS, type BuildChange, type BuildState } from "../build/rules.ts";
import { decide, type Seen } from "./botmind.ts";
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
    expect(decide(seen({ loose, others }, fill(SLOTS + LODGE - 5)))).toEqual({ kind: "wander" });
    expect(decide(seen({ loose, others }, fill(SLOTS + LODGE - 6)))).toEqual({ kind: "fell", tree: 0 });
    expect(decide(seen({}, fill(SLOTS + LODGE)))).toEqual({ kind: "wander" });
    expect(decide(seen({ me: { x: 0, z: 0, carry: 2 } }, fill(SLOTS + LODGE)))).toEqual({ kind: "leave" });
  });

  test("calm (a real player is in): fetches and leaves sticks at the dam, never builds, fells only when no wood is left", () => {
    expect(decide(seen({ calm: true, me: { x: 0, z: 0, carry: 3 } }))).toEqual({ kind: "leave" });
    expect(decide(seen({ calm: true, loose: [{ id: 1, x: 0, z: 5.5 }, { id: 2, x: 8, z: 0 }] }))).toEqual({ kind: "fetch", stick: 2 });
    expect(decide(seen({ calm: true, loose: [{ id: 1, x: 0, z: 5.5 }] }, felled(2)))).toEqual({ kind: "split", tree: 2 });
    expect(decide(seen({ calm: true, loose: [{ id: 1, x: 0, z: 5.5 }] }))).toEqual({ kind: "wander" });
    expect(decide(seen({ calm: true }))).toEqual({ kind: "fell", tree: 0 });
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
  });
  test("walks round what stands in the way, straight on when nothing does", () => {
    expect(heading({ x: 0, z: 0 }, { x: 0, z: 5 }, [])).toBeCloseTo(0);
    const round = heading({ x: 0, z: 0 }, { x: 0, z: 5 }, [{ x: 0, z: 1.5, r: 0.5 }]);
    expect(Math.abs(round)).toBeGreaterThan(0.4);
    expect(heading({ x: 0, z: 0 }, { x: 0, z: 5 }, [{ x: 3, z: 1.5, r: 0.5 }])).toBeCloseTo(0);
  });
});
