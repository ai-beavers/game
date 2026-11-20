// The Stare (Motion.stare): at weight 1 the head looks along the aim it is given, relative to the body, standing and
// sitting; at weight 0 the pose is the one it always was.
import { expect, test } from "bun:test";
import { BONES, type Bone, type Motion, type Pose } from "../contracts.ts";
import { createAnimator } from "./index.ts";
import { add, inv, mul, rotate, type Quat, type Vec } from "./quat.ts";
import { REST } from "./rest.ts";

const still = (over: Partial<Motion> = {}): Motion => ({ speed: 0, distance: 0, turning: 0, grounded: true, vertical: 0, airTime: 0,
  sinceLanding: 99, landingSpeed: 0, swimming: 0, action: "none", actionProgress: 0, carrying: false, anger: 0, time: 1, ...over });

function placed(pose: Pose) {
  const out = {} as Record<Bone, { q: Quat; p: Vec }>;
  for (const b of BONES) {
    const r = REST[b], local = pose[b]!, up = r.parent ? out[r.parent] : { q: [0, 0, 0, 1] as Quat, p: [0, 0, 0] as Vec };
    out[b] = { q: mul(up.q, local.rotation), p: add(up.p, rotate(up.q, local.translation ?? r.translation)) };
  }
  return out;
}
const settled = (m: Motion) => { const a = createAnimator(); let pose = a.pose(m, 1 / 60); for (let i = 0; i < 120; i++) pose = a.pose(m, 1 / 60); return pose; };
/** Where the face looks: the head's forward (+z at rest, the way the beaver faces). */
const face = (pose: Pose) => rotate(placed(pose).head.q, rotate(inv(REST.head.armatureRotation), [0, 0, 1]));
const angle = (a: Vec, b: Vec) => Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b)));

test("staring, the head looks along the aim, standing and sitting", () => {
  for (const low of [undefined, "sit" as const]) for (const [yaw, pitch] of [[0, 0.25], [0.6, 0.1], [-0.5, 0.4]] as const) {
    const aim: Vec = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    const look = face(settled(still({ low, stare: { weight: 1, yaw, pitch } })));
    expect(angle(look, aim)).toBeLessThan(0.05); // rad: about 3°
  }
});

test("a stare at weight 0 leaves the pose as it always was", () => {
  for (const over of [{}, { low: "sit" as const }, { carrying: true }])
    expect(settled(still({ ...over, stare: { weight: 0, yaw: 0.6, pitch: 0.3 } }))).toEqual(settled(still(over)));
});

test("staring, the head is cocked to one side, and does not look about", () => {
  const a = createAnimator(), looks = new Set<string>();
  for (let i = 0; i < 600; i++) {
    const pose = a.pose(still({ time: 1 + i / 60, stare: { weight: 1, yaw: 0, pitch: 0.2 } }), 1 / 60);
    const f = face(pose);
    looks.add(f.map((x) => x.toFixed(2)).join());
    if (i === 599) {
      const up = rotate(placed(pose).head.q, rotate(inv(REST.head.armatureRotation), [0, 1, 0]));
      expect(Math.abs(up[0])).toBeGreaterThan(0.1); // the top of the head tipped to a side
    }
  }
  expect(looks.size).toBeLessThanOrEqual(2); // fixed: no glance round, no nod with the breath
});
