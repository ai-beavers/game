// Tests for the world's rules: the shape of the ground, where things are placed, and how Havok's heightfield maps
// its samples (src/physics.ts relies on it). Run: bun test src/world
import { describe, expect, test } from "bun:test";
import { Quaternion } from "@babylonjs/core/Maths/math.vector.js";
import { GROUND, ball, capsule, heightfield } from "../physics.ts";
import { headless } from "../physics.testkit.ts";
import { createMover } from "../player/mover.ts";
import { placeAll, SPAWN } from "./place.ts";
import { dayAt } from "../features/sky/clock.ts";
import { BASIN, FIRST_RIM, groundAt, groundColliders, heightAt, HILL, pathAt, POND, pondRatio, RIM, SHELF, SHORE_SLOPE, SITE, SIZE, slopeAt, sunsetGap, WATER_LEVEL } from "./terrain.ts";
import { SHOP } from "../features/shop/place.ts";
import { FLOWER, HOME, TRACKS } from "../features/mrs-beaver/rules.ts";
import { POST } from "../features/trade/place.ts";

describe("heightAt", () => {
  test("the pond is about 1.2 m deep in its middle", () => {
    expect(heightAt(POND.x, POND.z)).toBeCloseTo(WATER_LEVEL - 1.2, 2);
    expect(heightAt(POND.x + 0.5, POND.z - 0.5)).toBeLessThan(WATER_LEVEL - 1.1);
  });
  test("the pond is about 8 m across at the water line", () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const at = (r: number) => heightAt(POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r);
      expect(at(3.3)).toBeLessThan(WATER_LEVEL);
      expect(at(5)).toBeGreaterThan(WATER_LEVEL);
    }
  });
  test("the shore is shallow enough to walk in and out (< 30°)", () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) for (let r = 2; r < 5.5; r += 0.25) {
      const x = POND.x + Math.cos(a) * r, z = POND.z + Math.sin(a) * r;
      if (pondRatio(x, z) > SHELF + 0.05) expect(slopeAt(x, z)).toBeLessThan(Math.tan(SHORE_SLOPE));
    }
  });
  test("a basin about 3 m deep on the south side, with room to dive; the shallows along the bank stay", () => {
    let deepest = 0, room = 0, shelf = 0;
    for (let x = POND.x - 4.5; x < POND.x + 4.5; x += 0.1) for (let z = POND.z - 4.5; z < POND.z + 4.5; z += 0.1) {
      const h = heightAt(x, z);
      deepest = Math.min(deepest, h);
      if (h < WATER_LEVEL - 2.5) room += 0.01;
      if (pondRatio(x, z) >= SHELF) shelf = Math.min(shelf, h);
    }
    expect(deepest).toBeLessThan(WATER_LEVEL - 2.9);
    expect(deepest).toBeGreaterThan(WATER_LEVEL - 3.4);
    expect(room).toBeGreaterThan(2.5); // m² deeper than 2.5 m
    expect(heightAt(BASIN.x, BASIN.z)).toBeLessThan(WATER_LEVEL - 2.5);
    expect(BASIN.z).toBeLessThan(POND.z - 1.5); // south of the middle: the lodge stands there, the dam at the west shore
    expect(shelf).toBeGreaterThan(WATER_LEVEL - 0.6); // the old bowl's shore, untouched
  });
  test("the bed stays up where the lodge stands and where the dam meets the water", () => {
    for (let r = 0; r <= 1.25; r += 0.05) for (let a = 0; a < Math.PI * 2; a += 0.1)
      expect(heightAt(POND.x + 0.6 + Math.cos(a) * r, POND.z + Math.sin(a) * r)).toBeGreaterThan(WATER_LEVEL - POND.depth - 0.15);
    expect(heightAt(SITE.x + 1.1 + 1, SITE.z)).toBeGreaterThan(WATER_LEVEL - 1);
  });
  test("the building site is flat", () => {
    const heights: number[] = [];
    for (let x = -1.2; x <= 1.2; x += 0.3) for (let z = -1.2; z <= 1.2; z += 0.3)
      if (Math.hypot(x, z) <= 1.2) heights.push(heightAt(SITE.x + x, SITE.z + z));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.02);
    expect(Math.min(...heights)).toBeGreaterThan(WATER_LEVEL);
  });
  test("the hill is about 3 m high, walkable from the clearing (≤ 25°) and steep on its far side", () => {
    expect(heightAt(HILL.x, HILL.z)).toBeGreaterThan(2.8);
    const toward = { x: -HILL.x, z: -HILL.z }, length = Math.hypot(toward.x, toward.z);
    let steepest = 0, far = 0;
    for (let r = 0; r < 9; r += 0.2) {
      steepest = Math.max(steepest, slopeAt(HILL.x + (toward.x / length) * r, HILL.z + (toward.z / length) * r));
      far = Math.max(far, slopeAt(HILL.x - (toward.x / length) * r, HILL.z - (toward.z / length) * r));
    }
    expect(steepest).toBeLessThan(Math.tan((25 * Math.PI) / 180));
    expect(far).toBeGreaterThan(1); // more than 45°
  });
  test("the edge is higher than the middle, all round; lower where the evening sun goes down", () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
      const x = Math.cos(a) * (RIM + 7), z = Math.sin(a) * (RIM + 7);
      expect(heightAt(x, z)).toBeGreaterThan(heightAt(0, 0) + (sunsetGap(x, z) > 0 ? 0.8 : 2.5));
    }
  });
  test("the clearing is about 66 m across: low meadow 28 m out, risen into bank beyond 40 m (but where the sun sets)", () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 32) {
      const out = (r: number) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });
      const meadow = out(28), bank = out(40);
      expect(heightAt(meadow.x, meadow.z)).toBeLessThan(1);
      if (sunsetGap(bank.x, bank.z) === 0) expect(heightAt(bank.x, bank.z)).toBeGreaterThan(3);
      // where the first clearing's bank stood 4 m high, it is meadow now
      const old = out(FIRST_RIM + 6);
      if (sunsetGap(old.x, old.z) === 0) expect(heightAt(old.x, old.z)).toBeLessThan(1);
    }
  });
  test("the evening sun, 6° to 17° high, reaches the middle of the clearing over the bank", () => {
    for (const hour of [18.5, 19, 19.5]) {
      const sun = dayAt(hour).sun, from = heightAt(0, 0) + 0.1;
      for (let s = 1; s < 70; s += 0.5) expect(heightAt(sun.x * s, sun.z * s)).toBeLessThan(from + sun.y * s);
    }
  });
});

