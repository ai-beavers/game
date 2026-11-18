// Where everything in the world goes: plain numbers from a seeded random and a few rules, the same on every load.
// Placement is deterministic for saved games and all network peers.
//
//   const layout = placeAll();     layout.tree / .rock / … : lists of Spot; layout.spawn
//
// Rules: trees ring the clearing and one stands near the pond; nothing solid stands in the water or on the building
// site; reeds grow in the shallow edge of the pond; sticks lie under trees, on the shore and by the site; the
// crates wait at the site. Bushes and far trees fill the bank and the land behind it (seen, not walked).
import { fbm, seeded } from "./noise.ts";
import { HILL, POND, RIM, SITE, WATER_LEVEL, heightAt, pondRatio, slopeAt, sunsetGap } from "./terrain.ts";

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
}

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
  const steep = scatter(4, 1.5, 4, (x, z) => slopeAt(x, z) > 0.55 && Math.hypot(x, z) < RIM && free(x, z, 0.7), HILL);
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

  // The thicket on the bank and the forest behind it, open where the evening sun goes down.
  const bush = scatter(260, RIM - 1, RIM + 7, (x, z) => heightAt(x, z) > 0.45 && dist(HILL, x, z) > 2.5 && dist(pondTree, x, z) > 2
    && sunsetGap(x, z) < 0.5).map((p) => spot(p, 0.8 + random() * 0.9, 3));
  const farTree = scatter(110, RIM + 4, RIM + 26, (x, z) => sunsetGap(x, z) === 0).map((p) => spot(p, 0.9 + random() * 0.6, 5));
  return { tree, stump, log, rock, reed, crate, stick, bush, farTree };
}
