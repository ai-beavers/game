// How fluid the beaver is in what players do with it: walk and reverse, circle, turn at a run, start and stop,
// change pace, jump while turning, swim, pick up while walking, steer with a stick half pushed. Each manoeuvre runs
// the player's own steering and Motion bookkeeping (src/player/state.ts) at 60 steps a second into the animator,
// puts the pose into the world (feet where the player went, turned by its facing) and measures, per frame:
//   turn     the fastest any bone turns in the world, rad/s, and the hardest change of that, rad/s² (jerk shows as
//            spikes there); the trunk (hips … head) on its own, since legs swing fast by nature
//   slip     how far soles that stand on the ground in two frames move over it, cm in total and m/s at worst
//   heading  how fast and how suddenly the whole body turns, rad/s and rad/s²
//   reverse  seconds from pressing the other way until it goes that way at half walking speed
// `bun test src/anim/manoeuvres` prints the table.
import { expect, test } from "bun:test";
import { BONES, RUN_SPEED, WALK_SPEED, type Bone, type Motion, type Pose } from "../contracts.ts";
import { newAction, newMotion, newSteering, steer, stepAction, trackMotion } from "../player/state.ts";
import { createAnimator } from "./index.ts";
import { add, axisAngle, inv, mul, rotate, type Quat, type Vec } from "./quat.ts";
import { REST } from "./rest.ts";

const dt = 1 / 60, GRAVITY = 18, JUMP_SPEED = Math.sqrt(2 * GRAVITY * 0.6) + GRAVITY / 120; // as src/player
const TRUNK: Bone[] = ["hips", "spine", "chest", "head"];
const UP: Vec = [0, 1, 0];

/** What the player does at time t: which way it wants to go (radians, as facing; undefined: let go), how far the
 *  stick is pushed, running, and presses. */
interface Wish { want?: number; amount?: number; run?: number; jump?: boolean; act?: boolean; water?: boolean }
export const MANOEUVRES: Record<string, { seconds: number; wish: (t: number) => Wish; reverseAt?: number }> = {
  walk: { seconds: 3, wish: () => ({ want: 0 }) },
  run: { seconds: 3, wish: () => ({ want: 0, run: 1 }) },
  reverse: { seconds: 3, reverseAt: 1.5, wish: (t) => ({ want: t < 1.5 ? 0 : Math.PI }) },
  "reverse run": { seconds: 3, reverseAt: 1.5, wish: (t) => ({ want: t < 1.5 ? 0 : Math.PI, run: 1 }) },
  circle: { seconds: 4, wish: (t) => ({ want: t < 0.5 ? 0 : 3 * (t - 0.5) }) },
  "strafe run": { seconds: 3, wish: (t) => ({ want: t < 1.5 ? 0 : -Math.PI / 2, run: 1 }) },
  "start stop": { seconds: 4, wish: (t) => ({ want: t > 0.5 && t < 1.5 || t > 2.5 && t < 3 ? 0 : undefined }) },
  "walk run walk": { seconds: 4.5, wish: (t) => ({ want: 0, run: t > 1.5 && t < 3 ? 1 : 0 }) },
  "jump turning": { seconds: 3, wish: (t) => ({ want: t < 1 ? 0 : Math.PI / 2, run: 1, jump: t > 1 && t < 1.1 }) },
  land: { seconds: 3, wish: (t) => ({ want: 0, jump: t > 1 && t < 1.1 }) },
  water: { seconds: 5, wish: (t) => ({ want: t < 2.5 ? 0 : Math.PI, water: t > 1 && t < 3.5 }) },
  pickup: { seconds: 3, wish: (t) => ({ want: t < 1 || t > 2.2 ? 0 : undefined, act: t > 1 && t < 1.05 }) },
  "half stick": { seconds: 3, wish: (t) => ({ want: t < 1.5 ? 0 : 2.4, amount: 0.5 }) },
};

const angle = (a: Quat, b: Quat) => { const [x, y, z, w] = mul(b, inv(a)); return 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w)); };
/** The turn from a to b as a rotation vector, in the world. */
const turnVec = (a: Quat, b: Quat): Vec => {
  let [x, y, z, w] = mul(b, inv(a));
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z), k = s < 1e-9 ? 2 : (2 * Math.atan2(s, w)) / s;
  return [x * k, y * k, z * k];
};

