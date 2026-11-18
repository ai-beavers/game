// No pops: a scripted minute of play (walk, run, turn, jump, land, pick up, carry, gnaw, swim, rage, stop) at 60
// frames per second. A pop is a jump in a bone's motion: each frame is compared with where the last two frames
// were heading (its turn and move extrapolated), so fast but smooth limbs pass and sudden changes do not. Turns
// are compared as seen, in the armature's space: a flat foot on a fast knee turns fast against its shin only.
import { expect, test } from "bun:test";
import { BONES, type Motion, type Pose } from "../contracts.ts";
import { createAnimator } from "./index.ts";
import { REST } from "./rest.ts";
import { inv, mul, type Quat } from "./quat.ts";

/** Each bone's turn in armature space. */
function seen(pose: Pose) {
  const out = {} as Record<string, Quat>;
  for (const b of BONES) { const parent = REST[b].parent; out[b] = parent ? mul(out[parent]!, pose[b]!.rotation) : pose[b]!.rotation; }
  return out;
}
const angle = (a: Quat, b: Quat) => { const [x, y, z, w] = mul(inv(a), b); return 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w)); };

/** The game's story, second by second: what the player would report. */
function script(t: number, m: Motion, dt: number) {
  const ramp = (from: number, to: number, a: number, b: number) => from + (to - from) * Math.min(1, Math.max(0, (t - a) / (b - a)));
  m.speed = t < 1 ? 0 : t < 3 ? ramp(0, 0.8, 1, 1.4) : t < 6 ? ramp(0.8, 2, 3, 3.6) : t < 9 ? ramp(2, 0, 8, 9) : t < 20 ? 0 : t < 24 ? 0.8 : 0;
  m.turning = t > 4 && t < 5 ? 1.5 : 0;
  m.distance += m.speed * dt;
  m.time = t;
  const jumping = t >= 5 && t < 5.6; // a jump while running: 0.6 s in the air
  if (jumping) { m.grounded = false; m.airTime = t - 5; m.vertical = 3 - 9.81 * m.airTime; }
  else { if (!m.grounded) { m.landingSpeed = -m.vertical; m.sinceLanding = 0; } m.grounded = true; m.airTime = 0; m.vertical = 0; m.sinceLanding += dt; }
  m.action = t > 10 && t < 11.5 ? "pickup" : t > 14 && t < 17 ? "gnaw" : t > 17.5 && t < 19 ? "drop" : "none";
  m.actionProgress = m.action === "pickup" ? (t - 10) / 1.5 : m.action === "drop" ? (t - 17.5) / 1.5 : 0;
  m.carrying = t > 10.8 && t < 18.2;
  m.swimming = t > 25 && t < 30 ? 1 : 0;
  m.anger = t > 30 ? 1 : 0;
  if (t > 31 && t < 33) m.speed = 0.8;
}

test("no bone pops over a scripted minute of play", () => {
  const animator = createAnimator(), dt = 1 / 60;
  const m: Motion = { speed: 0, distance: 0, turning: 0, grounded: true, vertical: 0, airTime: 0, sinceLanding: 99, landingSpeed: 0,
    swimming: 0, action: "none", actionProgress: 0, carrying: false, anger: 0, time: 0 };
  let before: Pose | undefined, last: Pose | undefined, seenBefore: Record<string, Quat> = {}, seenLast: Record<string, Quat> = {}, worstTurn = 0, worstMove = 0, where = "";
  for (let i = 0; i < 60 * 40; i++) {
    script(i * dt, m, dt);
    const pose = animator.pose(m, dt), turns = seen(pose);
    for (const b of BONES) {
      const p = pose[b]!;
      expect([...p.rotation, ...p.translation!].every(Number.isFinite)).toBe(true);
      if (!last || !before) continue;
      const q1 = last[b]!, q0 = before[b]!;
      const heading = mul(seenLast[b]!, mul(inv(seenBefore[b]!), seenLast[b]!)); // turning on as it did
      const turn = angle(heading, turns[b]!), move = Math.hypot(...p.translation!.map((x, k) => x - 2 * q1.translation![k]! + q0.translation![k]!));
      if (turn > worstTurn) { worstTurn = turn; where = `${b} at ${(i * dt).toFixed(2)} s`; }
      worstMove = Math.max(worstMove, move);
    }
    before = last;
    last = pose;
    seenBefore = seenLast;
    seenLast = turns;
  }
  console.log(`worst jump in a frame: ${worstTurn.toFixed(3)} rad (${where}), ${(worstMove * 1000).toFixed(1)} mm`);
  // Steady running at 2 m/s alone reaches 0.33 rad (a stride is 21 frames); the worst is going from walk to run
  // (0.40 rad). Touching down from a jump once restarted the stride and reached 0.61 rad; real pops were 2 rad.
  expect(worstTurn).toBeLessThan(0.45);
  expect(worstMove).toBeLessThan(0.015);
});

// The tail slap (src/player/state.ts: 0.9 s, the strike at half) on land and afloat, standing and on the move: the
// strike is the fastest thing the tail does, yet each frame stays close to where the last two frames were heading.
test("the tail slap strikes hard without a pop", () => {
  for (const [swimming, speed] of [[0, 0], [0, 0.8], [1, 0], [1, 0.5]] as const) {
    const animator = createAnimator(), dt = 1 / 60;
    const m: Motion = { speed, distance: 0, turning: 0, grounded: !swimming, vertical: 0, airTime: 0, sinceLanding: 99, landingSpeed: 0,
      swimming, action: "none", actionProgress: 0, carrying: false, anger: 0, time: 0 };
    let before: Record<string, Quat> | undefined, last: Record<string, Quat> | undefined, worst = 0, strike = 0;
    for (let i = 0; i < 60 * 3; i++) {
      const t = i * dt;
      m.time = t; m.distance += speed * dt;
      m.actionProgress = t > 1 && t < 1.9 ? (t - 1) / 0.9 : 0;
      const turns = seen(animator.pose(m, dt));
      if (before && last) for (const b of ["hips", "spine", "chest", "head", "tail1", "tail2"] as const) {
        worst = Math.max(worst, angle(mul(last[b]!, mul(inv(before[b]!), last[b]!)), turns[b]!));
      }
      if (last && m.actionProgress > 0) strike = Math.max(strike, angle(last.tail1!, turns.tail1!) / dt);
      before = last; last = turns;
    }
    console.log(`tail slap, swimming ${swimming}, ${speed} m/s: strike ${strike.toFixed(1)} rad/s, worst jump ${worst.toFixed(3)} rad`);
    expect(strike).toBeGreaterThan(10); // rad/s: a strike, not a wave
    expect(worst).toBeLessThan(0.2); // measured 0.16 rad afloat, 0.14 on land
  }
});
