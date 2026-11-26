// Where the trading post stands and where its spots are: plain numbers, so the bots (net/botworld.ts) steer round
// it as the beaver bumps into it. On flat open ground between the spawn and the pond's south bank, about 5 m from the
// building site, its counter facing the spawn: the dam's prompts and hints never reach it.
//
//   spotAt(i) · standAt(i)       the middle of good i's spot on the counter, and where a beaver stands to pay at it
//   spotFor(x, z)                the spot whose standing place is under the feet (nearest), or undefined
//   footprint()                  circles over the counter, for steering
import { SPAWN } from "../../world/place.ts";
import { POST_GOODS as GOODS } from "./ledger.ts";

/** The counter: its middle, length along it, depth front to back, height of its top above the ground, m. */
export const POST = { x: 1.3, z: -0.2, length: 2.3, depth: 0.55, top: 0.32 };
const toSpawn = Math.hypot(SPAWN.x - POST.x, SPAWN.z - POST.z);
/** The way the counter faces (unit, on the ground): towards the spawn, so a beaver coming from there sees it. */
export const FRONT = { x: (SPAWN.x - POST.x) / toSpawn, z: (SPAWN.z - POST.z) / toSpawn };
/** Along the counter, from its first spot to its last: to the right of a beaver facing it. */
export const ALONG = { x: FRONT.z, z: -FRONT.x };
/** m between the spots' middles. */
export const SPOT_GAP = 0.75;
/** m from the counter's front edge to where a beaver's feet stand to pay, and how far from there they may be. */
const STAND = 0.4, STAND_REACH = 0.5;

const at = (along: number, front: number) => ({ x: POST.x + ALONG.x * along + FRONT.x * front, z: POST.z + ALONG.z * along + FRONT.z * front });
/** The middle of spot i (one per good, in GOODS order) on the counter's top, on the ground's plan. */
export const spotAt = (i: number) => at((i - 1) * SPOT_GAP, 0);
/** Where the feet stand to pay at spot i: in front of it. */
export const standAt = (i: number) => at((i - 1) * SPOT_GAP, POST.depth / 2 + STAND);
/** Radians the beaver faces (as Player.facing: atan2(x, z)) to look at the counter. */
export const FACING = Math.atan2(-FRONT.x, -FRONT.z);

/** The spot a beaver with its feet at (x, z) pays at: the nearest whose standing place is within reach, and only
 *  from in front of the counter. */
export function spotFor(x: number, z: number): number | undefined {
  const front = (x - POST.x) * FRONT.x + (z - POST.z) * FRONT.z;
  if (front < POST.depth / 2) return undefined;
  let best: number | undefined, gap = STAND_REACH;
  for (let i = 0; i < GOODS.length; i++) {
    const s = standAt(i), d = Math.hypot(s.x - x, s.z - z);
    if (d < gap) { gap = d; best = i; }
  }
  return best;
}

/** Circles over the counter, every half metre along it, for whatever steers round it. */
export const footprint = () => [-1, -0.5, 0, 0.5, 1].map((d) => ({ ...at(d * (POST.length / 2 - 0.15), 0), r: POST.depth / 2 + 0.1 }));
