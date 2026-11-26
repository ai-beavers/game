// Where the bakery stands and where the beaver feeds its oven: plain numbers, so the bots (net/botworld.ts) steer
// round it as the beaver bumps into it. On flat open ground south-east of the spawn, east of Mrs. Beaver's way south,
// clear of the building site, the trading post, the Shop and its Calendar board, the Flag, the Old Beaver's place,
// and Mrs. Beaver's ways, flowers and tracks.
// The hut is open to the front, which faces the spawn; the stone oven stands inside against its back wall.
//
//   atOven(x, z)       whether feet at (x, z) stand at the oven's mouth to feed it: in front of the hut, within reach
//   STAND · FACING     where the feet stand to feed it, and the way the beaver faces then
//   footprint()        circles over the hut, for steering
import { SPAWN } from "../../world/place.ts";

/** The hut: its middle, its width across the front, its depth front to back and its walls' height, m. */
export const HUT = { x: 4.8, z: -10.2, width: 2.0, depth: 1.4, wall: 1.25 };
const toSpawn = Math.hypot(SPAWN.x - HUT.x, SPAWN.z - HUT.z);
/** The way the hut's open front faces (unit, on the ground): towards the spawn, so a beaver coming from there sees
 *  into it. */
export const FRONT = { x: (SPAWN.x - HUT.x) / toSpawn, z: (SPAWN.z - HUT.z) / toSpawn };
/** Across the front, to the right of a beaver facing the hut. */
export const ALONG = { x: FRONT.z, z: -FRONT.x };
/** The oven, in the hut's frame (m along FRONT from the hut's middle): its middle, its dome's radius, its mouth. */
export const OVEN = { back: -0.2, radius: 0.5, mouth: 0.3 };

const at = (along: number, front: number) => ({ x: HUT.x + ALONG.x * along + FRONT.x * front, z: HUT.z + ALONG.z * along + FRONT.z * front });
/** Where the feet stand to feed the oven: just outside the hut's open front, before the oven's mouth. */
export const STAND = at(0, HUT.depth / 2 + 0.3);
/** Radians the beaver faces (as Player.facing: atan2(x, z)) to look into the oven. */
export const FACING = Math.atan2(-FRONT.x, -FRONT.z);
/** The oven's mouth on the ground's plan, where a stick flies into. */
export const MOUTH = at(0, OVEN.mouth);
const REACH = 0.55; // m the feet may be from STAND

/** Whether a beaver with its feet at (x, z) stands at the oven to feed it: in front of the hut, within reach. */
export function atOven(x: number, z: number): boolean {
  const front = (x - HUT.x) * FRONT.x + (z - HUT.z) * FRONT.z;
  return front >= HUT.depth / 2 && Math.hypot(x - STAND.x, z - STAND.z) < REACH;
}

/** Circles over the hut, a grid of six, for whatever steers round it. */
export const footprint = () => [-0.55, 0.55].flatMap((a) => [-0.35, 0.35].map((f) => ({ ...at(a, f), r: 0.65 })))
  .concat([{ ...at(0, -0.35), r: 0.65 }, { ...at(0, 0.35), r: 0.65 }]);
