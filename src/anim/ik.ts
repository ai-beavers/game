// Two-bone leg IK for the animator: puts an ankle on a target with the knee bending forward, and turns the foot
// as asked, whatever the hips do. Works on a Body (body.ts) in armature space.
//
//   const placed = body.fk();  placeLeg(body, placed, "L", ankleTarget, footTurn, pole);
import type { Body, Placed } from "./body.ts";
import { sub } from "./body.ts";
import { REST } from "./rest.ts";
import { add, inv, mul, normalize, rotate, scaleV, type Quat, type Vec } from "./quat.ts";
import type { Bone } from "../contracts.ts";

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec): Vec => scaleV(a, 1 / (length(a) || 1));
/** The shortest turn that takes direction a to direction b. */
export const arc = (a: Vec, b: Vec): Quat => { const u = unit(a), w = unit(b), c = cross(u, w); return normalize([c[0], c[1], c[2], 1 + dot(u, w)]); };

const at = (b: Bone) => REST[b].armaturePosition;
export const THIGH = length(sub(at("shin_L"), at("thigh_L"))), SHIN = length(sub(at("foot_L"), at("shin_L")));
/** How far the hip joint can be from the ankle with the knee still a little bent. */
export const REACH = 0.97 * (THIGH + SHIN);
/** Height of the ankle over the sole when the foot is flat. */
export const ANKLE = at("foot_L")[1];

/** Two bones from `root` towards `target`, bending towards `pole`: where the joint and the end come to lie. */
function solve(root: Vec, target: Vec, first: number, second: number, pole: Vec) {
  const toTarget = sub(target, root);
  const d = Math.min(first + second - 1e-4, Math.max(Math.abs(first - second) + 1e-3, length(toTarget)));
  const u = unit(toTarget), side = unit(sub(pole, scaleV(u, dot(pole, u))));
  const cosA = (first * first + d * d - second * second) / (2 * first * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  return { joint: add(root, add(scaleV(u, first * cosA), scaleV(side, first * sinA))), end: add(root, scaleV(u, d)) };
}

/** Puts an ankle on a target (armature space) and turns the foot as asked (armature space, from rest). The knee
 *  bends forward of the line from hip to ankle, and `outward` (m per m) to the side; it never flips over. */
export function placeLeg(body: Body, placed: Record<Bone, Placed>, lr: "L" | "R", target: Vec, foot: Quat, outward = 0.25) {
  const thigh = `thigh_${lr}` as const, shin = `shin_${lr}` as const, footBone = `foot_${lr}` as const;
  const hip = placed[thigh].at, u = unit(sub(target, hip));
  const pole: Vec = [(lr === "L" ? 1 : -1) * outward, u[2], -u[1]]; // the leg's line turned 90° forward about x, a little out
  const { joint: knee, end: ankle } = solve(hip, target, THIGH, SHIN, pole);
  const thighTurn = arc(sub(at(shin), at(thigh)), sub(knee, hip));
  const shinTurn = mul(arc(rotate(thighTurn, sub(at(footBone), at(shin))), sub(ankle, knee)), thighTurn);
  body.turns[thigh] = mul(inv(placed.hips.delta), thighTurn);
  body.turns[shin] = mul(inv(thighTurn), shinTurn);
  body.turns[footBone] = mul(inv(shinTurn), foot);
}

/** Points an arm: upper arm and forearm along directions given in the chest's frame (x left, y up, z forward),
 *  so the arm goes along when the trunk leans. fist 0 … 1 as build.py's arm(). */
export function aimArm(body: Body, placed: Record<Bone, Placed>, lr: "L" | "R", upper: Vec, fore: Vec, fist = 0) {
  const sign = lr === "L" ? 1 : -1, chest = placed.chest.delta;
  const upperBone = `upper_arm_${lr}` as const, foreBone = `forearm_${lr}` as const, hand = `hand_${lr}` as const;
  const upperTurn = arc(sub(at(foreBone), at(upperBone)), rotate(chest, upper));
  const foreTurn = mul(arc(rotate(upperTurn, sub(at(hand), at(foreBone))), rotate(chest, fore)), upperTurn);
  body.turns[upperBone] = mul(inv(chest), upperTurn);
  body.turns[foreBone] = mul(inv(upperTurn), foreTurn);
  body.turn(hand, [[0, 0, -1], -sign * 0.5 * fist]);
  body.scales[hand] = 1 + 0.35 * fist;
}

export const UPPER_ARM = length(sub(at("forearm_L"), at("upper_arm_L"))), FOREARM = length(sub(at("hand_L"), at("forearm_L")));
/** From the wrist to the finger tips, along the forearm. */
export const HAND = 0.1;

/** Puts the finger tips of a hand on a target (armature space), the elbow bending towards `pole`. */
export function reachArm(body: Body, placed: Record<Bone, Placed>, lr: "L" | "R", target: Vec, pole: Vec, fist = 0) {
  const sign = lr === "L" ? 1 : -1, chest = placed.chest.delta;
  const upperBone = `upper_arm_${lr}` as const, foreBone = `forearm_${lr}` as const, hand = `hand_${lr}` as const;
  const shoulder = rotate(chest, sub(at(upperBone), at("chest")));
  const from = add(placed.chest.at, shoulder), { joint: elbow, end } = solve(from, target, UPPER_ARM, FOREARM + HAND, pole);
  const upperTurn = arc(sub(at(foreBone), at(upperBone)), sub(elbow, from));
  const foreTurn = mul(arc(rotate(upperTurn, sub(at(hand), at(foreBone))), sub(end, elbow)), upperTurn);
  body.turns[upperBone] = mul(inv(chest), upperTurn);
  body.turns[foreBone] = mul(inv(upperTurn), foreTurn);
  body.turn(hand, [[0, 0, -1], -sign * 0.5 * fist]);
  body.scales[hand] = 1 + 0.35 * fist;
}

/** A point given relative to the chest (x left, y up, z forward, from the chest bone's head), in armature space:
 *  it moves along when the trunk leans. */
export const onChest = (placed: Record<Bone, Placed>, offset: Vec): Vec => add(placed.chest.at, rotate(placed.chest.delta, offset));
