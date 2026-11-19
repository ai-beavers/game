// Mrs. Beaver's rules as a player meets them: a hiding place picked anew each visit with her flower on the way, the
// quest's steps in order, and the Use key's offers only close by with free paws, on land.
import { expect, test } from "bun:test";
import { placeAll, SPAWN } from "../../world/place.ts";
import { FIRST_RIM, heightAt, pondRatio, SITE, slopeAt, WATER_LEVEL } from "../../world/terrain.ts";
import { CALENDAR, SHOP, SIGN } from "../shop/place.ts";
// Where the Shop stands, turned to face the Clearing.
const FACING = Math.atan2(0 - SHOP.x, 2 - SHOP.z);
/** A point in the Shop's frame (building.ts toWorld), in the world. */
const shopToWorld = (x: number, z: number) => ({ x: SHOP.x + x * Math.cos(FACING) + z * Math.sin(FACING), z: SHOP.z - x * Math.sin(FACING) + z * Math.cos(FACING) });
// In front of the Shop: the post of its sign and the Calendar board, mirrored across the path from the sign and turned
// the other way; solid to its frame's ends.
const SIGN_POST = shopToWorld(SIGN.x, SIGN.z), BOARD = shopToWorld(CALENDAR.x, CALENDAR.z), BOARD_YAW = FACING + CALENDAR.yaw;
const BOARD_ENDS = [-1, 1].map((side) => side * (CALENDAR.width / 2 + 0.05)).map((t) => ({ x: BOARD.x + Math.cos(BOARD_YAW) * t, z: BOARD.z - Math.sin(BOARD_YAW) * t }));
/** m from p to the Calendar board's face, end to end. */
const toBoard = (p: { x: number; z: number }) => {
  const [a, b] = BOARD_ENDS as [{ x: number; z: number }, { x: number; z: number }], dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
};
import { POST } from "../trade/place.ts";
import { BENDS, done, FIND, FLOWER, follow, GNAW, find, gnaw, HIDING, HOME, offered, pick, REACH, rows, take, TRACKS, TRACKS_FACING, TRACKS_REACH, TRAIL, wayHome } from "./rules.ts";

test("each visit picks one of the six hiding places from the random number given, and starts on the flower step", () => {
  expect(HIDING).toHaveLength(6);
  expect(pick(0)).toEqual({ place: 0, step: "flower", gnawed: 0 });
  expect(pick(0.5).place).toBe(3);
  expect(pick(0.99).place).toBe(5);
  expect(pick(1).place).toBe(5); // a random number at its very top stays in the list
});

test("the first three hiding places stay where they were, and no two brush piles stand close together", () => {
  expect(HIDING.slice(0, 3)).toEqual([{ x: -13.3, z: -2.3 }, { x: 3.5, z: -13 }, { x: -5, z: 13.6 }]);
  HIDING.forEach((a, i) => HIDING.forEach((b, j) => { if (i < j) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(5.5); }));
});

test("every hiding place is on dry land just inside where the first clearing's bank stood, clear of the pond, the site, the dam, the shop, the post and the spawn", () => {
  const dam = { x: SITE.x + 1.1, z: SITE.z }; // the dam: on the shore, from the site towards the pond
  for (const p of HIDING) {
    const r = Math.hypot(p.x, p.z);
    expect(r).toBeGreaterThan(FIRST_RIM - 4); // they stayed when the clearing grew, as the middle did
    expect(r).toBeLessThan(FIRST_RIM - 1.5);
    expect(heightAt(p.x, p.z)).toBeGreaterThan(WATER_LEVEL + 0.1);
    expect(slopeAt(p.x, p.z)).toBeLessThan(0.25);
    expect(pondRatio(p.x, p.z)).toBeGreaterThan(2);
    expect(Math.hypot(p.x - SITE.x, p.z - SITE.z)).toBeGreaterThan(8);
    expect(Math.hypot(p.x - dam.x, p.z - dam.z)).toBeGreaterThan(6);
    expect(Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z)).toBeGreaterThan(6);
    expect(Math.hypot(p.x - SHOP.x, p.z - SHOP.z)).toBeGreaterThan(6);
    expect(Math.hypot(p.x - POST.x, p.z - POST.z)).toBeGreaterThan(8);
    expect(toBoard(p)).toBeGreaterThan(4);
  }
});

