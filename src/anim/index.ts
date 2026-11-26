// How the beaver moves: turns what the body is doing (a Motion, from the player) into a Pose for its 20 bones.
// Pure maths; the pose functions it builds on are build.py's, ported in clips.ts.
//
//   const animator = createAnimator();
//   each frame: beaver.pose(animator.pose(player.motion, dt));
//
// Layers, each a whole Body, blended by weights that are damped over time, so nothing pops:
//   ground   gait (stride from motion.distance, planted feet by IK), standing (breathing, weight shift, a look
//            around, flexing when angry), turning lean, the dip after a landing, anger
//   low      sit (on its haunches, trunk upright, tail flat on the ground, paws at the chest, still breathing and
//            looking round) or crawl (low on all fours, the front paws stepping with the hind feet), by motion.low
//   bound    running: down on all fours, long and low, the hind feet and the front paws each landing nearly together,
//            the back humping and stretching (the crawl's pose, by speed; not carrying, low or afloat)
//   action   pickup, drop, gnaw, build, by actionProgress; feet stay planted
//   air      stretched while rising, legs forward while falling
//   swim     level in the water, hind legs paddle, tail steers; pitched nose down sinking, up rising (motion.vertical)
//   dive     under the surface (the player's own motion.diving): long and streamlined, the tail driving in strokes
//   slap     the tail up and struck down (action "none" with a progress), over all of the above but the carry
//   glide    on the Hoverboard (motion.glide): standing upright, the feet still whatever the speed, the arms out to
//            balance, the upper body leaning into a turn; the lantern's left paw and the outfit as they are
//   carry    the right arm holds the stick in front of the chest, over all of the above
//   reach    the left paw over the shoulder to the backpack (motion.reachBack), over all of the above, left arm only
//   stare    the head turned to look along motion.stare's aim, raised and cocked, over all of the above, head only
// The inputs that set the stride (distance, phase) are never damped: damping them would make the feet slide.
import { BACKPACK, WALK_SPEED, type Action, type Animator, type Bone, type CreateAnimator, type Motion } from "../contracts.ts";
import { BOARD_SPEED, type SwimMotion } from "../player/state.ts";
import { Body, X, Y, Z } from "./body.ts";
import { FLEXES, SIDES, arm, brows_at, flexArms, leg, trunk, type Side, type Trunk } from "./clips.ts";
import { foot, gait, type FootPlan, type Gait } from "./gait.ts";
import { ANKLE, REACH, aimArm, onChest, placeLeg, reachArm } from "./ik.ts";
import { add, axisAngle, clamp, inv, lerp, mul, rotate, slerp, smooth, type Quat, type Vec } from "./quat.ts";
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
 *  onChest() takes it. The elbow points up and out. */
const BACKPACK_REACH: Vec = [0.05, BACKPACK.y + BACKPACK.height * 0.4, BACKPACK.z - 0.03];
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
/** Gliding on the Hoverboard: out from the sides to balance, the elbows a little bent. */
const GLIDE_ARM: ArmParams = [0.15, 0.15, 0, 0.35, 0.3, 0, 0];

// Turning on the spot the feet step round: the stride runs on as if the feet walked PIVOT m per radian turned, and a
// planted foot turns back against the body as it moves under it, so it stands still on the ground.
const PIVOT = 0.15;
/** Into a turn the upper body leans (roll) and twists (lead), more the faster it goes: rad, from speed and turn rate. */
const intoTurn = (speed: number, turning: number) => [soft(0.13 * speed * turning, 0.3), soft(0.04 * turning, 0.25)] as const;
/** stepping: the pace the feet step at, m/s, walking plus pivoting; pivot: rad/s turned on the ground. */
/** A foot as the stride plans it, plus yaw: turned about the middle, for pivoting. */
type Step = FootPlan & { yaw: number };
interface Ground { speed: number; pivot: number; feet: [Step, Step]; phase: number; anger: number; turning: number; dip: number; time: number; flex: number }

/** On its feet: from standing through walking to running, all one function of speed, so it blends by itself. Gives
 *  back where it put the feet. */
