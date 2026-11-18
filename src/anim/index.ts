// How the beaver moves: turns what the body is doing (a Motion, from the player) into a Pose for its 20 bones.
// Pure maths; the pose functions it builds on are build.py's, ported in clips.ts.
//
//   const animator = createAnimator();
//   each frame: beaver.pose(animator.pose(player.motion, dt));
//
// Layers, each a whole Body, blended by weights that are damped over time, so nothing pops:
//   ground   gait (stride from motion.distance, planted feet by IK), standing (breathing, weight shift, a look
//            around, flexing when angry), turning lean, the dip after a landing, anger
//   action   pickup, drop, gnaw, build, by actionProgress; feet stay planted
//   air      stretched while rising, legs forward while falling
//   swim     level in the water, hind legs paddle, tail steers; pitched nose down sinking, up rising (motion.vertical)
//   dive     under the surface (the player's own motion.diving): long and streamlined, the tail driving in strokes
//   slap     the tail up and struck down (action "none" with a progress), over all of the above but the carry
//   carry    the right arm holds the stick in front of the chest, over all of the above
//   reach    the left paw over the shoulder to the backpack (motion.reachBack), over all of the above, left arm only
// The inputs that set the stride (distance, phase) are never damped: damping them would make the feet slide.
import { WALK_SPEED, type Action, type Animator, type Bone, type CreateAnimator, type Motion } from "../contracts.ts";
import type { SwimMotion } from "../player/state.ts";
import { Body, X, Y, Z } from "./body.ts";
import { FLEXES, SIDES, arm, brows_at, flexArms, leg, trunk, type Side, type Trunk } from "./clips.ts";
import { foot, gait, type FootPlan, type Gait } from "./gait.ts";
import { ANKLE, REACH, aimArm, onChest, placeLeg, reachArm } from "./ik.ts";
import { axisAngle, clamp, lerp, mul, rotate, smooth, type Quat, type Vec } from "./quat.ts";
import { REST } from "./rest.ts";

export { gait, foot } from "./gait.ts";

const { sin, cos, max, sqrt, exp, PI, abs } = Math;
const TAU = 2 * PI;
const UP: Vec = [0, 1, 0];
const FOOT_X = REST.foot_L.armaturePosition[0];
const damp = (from: number, to: number, seconds: number, dt: number) => to + (from - to) * exp(-dt / seconds);
/** A blend weight that eases in and out (a critically damped spring, solved exactly): unlike plain damping it
 *  starts slowly, so a switch never jumps in the first frame. About 90 % there after `seconds`. */
class Ease {
  value = 0;
  speed = 0;
  constructor(readonly lo = 0, readonly hi = 1) {}
  to(target: number, seconds: number, dt: number) {
    const w = 3.9 / seconds, off = this.value - target, k = this.speed + w * off, e = exp(-w * dt);
    this.value = clamp(target + (off + k * dt) * e, this.lo, this.hi);
    this.speed = (this.speed - w * k * dt) * e;
    return this.value;
  }
}
const ARMS: Bone[] = ["upper_arm_L", "forearm_L", "hand_L", "upper_arm_R", "forearm_R", "hand_R"];
const RIGHT_ARM: Bone[] = ["upper_arm_R", "forearm_R", "hand_R"];
const LEFT_ARM: Bone[] = ["upper_arm_L", "forearm_L", "hand_L"];
/** Where the left finger tips go reaching back for the lantern: the backpack's opening, over the left shoulder, as
 *  onChest() takes it (src/features/lantern puts the backpack there). The elbow points up and out. */
