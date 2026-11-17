// Where the feet go: the stride as a plan for each foot, from speed alone. Pure numbers, no bones; the animator
// puts the ankles there with IK (ik.ts). Phase runs 0 … 1 per double step; a foot is planted for the first `duty`
// of its phase and moves backwards at exactly ground speed, so it stands still in the world.
//
//   const g = gait(speed, anger);   phase += metresWalked / g.cycle;   foot(phase, g) → { z, lift, planted }
import { WALK_SPEED } from "../contracts.ts";
import { lerp, smooth } from "./quat.ts";

export interface Gait {
  /** 0 walking … 1 running. */
  run: number;
  /** Share of a double step a foot is on the ground. Below 0.5 there are moments with both feet in the air. */
  duty: number;
  /** Half the length a planted foot travels under the body, m. */
  reach: number;
  /** Metres covered in one double step (two steps): the stride. */
  cycle: number;
  /** How high a swinging foot lifts, m. */
  lift: number;
}

export const MIN_CYCLE = 0.05;

export function gait(speed: number, anger = 0): Gait {
  const run = smooth(0.9, 1.6, speed);
  const duty = lerp(lerp(0.6, 0.66, anger), 0.36, run);
  const walkReach = Math.min(0.085, 0.12 * speed);
  const reach = lerp(walkReach, 0.125, run);
  const lift = lerp(lerp(0.03, 0.04, anger), 0.035, run) * smooth(0, Math.max(0.05, 0.3 * WALK_SPEED), speed);
  return { run, duty, reach, cycle: Math.max(MIN_CYCLE, (2 * reach) / duty), lift };
}

export interface FootPlan {
  /** Ankle ahead of the hips, m (back is negative). */
  z: number;
  /** Ankle above its standing height, m. */
  lift: number;
  /** Toes up (negative) or down, radians. */
  pitch: number;
  planted: boolean;
  /** -1 … 1: how far forward the leg is, a smooth wave for arms and hips to follow. */
  forward: number;
}

export function foot(phase: number, g: Gait): FootPlan {
  const p = phase - Math.floor(phase);
  if (p < g.duty) {
    const s = p / g.duty;
    return { z: g.reach * (1 - 2 * s), lift: 0, pitch: 0, planted: true, forward: Math.cos(Math.PI * s) };
  }
  const s = (p - g.duty) / (1 - g.duty), up = Math.sin(Math.PI * s) ** 2;
  // Hermite curve from back to front that leaves and arrives at the stance's speed, so the foot's motion has no
  // kink at lift-off or touchdown (running, it kicks back a little first, as feet do)
  const back = (-2 * g.reach * (1 - g.duty)) / g.duty, s2 = s * s, s3 = s2 * s;
  const z = g.reach * (-(2 * s3 - 3 * s2 + 1) + (-2 * s3 + 3 * s2)) + back * (s3 - 2 * s2 + s + (s3 - s2));
  // walking the toes clear the ground (up); running they first trail pointed after the push-off
  const pitch = (-0.3 + 0.7 * g.run * (1 - s)) * up * smooth(0, 0.02, g.lift);
  return { z, lift: g.lift * up, pitch, planted: false, forward: -Math.cos(Math.PI * s) };
}