/** Every bone in the world, for the root at `at` turned by `facing`. */
function world(pose: Pose, at: Vec, facing: number) {
  const root = axisAngle(UP, facing), out = {} as Record<Bone, { q: Quat; p: Vec }>;
  for (const b of BONES) {
    const r = REST[b], local = pose[b]!, up = r.parent ? out[r.parent] : { q: root, p: at };
    out[b] = { q: mul(up.q, local.rotation), p: add(up.p, rotate(up.q, local.translation ?? r.translation)) };
  }
  return out;
}
const SOLE = (lr: "L" | "R"): Vec[] => { const a = REST[`foot_${lr}`].armaturePosition; return [[a[0], 0, a[2]], [a[0], 0, a[2] + 0.12]]; };
const soles = (w: ReturnType<typeof world>) => (["L", "R"] as const).flatMap((lr) => SOLE(lr).map((point) => {
  const f = w[`foot_${lr}`], rest = REST[`foot_${lr}`];
  return add(f.p, rotate(f.q, rotate(inv(rest.armatureRotation), [point[0] - rest.armaturePosition[0], point[1] - rest.armaturePosition[1], point[2] - rest.armaturePosition[2]])));
}));

export interface Measure { turn: number; turnBone: string; jerk: number; jerkBone: string; trunkTurn: number; trunkJerk: number; slip: number; slipSpeed: number; slipAt: string; heading: number; headingJerk: number; reverse: number }

export function measure(name: string): Measure {
  const { seconds, wish, reverseAt } = MANOEUVRES[name]!;
  const animator = createAnimator(), m: Motion = newMotion(), act = newAction(), steering = newSteering();
  const at: Vec = [0, 0, 0];
  let vy = 0, grounded = true, afloat = false, jumpHeld = false, actHeld = false, spin = 0;
  const r: Measure = { turn: 0, turnBone: "", jerk: 0, jerkBone: "", trunkTurn: 0, trunkJerk: 0, slip: 0, slipSpeed: 0, slipAt: "", heading: 0, headingJerk: 0, reverse: NaN };
  let last: ReturnType<typeof world> | undefined, lastSoles: Vec[] | undefined, lastSpin: Record<string, Vec> = {};
  for (let i = 0; i * dt < seconds; i++) {
    const t = i * dt, w = wish(t), before = steering.facing;
    // the player's step, as src/player/index.ts does it, on flat ground with water where the script says
    const pressAct = !!w.act && !actHeld, pressJump = !!w.jump && !jumpHeld;
    actHeld = !!w.act; jumpHeld = !!w.jump;
    stepAction(act, dt, pressAct && grounded, true);
    const busy = act.action !== "none";
    afloat = !!w.water;
    const top = afloat ? 0.5 : WALK_SPEED + (RUN_SPEED - WALK_SPEED) * (w.run ?? 0);
    const [accel, brake] = afloat ? [2, 2] : !grounded ? [2.5, 2.5] : [6, 9];
    steer(steering, busy ? undefined : w.want, busy ? 0 : w.amount ?? 1, top, accel, brake, dt);
    if (pressJump && grounded && !afloat && !busy) { vy = JUMP_SPEED; grounded = false; }
    if (!grounded) vy -= GRAVITY * dt;
    const moved = steering.speed * dt;
    at[0] += Math.sin(steering.facing) * moved; at[2] += Math.cos(steering.facing) * moved;
    at[1] = afloat ? 0 : Math.max(0, at[1] + vy * dt);
    if (!afloat && at[1] === 0 && vy <= 0) { grounded = true; vy = 0; } else if (afloat) grounded = false;
    trackMotion(m, dt, { moved, vertical: grounded ? 0 : vy, turning: (steering.facing - before) / dt, grounded, afloat, act });
    if (reverseAt !== undefined && t >= reverseAt && Number.isNaN(r.reverse) && steering.speed * Math.cos(steering.facing - w.want!) > 0.5 * WALK_SPEED) r.reverse = t - reverseAt;

    const now = world(animator.pose(m, dt), [...at], steering.facing), sole = soles(now);
    const newSpin = (steering.facing - before) / dt;
    if (i > 0) { r.heading = Math.max(r.heading, Math.abs(newSpin)); if (i > 1) r.headingJerk = Math.max(r.headingJerk, Math.abs(newSpin - spin) / dt); }
    spin = newSpin;
    if (last && lastSoles) {
      for (const b of BONES) {
        const v = turnVec(last[b].q, now[b].q).map((x) => x / dt) as Vec, speed = Math.hypot(...v);
        if (speed > r.turn) { r.turn = speed; r.turnBone = `${b} ${t.toFixed(2)} s`; }
        if (TRUNK.includes(b)) r.trunkTurn = Math.max(r.trunkTurn, speed);
        const p = lastSpin[b];
        if (p) {
          const jerk = Math.hypot(v[0] - p[0], v[1] - p[1], v[2] - p[2]) / dt;
          if (jerk > r.jerk) { r.jerk = jerk; r.jerkBone = `${b} ${t.toFixed(2)} s`; }
          if (TRUNK.includes(b)) r.trunkJerk = Math.max(r.trunkJerk, jerk);
        }
        lastSpin[b] = v;
      }
      // a foot flat on the ground (heel and toe) in both frames: it should not move over the ground
      if (grounded) for (const k of [0, 2]) {
        if ([sole[k]!, sole[k + 1]!, lastSoles[k]!, lastSoles[k + 1]!].some((p) => p[1] > 0.002)) continue;
        const d = (Math.hypot(sole[k]![0] - lastSoles[k]![0], sole[k]![2] - lastSoles[k]![2]) + Math.hypot(sole[k + 1]![0] - lastSoles[k + 1]![0], sole[k + 1]![2] - lastSoles[k + 1]![2])) / 2;
        r.slip += d;
        if (d / dt > r.slipSpeed) { r.slipSpeed = d / dt; r.slipAt = `${k ? "R" : "L"} ${t.toFixed(2)} s`; }
      }
    }
    last = now; lastSoles = sole;
  }
  return r;
}

