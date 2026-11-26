// Gliding on the Hoverboard (Motion.glide): standing upright, the feet together and still, the arms a little out,
// whatever the speed. Positions, not angles.
import { expect, test } from "bun:test";
import { BONES, type Bone, type Motion, type Pose } from "../contracts.ts";
import { createAnimator } from "./index.ts";
import { add, mul, rotate, type Quat, type Vec } from "./quat.ts";
import { REST } from "./rest.ts";

const moving = (over: Partial<Motion> = {}): Motion => ({ speed: 0, distance: 0, turning: 0, grounded: true, vertical: 0, airTime: 0,
  sinceLanding: 99, landingSpeed: 0, swimming: 0, action: "none", actionProgress: 0, carrying: false, anger: 0, time: 1, ...over });

/** Each bone's head in armature space (y up from the ground, the beaver faces +z). */
function placed(pose: Pose) {
  const out = {} as Record<Bone, { q: Quat; p: Vec }>;
  for (const b of BONES) {
    const r = REST[b], local = pose[b]!, up = r.parent ? out[r.parent] : { q: [0, 0, 0, 1] as Quat, p: [0, 0, 0] as Vec };
    out[b] = { q: mul(up.q, local.rotation), p: add(up.p, rotate(up.q, local.translation ?? r.translation)) };
  }
  return out;
}

/** Two seconds at 4 m/s: how far each foot moves (most minus least, along and up), how high the head is at the end,
 *  and how far out the hands are. */
function ride(glide: boolean) {
  const a = createAnimator(), dt = 1 / 60, speed = 4;
  const z = { L: [Infinity, -Infinity], R: [Infinity, -Infinity] }, y = { L: [Infinity, -Infinity], R: [Infinity, -Infinity] };
  let distance = 0, at = placed(a.pose(moving(), dt));
  for (let i = 0; i < 120; i++) {
    distance += glide ? 0 : speed * dt; // the player counts no footsteps gliding (state.ts trackMotion)
    at = placed(a.pose(moving({ speed, distance, time: 1 + i * dt, ...(glide ? { glide: true } : {}) }), dt));
    if (i < 60) continue; // settled into it
    for (const lr of ["L", "R"] as const) {
      const f = at[`foot_${lr}`].p;
      z[lr] = [Math.min(z[lr][0]!, f[2]), Math.max(z[lr][1]!, f[2])];
      y[lr] = [Math.min(y[lr][0]!, f[1]), Math.max(y[lr][1]!, f[1])];
    }
  }
  const swing = Math.max(...(["L", "R"] as const).flatMap((lr) => [z[lr][1]! - z[lr][0]!, y[lr][1]! - y[lr][0]!]));
  return { swing, head: at.head.p[1], hands: Math.abs(at.hand_L.p[0]) + Math.abs(at.hand_R.p[0]) };
}

test("gliding at 4 m/s it stands upright, the feet still, unlike bounding at the same speed", () => {
  const standing = placed(createAnimator().pose(moving(), 1 / 60));
  const glide = ride(true), bound = ride(false);
  expect(glide.swing).toBeLessThan(0.01); // m: no stride
  expect(bound.swing).toBeGreaterThan(0.05);
  expect(glide.head).toBeGreaterThan(standing.head.p[1] - 0.05); // upright, not down on all fours
  expect(bound.head).toBeLessThan(standing.head.p[1] - 0.1);
});

test("gliding the arms are held a little out to balance", () => {
  const a = createAnimator();
  let still = placed(a.pose(moving(), 1 / 60));
  for (let i = 0; i < 60; i++) still = placed(a.pose(moving({ time: 1 + i / 60 }), 1 / 60));
  const out = (at: ReturnType<typeof placed>) => Math.abs(at.hand_L.p[0]) + Math.abs(at.hand_R.p[0]);
  expect(ride(true).hands).toBeGreaterThan(out(still) + 0.06);
});
