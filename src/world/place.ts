// Where everything in the world goes: plain numbers from a seeded random and a few rules, the same on every load.
// Placement is deterministic for saved games and all network peers.
//
//   const layout = placeAll();     layout.tree / .rock / … : lists of Spot; layout.spawn
//
// Rules: trees ring the clearing and one stands near the pond; nothing solid stands in the water or on the building
// site; reeds grow in the shallow edge of the pond; sticks lie under trees, on the shore and by the site; the
// crates wait at the site. Bushes and far trees fill the bank and the land behind it (seen, not walked). Rocks and a
// sunken log lie down in the pond's deep basin. The wide ring of meadow the clearing grew by gets trees, stumps, logs
// and rocks of its own, at the inner meadow's density.
//
// Saved games name trees by their index in `tree`: what was placed before the clearing grew is placed as it was,
// against the ground as it was then (FIRST_RIM), and the ring's things come after it from a random of their own.
import { fbm, seeded } from "./noise.ts";
import { SHOP, SHOP_CLEAR } from "../features/shop/place.ts";
import { BASIN, FIRST_RIM, HILL, POND, RIM, SITE, WATER_LEVEL, heightAt as groundNow, pondRatio, shape, slopeAt as slopeNow, sunsetGap } from "./terrain.ts";

/** The ground the first clearing's things were placed on: its bank started at FIRST_RIM. */
const { heightAt, slopeAt } = shape(FIRST_RIM);

export interface Spot {
  x: number; z: number;
  /** Turn around y, radians. */
  turn: number;
  /** Uniform size factor; for sticks the length in metres. */
  scale: number;
  /** Which variant of the template list. */
  variant: number;
  /** Sticks only: thickness in metres. */
  thickness?: number;
}

export const SPAWN = { x: -1.5, z: -3 };

export interface Layout {
  tree: Spot[]; stump: Spot[]; log: Spot[]; rock: Spot[]; reed: Spot[]; crate: Spot[]; stick: Spot[];
  bush: Spot[]; farTree: Spot[];
  /** Under water, in the deep basin: rocks on its bed, a sunken log. */
  bedRock: Spot[]; sunkenLog: Spot[];
}

/** How many of each the ring gets: the first meadow's 13 trees, 4 stumps, 3 logs and 3 rocks in the grass, for three
 *  times its area. */
const RING = { tree: 36, stump: 12, log: 9, rock: 9 };

const dist = (a: { x: number; z: number }, x: number, z: number) => Math.hypot(a.x - x, a.z - z);