function ground(body: Body, d: Ground, g: Gait): Record<Side, Plant> {
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
  const [roll, lead] = intoTurn(d.speed, d.turning);
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
  body.turns.spine = mul(axisAngle(Y, 0.6 * roll), mul(axisAngle(Z, 0.4 * lead), body.turns.spine));
  body.turns.chest = mul(axisAngle(Y, 0.4 * roll), mul(axisAngle(Z, 0.6 * lead), body.turns.chest));
  // the head leads into a turn and keeps looking where it goes
  const twist = trunkParams.twist!, yaw = soft(0.12 * d.turning, 0.6) + glance; // gain for turns up to 12 rad/s (src/player)
  body.turn("head", [X, trunkParams.nod!], [Z, twist * 0.8 + yaw], [[0, 0, 1], -0.25 * roll + 0.08 * glance]);

  const width = lerp(0.015, 0.0, run) + 0.05 * a + 0.025 * still;
  const plan = (f: Step, sign: number): Plant => {
    const q = axisAngle(UP, f.yaw), out = lerp(0.12, 0.25, a) * (1 - run), t = onToes(f, run, out);
    return { at: rotate(q, [sign * (FOOT_X + width + t.side), ANKLE + f.lift + t.rise, f.z + t.ahead]), turn: mul(q, footTurn(sign, out, f.pitch + t.roll)) };
  };
  const compress = (f: typeof L) => (f.planted ? 1 - f.forward * f.forward : 0);
  // the hips ride as low as the longest reach of the stride needs, so they need not dip at every step; walking
  // they rise a little over the planted foot, running they sink into each stance and rise in the flight
  const low = HIP - (ANKLE + sqrt(REACH * REACH - g.reach * g.reach));
  const bob = moving * (1 - run) * 0.005 * cos(2 * TAU * (d.phase - g.duty / 2));
  const drop = low - bob + run * (0.006 + 0.015 * max(compress(L), compress(R))) + d.dip + 0.01 * a * max(compress(L), compress(R));
  const feet = { L: plan(L, 1), R: plan(R, -1) };
  plantLegs(body, feet, drop, [0.012 * load * (1 - run) + 0.02 * shift * still, 0, 0]);

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
  return feet;
}

