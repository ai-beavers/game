// Reaching back for the lantern (Motion.reachBack): at 1 the left paw is at the backpack, behind and above the left
// shoulder; at 0 the pose is what it always was; the right arm, carrying a stick, never moves for it.
import { expect, test } from "bun:test";
import { BONES, type Bone, type Motion, type Pose } from "../contracts.ts";
import { createAnimator } from "./index.ts";
import { add, mul, rotate, type Quat, type Vec } from "./quat.ts";
import { REST } from "./rest.ts";

const still = (over: Partial<Motion> = {}): Motion => ({ speed: 0, distance: 0, turning: 0, grounded: true, vertical: 0, airTime: 0,
  sinceLanding: 99, landingSpeed: 0, swimming: 0, action: "none", actionProgress: 0, carrying: false, anger: 0, time: 1, ...over });

/** Each bone's head in armature space. */
function placed(pose: Pose) {
  const out = {} as Record<Bone, { q: Quat; p: Vec }>;
  for (const b of BONES) {
    const r = REST[b], local = pose[b]!, up = r.parent ? out[r.parent] : { q: [0, 0, 0, 1] as Quat, p: [0, 0, 0] as Vec };
    out[b] = { q: mul(up.q, local.rotation), p: add(up.p, rotate(up.q, local.translation ?? r.translation)) };
  }
  return out;
}
/** Two seconds of the same Motion, so every eased weight has settled. */
const settled = (m: Motion) => { const a = createAnimator(); let pose = a.pose(m, 1 / 60); for (let i = 0; i < 120; i++) pose = a.pose(m, 1 / 60); return pose; };

test("reaching back, the left paw is behind and above the left shoulder", () => {
  const at = placed(settled(still({ reachBack: 1 }))), hand = at.hand_L.p, shoulder = at.upper_arm_L.p;
  expect(hand[2]).toBeLessThan(shoulder[2]); // behind: the beaver faces +z
  expect(hand[1]).toBeGreaterThan(shoulder[1]);
  expect(hand[0]).toBeGreaterThan(0); // still on its left
});

test("not reaching back, the pose is the one it always was", () => {
  for (const over of [{}, { speed: 0.8, distance: 3 }, { carrying: true }, { action: "gnaw" as const, actionProgress: 0.5 }]) {
    expect(settled(still({ ...over, reachBack: 0 }))).toEqual(settled(still(over)));
  }
});

test("a stick in the right hand stays where it is while the left paw reaches back", () => {
  const holding = placed(settled(still({ carrying: true }))), reaching = placed(settled(still({ carrying: true, reachBack: 1 })));
  for (const b of ["upper_arm_R", "forearm_R", "hand_R", "chest", "head"] as const)
    for (let k = 0; k < 3; k++) expect(reaching[b].p[k]!).toBeCloseTo(holding[b].p[k]!, 6);
  expect(Math.hypot(...[0, 1, 2].map((k) => reaching.hand_L.p[k]! - holding.hand_L.p[k]!))).toBeGreaterThan(0.1);
});