export function placeAll(seed = 42): Layout {
  const random = seeded(seed);
  const solid: { x: number; z: number; r: number }[] = []; // footprints that block other solid things
  const free = (x: number, z: number, r: number) => solid.every((s) => Math.hypot(s.x - x, s.z - z) > s.r + r);
  const dry = (x: number, z: number, margin = 0.05) => heightAt(x, z) > WATER_LEVEL + margin && pondRatio(x, z) > 1.15;
  const offSite = (x: number, z: number, extra = 0) => dist(SITE, x, z) > SITE.radius + 0.6 + extra;
  const offSpawn = (x: number, z: number, r = 2.5) => dist(SPAWN, x, z) > r;
  const variant = (n: number) => Math.floor(random() * n);
  /** Tries random points in a ring until `count` pass the test or the tries run out. */
  const scatter = (count: number, rMin: number, rMax: number, test: (x: number, z: number) => boolean,
                   around = { x: 0, z: 0 }, tries = 4000) => {
    const out: { x: number; z: number }[] = [];
    for (let i = 0; i < tries && out.length < count; i++) {
      const a = random() * Math.PI * 2, r = Math.sqrt(rMin * rMin + random() * (rMax * rMax - rMin * rMin));
      const x = around.x + Math.cos(a) * r, z = around.z + Math.sin(a) * r;
      if (test(x, z)) out.push({ x, z });
    }
    return out;
  };
  const spot = (p: { x: number; z: number }, scale: number, variants: number, extra: Partial<Spot> = {}): Spot =>
    ({ x: p.x, z: p.z, turn: random() * Math.PI * 2, scale, variant: variant(variants), ...extra });

  // One tree near the pond, on the side away from the site, leaning its crown over the water.
  const pondTree = { x: POND.x + 3.4, z: POND.z + 3.9 };
  solid.push({ ...pondTree, r: 2.2 });
  const tree: Spot[] = [spot(pondTree, 1.05, 3)];
  for (const p of scatter(12, 9, 15, (x, z) => dry(x, z) && pondRatio(x, z) > 1.7 && offSite(x, z, 3) && offSpawn(x, z, 5)
    && slopeAt(x, z) < 0.45 && free(x, z, 2.6))) {
    solid.push({ ...p, r: 2.6 });
    tree.push(spot(p, 0.85 + random() * 0.4, 5));
  }

  const stump = scatter(4, 5, 14, (x, z) => dry(x, z) && offSite(x, z) && offSpawn(x, z) && slopeAt(x, z) < 0.3 && free(x, z, 0.8))
    .map((p) => (solid.push({ ...p, r: 0.6 }), spot(p, 0.9 + random() * 0.3, 2)));
  const log = scatter(3, 4, 13, (x, z) => dry(x, z, 0.1) && offSite(x, z, 0.8) && offSpawn(x, z, 3) && slopeAt(x, z) < 0.2 && free(x, z, 1.5))
    .map((p) => (solid.push({ ...p, r: 1.3 }), spot(p, 1, 2)));

  // Rocks: on the steep side of the hill, on the pond's shore, a few in the grass.
  const steep = scatter(4, 1.5, 4, (x, z) => slopeAt(x, z) > 0.55 && Math.hypot(x, z) < FIRST_RIM && free(x, z, 0.7), HILL);
  const shore = scatter(3, 4.3, 5.6, (x, z) => dry(x, z, 0.02) && offSite(x, z, 0.5) && free(x, z, 0.7), POND);
  const meadow = scatter(3, 3, 14, (x, z) => dry(x, z) && offSite(x, z) && offSpawn(x, z) && free(x, z, 0.8));
  const rock = [...steep, ...shore, ...meadow].map((p) => (solid.push({ ...p, r: 0.6 }), spot(p, 0.7 + random() * 0.7, 3)));

  // Reeds stand in the shallow water and on the wet edge, but leave the site's shore open to walk in.
  const reed = scatter(26, 2.6, 5.2, (x, z) => {
    const h = heightAt(x, z);
    return h > WATER_LEVEL - 0.35 && h < WATER_LEVEL + 0.08 && dist(SITE, x, z) > SITE.radius + 1.6 && dist(pondTree, x, z) > 1
      && fbm(x * 0.6, z * 0.6, 2) > -0.15;
  }, POND).map((p) => spot(p, 0.8 + random() * 0.5, 2));

  // Three crates on the flat of the building site, at its back (west), clear of the dam by the water.
  const crate = [-0.95, 0, 0.95].map((a, i) => spot({ x: SITE.x + Math.cos(a + Math.PI) * (SITE.radius - 0.4 + i * 0.1),
    z: SITE.z + Math.sin(a + Math.PI) * (SITE.radius - 0.4 + i * 0.1) }, 1, 1));

  // Twenty sticks: under the trees, on the shore, by the site.
  const stickFree = (x: number, z: number) => dry(x, z, 0.04) && slopeAt(x, z) < 0.35 && solid.every((s) => Math.hypot(s.x - x, s.z - z) > Math.min(s.r, 0.9) + 0.4);
  const sticks = [
    ...tree.slice(0, 8).flatMap((t) => scatter(1, 1.2, 2.6, stickFree, t, 200)),
    ...scatter(6, 4.4, 6, (x, z) => stickFree(x, z) && offSite(x, z, 0), POND),
    ...scatter(6, SITE.radius + 0.3, SITE.radius + 2.2, stickFree, SITE),
  ];
  for (const p of scatter(20, 2, 13, stickFree)) if (sticks.length < 20) sticks.push(p);
  const stick = sticks.slice(0, 20).map((p) => spot(p, 0.5 + random() * 0.3, 2, { thickness: 0.03 + random() * 0.02 }));

  // The thicket on the bank and the forest behind it, open where the evening sun goes down: at the bank as it is now,
  // as thick along it as round the first clearing. Seen, not walked, not saved: they may move with the bank.
  const bush = scatter(520, RIM - 1, RIM + 7, (x, z) => groundNow(x, z) > 0.45 && sunsetGap(x, z) < 0.5, undefined, 8000)
    .map((p) => spot(p, 0.8 + random() * 0.9, 3));
  const farTree = scatter(190, RIM + 4, RIM + 26, (x, z) => sunsetGap(x, z) === 0).map((p) => spot(p, 0.9 + random() * 0.6, 5));

  // Down in the deep basin: a few rocks fallen from the drop-off and a sunken log on the floor, lengthwise. Their own
  // random, after everything else, so nothing above moves.
  const deep = seeded(seed + 1), bedRock: Spot[] = [];
  const sunkenLog: Spot[] = [{ x: BASIN.x + 0.5, z: BASIN.z + 0.05, turn: Math.atan2(1, -0.25) + 0.3, scale: 1, variant: 0 }]; // the variant of the meadow's logs: drawn with them
  for (let i = 0; i < 400 && bedRock.length < 4; i++) {
    const x = BASIN.x + (deep() * 2 - 1) * BASIN.along, z = BASIN.z + (deep() * 2 - 1) * BASIN.across * 1.4;
    if (heightAt(x, z) < WATER_LEVEL - 1.3 && [...bedRock, ...sunkenLog].every((r) => dist(r, x, z) > 1))
      bedRock.push({ x, z, turn: deep() * Math.PI * 2, scale: 0.5 + deep() * 0.6, variant: Math.floor(deep() * 3) });
  }

  // The ring the clearing grew by: trees, stumps, logs and rocks as thick as in the first meadow, on walkable meadow
  // short of the bank, clear of everything above and of each other. Their own random, after everything else, and
  // after the first clearing's in each list, so nothing above moves and a saved game's tree i is the same tree.
  const ring = seeded(seed + 2), inRing = { from: FIRST_RIM, to: RIM - 2.5 };
  const meadowNow = (x: number, z: number, steep: number) => groundNow(x, z) > WATER_LEVEL + 0.1 && groundNow(x, z) < 1.1 && slopeNow(x, z) < steep && sunsetGap(x, z) < 0.5
    && dist(SHOP, x, z) > SHOP_CLEAR;
  /** Up to `count` places on the ring passing `test`, each `r` m clear of every solid thing, the ones placed here too. */
  const spread = (count: number, r: number, test: (x: number, z: number) => boolean) => {
    const out: { x: number; z: number }[] = [];
    for (let i = 0; i < count * 60 && out.length < count; i++) {
      const a = ring() * Math.PI * 2, d = Math.sqrt(inRing.from ** 2 + ring() * (inRing.to ** 2 - inRing.from ** 2));
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (test(x, z) && free(x, z, r)) { out.push({ x, z }); solid.push({ x, z, r }); }
    }
    return out;
  };
  const ringSpot = (p: { x: number; z: number }, scale: number, variants: number): Spot =>
    ({ x: p.x, z: p.z, turn: ring() * Math.PI * 2, scale, variant: Math.floor(ring() * variants) });
  tree.push(...spread(RING.tree, 2.6, (x, z) => meadowNow(x, z, 0.45)).map((p) => ringSpot(p, 0.85 + ring() * 0.4, 5)));
  stump.push(...spread(RING.stump, 0.7, (x, z) => meadowNow(x, z, 0.3)).map((p) => ringSpot(p, 0.9 + ring() * 0.3, 2)));
  log.push(...spread(RING.log, 1.4, (x, z) => meadowNow(x, z, 0.2)).map((p) => ringSpot(p, 1, 2)));
  rock.push(...spread(RING.rock, 0.7, (x, z) => meadowNow(x, z, 0.6)).map((p) => ringSpot(p, 0.7 + ring() * 0.7, 3)));
  return { tree, stump, log, rock, reed, crate, stick, bush, farTree, bedRock, sunkenLog };
}
