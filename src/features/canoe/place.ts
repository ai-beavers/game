// Where the canoe lies and where the beaver goes getting in and out: plain numbers from the pond, the spawn and the
// ground's height, so they can be tested alone.
//
//   bankPlace(pond, spawn, heightAt, level)        where it lies pulled up on the bank at the start, bow to the water
//   launch(from, heading, heightAt, level)         the first place along its heading where it floats with the beaver in
//   wayOut(at, facing, heightAt, level)            where the beaver steps out: the bank if it is near, else the water
//   beside(feet, canoe)                            whether the feet are near enough to get in

import { SLOPE } from "../../player/state.ts";

export interface Place { x: number; z: number }
export type HeightAt = (x: number, z: number) => number;

/** The hull, m: length, beam, and how deep its keel lies under the water's surface afloat. */
export const HULL = { length: 2, beam: 0.6, keel: 0.1 };
/** Where the beaver sits in it: m behind the hull's middle, and its feet above the surface (on the floor). */
export const SEAT = { back: 0.15, height: -0.08 };
/** m ahead of the feet that must still be in water at least DRAFT deep: the bow, a little short of its tip. */
export const BOW = 1.0, DRAFT = 0.12;
/** m of water the seat needs under it: the hull's draft and a little more (Player.ride stops it where there is less). */
export const DEPTH = 0.25;
/** A little more for where it is launched, so the ground's colliders (finer than heightAt) never stop it at once. */
const FLOATS = DEPTH + 0.05;
/** Radians from the line pond → spawn, round towards the south: the canoe lies beside the way from the spawn to the
 *  pond's middle, not on it, and away from the trading post and the building site. */
const ASIDE = 0.5;
/** m of the hull that lie on dry ground, pulled up. */
const PULLED_UP = 0.55;

/** m from the hull's middle line within which the beaver can get in. */
const NEAR = 1.0;

const forward = (heading: number) => ({ x: Math.sin(heading), z: Math.cos(heading) });

/** The middle of the canoe on the bank and its heading (radians, as Player.facing: atan2(x, z)), bow to the pond's
 *  middle: on the shore line of the side facing the spawn, a little round to one side. */
export function bankPlace(pond: Place & { radius: number }, spawn: Place, heightAt: HeightAt, level: number) {
  const toSpawn = Math.atan2(spawn.z - pond.z, spawn.x - pond.x) + ASIDE, out = { x: Math.cos(toSpawn), z: Math.sin(toSpawn) };
  let r = pond.radius * 0.5;
  while (r < pond.radius * 2 && heightAt(pond.x + out.x * r, pond.z + out.z * r) <= level + 0.02) r += 0.05;
  r += PULLED_UP;
  return { x: pond.x + out.x * r, z: pond.z + out.z * r, heading: Math.atan2(-out.x, -out.z) };
}

/** Whether the canoe floats with the beaver's feet at `feet` facing `heading`: deep at the seat, the bow in the water. */
export function floats(feet: Place, heading: number, heightAt: HeightAt, level: number) {
  const f = forward(heading);
  return level - heightAt(feet.x, feet.z) > FLOATS && level - heightAt(feet.x + f.x * BOW, feet.z + f.z * BOW) > DRAFT;
}

/** Where the beaver's feet go getting in at a canoe whose middle is at `from`: there if it floats, else pushed off
 *  along its heading until it does (at most 6 m), so a canoe on the bank is launched. undefined: nowhere floats. */
export function launch(from: Place, heading: number, heightAt: HeightAt, level: number): Place | undefined {
  const f = forward(heading);
  for (let d = -SEAT.back; d < 6; d += 0.1) {
    const feet = { x: from.x + f.x * d, z: from.z + f.z * d };
    if (floats(feet, heading, heightAt, level)) return feet;
  }
  return undefined;
}

/** Where the beaver's feet go getting out of the canoe, its feet at `at` facing `facing`. "bank": dry ground ahead of
 *  the bow or beside the hull is near, the feet go a little onto it. "water": out on the pond, beside the hull on its
 *  deeper side. */
export function wayOut(at: Place, facing: number, heightAt: HeightAt, level: number): Place & { outcome: "bank" | "water" } {
  const f = forward(facing), left = { x: f.z, z: -f.x }, right = { x: -f.z, z: f.x };
  // Dry, and flat enough to stand on: 5° short of the steepest the beaver walks up (SLOPE), round the feet.
  const flat = (x: number, z: number) => { const e = 0.2, h = heightAt(x, z), steep = Math.tan(SLOPE - 5 * Math.PI / 180) * e;
    return [[e, 0], [-e, 0], [0, e], [0, -e]].every(([dx, dz]) => Math.abs(heightAt(x + dx!, z + dz!) - h) < steep); };
  const dry = (x: number, z: number) => heightAt(x, z) > level + 0.03 && flat(x, z);
  // Ahead from past the bow's tip, beside from past the hull's side, nearest first.
  const ways = [{ d: f, from: HULL.length / 2 + SEAT.back + 0.3 }, { d: right, from: 0.6 }, { d: left, from: 0.6 }];
  let best: (Place & { far: number }) | undefined;
  for (const { d, from } of ways) for (let k = from; k < from + 1.4; k += 0.1) {
    if (!dry(at.x + d.x * k, at.z + d.z * k)) continue;
    const far = k - from;
    const x = at.x + d.x * (k + 0.25), z = at.z + d.z * (k + 0.25);
    if (!flat(x, z)) continue;
    if (!best || far < best.far) best = { x, z, far };
    break;
  }
  if (best) return { x: best.x, z: best.z, outcome: "bank" };
  const side = [left, right].map((d) => ({ x: at.x + d.x * 0.85, z: at.z + d.z * 0.85 }));
  const deeper = side.reduce((a, b) => heightAt(b.x, b.z) < heightAt(a.x, a.z) ? b : a);
  return { ...deeper, outcome: "water" };
}

/** Whether feet at `feet` are beside the canoe lying at `canoe` (its middle and heading): within NEAR of its middle
 *  line, from stern to bow. */
export function beside(feet: Place, canoe: Place & { heading: number }) {
  const f = forward(canoe.heading), dx = feet.x - canoe.x, dz = feet.z - canoe.z;
  const along = Math.max(-HULL.length / 2, Math.min(HULL.length / 2, dx * f.x + dz * f.z));
  return Math.hypot(dx - f.x * along, dz - f.z * along) < NEAR;
}