test("the brush pile stands clear of the trees, rocks, stumps, logs, bushes and sticks laid out round it (a stick in reach would take the Use key)", () => {
  const layout = placeAll();
  const things = [...layout.tree.map((s) => ({ s, r: 2 })), ...layout.rock.map((s) => ({ s, r: 1 })), ...layout.stump.map((s) => ({ s, r: 1 })),
    ...layout.log.map((s) => ({ s, r: 1.8 })), ...layout.bush.map((s) => ({ s, r: 1.2 })), ...layout.stick.map((s) => ({ s, r: 2 }))];
  for (const p of HIDING) for (const { s, r } of things) expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThan(r);
});

test("from every hiding place a way of straight legs over dry land leads home, past nothing laid out solid", () => {
  const layout = placeAll();
  const solid = [...layout.tree.map((s) => ({ s, r: 0.8 })), ...layout.rock.map((s) => ({ s, r: 0.5 * s.scale + 0.3 })),
    ...layout.stump.map((s) => ({ s, r: 0.6 })), ...layout.log.map((s) => ({ s, r: 1.3 })), ...layout.crate.map((s) => ({ s, r: 0.5 })),
    { s: SHOP, r: 3.5 }, { s: POST, r: 1.6 }, { s: SIGN_POST, r: 0.4 }];
  expect(Math.hypot(HOME.x - SITE.x, HOME.z - SITE.z)).toBeLessThan(SITE.radius + 2);
  expect(BENDS).toHaveLength(HIDING.length);
  HIDING.forEach((p, i) => {
    const way = wayHome(i);
    expect(way.at(-1)).toEqual(HOME);
    expect(way.length).toBeLessThanOrEqual(3); // home straight, or round the Calendar board's east end and the crates
    let from = p, walked = 0;
    for (const to of way) {
      for (let t = 0; t <= 1; t += 0.01) {
        const x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
        expect(heightAt(x, z)).toBeGreaterThan(WATER_LEVEL + 0.03);
        // No steeper than a beaver walks: the game's own check (index.ts clearWay) takes ground rising 0.4 m in a
        // quarter metre for a wall.
        const d = Math.hypot(to.x - from.x, to.z - from.z), on = { x: x + ((to.x - from.x) / d) * 0.25, z: z + ((to.z - from.z) / d) * 0.25 };
        expect(Math.abs(heightAt(on.x, on.z) - heightAt(x, z))).toBeLessThan(0.25);
        expect(pondRatio(x, z)).toBeGreaterThan(1.2);
        for (const { s, r } of solid) expect(Math.hypot(s.x - x, s.z - z)).toBeGreaterThan(r);
        expect(toBoard({ x, z })).toBeGreaterThan(0.4); // she walks past the board, not through it
      }
      walked += Math.hypot(to.x - from.x, to.z - from.z);
      from = to;
    }
    expect(walked).toBeLessThan(Math.hypot(HOME.x - p.x, HOME.z - p.z) + 1); // a bend is no long way round
  });
});

/** Where p lies along her way from HOME out to hiding place i: the share of the way walked to its nearest point on
 *  the way (0 at HOME, 1 at the hiding place), and its m from the way. */
function onWay(i: number, p: { x: number; z: number }) {
  const points = [HOME, ...[...(BENDS[i] ?? [])].reverse(), HIDING[i]!];
  let total = 0, best = { at: 0, off: Infinity };
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k]!, b = points[k + 1]!, dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (len * len)));
    const off = Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
    if (off < best.off) best = { at: total + len * t, off };
    total += len;
  }
  return { share: best.at / total, off: best.off };
}