const results: Record<string, Measure> = {};
test("manoeuvres: per bone turn and jerk, foot slip, heading rate", () => {
  const rows: string[] = [];
  for (const name of Object.keys(MANOEUVRES)) {
    const r = measure(name);
    results[name] = r;
    for (const v of Object.values(r)) if (typeof v === "number" && !Number.isNaN(v)) expect(Number.isFinite(v)).toBe(true);
    rows.push(`${name.padEnd(14)} ${r.turn.toFixed(1).padStart(6)} ${r.turnBone.padEnd(15)} ${r.jerk.toFixed(0).padStart(6)} ${r.jerkBone.padEnd(15)} ${r.trunkTurn.toFixed(1).padStart(6)} ${r.trunkJerk.toFixed(0).padStart(6)} ${(r.slip * 100).toFixed(1).padStart(6)} ${r.slipSpeed.toFixed(2).padStart(6)} ${r.slipAt.padEnd(8)} ${r.heading.toFixed(1).padStart(6)} ${r.headingJerk.toFixed(0).padStart(6)} ${Number.isNaN(r.reverse) ? "" : r.reverse.toFixed(3)}`);
  }
  console.log(`manoeuvre        turn worst bone        jerk worst bone      trunk  jerk  slip cm  m/s  heading  h-jerk reverse s\n${rows.join("\n")}`);
});

// Bounds the old animation failed (its numbers after //): the body snapped into a turn at full rate, the head and
// tail hit their limits within two frames, and turning on the spot the feet turned with the body, skating.
test("a reversal turns the body with weight and keeps the feet on the ground, as quickly as before", () => {
  const r = results.reverse ?? measure("reverse");
  expect(r.headingJerk).toBeLessThan(300); // 600: full turn rate in one step
  expect(r.trunkTurn).toBeLessThan(26); // 32.8
  expect(r.trunkJerk).toBeLessThan(800); // 1981
  expect(r.slip).toBeLessThan(0.2); // 0.75 m
  expect(r.reverse).toBeLessThan(0.24); // 0.233 s: no slower to go the other way
  const run = results["reverse run"] ?? measure("reverse run");
  expect(run.trunkJerk).toBeLessThan(800); // 2197
  expect(run.slip).toBeLessThan(0.35); // 0.90 m
  expect(run.reverse).toBeLessThan(0.21); // 0.200 s
});
test("turning while walking steps round instead of skating", () => {
  expect((results.circle ?? measure("circle")).slip).toBeLessThan(0.5); // 2.09 m
  expect((results["half stick"] ?? measure("half stick")).slip).toBeLessThan(0.15); // 0.68 m
  expect((results["strafe run"] ?? measure("strafe run")).trunkJerk).toBeLessThan(800); // 2184
});
test("turning in the water, the tail swings round without a snap", () => {
  expect((results.water ?? measure("water")).turn).toBeLessThan(30); // 57.1 rad/s, tail2
});
