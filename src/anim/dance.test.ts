// The Dance (Motion.low "dance"): a loop to the beat of a sway, a hop, a paw raised and a turn, on the spot. Positions,
// not angles.
import { expect, test } from "bun:test";
import { BONES, DANCE_BPM, type Bone, type Motion, type Pose } from "../contracts.ts";
import { createAnimator } from "./index.ts";
import { add, mul, rotate, type Quat, type Vec } from "./quat.ts";
import { REST } from "./rest.ts";

const still = (over: Partial<Motion> = {}): Motion => ({ speed: 0, distance: 0, turning: 0, grounded: true, vertical: 0, airTime: 0,
  sinceLanding: 99, landingSpeed: 0, swimming: 0, action: "none", actionProgress: 0, carrying: false, anger: 0, time: 1, ...over });

/** Each bone's head in armature space (y up from the ground, the beaver faces +z), and its turn. */
function placed(pose: Pose) {
  const out = {} as Record<Bone, { q: Quat; p: Vec }>;
  for (const b of BONES) {
    const r = REST[b], local = pose[b]!, up = r.parent ? out[r.parent] : { q: [0, 0, 0, 1] as Quat, p: [0, 0, 0] as Vec };
    out[b] = { q: mul(up.q, local.rotation), p: add(up.p, rotate(up.q, local.translation ?? r.translation)) };
  }
  return out;
}
const LOOP = 16 * 60 / DANCE_BPM; // s: the dance's loop, sixteen beats

/** One loop of the dance after settling into it, from its first beat: per frame where the bones are. */
function dance(low?: Motion["low"]) {
  const a = createAnimator(), dt = 1 / 60, frames: ReturnType<typeof placed>[] = [];
  for (let t = 0; t < 2 + LOOP; t += dt) {
    const at = placed(a.pose(still({ low, time: LOOP - 2 + t }), dt));
    if (t >= 2) frames.push(at);
  }
  return frames;
}
const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

test("dancing it sways from side to side and hops, the feet leaving the ground", () => {
  const frames = dance("dance"), standing = dance();
  const firstBar = (fs: typeof frames) => fs.slice(0, fs.length / 4).map((f) => f.head.p[0]); // the sway, before the turn
  expect(range(firstBar(frames))).toBeGreaterThan(range(firstBar(standing)) + 0.04);
  const feet = (f: ReturnType<typeof placed>) => Math.min(f.foot_L.p[1], f.foot_R.p[1]);
  expect(Math.max(...frames.map(feet)) - feet(standing[0]!)).toBeGreaterThan(0.03); // both feet up: a hop
});

test("dancing it raises a paw over its head", () => {
  expect(Math.max(...dance("dance").map((f) => Math.max(f.hand_L.p[1], f.hand_R.p[1]) - f.head.p[1]))).toBeGreaterThan(0.05);
  expect(Math.max(...dance().map((f) => Math.max(f.hand_L.p[1], f.hand_R.p[1]) - f.head.p[1]))).toBeLessThan(0);
});

test("dancing it turns right round on the spot", () => {
  const frames = dance("dance");
  // Which way the hips face (their forward, +z at rest) on the ground: the angle walked round over the loop.
  let turned = 0, before: number | undefined;
  for (const f of frames) {
    const ahead = rotate(f.hips.q, [0, 0, 1]), yaw = Math.atan2(ahead[0], ahead[2]);
    if (before !== undefined) turned += Math.atan2(Math.sin(yaw - before), Math.cos(yaw - before));
    before = yaw;
  }
  expect(Math.abs(turned)).toBeGreaterThan(1.9 * Math.PI);
  for (const f of frames) expect(Math.hypot(f.hips.p[0], f.hips.p[2])).toBeLessThan(0.12); // on the spot
});

test("the dance is a loop: one loop later the pose is the same", () => {
  const a = createAnimator(), b = createAnimator(), dt = 1 / 60;
  let p = placed(a.pose(still({ low: "dance", time: 5 }), dt)), q = placed(b.pose(still({ low: "dance", time: 5 }), dt));
  for (let i = 1; i < 300; i++) { p = placed(a.pose(still({ low: "dance", time: 5 + i * dt }), dt)); q = placed(b.pose(still({ low: "dance", time: 5 + LOOP + i * dt }), dt)); }
  for (const bone of ["head", "hand_R", "foot_L"] as const) for (let k = 0; k < 3; k++) expect(p[bone].p[k]!).toBeCloseTo(q[bone].p[k]!, 3);
});