test("the path leads from the spawn to the building site, and nothing stands or lies on it", () => {
  expect(pathAt(SPAWN.x, SPAWN.z)).toBe(1);
  expect(pathAt(SITE.x, SITE.z - SITE.radius)).toBeGreaterThan(0.8);
  for (const [x, z] of [[POND.x, POND.z], [POST.x, POST.z], [SHOP.x, SHOP.z], [10, -10], [-15, -5], [HILL.x, HILL.z]]) expect(pathAt(x!, z!)).toBe(0);
  // Mrs. Beaver's waiting spot and her clues (the dropped flower, the tracks) stay in the grass.
  for (const { x, z } of [HOME, ...FLOWER, ...TRACKS]) expect(pathAt(x, z)).toBe(0);
  const { tree, stump, log, rock, crate } = placeAll();
  for (const { x, z } of [...tree, ...stump, ...log, ...rock, ...crate]) expect(pathAt(x, z)).toBeLessThan(0.3);
});

describe("placement", () => {
  const layout = placeAll();
  const wet = (s: { x: number; z: number }) => heightAt(s.x, s.z) <= WATER_LEVEL || pondRatio(s.x, s.z) < 1.1;
  test("is the same every time", () => expect(placeAll()).toEqual(layout));
  test("has what the world promises", () => {
    const first = layout.tree.filter((t) => Math.hypot(t.x, t.z) < FIRST_RIM);
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(first.length).toBeLessThanOrEqual(15);
    expect(layout.tree.some((t) => Math.hypot(t.x - POND.x, t.z - POND.z) < POND.radius + 3)).toBe(true);
    expect(layout.crate).toHaveLength(3);
    expect(layout.stick).toHaveLength(20);
    expect(layout.reed.length).toBeGreaterThan(10);
  });
  test("nothing dry stands in the pond, nothing solid on the site", () => {
    for (const s of [...layout.tree, ...layout.stump, ...layout.log, ...layout.rock, ...layout.crate, ...layout.stick]) expect(wet(s)).toBe(false);
    for (const s of [...layout.tree, ...layout.stump, ...layout.log, ...layout.rock])
      expect(Math.hypot(s.x - SITE.x, s.z - SITE.z)).toBeGreaterThan(SITE.radius);
  });
  test("reeds grow at the water's edge", () => {
    for (const s of layout.reed) expect(Math.abs(heightAt(s.x, s.z) - WATER_LEVEL)).toBeLessThan(0.4);
  });
  test("sticks lie on dry ground inside the clearing, with the sizes asked for", () => {
    for (const s of layout.stick) {
      expect(heightAt(s.x, s.z)).toBeGreaterThan(WATER_LEVEL);
      expect(Math.hypot(s.x, s.z)).toBeLessThan(RIM);
      expect(s.scale).toBeGreaterThanOrEqual(0.5);
      expect(s.scale).toBeLessThanOrEqual(0.8);
      expect(s.thickness!).toBeGreaterThanOrEqual(0.03);
      expect(s.thickness!).toBeLessThanOrEqual(0.05);
    }
  });
  test("rocks and a sunken log lie down in the deep basin", () => {
    expect(layout.bedRock.length).toBeGreaterThanOrEqual(3);
    expect(layout.sunkenLog).toHaveLength(1);
    for (const s of [...layout.bedRock, ...layout.sunkenLog]) expect(heightAt(s.x, s.z)).toBeLessThan(WATER_LEVEL - 1.2);
  });
  test("the trees a saved game knows stand where they stood, in the same order", () => {
    // The first clearing's 13 trees, as they were placed before it grew: a saved game names a tree by its index.
    const first = [[8.4, 8.9], [7.996, -10.654], [-1.902, 12.936], [8.1, -9.133], [0.007, 14.423], [-0.3, -11.186], [4.026, 11.7],
      [-5.041, -11.98], [12.195, 0.295], [4.904, -8.02], [-7.736, -5.069], [5.474, 12.801], [-14.012, 1.081]];
    first.forEach(([x, z], i) => {
      expect(layout.tree[i]!.x).toBeCloseTo(x!, 3);
      expect(layout.tree[i]!.z).toBeCloseTo(z!, 3);
    });
  });
  test("the far meadow has trees to fell: after the first ones, inside the clearing, on dry walkable ground, apart", () => {
    const ring = layout.tree.slice(13);
    const far = layout.tree.filter((t) => Math.hypot(t.x, t.z) > FIRST_RIM);
    expect(ring.length).toBeGreaterThanOrEqual(25); // about the first meadow's density over three times its area
    expect(far).toEqual(ring); // the new ones come after the old, and only they stand out there
    for (const t of ring) {
      expect(Math.hypot(t.x, t.z)).toBeLessThan(RIM);
      expect(heightAt(t.x, t.z)).toBeGreaterThan(WATER_LEVEL + 0.05);
      expect(heightAt(t.x, t.z)).toBeLessThan(1.2);
      expect(slopeAt(t.x, t.z)).toBeLessThan(0.5);
      for (const other of layout.tree) if (other !== t) expect(Math.hypot(other.x - t.x, other.z - t.z)).toBeGreaterThan(3);
      for (const p of [POND, SITE, SHOP, POST]) expect(Math.hypot(p.x - t.x, p.z - t.z)).toBeGreaterThan(5);
    }
    for (const s of [...layout.stump, ...layout.log, ...layout.rock]) expect(Math.hypot(s.x, s.z)).toBeLessThan(RIM);
    expect(layout.stump.filter((s) => Math.hypot(s.x, s.z) > FIRST_RIM).length).toBeGreaterThan(4);
    expect(layout.log.filter((s) => Math.hypot(s.x, s.z) > FIRST_RIM).length).toBeGreaterThan(3);
    expect(layout.rock.filter((s) => Math.hypot(s.x, s.z) > FIRST_RIM).length).toBeGreaterThan(3);
  });
  test("loose sticks stay near the pond and the building site", () => {
    for (const s of layout.stick) expect(Math.hypot(s.x, s.z)).toBeLessThan(FIRST_RIM);
  });
  test("the far forest stands beyond the bank, and the ground is drawn under it", () => {
    for (const t of layout.farTree) {
      expect(Math.hypot(t.x, t.z)).toBeGreaterThan(RIM + 3);
      expect(Math.max(Math.abs(t.x), Math.abs(t.z))).toBeLessThan(SIZE / 2 - 2);
    }
  });
  test("the spawn is clear and dry", () => {
    expect(wet(SPAWN)).toBe(false);
    for (const s of [...layout.tree, ...layout.rock, ...layout.stump, ...layout.log]) expect(Math.hypot(s.x - SPAWN.x, s.z - SPAWN.z)).toBeGreaterThan(1.5);
  });
});

