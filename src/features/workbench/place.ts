// Where the workbench stands and where the beaver works at it: plain numbers, so the bots (net/botworld.ts) steer
// round it as the beaver bumps into it. In the open some 3 m past the trading post's first end (the pinecone's), on
// the same low flat ground, its working side facing the spawn as the post's counter does: a beaver buying goods there turns
// and finds it. Clear of the post's spots and the ways to them, the bakery's way, the building site and Mrs. Beaver's
// ways, flowers and tracks.
//
//   atBench(x, z)      whether feet at (x, z) stand at the bench to work at it: on its working side, within reach
//   STAND · FACING     where the feet stand to work, and the way the beaver faces then
//   footprint()        a circle over the bench, for steering
import { SPAWN } from "../../world/place.ts";

/** The bench: a broad tree stump with a flat top. Its middle, the top's radius and the top's height above the ground, m. */
export const BENCH = { x: 3.9, z: -1.7, radius: 0.36, top: 0.36 };
const toSpawn = Math.hypot(SPAWN.x - BENCH.x, SPAWN.z - BENCH.z);
/** The bench's working side (unit, on the ground): towards the spawn. */
export const FRONT = { x: (SPAWN.x - BENCH.x) / toSpawn, z: (SPAWN.z - BENCH.z) / toSpawn };
/** Across the bench, to the right of a beaver facing it (as the bakery's ALONG). */
export const ALONG = { x: FRONT.z, z: -FRONT.x };
/** Where the feet stand to work at it: just off its edge on the working side. */
export const STAND = { x: BENCH.x + FRONT.x * (BENCH.radius + 0.35), z: BENCH.z + FRONT.z * (BENCH.radius + 0.35) };
/** Radians the beaver faces (as Player.facing: atan2(x, z)) to look at the bench. */
export const FACING = Math.atan2(-FRONT.x, -FRONT.z);
const REACH = 0.55; // m the feet may be from STAND

/** Whether a beaver with its feet at (x, z) stands at the bench to work: on its working side, within reach. */
export function atBench(x: number, z: number): boolean {
  const front = (x - BENCH.x) * FRONT.x + (z - BENCH.z) * FRONT.z;
  return front >= BENCH.radius && Math.hypot(x - STAND.x, z - STAND.z) < REACH;
}

/** A circle over the bench, roots and all, for whatever steers round it. */
export const footprint = () => [{ x: BENCH.x, z: BENCH.z, r: BENCH.radius + 0.12 }];
