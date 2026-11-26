// Sitting and crawling (Motion.low): sitting the hips go down onto the haunches and the tail lies on the ground;
// crawling the hips go down and the front paws stand on the ground, stepping with the hind feet without sliding.
// Positions, not angles.
import { expect, test } from "bun:test";
import { BONES, WALK_SPEED, type Bone, type Motion, type Pose } from "../contracts.ts";
import { createAnimator } from "./index.ts";
import { HAND } from "./ik.ts";
import { add, mul, rotate, type Quat, type Vec } from "./quat.ts";
import { REST } from "./rest.ts";

const still = (over: Partial<Motion> = {}): Motion => ({ speed: 0, distance: 0, turning: 0, grounded: true, vertical: 0, airTime: 0,
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
/** The finger tips: HAND past the wrist along the hand bone (y along a bone). */
const tips = (at: ReturnType<typeof placed>, lr: "L" | "R") => add(at[`hand_${lr}`].p, rotate(at[`hand_${lr}`].q, [0, HAND, 0]));
const settled = (m: Motion) => { const a = createAnimator(); let pose = a.pose(m, 1 / 60); for (let i = 0; i < 120; i++) pose = a.pose(m, 1 / 60); return pose; };

test("sitting, the hips are low on the haunches, the head stays up and the tail lies on the ground", () => {
  const standing = placed(settled(still())), sitting = placed(settled(still({ low: "sit" })));
  expect(sitting.hips.p[1]).toBeLessThan(standing.hips.p[1] - 0.07);
  expect(sitting.head.p[1]).toBeGreaterThan(standing.head.p[1] - 0.15); // upright, not bent over
  expect(sitting.head.p[2] - sitting.hips.p[2]).toBeLessThan(0.15); // the head over the hips
  expect(sitting.tail2.p[1]).toBeLessThan(0.06); // on the ground behind
  expect(sitting.tail2.p[2]).toBeLessThan(sitting.hips.p[2] - 0.15);
  for (const lr of ["L", "R"] as const) expect(sitting[`foot_${lr}`].p[1]).toBeCloseTo(standing[`foot_${lr}`].p[1], 2); // feet on the ground
});

test("crawling, the hips go down and both front paws stand on the ground ahead", () => {
  const standing = placed(settled(still())), crawling = placed(settled(still({ low: "crawl" })));
  expect(crawling.hips.p[1]).toBeLessThan(standing.hips.p[1] - 0.05);
  expect(crawling.head.p[1]).toBeLessThan(standing.head.p[1] - 0.15);
  for (const lr of ["L", "R"] as const) {
    const paw = tips(crawling, lr);
    expect(paw[1]).toBeLessThan(0.04);
    expect(paw[1]).toBeGreaterThan(-0.01);
    expect(paw[2]).toBeGreaterThan(0.2);
  }
});

test("crawling along, a planted front paw stands still on the ground while the body goes over it", () => {
  const a = createAnimator(), speed = WALK_SPEED / 2, dt = 1 / 60;
  let distance = 0, slid = 0, stepped = 0, before: Vec | undefined;
  for (let i = 0; i < 300; i++) {
    distance += speed * dt;
    const at = placed(a.pose(still({ low: "crawl", speed, distance, time: 1 + i * dt }), dt));
    const paw = tips(at, "L"), world: Vec = [paw[0], paw[1], paw[2] + distance]; // the ground under it, as the world sees it
    if (i > 120 && before && paw[1] < 0.016 && before[1] < 0.016) slid = Math.max(slid, Math.abs(world[2] - before[2]));
    if (i > 120 && paw[1] > 0.035) stepped++;
    before = world;
  }
  expect(slid).toBeLessThan(0.004); // m per picture: standing, not sliding
  expect(stepped).toBeGreaterThan(10); // and it lifts to step
});

test("a stick stays in the right paw sitting and crawling", () => {
  for (const low of ["sit", "crawl"] as const) {
    const at = placed(settled(still({ low, carrying: true }))), hand = at.hand_R.p, chest = at.chest.p;
    expect(hand[1]).toBeGreaterThan(0.15); // held up before the chest, not on the ground
    expect(hand[2]).toBeGreaterThan(chest[2]);
  }
});

test("paddling a canoe, the right paw sweeps back and forth out to its right side as the canoe goes, the left stays", () => {
  const a = createAnimator(), dt = 1 / 60, speed = 1;
  let back = Infinity, ahead = -Infinity, side = 0, left = new Set<number>();
  for (let i = 0; i < 240; i++) {
    const at = placed(a.pose(still({ low: "sit", paddle: true, speed, time: 1 + i * dt }), dt));
    if (i < 60) continue;
    const paw = tips(at, "R");
    back = Math.min(back, paw[2]); ahead = Math.max(ahead, paw[2]); side = Math.min(side, paw[0]);
    left.add(Math.round(tips(at, "L")[2] * 100));
  }
  expect(ahead - back).toBeGreaterThan(0.2); // a stroke
  expect(side).toBeLessThan(-0.12); // out to its right (-x), over the side of the hull
  expect(left.size).toBeLessThanOrEqual(2); // the left paw (the lantern's) does not stroke
  const resting = placed(settled(still({ low: "sit", paddle: true })));
  const sitting = placed(settled(still({ low: "sit" })));
  expect(Math.abs(tips(resting, "R")[2] - tips(sitting, "R")[2])).toBeLessThan(0.03); // still: no stroke
});
