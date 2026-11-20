// The planted foot stands still in the world: the animator's Pose, put through forward kinematics from the rest
// data, keeps the sole of a foot in stance on y = 0 and moves it backwards at ground speed, at several speeds
// (running, the toes for the whole stance: the heel rolls up off them in its second half to push off).
import { expect, test } from "bun:test";
import { BONES, RUN_SPEED, WALK_SPEED, type Bone, type Motion, type Pose } from "../contracts.ts";
import { foot, gait } from "./gait.ts";
import { SPLIT, createAnimator } from "./index.ts";
import { add, inv, mul, rotate, type Quat, type Vec } from "./quat.ts";
import { REST } from "./rest.ts";

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** Heel and toe of each foot at rest, armature space: under the ankle, and 12 cm ahead of it. */
const SOLE = (lr: "L" | "R"): Vec[] => { const a = REST[`foot_${lr}`].armaturePosition; return [[a[0], 0, a[2]], [a[0], 0, a[2] + 0.12]]; };

/** Where the soles are for a pose, in the beaver's own frame (its root). */
function soles(pose: Pose) {
  const world = {} as Record<Bone, { q: Quat; p: Vec }>;
  for (const b of BONES) {
    const r = REST[b], local = pose[b]!, up = r.parent ? world[r.parent] : { q: [0, 0, 0, 1] as Quat, p: [0, 0, 0] as Vec };
    world[b] = { q: mul(up.q, local.rotation), p: add(up.p, rotate(up.q, local.translation ?? r.translation)) };
  }
  const at = (lr: "L" | "R") => SOLE(lr).map((point) => {
    const f = world[`foot_${lr}`], local = rotate(inv(REST[`foot_${lr}`].armatureRotation), sub(point, REST[`foot_${lr}`].armaturePosition));
    return add(f.p, rotate(f.q, local));
  });
  return { L: at("L"), R: at("R") };
}

const still: Motion = { speed: 0, distance: 0, turning: 0, grounded: true, vertical: 0, airTime: 0, sinceLanding: 99, landingSpeed: 0,
  swimming: 0, action: "none", actionProgress: 0, carrying: false, anger: 0, time: 0 };

for (const [speed, anger] of [[0.3, 0], [WALK_SPEED, 0], [1.3, 0], [RUN_SPEED, 0], [WALK_SPEED, 1], [RUN_SPEED, 1]] as const) {
  test(`planted feet stand still at ${speed} m/s${anger ? ", furious" : ""}`, () => {
    const animator = createAnimator(), g = gait(speed, anger), dt = 1 / 240, m: Motion = { ...still, speed, anger };
    let worstHeight = 0, worstSlip = 0, checked = 0, previous: ReturnType<typeof soles> | undefined;
    for (let i = 0; i < 2400; i++) {
      m.time += dt;
      m.distance += speed * dt;
      const now = soles(animator.pose(m, dt)), phase = m.distance / g.cycle;
      if (i > 600 && previous) {
        // running it bounds on all fours: the right hind foot lands just after the left (as it settles there)
        for (const [lr, offset] of [["L", 0], ["R", SPLIT.hind[0] + (SPLIT.hind[1] - SPLIT.hind[0]) * g.run]] as const) {
          const plan = foot(phase + offset, g), p = (phase + offset) % 1;
          if (!plan.planted || p - (speed * dt) / g.cycle < 0.01 * g.duty || p > 0.99 * g.duty) continue; // this frame and the last in stance
          for (let k = 0; k < 2; k++) {
            if (k === 0 && g.run > 0 && p > 0.5 * g.duty) continue; // bounding the heel rolls up off the toes to push off
            worstHeight = Math.max(worstHeight, Math.abs(now[lr][k]![1]));
            // backwards at ground speed: it moves -speed·dt along z, so in the world it stands still
            worstSlip = Math.max(worstSlip, Math.abs((now[lr][k]![2] - previous[lr][k]![2]) / (speed * dt) + 1), Math.abs(now[lr][k]![0] - previous[lr][k]![0]) / (speed * dt));
          }
          checked++;
        }
      }
      previous = now;
    }
    console.log(`${speed} m/s anger ${anger}: stride ${g.cycle.toFixed(3)} m, ${(speed / g.cycle).toFixed(2)} strides/s, duty ${g.duty.toFixed(2)}, sole off the ground ≤ ${(worstHeight * 1000).toFixed(2)} mm, slip ≤ ${(worstSlip * 100).toFixed(2)} % (${checked} samples)`);
    expect(checked).toBeGreaterThan(200);
    expect(worstHeight).toBeLessThan(0.002);
    expect(worstSlip).toBeLessThan(0.02);
  });
}