/** Standing on the Hoverboard: the arms out to balance, the upper body leaning into a turn as at the board's speed. */
function glide(body: Body, turning: number) {
  const [roll, lead] = intoTurn(BOARD_SPEED, turning); // it stands, so ground() leans as standing: at the board's speed
  body.turns.spine = mul(axisAngle(Y, 0.6 * roll), mul(axisAngle(Z, 0.4 * lead), body.turns.spine));
  body.turns.chest = mul(axisAngle(Y, 0.4 * roll), mul(axisAngle(Z, 0.6 * lead), body.turns.chest));
  for (const [sign, lr] of SIDES) arm(body, sign, lr, ...GLIDE_ARM);
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

/** A jump out of a bound: the trunk as the bound has it, long and low; the front paws stretched forward and down
 *  for the landing, the hind legs trailing out behind while rising and coming in under the body while falling. */
function leap(body: Body, vertical: number) {
  const up = smooth(-2.5, 2.5, vertical); // 1 rising … 0 falling
  for (const [sign, lr] of SIDES) leg(body, sign, lr, lerp(0.9, -0.5, up), lerp(1.2, 0.4, up), lerp(-0.6, 0.6, up), 0.15);
  const placed = body.fk();
  // the chest's frame lies down with the trunk: its up is ahead, its forward is down
  for (const [sign, lr] of SIDES) aimArm(body, placed, lr, [sign * 0.25, 0.75, lerp(0.6, 0.4, up)], [sign * 0.1, 0.85, lerp(0.5, 0.3, up)], 0.3);
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

/** Sitting on its haunches: the hips low, the feet flat ahead, the trunk upright over them, the tail lying flat on
 *  the ground behind, the front paws together at the chest. The head keeps what ground() gave it (the look round),
 *  the chest the breath. */
function sit(body: Body, time: number) {
  const head = body.turns.head, breath = sin(TAU * time / 3.6);
  trunk(body, { lean: -0.12, tail_up: SIT_TAIL, tail_sway: 0.05 * sin(TAU * time / 5.3) });
  body.turns.tail2 = mul(axisAngle(X, SIT_TIP), body.turns.tail2);
  body.turns.chest = mul(axisAngle(X, 0.03 * breath), body.turns.chest);
  body.turns.head = mul(axisAngle(X, 0.05), head); // the trunk leans back a little: the head forward against it
  plantLegs(body, { L: { at: [FOOT_X + 0.03, ANKLE, SIT_FEET], turn: footTurn(1, 0.3, 0) }, R: { at: [-FOOT_X - 0.03, ANKLE, SIT_FEET], turn: footTurn(-1, 0.3, 0) } }, SIT_DROP, [0, 0, -0.03]);
  const placed = body.fk();
  for (const [sign, lr] of SIDES) reachArm(body, placed, lr, onChest(placed, [sign * 0.05, -0.13 + 0.004 * breath, 0.15]), [sign, -0.4, -0.4], 0.3);
}
/** Where the right paw holds the paddle, relative to the chest (x left, y up, z ahead), at `phase` 0 … 1 of a stroke:
 *  in ahead and low out to the right at the catch, pulled back along the hull to the hip, lifted and brought forward
 *  again. strength 0 … 1 (from the speed): 0 rests the paw at the chest as sitting does. */
export function paddleStroke(phase: number, strength: number): Vec {
  const PULL = 0.6, pull = phase < PULL, t = smooth(0, 1, pull ? phase / PULL : (phase - PULL) / (1 - PULL));
  const stroke: Vec = [-0.2, pull ? -0.24 : -0.24 + 0.12 * sin(Math.PI * t), pull ? lerp(0.3, -0.06, t) : lerp(-0.06, 0.3, t)];
  const rest: Vec = [-0.05, -0.13, 0.15];
  return [lerp(rest[0], stroke[0], strength), lerp(rest[1], stroke[1], strength), lerp(rest[2], stroke[2], strength)];
}
const STROKE = 0.9; // m the canoe goes per stroke

const SIT_DROP = 0.1, SIT_FEET = 0.12, SIT_TAIL = -0.2, SIT_TIP = -0.2; // m, m, rad, rad

/** On all fours: the trunk pitched forward and low, the head up to look ahead, the hind feet on their plans, the front
 *  paws on the ground on theirs (each on the distance walked, so none slides). b 0 crawls: each paw steps with the hind
 *  foot of the other side. b 1 bounds, as a beaver runs: the hind feet push off nearly together and the front paws land
 *  between, the back arching as the hind feet swing in under it and stretching as the paws reach out, the rump rising
 *  in the flight. roll and lead: how the trunk leans and twists into a turn, as standing. */
function allFours(body: Body, hind: [Step, Step], paws: [Step, Step], g: Gait, turning: number, b: number, roll: number, lead: number): Record<Side, Plant> {
  const under = (hind[0].forward + hind[1].forward) / 2; // 1 with the hind feet forward under the belly, -1 pushed back
  // Pitch of the pelvis, the back and the chest, each from the one before (rad, forward): crawling as trunk() leans
  // them, the chest up; bounding the back long and level, as low as the rump. The tail is turned back down by what
  // the pelvis pitches, so it trails behind a little below level, bobbing only a little as the back humps.
  const pitch = [0.4, 0.35, 0.25].map((share, k) => lerp(share * CRAWL_LEAN, BOUND_PITCH[k]!, b));
  const back = pitch[0]! + pitch[1]! + pitch[2]!;
  trunk(body, { tail_up: lerp(0.4, pitch[0]! - BOUND_TAIL, b) - 0.15 * b * under, tail_sway: soft(-0.06 * turning, 0.35) + lerp(0.15, 0.05, b) * hind[0].forward });
  // The back flexes with the hind legs: humped (the middle of the back up, rump and chest staying) as they swing in
  // under the belly, long as they push off behind.
  const arch = BOUND_ARCH * b * under;
  body.turns.hips = mul(axisAngle(X, pitch[0]! - arch), body.turns.hips);
  body.turns.spine = mul(axisAngle(Y, 0.6 * roll), mul(axisAngle(Z, 0.4 * lead), mul(axisAngle(X, pitch[1]! + 2 * arch), body.turns.spine)));
  body.turns.chest = mul(axisAngle(Y, 0.4 * roll), mul(axisAngle(Z, 0.6 * lead), mul(axisAngle(X, pitch[2]! - arch), body.turns.chest)));
  // crawling the head comes up to look ahead; bounding it stays in line with the back, the nose a little down
  body.turn("head", [X, lerp(0.15 * CRAWL_LEAN, BOUND_NOSE, b) - back], [Z, soft(0.12 * turning, 0.6)], [[0, 0, 1], -0.25 * roll]);
  // Bounding the body is drawn out long along the back and the neck: longest as the hind feet push off behind, shorter
  // as it humps with them under the belly.
  const long = b * (BOUND_LONG - BOUND_LONG_FLEX * under);
  body.move("spine", [0, 0.4 * long, 0]);
  body.move("chest", [0, 0.4 * long, 0]);
  body.move("head", [0, 0.2 * long, 0]);
  // Airtime: once both hind feet have pushed off the body rises, sails over the front paws as they land and carry it,
  // and comes down as the hind feet reach the ground again. Only while both hind feet are up (their lifts are 0 on the
  // ground and at lift-off and touchdown, so it eases in and out): a hind leg on the ground is too short to follow.
  // Feet in the air rise with the body, feet on the ground stay there.
  const up = (f: Step) => (g.lift > 1e-6 ? f.lift / g.lift : 0), hop = BOUND_HOP * b * up(hind[0]) * up(hind[1]);
  const plan = (f: Step, sign: number): Plant => {
    const q = axisAngle(UP, f.yaw);
    // the swing's kick back is short (a hind leg under the low body cannot reach as far back as an upright one): what
    // it is cut short by goes up instead, so the foot flicks up off the ground rather than sliding forward along it
    // and so is its reach forward before touchdown: the foot comes down onto the ground from above instead
    const behind = -g.reach - f.z, ahead = f.z - g.reach;
    const z = f.planted ? f.z : behind > 0 ? lerp(f.z, -g.reach - KICK * Math.tanh(behind / KICK), b) : ahead > 0 ? lerp(f.z, g.reach + REACH_ON * Math.tanh(ahead / REACH_ON), b) : f.z;
    const out = 0.2 * (1 - g.run), t = onToes(f, g.run, out); // toed out as standing at a run, so they blend
    const y = ANKLE + f.lift + FLICK * Math.abs(z - f.z) + hop * up(f) + t.rise;
    return { at: rotate(q, [sign * (FOOT_X + 0.03 + t.side), y, z + t.ahead]), turn: mul(q, footTurn(sign, out, f.pitch + t.roll)) };
  };
  const pressed = (f: Step) => (f.planted ? 1 - f.forward * f.forward : 0);
  const feet = { L: plan(hind[0], 1), R: plan(hind[1], -1) };
  plantLegs(body, feet, lerp(CRAWL_DROP, BOUND_DROP, b) + b * BOUND_SINK * max(pressed(hind[0]), pressed(hind[1])) - hop, [0, 0, -0.04 * (1 - b)]);
  const placed = body.fk(), pawZ = lerp(PAW_Z, BOUND_PAW_Z, b);
  for (const [sign, lr] of SIDES) {
    const f = paws[sign > 0 ? 0 : 1], q = axisAngle(UP, f.yaw);
    reachArm(body, placed, lr, rotate(q, [sign * PAW_X, PAW_Y + 1.5 * f.lift + hop * up(f), pawZ + f.z]), [sign * 0.4, 0.2, -1], 0.2);
  }
  return feet;
}
/** Running (run 0 … 1) a foot pushes off rolling onto its toes: the heel comes up through the second half of the
 *  stance while the toes stay where they stand, and the foot stays stretched out behind into the swing, then curls
 *  forward (smooth at lift-off). How far it rolls (rad, toes down), and how far that moves the ankle: turned about the
 *  toes (TOE ahead of it along the foot, toed out by `out` rad; ANKLE above the sole) up, ahead and out to its side. */
function onToes(f: Step, run: number, out: number) {
  const s = Math.acos(clamp(f.planted ? f.forward : -f.forward, -1, 1)) / PI;
  const roll = run * TOE_OFF * (f.planted ? smooth(0.5, 1, s) : 1 - smooth(0, 0.4, s));
  const along = TOE * (1 - cos(roll)) + ANKLE * sin(roll);
  return { roll, rise: ANKLE * (cos(roll) - 1) + TOE * sin(roll), ahead: cos(out) * along, side: sin(out) * along };
}
/** Between two poses that each stood on their feet, a blend of them does not: blended joint turns put the feet
 *  somewhere between. The feet go back onto the blend of where each pose put them, the hips lower only if they must. */
function replant(body: Body, a: Record<Side, Plant>, b: Record<Side, Plant>, t: number) {
  const mix = (lr: Side): Plant => ({ at: a[lr].at.map((x, k) => lerp(x, b[lr].at[k]!, t)) as Vec, turn: slerp(a[lr].turn, b[lr].turn, t) });
  plantLegs(body, { L: mix("L"), R: mix("R") }, 0);
}
/** rad the trunk leans, m the hips go down, and where the finger tips of a front paw stand at the middle of its step. */
const CRAWL_LEAN = 1.25, CRAWL_DROP = 0.08;
export const PAW_X = 0.13, PAW_Y = 0.015, PAW_Z = 0.36;
/** Bounding: the pitch of the pelvis, the back and the chest (rad, each from the one before: the back long, round and
 *  level, the rump low), how far the tail is turned up from trailing straight behind the pelvis (rad), the nose below
 *  level (rad), the most the back humps (rad), m the rump sinks into a stance and the hips ride lower than crawling,
 *  and where the paws stand at the middle of their step (reaching ahead under the chin); KICK: m the hind feet swing back past the stance, at most,
 *  and FLICK: m they lift per m that cuts off. */
const BOUND_LONG = 0.08, BOUND_LONG_FLEX = 0.03; // m the back and neck are drawn out bounding, and how much more or less as the back stretches or humps
const BOUND_PITCH = [0.7, 0.9, 0], BOUND_TAIL = 0.2, BOUND_NOSE = 0.3, BOUND_ARCH = 0.25, BOUND_SINK = 0.015, BOUND_DROP = 0.04, BOUND_PAW_Z = 0.56, KICK = 0.07, FLICK = 1.5, BOUND_HOP = 0.04, REACH_ON = 0.02, TOE_OFF = 0.4, TOE = 0.12;
/** How far behind the left foot (or paw) the right one comes down, in strides: walking and crawling they take turns
 *  (0.5); bounding the hind feet land nearly together and the paws a little apart, half a stride after them. */
export const SPLIT = { hind: [0.5, 0.08], paws: [0.5, 0.12] } as const;
/** Strides the front paws come down after the hind feet: walking and crawling half a stride; bounding later, after
 *  the flight that follows the push-off. */
const PAWS_AFTER = [0.5, 0.6] as const;
const LEAP_EASE = 0.3; // s a jump out of a bound takes to go over into the leap
const RETIME = 0.8;

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

/** How far the head turns to stare, rad: either way, down and up; and the cock, its top tipped to the beaver's right. */
const STARE_YAW = 1.3, STARE_DOWN = 0.5, STARE_UP = 0.9, COCK = 0.22, NECK = 0.012; // NECK: m the head rises

/** The head looking along yaw and pitch (relative to the body, armature space), cocked: its turn from rest in armature
 *  space is yaw about up, then pitch about its left, then the cock about its own forward; set as a turn relative to the
 *  chest as it stands now. Raised a little on its neck. */
function stare(body: Body, yaw: number, pitch: number) {
  const chest = body.fk().chest.delta;
  const look = mul(axisAngle(UP, clamp(yaw, -STARE_YAW, STARE_YAW)), mul(axisAngle(X, -clamp(pitch, -STARE_DOWN, STARE_UP)), axisAngle([0, 0, 1], COCK)));
  body.turns.head = mul(inv(chest), look);
  body.move("head", add(body.offsets.head, [0, NECK, 0]));
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
  const holds = [0, 1, 2, 3].map(() => ({ planted: false, z: 0, yaw: 0, dz: 0, dyaw: 0 }));
  let phase = 0, lastSpin = 0, lastDistance: number | undefined, swimPhase = 0, strokePhase = 0;
  const offsets = [0, 0.5, 0.5, 1]; // in strides behind the left hind foot: right hind foot, left and right front paw
  let speed = 0, anger = 0, first = true, wasGrounded = true;
  const turning$ = new Ease(-Infinity, Infinity); // eased, not damped: a damped rate jumps in its first frame
  const sit$ = new Ease(), crawl$ = new Ease(), bound$ = new Ease(), air$ = new Ease(), leap$ = new Ease(), acting$ = new Ease(), swimming$ = new Ease(), carrying$ = new Ease(), flexing$ = new Ease(), diving$ = new Ease(), paddle$ = new Ease(), glide$ = new Ease();
  const pitch$ = new Ease(-Infinity, Infinity);
  let shown: Action = "none", progress = 0, vertical = 0;
  return {
    pose(m: SwimMotion, dt: number) {
      dt = clamp(dt, 0, 0.1);
      const set = (from: number, to: number, seconds: number) => (first ? to : damp(from, to, seconds, dt));
      // gliding it stands on the board however fast it goes: the feet keep no pace (others' beavers too: glide travels)
      speed = set(speed, m.glide ? 0 : m.speed, 0.08);
      anger = set(anger, clamp(m.anger), 0.3);
      const ease = (weight: Ease, target: number, seconds: number) => (first ? (weight.value = target) : weight.to(target, seconds, dt));
      const turning = ease(turning$, m.turning, 0.25);
      const airborne = m.grounded || m.swimming > 0.5 ? 0 : 1;
      const upright = ease(air$, airborne, 0.15), leaping = ease(leap$, airborne, LEAP_EASE);
      const swimming = ease(swimming$, clamp(m.swimming), 0.5);
      const carrying = ease(carrying$, m.carrying ? 1 : 0, 0.35);
      const diving = ease(diving$, m.diving && m.swimming > 0.5 ? 1 : 0, 0.6);
      // afloat, nose down while it sinks and up while it rises (others' beavers too: vertical travels)
      const pitch = ease(pitch$, m.swimming > 0.5 ? soft(-0.8 * m.vertical, 0.45) : 0, 0.4);
      if (m.action !== "none") { shown = m.action; progress = m.actionProgress; }
      if (!m.grounded) vertical = m.vertical; // after touchdown the air pose fades out as it was, not as at the top
      const acting = ease(acting$, m.action !== "none" ? 1 : 0, 0.25);
      const sitting = ease(sit$, m.low === "sit" ? 1 : 0, 0.45), crawling = ease(crawl$, m.low === "crawl" ? 1 : 0, 0.35);
      const pivot = m.grounded && !m.glide ? m.turning : 0, stepping = speed + abs(pivot) * PIVOT;
      const g = gait(Math.min(stepping, max(speed, WALK_SPEED)), anger); // pivoting it walks, quicker, never runs
      // running it drops onto all fours and bounds; not with a stick in the paw, low, or afloat (others' beavers too)
      const bounding = ease(bound$, m.low || m.carrying ? 0 : g.run * (1 - clamp(m.swimming)), 0.4);
      // the stride follows the ground walked, not the clock
      const walked = lastDistance === undefined ? m.distance : clamp(m.distance - lastDistance, -0.5, 0.5);
      const advanced = lastDistance === undefined ? 0 : (walked + (m.grounded ? abs(m.turning) * PIVOT * dt : 0)) / g.cycle;
      phase = lastDistance === undefined ? m.distance / g.cycle : phase + advanced;
      phase -= Math.floor(phase);
      // standing still the stride does not show (no reach, no lift): it settles where both feet stand, so moving off
      // never starts with a foot caught in the middle of a swing
      if (stepping < 0.005) phase = phase < 0.3 || phase >= 0.8 ? 0.05 : 0.55;
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
      // shares of walking and turning, from the turn whether or not on the ground: leaving the ground they would change
      // at once, and the feet with them (the paws, far ahead, sideways)
      const turned = speed + abs(m.turning) * PIVOT, along = turned > 1e-4 ? speed / turned : 1, spin = turned > 1e-4 ? m.turning / turned : 0;
      // Hind feet, then front paws. Walking they take turns; bounding they come down in pairs. A foot changes its
      // timing only in the air, so none is ever pulled along the ground: its swing runs up to RETIME faster or slower
      // than the stride, most in the middle of the swing and not at all at lift-off and touchdown, easing off as it
      // comes to the new timing, so the foot never jerks. Standing, the timing does not show and it changes at once.
      const split = (s: readonly [number, number]) => lerp(s[0], s[1], bounding);
      const timing = [0, split(SPLIT.hind), split(PAWS_AFTER), split(PAWS_AFTER) + split(SPLIT.paws)];
      for (let k = 1; k < 4; k++) {
        const swing = foot(phase + offsets[k]!, g), up = g.lift > 1e-6 ? swing.lift / g.lift : 0;
        if (stepping < 0.02 || first) offsets[k] = timing[k]!;
        else if (!swing.planted) offsets[k]! += RETIME * Math.tanh((timing[k]! - offsets[k]!) / 0.05) * up * abs(advanced);
      }
      const plans = offsets.map((o) => foot(phase + o, g));
      const [L, R, pawL, pawR] = plans.map((f, k): Step => {
        const held = holds[k]!, z = f.z * along, yaw = spin * f.z;
        // held no further than a little past the stride's reach: a foot left far behind would pull the hips down
        if (f.planted && held.planted && m.grounded && wasGrounded) { held.dz = clamp(held.z - walked, -g.reach - 0.02, g.reach + 0.02) - z; held.dyaw = held.yaw - pivot * dt - yaw; }
        else if (!f.planted) held.dyaw -= (spin - lastSpin) * f.z; // in the air a sudden change of turn (it can stop at once) eases in
        const fade = exp(-dt / (f.planted && stepping > 0.05 ? Infinity : f.planted ? 0.3 : 0.06));
        held.dz *= fade; held.dyaw *= fade;
        held.z = z + held.dz; held.yaw = yaw + held.dyaw; held.planted = f.planted;
        return { ...f, z: held.z, yaw: held.yaw };
      });
      const feet: [Step, Step] = [L!, R!];
      wasGrounded = m.grounded;
      lastSpin = spin;
      const flexing = ease(flexing$, smooth(0.35, 0.75, anger) * (1 - smooth(0.02, 0.3, speed)) * (1 - acting), 0.6);
      first = false;

      // the dip after a touchdown: eases in, deepest after 0.07 s, then fades
      const since = max(0, m.sinceLanding) / 0.07, dip = clamp(0.014 * m.landingSpeed, 0, 0.08) * since * since * exp(2 - 2 * since);
      body.reset();
      const standOn = ground(body, { speed, pivot, feet, phase, anger, turning, dip: m.grounded ? dip : 0, time: m.time, flex: flexing }, g);
      if (sitting > 0.001) { sit(layer.copy(body), m.time); body.blend(layer, sitting); }
      const gliding = ease(glide$, m.glide ? 1 : 0, 0.3);
      if (gliding > 0.001) { glide(layer.copy(body), turning); body.blend(layer, gliding); }
      const fours = max(crawling, bounding);
      if (fours > 0.001) {
        const fourOn = allFours(layer.copy(body), feet, [pawL!, pawR!], g, turning, bounding / (crawling + bounding), ...intoTurn(speed, turning));
        body.blend(layer, fours);
        if (fours < 0.999) replant(body, standOn, fourOn, fours);
      }
      if (acting > 0.001) { action(layer.reset(), shown, progress, m.time); body.blend(layer, acting); }
      // out of a bound the limbs go over into the leap more slowly: they are in the middle of a fast stride
      const inAir = lerp(upright, leaping, bounding);
      if (inAir > 0.001) {
        air(layer.reset(), vertical);
        if (bounding > 0.001) { leap(extra.copy(body), vertical); layer.blend(extra, bounding); } // the trunk stays long
        body.blend(layer, inAir);
      }
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
      const paddling = ease(paddle$, m.paddle ? 1 : 0, 0.4);
      strokePhase = (strokePhase + speed * dt / STROKE) % 1;
      if (paddling > 0.001) { // in the canoe: the right paw strokes the paddle as fast as the canoe goes
        layer.copy(body);
        const placed = layer.fk();
        reachArm(layer, placed, "R", onChest(placed, paddleStroke(strokePhase, smooth(0.03, 0.4, speed))), rotate(placed.chest.delta, [-1, -0.4, -0.3]), 1);
        body.blend(layer, paddling, RIGHT_ARM);
      }
      const reach = clamp(m.reachBack ?? 0);
      if (reach > 0) { // the left paw over the shoulder to the backpack, wherever the trunk leans
        layer.copy(body);
        const placed = layer.fk();
        reachArm(layer, placed, "L", onChest(placed, BACKPACK_REACH), rotate(placed.chest.delta, REACH_POLE), 0.5);
        body.blend(layer, reach, LEFT_ARM);
      }
      const staring = clamp(m.stare?.weight ?? 0);
      if (staring > 0) { // the head at the camera, over whatever the body does: fixed, no look round, no breath in it
        stare(layer.copy(body), m.stare!.yaw, m.stare!.pitch);
        body.blend(layer, staring, ["head"]);
      }
      brows_at(body, anger);
      return body.pose();
    },
  };
};