test("every flower spot lies on dry land, clear of the pond, the site, the dam, the shop, the board, the post and the spawn, out along her way, nearer home than her tracks", () => {
  expect(FLOWER).toHaveLength(HIDING.length);
  const layout = placeAll(), dam = { x: SITE.x + 1.1, z: SITE.z }; // the dam: on the shore, from the site towards the pond
  FLOWER.forEach((f, i) => {
    // About a third of the way out; up to half where the middle of the clearing is crowded (the site, the spawn, the
    // post, the sticks laid out), and a little off her way where something stands on it.
    const { share, off } = onWay(i, f), tracks = onWay(i, TRACKS[i]!);
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.52);
    expect(off).toBeLessThan(2);
    expect(tracks.share - share).toBeGreaterThan(0.15);
    expect(toBoard(f)).toBeGreaterThan(1);
    expect(heightAt(f.x, f.z)).toBeGreaterThan(WATER_LEVEL + 0.1);
    expect(pondRatio(f.x, f.z)).toBeGreaterThan(2);
    expect(Math.hypot(f.x - SITE.x, f.z - SITE.z)).toBeGreaterThan(4);
    expect(Math.hypot(f.x - dam.x, f.z - dam.z)).toBeGreaterThan(4);
    expect(Math.hypot(f.x - SHOP.x, f.z - SHOP.z)).toBeGreaterThan(5);
    expect(Math.hypot(f.x - POST.x, f.z - POST.z)).toBeGreaterThan(4);
    expect(Math.hypot(f.x - SPAWN.x, f.z - SPAWN.z)).toBeGreaterThan(3);
    // Nothing laid out on it, and no stick so close that the Use key would pick the stick up instead.
    for (const s of [...layout.tree, ...layout.rock, ...layout.stump, ...layout.log, ...layout.bush, ...layout.crate]) expect(Math.hypot(s.x - f.x, s.z - f.z)).toBeGreaterThan(1.5);
    for (const s of layout.stick) expect(Math.hypot(s.x - f.x, s.z - f.z)).toBeGreaterThan(2);
  });
});

test("her tracks lie about two thirds of the way out, on dry land, clear of all that stands round them, their trail pointing at her brush pile and not at the next one", () => {
  expect(TRACKS).toHaveLength(HIDING.length);
  expect(TRACKS_FACING).toHaveLength(HIDING.length);
  const layout = placeAll(), dam = { x: SITE.x + 1.1, z: SITE.z };
  TRACKS.forEach((t, i) => {
    const h = HIDING[i]!, face = TRACKS_FACING[i]!, { share, off } = onWay(i, t);
    expect(share).toBeGreaterThan(0.58);
    expect(share).toBeLessThan(0.85);
    expect(off).toBeLessThan(1);
    // Pointing at her pile: straight ahead of the trail, within a metre of the pile's middle.
    const dx = h.x - t.x, dz = h.z - t.z, ahead = dx * Math.sin(face) + dz * Math.cos(face), side = Math.abs(dx * Math.cos(face) - dz * Math.sin(face));
    expect(ahead).toBeGreaterThan(2.3); // the trail ends at the pile, not under it
    // On the trail, coming from home, she is not found yet: that comes a few steps on.
    expect(ahead + TRACKS_REACH).toBeGreaterThan(FIND + 1);
    expect(side).toBeLessThan(0.1);
    // Every other pile lies well off the way the trail points.
    HIDING.forEach((o, j) => {
      if (j === i) return;
      const a = Math.abs(Math.atan2(Math.sin(Math.atan2(o.x - t.x, o.z - t.z) - face), Math.cos(Math.atan2(o.x - t.x, o.z - t.z) - face)));
      expect(a).toBeGreaterThan(0.45);
    });
    // The whole trail, about 3 m long, on dry land, clear of the landmarks and of all laid out.
    for (const k of [-TRAIL / 2, -TRAIL / 4, 0, TRAIL / 4, TRAIL / 2]) {
      const p = { x: t.x + Math.sin(face) * k, z: t.z + Math.cos(face) * k };
      expect(heightAt(p.x, p.z)).toBeGreaterThan(WATER_LEVEL + 0.1);
      expect(slopeAt(p.x, p.z)).toBeLessThan(0.6); // walkable; each print lies along the ground
      expect(pondRatio(p.x, p.z)).toBeGreaterThan(2);
      expect(Math.hypot(p.x - SITE.x, p.z - SITE.z)).toBeGreaterThan(3);
      expect(Math.hypot(p.x - dam.x, p.z - dam.z)).toBeGreaterThan(3);
      expect(Math.hypot(p.x - SHOP.x, p.z - SHOP.z)).toBeGreaterThan(5);
      expect(Math.hypot(p.x - POST.x, p.z - POST.z)).toBeGreaterThan(3);
      expect(Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z)).toBeGreaterThan(3);
      expect(toBoard(p)).toBeGreaterThan(1);
      for (const s of [...layout.tree, ...layout.rock, ...layout.stump, ...layout.log, ...layout.bush, ...layout.crate]) expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThan(1.2);
      for (const s of layout.stick) expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThan(0.8);
    }
  });
});

