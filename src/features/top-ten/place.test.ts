// Tests for where the Top-ten board stands: on dry flat ground at the edge of the building site, facing the path's end
// and the site, clear of the dam and the way to it, the worn path, the Flag, the Campfire, Mrs. Beaver's spot and ways,
// the trading post and everything the world placed. Run: bun test src/features/top-ten
import { expect, test } from "bun:test";
import { heightAt, PATH, POND, SITE, WATER_LEVEL } from "../../world/terrain.ts";
import { placeAll, SPAWN } from "../../world/place.ts";
import { DAM } from "../build/rules.ts";
import { POLE } from "../flag/state.ts";
import { CAMPFIRE, FIRE, SEAT } from "../mrs-beaver/reading.ts";
import { HIDING, HOME, wayHome } from "../mrs-beaver/rules.ts";
import { footprint as tradingPost, standAt, FRONT as POST_FRONT } from "../trade/place.ts";
import { footprint as bench } from "../workbench/place.ts";
import { footprint as bulb } from "../lightbulb/place.ts";
import { BOARD, footprint, FRONT } from "./place.ts";

type Circle = { x: number; z: number; r: number };
const apart = (a: Circle, b: Circle) => Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
const offWay = (c: Circle, a: { x: number; z: number }, b: { x: number; z: number }) => {
  let least = Infinity;
  for (let t = 0; t <= 1; t += 0.01) least = Math.min(least, apart(c, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, r: 0 }));
  return least;
};
const board = footprint();
const nearest = (o: Circle) => Math.min(...board.map((b) => apart(b, o)));
const nearestWay = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.min(...board.map((c) => offWay(c, a, b)));
const towards = (p: { x: number; z: number }) => {
  const dx = p.x - BOARD.x, dz = p.z - BOARD.z, l = Math.hypot(dx, dz);
  return (dx * FRONT.x + dz * FRONT.z) / l;
};
// The dam as dam.ts lays it: its middle 1.1 m from the site's towards the pond, DAM.length along the shore.
const across = (() => { const dx = POND.x - SITE.x, dz = POND.z - SITE.z, l = Math.hypot(dx, dz); return { x: dx / l, z: dz / l }; })();
const dam = { x: SITE.x + across.x * 1.1, z: SITE.z + across.z * 1.1 };
const builder = { x: dam.x - across.x * 1.25, z: dam.z - across.z * 1.25 }; // where a beaver stands to build it (tour kit)

test("it stands on dry flat ground at the edge of the building site", () => {
  for (const b of board) expect(heightAt(b.x, b.z)).toBeGreaterThan(WATER_LEVEL + 0.01);
  const heights = board.map((b) => heightAt(b.x, b.z));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.1);
  expect(nearest({ ...SITE, r: SITE.radius })).toBeGreaterThan(0.2);
  expect(nearest({ ...SITE, r: SITE.radius })).toBeLessThan(1.5);
});

test("its face looks at the path's end and the site", () => {
  const end = { x: PATH.at(-1)![0], z: PATH.at(-1)![1] };
  expect(towards(end)).toBeGreaterThan(0.6);
  expect(towards(SITE)).toBeGreaterThan(0.6);
  expect(towards({ x: PATH[2][0], z: PATH[2][1] })).toBeGreaterThan(0); // seen from the path on the way up
});

test("it keeps clear of the dam, the way to it and the worn path", () => {
  expect(nearest({ ...dam, r: DAM.length / 2 + 0.3 }), "the dam").toBeGreaterThan(0.5);
  expect(nearest({ ...builder, r: 0.4 }), "where the beaver builds").toBeGreaterThan(0.5);
  for (let k = 1; k < PATH.length; k++) {
    const a = { x: PATH[k - 1]![0], z: PATH[k - 1]![1] }, b = { x: PATH[k]![0], z: PATH[k]![1] };
    expect(nearestWay(a, b), `the path's leg ${k}`).toBeGreaterThan(0.55);
  }
  expect(nearestWay(SPAWN, builder), "the way from the spawn to the dam").toBeGreaterThan(0.4);
});

test("it keeps clear of the Flag, the Campfire, Mrs. Beaver's spot and her ways home", () => {
  expect(nearest({ ...POLE, r: 0.3 })).toBeGreaterThan(1);
  expect(nearest({ ...FIRE, r: CAMPFIRE.solid })).toBeGreaterThan(1);
  expect(nearest({ ...SEAT, r: 0.4 })).toBeGreaterThan(1);
  expect(nearest({ ...HOME, r: 0.5 })).toBeGreaterThan(1);
  HIDING.forEach((h, i) => {
    const way = [h, ...wayHome(i)];
    for (let k = 1; k < way.length; k++) expect(nearestWay(way[k - 1]!, way[k]!), `her way from hiding place ${i}`).toBeGreaterThan(0.5);
  });
});

test("it keeps clear of the trading post, its spots and the ways to them, and of everything the world placed", () => {
  // Room for a beaver between the board and the counter's end (the bots go round both).
  for (const p of tradingPost()) expect(nearest(p)).toBeGreaterThan(0.5);
  for (const p of [...bench(), ...bulb()]) expect(nearest(p)).toBeGreaterThan(0.8);
  for (const i of [0, 1, 2]) {
    const stand = standAt(i), approach = { x: stand.x + POST_FRONT.x * 1.4, z: stand.z + POST_FRONT.z * 1.4 };
    expect(nearestWay(SPAWN, approach), `the way to spot ${i}`).toBeGreaterThan(0.6);
  }
  const layout = placeAll();
  for (const s of layout.stick) expect(nearest({ x: s.x, z: s.z, r: s.scale / 2 }), `a stick at ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`).toBeGreaterThan(0.1);
  for (const s of layout.crate) expect(nearest({ x: s.x, z: s.z, r: 0.4 })).toBeGreaterThan(0.5);
  for (const list of [layout.tree, layout.stump, layout.log, layout.rock, layout.reed]) for (const s of list) expect(nearest({ x: s.x, z: s.z, r: 0.5 * s.scale })).toBeGreaterThan(0.3);
});