describe("the ground as drawn and collided", () => {
  test("follows heightAt over the whole clearing and its bank", () => {
    let worst = 0;
    for (let x = -RIM - 8; x < RIM + 8; x += 0.37) for (let z = -RIM - 8; z < RIM + 8; z += 0.41)
      if (pondRatio(x, z) > 1.3) worst = Math.max(worst, Math.abs(groundAt(x, z) - heightAt(x, z)));
    expect(worst).toBeLessThan(0.1);
  });
  test("follows heightAt within 0.1 m all over the pond, the basin's walls too", () => {
    let worst = 0;
    for (let x = POND.x - 5; x < POND.x + 5; x += 0.02) for (let z = POND.z - 5; z < POND.z + 5; z += 0.02)
      if (pondRatio(x, z) < 1.3) worst = Math.max(worst, Math.abs(groundAt(x, z) - heightAt(x, z)));
    expect(worst).toBeLessThan(0.1);
  });
  test("its colliders are where it is drawn, and a beaver set down anywhere in the pond stays on the bed", async () => {
    const { scene, physics } = await headless();
    groundColliders(physics, scene);
    physics.step(1 / 60);
    const down = { x: 0, y: -1, z: 0 };
    for (let x = POND.x - 4.4; x < POND.x + 4.4; x += 0.37) for (let z = POND.z - 4.4; z < POND.z + 4.4; z += 0.37) {
      const hit = physics.ray({ x, y: 20, z }, down, 40)!;
      expect(Math.abs(20 - hit.distance - groundAt(x, z))).toBeLessThan(0.002);
    }
    // As the player's capsule (src/player/index.ts: 1 m tall, 0.45 m wide, a gap of 0.02 m), set down as teleport()
    // does at heightAt (the game's teleports use groundAt, placement rules heightAt), then dived straight down for a
    // second, then swum level a second: it stays on the bed.
    const HEIGHT = 1, RADIUS = 0.225, OFFSET = 0.02;
    const mover = createMover(physics, capsule(scene, HEIGHT / 2 - RADIUS, RADIUS), { gap: OFFSET, slope: Math.PI / 4, mass: 12 });
    let lowest = Infinity;
    for (let x = POND.x - 4; x < POND.x + 4; x += 0.29) for (let z = POND.z - 4; z < POND.z + 4; z += 0.29) {
      if (pondRatio(x, z) > 1) continue;
      const at = { x, y: heightAt(x, z) + HEIGHT / 2 + OFFSET, z };
      const a = x * 7 + z * 3;
      for (let i = 0; i < 60; i++) {
        const { moved } = mover.move(at, i < 30 ? { x: 0, y: -0.1, z: 0 } : { x: 0.06 * Math.cos(a), y: 0, z: 0.06 * Math.sin(a) }, 0);
        at.x += moved.x; at.y += moved.y; at.z += moved.z;
      }
      lowest = Math.min(lowest, at.y - HEIGHT / 2 - OFFSET - groundAt(at.x, at.z));
    }
    expect(lowest).toBeGreaterThan(-0.05);
    // The camera's ball, cast level from the basin's floor (along a grid line too), meets the wall.
    const sphere = ball(scene, 0.18);
    for (const x of [4.5, 4.53]) {
      const hit = physics.cast(sphere, Quaternion.Identity(), { x, y: groundAt(x, 3) + 0.5, z: 3 }, { x: 0, y: 0, z: -1 }, 3);
      expect(hit?.distance).toBeLessThan(1);
    }
  }, 60_000); // about 5 s here and 8 to 12 s on GitHub's machines: over bun's 5 s
});

test("the heightfield: heights[k + m * n] is sample k along x and m along z, centred", async () => {
  const { scene, physics } = await headless(), n = 3, heights = new Float32Array(n * n);
  for (let m = 0; m < n; m++) for (let k = 0; k < n; k++) heights[k + m * n] = m + 10 * k;
  physics.fixed(heightfield(scene, n, 4, heights), GROUND);
  physics.step(1 / 60);
  const down = (x: number, z: number) => 50 - physics.ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }, 100)!.distance;
  // Just inside the corners (rays on the very edge miss): within the slope's 10 m a sample's 0.1 m.
  expect(Math.abs(down(-1.99, -1.99) - 0)).toBeLessThan(0.1); // k 0, m 0
  expect(Math.abs(down(1.99, -1.99) - 20)).toBeLessThan(0.1); // last along x
  expect(Math.abs(down(-1.99, 1.99) - 2)).toBeLessThan(0.1); // last along z
  expect(down(0, 0)).toBeCloseTo(11, 3); // the middle sample
});
