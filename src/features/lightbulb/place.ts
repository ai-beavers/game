// Where the Lightbulb's post stands and where the beaver pulls its cord: plain numbers, so the bots (net/botworld.ts)
// steer round it as the beaver bumps into it. Beside the workbench at the left hand of a beaver working there, between
// the bench, the trading post's first end and a rock of the meadow (the bench's other side has one of Mrs. Beaver's
// flowers), its arm reaching out to the spawn's side. Clear of the bench's working side, the post's spots and the ways
// to them, the bakery's way and Mrs. Beaver's ways, flowers and tracks.
//
//   atCord(x, z)       whether feet at (x, z) stand at the post within reach of its cord: in front of it, near STAND,
//                      not at the bench
//   STAND · FACING     where the feet stand to pull the cord, and the way the beaver faces then
//   footprint()        a circle over the post, for steering
import { ALONG as BENCH_ALONG, atBench, BENCH, FRONT as BENCH_FRONT } from "../workbench/place.ts";

/** The crooked post: its foot on the ground, how tall it stands, and the arm at its top the bulb hangs from, m. */
export const POST = {
  x: BENCH.x + BENCH_ALONG.x * 0.85 + BENCH_FRONT.x * 0.72,
  z: BENCH.z + BENCH_ALONG.z * 0.85 + BENCH_FRONT.z * 0.72,
  radius: 0.06, height: 1.35, arm: 0.32,
};
const out = { x: BENCH_FRONT.x + BENCH_ALONG.x * 0.2, z: BENCH_FRONT.z + BENCH_ALONG.z * 0.2 }, length = Math.hypot(out.x, out.z);
/** The post's front (unit, on the ground): the way its arm reaches and the cord hangs, out from the bench's corner
 *  towards the spawn's side and a little away from the bench, so the beaver pulls it standing beside the bench and a
 *  beaver walking up to the bench never comes within reach of the cord on its way. */
export const FRONT = { x: out.x / length, z: out.z / length };
/** Where the feet stand to pull the cord: just under it, in front of the post. */
export const STAND = { x: POST.x + FRONT.x * (POST.arm + 0.25), z: POST.z + FRONT.z * (POST.arm + 0.25) };
/** Radians the beaver faces (as Player.facing: atan2(x, z)) to look at the post. */
export const FACING = Math.atan2(-FRONT.x, -FRONT.z);
const REACH = 0.4; // m the feet may be from STAND

/** Whether a beaver with its feet at (x, z) can pull the cord: in front of the post, within reach of STAND. Where the
 *  bench could be worked at too (the strip between the two), the bench has it: E there never does two things. */
export function atCord(x: number, z: number): boolean {
  const front = (x - POST.x) * FRONT.x + (z - POST.z) * FRONT.z;
  return front >= POST.radius + 0.1 && Math.hypot(x - STAND.x, z - STAND.z) < REACH && !atBench(x, z);
}

/** A circle over the post's foot, for whatever steers round it. */
export const footprint = () => [{ x: POST.x, z: POST.z, r: POST.radius + 0.12 }];
