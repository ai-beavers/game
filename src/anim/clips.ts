// The pose functions of tools/blender/build.py (section "motion"), ported one to one. Each sets bones of a Body
// for a moment t of a loop (0 … 1). clips.test.ts proves they give what the clips in assets/beaver.glb hold;
// the animator (index.ts) builds its own poses from these pieces.
//
//   const body = new Body();  walk(body, 0.25);  body.pose()
import { Body, X, Y, Z, v } from "./body.ts";
import { lerp as mix, smooth } from "./quat.ts";

export const SIDES = [[1, "L"], [-1, "R"]] as const;
export type Side = "L" | "R";
const { sin, cos, abs, max, min, PI } = Math; // as in build.py

export function arm(body: Body, sign: number, lr: Side, lower = 0, swing = 0, back = 0, elbow = 0, curl = 0, inward = 0, fist = 0) {
  body.turn(`upper_arm_${lr}`, [Y, sign * lower], [X, swing], [Z, sign * back]);
  body.turn(`forearm_${lr}`, [Y, -sign * elbow], [X, -curl], [Z, -sign * inward]);
  body.turn(`hand_${lr}`, [Y, -sign * 0.5 * fist]);
  body.scales[`hand_${lr}`] = 1 + 0.35 * fist;
}

export function brows_at(body: Body, a: number) {
  for (const [sign, lr] of SIDES) { // they drop and tilt inwards over the eyes
    body.turn(`brow_${lr}`, [Y, -sign * mix(-0.1, 0.5, a)]);
    body.move(`brow_${lr}`, v(0, 0, mix(0.012, 0.004, a)));
    body.scales[`brow_${lr}`] = mix(0.02, 0.9, a); // calm: none to see
  }
}

export interface Trunk { lean?: number; drop?: number; sway?: number; twist?: number; nod?: number; tail_up?: number; tail_sway?: number }
export function trunk(body: Body, { lean = 0, drop = 0, sway = 0, twist = 0, nod = 0, tail_up = 0, tail_sway = 0 }: Trunk = {}) {
  body.turn("hips", [Y, sway], [Z, twist], [X, lean * 0.4]);
  body.move("hips", v(0, 0, -drop));
  body.turn("spine", [Z, -twist * 0.8], [X, lean * 0.35]);
  body.turn("chest", [Z, -twist * 1.1], [Y, -sway * 0.7], [X, lean * 0.25]);
  body.turn("head", [X, nod], [Z, twist * 0.8]);
  body.turn("tail1", [Z, tail_sway], [X, -tail_up]);
  body.turn("tail2", [Z, tail_sway * 1.2], [X, -tail_up * 0.5]);
}

export function leg(body: Body, sign: number, lr: Side, hip = 0, knee = 0, ankle = 0, splay = 0.1) {
  body.turn(`thigh_${lr}`, [X, -hip], [Y, sign * splay]);
  body.turn(`shin_${lr}`, [X, knee]);
  body.turn(`foot_${lr}`, [X, ankle]);
}

/** The legs and trunk of one double step. Furious: wide, heavy, chest out, shoulders rolling. */
export function stride(body: Body, t: number, a: number) {
  const s = sin(2 * PI * t), c = cos(2 * PI * t);
  trunk(body, { lean: mix(0.05, -0.12, a), drop: -0.02 * abs(s) * mix(1, 1.6, a), sway: mix(0.07, 0.16, a) * s, twist: mix(0.12, 0.2, a) * s,
    nod: mix(-0.05, 0.16, a) + 0.04 * c, tail_up: mix(-0.05, 0.25, a), tail_sway: 0.2 * s });
  for (const [sign, lr] of SIDES) {
    const step = sign * s; // the left leg leads the first half
    leg(body, sign, lr, mix(0.7, 0.95, a) * step, 0.6 * max(0, sign * c), mix(0.35, 0.5, a) * step - 0.3 * max(0, sign * c), mix(0.1, 0.32, a));
  }
  return [s, c] as const;
}

export function walk(body: Body, t: number) {
  const [s] = stride(body, t, 0);
  brows_at(body, 0);
  for (const [sign, lr] of SIDES) // arms hang and swing against the legs
    arm(body, sign, lr, 0.55, 0.55 * sign * s, 0, 0.15, 0.5 + 0.2 * max(0, -sign * s));
}

export function rage(body: Body, t: number) {
  const [s] = stride(body, t, 1);
  brows_at(body, 1);
  for (const [sign, lr] of SIDES) // carried wide, as if the back were too broad to let them hang
    arm(body, sign, lr, 0.12, 0.14 * sign * s, 0.12, -0.55, 0.25, 0, 1);
}

export function stand(body: Body, t: number) {
  const s = sin(2 * PI * t);
  trunk(body, { lean: -0.05, drop: 0.004 * s, nod: 0.02 * s, tail_sway: 0.08 * s });
  brows_at(body, 0);
  for (const [sign, lr] of SIDES) {
    leg(body, sign, lr, 0, 0, 0, 0.22);
    arm(body, sign, lr, 0.5, 0, 0, 0.1, 0.3);
  }
}

export const FLEXES = ["double", "lats", "crab", "side"] as const;
export type Flex = (typeof FLEXES)[number];