test("the steps advance only in order, each change true exactly once", () => {
  const quest = pick(0.4);
  expect(find(quest, 1)).toBe(false); // at her pile before the flower: nothing
  expect(follow(quest, 0)).toBe(false); // on her tracks before the flower: nothing
  expect(gnaw(quest, 5)).toBe(false); // gnawing before she is found: nothing
  expect(quest).toEqual({ place: 2, step: "flower", gnawed: 0 });
  expect(take(quest)).toBe(true);
  expect(take(quest)).toBe(false);
  expect(quest.step).toBe("tracks");
  expect(find(quest, 1)).toBe(false); // at her pile before her tracks: nothing
  expect(follow(quest, TRACKS_REACH + 0.3)).toBe(false); // not on the trail yet
  expect(follow(quest, 1)).toBe(true);
  expect(follow(quest, 1)).toBe(false);
  expect(quest.step).toBe("find");
  expect(gnaw(quest, 5)).toBe(false);
  expect(find(quest, 3)).toBe(false); // too far from her pile to have found her
  expect(find(quest, 2.2)).toBe(true);
  expect(find(quest, 2.2)).toBe(false);
  expect(take(quest)).toBe(false); // the flower is in the paws already
  expect(follow(quest, 0)).toBe(false);
  expect(quest).toEqual({ place: 2, step: "gnaw", gnawed: 0 });
});

test("gnawing adds up across releases and frees her exactly once, after about three seconds", () => {
  const quest = pick(0);
  take(quest); follow(quest, 0); find(quest, 1);
  expect(gnaw(quest, 1)).toBe(false);
  expect(gnaw(quest, 1.5)).toBe(false); // let go and held again: the second hold goes on from the first
  expect(quest.step).toBe("gnaw");
  expect(quest.gnawed).toBeCloseTo(2.5);
  expect(gnaw(quest, 0.6)).toBe(true);
  expect(quest.step).toBe("freed");
  expect(gnaw(quest, 1)).toBe(false);
  expect(GNAW).toBeGreaterThanOrEqual(2.5);
  expect(GNAW).toBeLessThanOrEqual(3.5);
});

test("the Use key offers the flower at the flower and the pen only once she is found, never with a stick or afloat", () => {
  const quest = pick(0), at = { flower: 9, pen: 9, carrying: false, afloat: false };
  expect(offered(quest, { ...at, flower: 1 })).toBe("flower");
  expect(offered(quest, { ...at, flower: 1.6 })).toBeUndefined(); // too far
  expect(offered(quest, { ...at, pen: 0.9 })).toBeUndefined(); // at the pen without the flower: nothing
  expect(offered(quest, { ...at, flower: 1, carrying: true })).toBeUndefined(); // a stick in the paws: Use does what it did
  expect(offered(quest, { ...at, flower: 1, afloat: true })).toBeUndefined();
  take(quest);
  expect(offered(quest, { ...at, flower: 1 })).toBeUndefined(); // the flower is gone
  expect(offered(quest, { ...at, pen: 0.9 })).toBeUndefined(); // not found yet
  follow(quest, 0);
  expect(offered(quest, { ...at, pen: 0.9 })).toBeUndefined(); // on her tracks, still not found
  find(quest, 0.9);
  expect(offered(quest, { ...at, pen: 0.9 })).toBe("gnaw");
  expect(offered(quest, { ...at, pen: 1.25 })).toBe("gnaw");
  expect(offered(quest, { ...at, pen: 1.6 })).toBeUndefined();
  expect(offered(quest, { ...at, pen: 0.9, carrying: true })).toBeUndefined();
  expect(offered(quest, { ...at, pen: 0.9, afloat: true })).toBeUndefined();
  gnaw(quest, GNAW);
  expect(offered(quest, { ...at, pen: 0.9 })).toBeUndefined(); // freed: nothing more of hers
  expect(FIND).toBeGreaterThan(REACH);
});

test("the checklist ticks one more step with each step done, and shows the steps that fit", () => {
  const quest = pick(0);
  expect(done(quest)).toBe(0);
  take(quest);
  expect(done(quest)).toBe(1);
  follow(quest, 0);
  expect(done(quest)).toBe(2);
  find(quest, 0);
  expect(done(quest)).toBe(3);
  gnaw(quest, GNAW);
  expect(done(quest)).toBe(4);
  expect(rows(0, true)).toEqual([0, 1, 2, 3]);
  expect(rows(2, false)).toEqual([2]); // too little room: only the step at hand
  expect(rows(4, true)).toEqual([]); // freed: only the one line "Mrs. Beaver found"
});