export const BACKPACK_REACH: Vec = [0.05, 0.05, -0.2];
const REACH_POLE: Vec = [0.6, 1, 0.5];
/** A number 0 … 1 that looks random but is the same for the same n. */
/** x, but bending smoothly into ±limit: a hard clamp turns a fast rise into a kink. */
const soft = (x: number, limit: number) => limit * Math.tanh(x / limit);
const hash = (n: number) => { const x = sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

interface Plant { at: Vec; turn: Quat }
const SOFT = 0.006;
const HIP = REST.thigh_L.armaturePosition[1]; // height of the hip joint at rest // m: how softly the hips follow the leg that needs them lowest

/** Puts both ankles on their targets: the hips go down by `drop`, or further if a target is out of reach. */
function plantLegs(body: Body, targets: Record<Side, Plant>, drop: number, shift: Vec = [0, 0, 0]) {
  // how far down the hips must go for each ankle, joined by a soft maximum: a hard one would kink the motion
  let placed = body.fk(), sum = exp(drop / SOFT);
  for (const lr of ["L", "R"] as const) {
    const hip = placed[`thigh_${lr}`].at, t = targets[lr].at;
    const dx = t[0] - hip[0] - shift[0], dz = t[2] - hip[2] - shift[2];
    sum += exp((hip[1] - (t[1] + sqrt(max(0, REACH * REACH - dx * dx - dz * dz)))) / SOFT);
  }
  const need = SOFT * Math.log(sum);
  const off = body.offsets.hips;
  body.move("hips", [off[0] + shift[0], off[1] - need, off[2] + shift[2]]);
  placed = body.fk();
  for (const lr of ["L", "R"] as const) placeLeg(body, placed, lr, targets[lr].at, targets[lr].turn);
}

const footTurn = (sign: number, toeOut: number, pitch: number): Quat => mul(axisAngle(UP, sign * toeOut), axisAngle(X, pitch));
/** Both feet flat beside each other, a little apart. */
const standing = (width: number, z = 0): Record<Side, Plant> => ({
  L: { at: [FOOT_X + width, ANKLE, z], turn: footTurn(1, 0.15, 0) },
  R: { at: [-FOOT_X - width, ANKLE, z], turn: footTurn(-1, 0.15, 0) },
});

/** Arm parameters as build.py's arm() takes them, so they can be mixed as numbers. */
type ArmParams = [lower: number, swing: number, back: number, elbow: number, curl: number, inward: number, fist: number];
const mixArm = (a: ArmParams, b: ArmParams, t: number) => a.map((x, i) => lerp(x, b[i]!, t)) as ArmParams;
const WALK_ARM: ArmParams = [0.55, 0.45, 0, 0.15, 0.55, 0, 0];
const RAGE_ARM: ArmParams = [0.12, 0.14, 0.12, -0.55, 0.25, 0, 1];
const STAND_ARM: ArmParams = [0.5, 0, 0, 0.1, 0.3, 0, 0];

// Turning on the spot the feet step round: the stride runs on as if the feet walked PIVOT m per radian turned, and a
// planted foot turns back against the body as it moves under it, so it stands still on the ground.
const PIVOT = 0.15;
/** stepping: the pace the feet step at, m/s, walking plus pivoting; pivot: rad/s turned on the ground. */
/** A foot as the stride plans it, plus yaw: turned about the middle, for pivoting. */
type Step = FootPlan & { yaw: number };
interface Ground { speed: number; pivot: number; feet: [Step, Step]; phase: number; anger: number; turning: number; dip: number; time: number; flex: number }

/** On its feet: from standing through walking to running, all one function of speed, so it blends by itself. */
function ground(body: Body, d: Ground, g: Gait) {
  const { run } = g, a = d.anger, t = d.time;
  const moving = smooth(0.02, 0.4, d.speed + abs(d.pivot) * PIVOT), still = 1 - moving;
  const [L, R] = d.feet;
  // +1 when the left foot carries the body in mid-stance, -1 for the right
  const load = cos(TAU * (d.phase - g.duty / 2)) * moving;
  // standing: breathing, a slow shift of weight from foot to foot, now and then a look to one side
  const breath = sin(TAU * t / 3.6), shift = (sin(TAU * t / 9) + 0.4 * sin(TAU * t / 4.1)) / 1.4;
  const glanceAt = Math.floor(t / 4.5), into = t - glanceAt * 4.5;
  const glance = (hash(glanceAt) < 0.6 ? (hash(glanceAt + 0.5) - 0.5) * 1.6 : 0) * smooth(0.4, 1.0, into) * (1 - smooth(2.6, 3.3, into)) * still;
  const dipN = d.dip / 0.08;
  const lean = lerp(lerp(0.04, -0.12, a), 0.5, run) - 0.05 * still + 0.015 * breath * still + 0.5 * dipN;
  const roll = soft(0.13 * d.speed * d.turning, 0.3);
  const trunkParams: Trunk = {
    lean,
    sway: lerp(0.09, 0.035, run) * (1 + 0.7 * a) * load + 0.035 * shift * still,
    twist: -lerp(0.12, 0.2, run) * L.forward * moving * (1 + 0.5 * a),
    nod: -0.75 * lean + lerp(0, 0.16, a) + 0.035 * cos(2 * TAU * d.phase) * moving + 0.01 * breath * still - 0.3 * dipN * 0.5,
    tail_up: lerp(-0.05, 0.25, a) - 0.25 * run + 0.08 * sin(2 * TAU * d.phase) * run, // build.py's tail_up lowers the tip
    // the tail swings out of a turn, late (d.turning is eased): follow-through
    tail_sway: soft(-0.06 * d.turning, 0.35) + 0.2 * L.forward * moving + (0.1 * sin(TAU * t / 2.7) + 0.1 * smooth(0.85, 1, sin(TAU * t / 7.3)) * sin(TAU * t * 1.7)) * still,
  };
  trunk(body, trunkParams);
  // into a turn the upper body leans in; the hips stay level, so the legs keep their reach
  // and twists into it from the chest up, so the head looks round first and the hips follow
  const lead = soft(0.04 * d.turning, 0.25);
  body.turns.spine = mul(axisAngle(Y, 0.6 * roll), mul(axisAngle(Z, 0.4 * lead), body.turns.spine));
  body.turns.chest = mul(axisAngle(Y, 0.4 * roll), mul(axisAngle(Z, 0.6 * lead), body.turns.chest));
  // the head leads into a turn and keeps looking where it goes
  const twist = trunkParams.twist!, yaw = soft(0.12 * d.turning, 0.6) + glance; // gain for turns up to 12 rad/s (src/player)
  body.turn("head", [X, trunkParams.nod!], [Z, twist * 0.8 + yaw], [[0, 0, 1], -0.25 * roll + 0.08 * glance]);

  const width = lerp(0.015, 0.0, run) + 0.05 * a + 0.025 * still;
  const plan = (f: Step, sign: number): Plant => {
    const q = axisAngle(UP, f.yaw);
    return { at: rotate(q, [sign * (FOOT_X + width), ANKLE + f.lift, f.z]), turn: mul(q, footTurn(sign, lerp(0.12, 0.25, a) * (1 - run), f.pitch)) };
  };
  const compress = (f: typeof L) => (f.planted ? 1 - f.forward * f.forward : 0);
  // the hips ride as low as the longest reach of the stride needs, so they need not dip at every step; walking
  // they rise a little over the planted foot, running they sink into each stance and rise in the flight
  const low = HIP - (ANKLE + sqrt(REACH * REACH - g.reach * g.reach));
  const bob = moving * (1 - run) * 0.005 * cos(2 * TAU * (d.phase - g.duty / 2));
  const drop = low - bob + run * (0.006 + 0.015 * max(compress(L), compress(R))) + d.dip + 0.01 * a * max(compress(L), compress(R));
  plantLegs(body, { L: plan(L, 1), R: plan(R, -1) }, drop, [0.012 * load * (1 - run) + 0.02 * shift * still, 0, 0]);

  // arms swing against the legs; furious they are carried wide; running they pump, bent at the elbow
  const swinging = mixArm(WALK_ARM, RAGE_ARM, a);
  for (const [sign, lr] of SIDES) {
    const f = sign > 0 ? L : R, p = mixArm(STAND_ARM, swinging, moving);
    const swing = p[1] * f.forward * moving - 0.35 * dipN;
    arm(body, sign, lr, p[0] - 0.02 * breath * still, swing, p[2], p[3], p[4] + 0.25 * max(0, -swing), p[5], p[6]);
  }
  if (run * moving > 0.001) {
    const pumping = new Body().copy(body), placed = body.fk();
    for (const [sign, lr] of SIDES) {
      const forward = -0.75 * (sign > 0 ? L : R).forward - 0.3 * dipN, bend = forward + 1.65;
      aimArm(pumping, placed, lr, [sign * lerp(0.15, 0.35, a), -cos(forward), sin(forward)], [-sign * 0.25, -cos(bend), sin(bend)], lerp(0.6, 1, a));
    }
    body.blend(pumping, run * moving, ARMS);
  }
  if (d.flex > 0.001) { // angry and standing still: bodybuilder poses, one after the other, each held a while
    const at = t / 3.2, i = Math.floor(at), blendIn = smooth(0, 0.25, at - i);
    const pump = 0.5 + 0.5 * sin(TAU * t * 0.9), poses = new Body().copy(body), next = new Body().copy(body);
    flexArms(poses, FLEXES[(i + 3) % 4]!, pump);
    flexArms(next, FLEXES[i % 4]!, pump);
    body.blend(poses.blend(next, blendIn), d.flex, ARMS);
  }
}

/** In the air: no crouch before, the body follows its vertical speed. Rising it stretches, arms up; falling the
 *  legs come forward for the landing, tail up, arms out for balance. */
function air(body: Body, vertical: number) {
  const up = smooth(-2.5, 2.5, vertical); // 1 rising … 0 falling
  trunk(body, { lean: lerp(0.3, -0.15, up), nod: lerp(-0.15, 0.1, up), tail_up: lerp(-0.7, 0.2, up) }); // negative: tip up
  for (const [sign, lr] of SIDES) leg(body, sign, lr, lerp(1.15, -0.15, up), lerp(0.35, 0.15, up), lerp(-0.45, 0.55, up), 0.2);
  const placed = body.fk();
  for (const [sign, lr] of SIDES)
    aimArm(body, placed, lr, [sign * lerp(0.8, 0.3, up), lerp(0.35, 0.85, up), lerp(0.35, 0.45, up)], [sign * lerp(0.4, 0.05, up), lerp(0.75, 0.95, up), lerp(0.5, 0.3, up)], lr === "R" ? 1 : 0.3);
}

/** Bent down to the ground in front: b 0 (upright) … 1 (right finger tips at `spot`, on the ground). */
function stoop(body: Body, b: number, spot: Vec, fist: number) {
  trunk(body, { lean: 1.45 * b, nod: -0.35 * b, tail_up: -0.2 * b });
  plantLegs(body, standing(0.04), 0.11 * b, [0, 0, -0.05 * b]); // a squat, the seat back to balance
  const placed = body.fk(), hanging = new Body().copy(body);
  arm(hanging, -1, "R", 0.5, 0, 0, 0.1, 0.3, 0, fist);
  reachArm(body, placed, "R", spot, [-1, 0.3, -0.3], fist);
  body.blend(hanging, 1 - smooth(0.2, 0.95, b), RIGHT_ARM);
  arm(body, 1, "L", 0.45 - 0.3 * b, 0.5 * b, 0, 0.1, 0.3); // out a little and back, for balance
}

/** Where the right hand picks a thing up and puts it down: on the ground ahead of the feet, a little to the right. */
export const PICKUP_SPOT: Vec = [-0.1, 0.02, 0.3], DROP_SPOT: Vec = [-0.1, 0.03, 0.36];

function action(body: Body, what: Action, progress: number, time: number) {
  const p = clamp(progress), b = sin(PI * p) ** 1.5;
  if (what === "pickup") stoop(body, b, PICKUP_SPOT, smooth(0.45, 0.6, p)); // grips at the bottom
  else if (what === "drop") stoop(body, b, DROP_SPOT, 1 - smooth(0.45, 0.6, p)); // lets go at the bottom
  else if (what === "gnaw") { // at a trunk in front: hands on it, the head working in quick bites
    const bite = sin(TAU * time * 3.2);
    trunk(body, { lean: 0.5, tail_up: -0.1, tail_sway: 0.06 * sin(TAU * time * 0.7) });
    body.turn("head", [X, -0.15 + 0.14 * bite], [Z, 0.12 * sin(TAU * time * 0.8)]);
    plantLegs(body, standing(0.04), 0.03, [0, 0, -0.03]);
    const placed = body.fk();
    for (const [sign, lr] of SIDES) reachArm(body, placed, lr, [sign * 0.1, 0.5 + 0.01 * bite, 0.36], [sign, -0.6, -0.2], 0.4);
  } else if (what === "build") { // as the old clip: bent over the dam, pressing sticks down, fist after fist
    const s = sin(TAU * p);
    trunk(body, { lean: 1.5 + 0.25 * abs(s), nod: -0.1, twist: 0.12 * s, tail_up: 0.3, tail_sway: 0.3 * s });
    plantLegs(body, standing(0.05), 0.05, [0, 0, -0.03]);
    for (const [sign, lr] of SIDES) arm(body, sign, lr, 0.45, -1.0 + 0.45 * sign * s, 0, 0.1, 0.5 + 0.4 * max(0, sign * s), 0, 1);
  }
}

/** Afloat: level, head up, hind legs paddling, tail steering. */
function swim(body: Body, phase: number, turning: number) {
  const s = sin(TAU * phase);
  trunk(body, { tail_up: 1.2, tail_sway: soft(-0.5 * turning, 0.6) + 0.12 * s });
  body.turn("hips", [Z, 0.05 * s], [X, 1.4]);
  body.turn("spine", [X, 0.08]);
  body.turn("chest", [X, -0.05]);
  body.turn("head", [X, -1.45], [Z, soft(0.3 * turning, 0.5)]);
  for (const [sign, lr] of SIDES) {
    const k = sin(TAU * phase + (sign > 0 ? 0 : PI)); // the hind legs kick in turn
    leg(body, sign, lr, 0.15 + 0.5 * k, 0.35 + 0.45 * max(0, -k), 0.5 + 0.3 * k, 0.25);
  }
  const placed = body.fk();
  for (const [sign, lr] of SIDES) reachArm(body, placed, lr, onChest(placed, [sign * 0.07, 0.06, 0.16]), [sign, 0, -1], 0.5); // folded under the chin
}

/** Under water: long and level, the head in line, forelegs folded under the chin, hind legs trailing with slow kicks,
 *  the tail driving in strokes up and down; the body stays as swim() pitched it. */
function dive(body: Body, phase: number, turning: number) {
  const s = sin(TAU * phase), late = sin(TAU * phase - 0.9);
  trunk(body, { tail_up: 1.35 + 0.3 * s, tail_sway: soft(-0.5 * turning, 0.6) });
  body.turns.tail2 = mul(axisAngle(X, 0.35 * late), body.turns.tail2); // the flat tip follows the stroke, late
  body.turn("hips", [X, 1.5 + 0.04 * s]);
  body.turn("spine", [X, 0.03 * s]);
  body.turn("chest", [X, -0.03 * s]);
  body.turn("head", [X, -1.3 - 0.04 * s], [Z, soft(0.3 * turning, 0.5)]);
  for (const [sign, lr] of SIDES) {
    const k = sin(TAU * phase + (sign > 0 ? 0 : 0.4)); // both hind feet kick nearly together, webbed and wide
    leg(body, sign, lr, -0.35 + 0.25 * k, 0.4 + 0.2 * max(0, -k), 1.0 + 0.2 * k, 0.3);
  }
  const placed = body.fk();
  for (const [sign, lr] of SIDES) reachArm(body, placed, lr, onChest(placed, [sign * 0.06, 0.04, 0.17]), [sign, 0, -1], 0.5);
}

/** How far the tail is raised over what the body does at slap progress p, radians: up in the first 38 %, struck down
 *  past rest by `below` at SLAP_HIT (src/player/state.ts: 0.5), then back. Each piece starts and ends at rest speed,
 *  so the strike is fast but never jumps. */
export function slapLift(p: number, below: number) {
  const UP = 1.1;
  return p < 0.38 ? UP * smooth(0, 0.38, p) : p < 0.5 ? UP - (UP + below) * smooth(0.38, 0.5, p) : -below * (1 - smooth(0.5, 1, p));
}

/** The tail slap, over the body as it is: the tail curls up, the tip trailing, then whips down flat onto the water
 *  (wet 1) or the ground (0); the back rocks with it. Only spine and tail, so the legs go on as they were. */
function tailSlap(body: Body, p: number, wet: number) {
  const below = lerp(0.08, 0.3, wet), lift = slapLift(p, below), tip = slapLift(max(0, p - 0.03), below);
  body.turns.tail1 = mul(axisAngle(X, lift), body.turns.tail1);
  body.turns.tail2 = mul(axisAngle(X, 0.6 * tip), body.turns.tail2);
  body.turns.spine = mul(axisAngle(X, -0.08 * lift), body.turns.spine);
}

export const createAnimator: CreateAnimator = (): Animator => {
  const body = new Body(), layer = new Body(), extra = new Body();
  const holds = [0, 1].map(() => ({ planted: false, z: 0, yaw: 0, dz: 0, dyaw: 0 }));
  let phase = 0, lastDistance: number | undefined, swimPhase = 0;
  let speed = 0, anger = 0, first = true, wasGrounded = true;
  const turning$ = new Ease(-Infinity, Infinity); // eased, not damped: a damped rate jumps in its first frame
  const air$ = new Ease(), acting$ = new Ease(), swimming$ = new Ease(), carrying$ = new Ease(), flexing$ = new Ease(), diving$ = new Ease();
  const pitch$ = new Ease(-Infinity, Infinity);
  let shown: Action = "none", progress = 0, vertical = 0;
  return {
    pose(m: SwimMotion, dt: number) {
      dt = clamp(dt, 0, 0.1);
      const set = (from: number, to: number, seconds: number) => (first ? to : damp(from, to, seconds, dt));
      speed = set(speed, m.speed, 0.08);
      anger = set(anger, clamp(m.anger), 0.3);
      const ease = (weight: Ease, target: number, seconds: number) => (first ? (weight.value = target) : weight.to(target, seconds, dt));
      const turning = ease(turning$, m.turning, 0.25);
      const inAir = ease(air$, m.grounded || m.swimming > 0.5 ? 0 : 1, 0.15);
      const swimming = ease(swimming$, clamp(m.swimming), 0.5);
      const carrying = ease(carrying$, m.carrying ? 1 : 0, 0.35);
      const diving = ease(diving$, m.diving && m.swimming > 0.5 ? 1 : 0, 0.6);
      // afloat, nose down while it sinks and up while it rises (others' beavers too: vertical travels)
      const pitch = ease(pitch$, m.swimming > 0.5 ? soft(-0.8 * m.vertical, 0.45) : 0, 0.4);
      if (m.action !== "none") { shown = m.action; progress = m.actionProgress; }
      if (!m.grounded) vertical = m.vertical; // after touchdown the air pose fades out as it was, not as at the top
      const acting = ease(acting$, m.action !== "none" ? 1 : 0, 0.25);
      const pivot = m.grounded ? m.turning : 0, stepping = speed + abs(pivot) * PIVOT;
      const g = gait(Math.min(stepping, max(speed, WALK_SPEED)), anger); // pivoting it walks, quicker, never runs
      // the stride follows the ground walked, not the clock
      const walked = lastDistance === undefined ? m.distance : clamp(m.distance - lastDistance, -0.5, 0.5);
      phase = lastDistance === undefined ? m.distance / g.cycle : phase + (walked + (m.grounded ? abs(m.turning) * PIVOT * dt : 0)) / g.cycle;
      phase -= Math.floor(phase);
      // touching down the stride goes on where it was: restarting it with a foot just landing (as it once did) made
      // the legs jump, and the air pose fades out over them anyway
      swimPhase = lastDistance === undefined ? m.distance / 0.6 + m.time * 0.5 : swimPhase + walked / 0.6 + dt * 0.5;
      swimPhase -= Math.floor(swimPhase);
      lastDistance = m.distance;
      // Where the feet go. The plan's z runs at the stepping pace: the part of it that is walking moves the foot along,
      // the part that is turning turns it about the middle. A foot that stays planted from one frame to the next is
      // then held where it stood, moved back by what was walked and turned against the body: the plan alone would
      // let it slide whenever the stride changes under it (speeding up, slowing down, turning harder). The
      // difference fades out in the swing, or slowly when it stands still and should come back beside the other.
      const along = stepping > 1e-4 ? speed / stepping : 1, spin = stepping > 1e-4 ? pivot / stepping : 0;
      const feet = [foot(phase, g), foot(phase + 0.5, g)].map((f, k): Step => {
        const held = holds[k]!, z = f.z * along, yaw = spin * f.z;
        // held no further than a little past the stride's reach: a foot left far behind would pull the hips down
        if (f.planted && held.planted && m.grounded && wasGrounded) { held.dz = clamp(held.z - walked, -g.reach - 0.02, g.reach + 0.02) - z; held.dyaw = held.yaw - pivot * dt - yaw; }
        const fade = exp(-dt / (f.planted && stepping > 0.05 ? Infinity : f.planted ? 0.3 : 0.06));
        held.dz *= fade; held.dyaw *= fade;
        held.z = z + held.dz; held.yaw = yaw + held.dyaw; held.planted = f.planted;
        return { ...f, z: held.z, yaw: held.yaw };
      }) as [Step, Step];
      wasGrounded = m.grounded;
      const flexing = ease(flexing$, smooth(0.35, 0.75, anger) * (1 - smooth(0.02, 0.3, speed)) * (1 - acting), 0.6);
      first = false;

      // the dip after a touchdown: eases in, deepest after 0.07 s, then fades
      const since = max(0, m.sinceLanding) / 0.07, dip = clamp(0.014 * m.landingSpeed, 0, 0.08) * since * since * exp(2 - 2 * since);
      body.reset();
      ground(body, { speed, pivot, feet, phase, anger, turning, dip: m.grounded ? dip : 0, time: m.time, flex: flexing }, g);
      if (acting > 0.001) { action(layer.reset(), shown, progress, m.time); body.blend(layer, acting); }
      if (inAir > 0.001) { air(layer.reset(), vertical); body.blend(layer, inAir); }
      if (swimming > 0.001) {
        swim(layer.reset(), swimPhase, turning);
        if (diving > 0.001) { dive(extra.reset(), swimPhase, turning); layer.blend(extra, diving); }
        layer.turns.hips = mul(axisAngle(X, pitch), layer.turns.hips);
        body.blend(layer, swimming);
      }
      if (m.action === "none" && m.actionProgress > 0) tailSlap(body, m.actionProgress, swimming);
      const holding = carrying * (1 - acting);
      if (holding > 0.001) { // the right hand before the chest, wherever the trunk leans
        layer.copy(body);
        const placed = layer.fk();
        reachArm(layer, placed, "R", onChest(placed, [-0.03, -0.1, 0.27]), [-1, -0.7, -0.2], 1);
        body.blend(layer, holding, RIGHT_ARM);
      }
      const reach = clamp(m.reachBack ?? 0);
      if (reach > 0) { // the left paw over the shoulder to the backpack, wherever the trunk leans
        layer.copy(body);
        const placed = layer.fk();
        reachArm(layer, placed, "L", onChest(placed, BACKPACK_REACH), rotate(placed.chest.delta, REACH_POLE), 0.5);
        body.blend(layer, reach, LEFT_ARM);
      }
      brows_at(body, anger);
      return body.pose();
    },
  };
};