/** The arms of one bodybuilder pose; pump 0 … 1 squeezes. */
export function flexArms(body: Body, pose: Flex, pump: number) {
  for (const [sign, lr] of SIDES) {
    if (pose === "double") arm(body, sign, lr, -0.55, 0, 0.1, 1.45 + 0.25 * pump, 0, 0, 1); // both biceps, elbows high
    else if (pose === "lats") arm(body, sign, lr, -0.1 - 0.08 * pump, 0, 0.3, -1.55, 0, 0, 1); // fists on the hips, elbows wide
    else if (pose === "crab") arm(body, sign, lr, 0.3, 0, -0.75 - 0.1 * pump, -0.3, 0, 1.25, 1); // arms forward and down, fists meeting before the belly
    else if (sign > 0) arm(body, sign, lr, -0.7, 0, 0.1, 2.0 + 0.2 * pump, 0, 0, 1); // "side": one biceps up …
    else arm(body, sign, lr, 0.4, 0, -0.5, -0.4, 0, 1.5 + 0.1 * pump, 1); // … the other fist across the belly
  }
}

export const flex = (pose: Flex) => (body: Body, t: number) => {
  stand(body, t);
  flexArms(body, pose, 0.5 + 0.5 * sin(4 * PI * t)); // squeezes twice per loop
};

export function pickup(body: Body, t: number) {
  const b = sin(PI * t) ** 1.5; // down to the ground and up again
  trunk(body, { lean: 2.6 * b, drop: 0.08 * b, nod: -0.2 * b, tail_up: 0.5 * b });
  brows_at(body, 0);
  for (const [sign, lr] of SIDES) leg(body, sign, lr, 0.9 * b, 1.2 * b, -0.3 * b, 0.22);
  arm(body, 1, "L", 0.5, 0.7 * b, 0, 0.1, 0.3); // back, for balance
  arm(body, -1, "R", 0.55, -1.1 * b, 0, 0.1, 0.3 * (1 - b), 0, smooth(0.45, 0.6, t)); // reaches, then grips
}

/** Crouch, leap, land; the stage moves the beaver through the air between t = 0.25 and 0.75. */
export function jump(body: Body, t: number) {
  const crouch = t < 0.25 ? sin(PI * min(1, t / 0.25)) : t > 0.75 ? sin(PI * (t - 0.75) / 0.25) : 0;
  const air = t >= 0.25 && t <= 0.75 ? sin(PI * (t - 0.25) / 0.5) : 0;
  trunk(body, { lean: 1.2 * crouch - 0.5 * air, drop: 0.09 * crouch, nod: 0.1 * crouch - 0.15 * air, tail_up: 0.6 * air });
  brows_at(body, 0);
  for (const [sign, lr] of SIDES) leg(body, sign, lr, 0.9 * crouch - 0.5 * air, 1.3 * crouch + 0.6 * air, -0.4 * crouch + 0.5 * air, 0.22);
  arm(body, 1, "L", 0.5 - 1.5 * air, 0.9 * crouch - 0.4 * air, 0, 0.1 + 0.3 * air, 0.3);
  arm(body, -1, "R", 0.5 - 1.2 * air, 0.9 * crouch - 0.6 * air, 0, 0.1 + 0.3 * air, 0.3, 0, 1); // holds the stick
}

export function build(body: Body, t: number) {
  const s = sin(2 * PI * t);
  trunk(body, { lean: 1.5 + 0.25 * abs(s), drop: 0.05, nod: -0.1, twist: 0.12 * s, tail_up: 0.3, tail_sway: 0.3 * s });
  brows_at(body, 0);
  for (const [sign, lr] of SIDES) { // bent over the dam, pressing the sticks down with one fist after the other
    leg(body, sign, lr, 0.5, 0.8, -0.3, 0.25);
    arm(body, sign, lr, 0.45, -1.0 + 0.45 * sign * s, 0, 0.1, 0.5 + 0.4 * max(0, sign * s), 0, 1);
  }
}

export function fly(body: Body, t: number) {
  const s = sin(2 * PI * t), c = cos(2 * PI * t);
  trunk(body, { nod: 0.1, tail_up: 0.3, tail_sway: 0.5 * s });
  body.turn("hips", [X, 0.3 * s], [Z, 0.7 * c], [Y, 0.5 * sin(4 * PI * t)]); // tumbling, but never with its back to the viewer
  brows_at(body, 1);
  for (const [sign, lr] of SIDES) {
    leg(body, sign, lr, 0.4 * s * sign, 0.3, 0, 0.5 + 0.2 * c);
    arm(body, sign, lr, 0.15 + 0.2 * s * sign, 0, 0.3, 0.25 * (1 + c), 0, 0, 1); // spread wide and low: the face stays clear
  }
}

/** As build.py's CLIPS: name, frames per loop (30 per second), pose function. */
export const CLIPS: [string, number, (body: Body, t: number) => void][] = [
  ["walk", 24, walk], ["rage", 24, rage], ["stand", 24, stand], ["pickup", 36, pickup], ["jump", 30, jump], ["build", 24, build], ["fly", 24, fly],
  ...FLEXES.map((pose) => [`flex_${pose}`, 24, flex(pose)] as [string, number, (body: Body, t: number) => void]),
];
