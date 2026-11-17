// The skeleton as the pose functions of tools/blender/build.py see it: per bone a turn about the armature's rest
// axes (Blender's turn()), an offset in armature space (move()) and a uniform scale. Turns it into a Pose (what a
// glTF channel holds), runs forward kinematics for the feet and hands, and blends two bodies.
//
//   const body = new Body();
//   body.turn("thigh_L", [X, -0.5]);   body.move("hips", v(0, 0, -0.02));
//   body.pose()  → Pose;   body.fk()  → where each bone's head is and how it is turned, armature space
//
// Axes are glTF's: y up, the beaver faces +z, +x is its left. X, Y, Z below are Blender's axes of the rig as
// build.py names them (X to its left, Y back, Z up), written in glTF axes, so ported code reads the same.
import { BONES, type Bone, type Pose } from "../contracts.ts";
import { REST } from "./rest.ts";
import { IDENTITY, add, axisAngle, inv, lerp, mul, rotate, slerp, type Quat, type Vec } from "./quat.ts";

export const X: Vec = [1, 0, 0], Y: Vec = [0, 0, -1], Z: Vec = [0, 1, 0];
/** A Blender vector (x left, y back, z up) in glTF axes. */
export const v = (x: number, y: number, z: number): Vec => [x, z, -y];

export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export interface Placed { /** turn of the bone from rest, armature space */ delta: Quat; /** head of the bone */ at: Vec }

export class Body {
  turns = {} as Record<Bone, Quat>;
  offsets = {} as Record<Bone, Vec>;
  scales = {} as Record<Bone, number>;
  constructor() { this.reset(); }

  reset() {
    for (const b of BONES) { this.turns[b] = IDENTITY; this.offsets[b] = [0, 0, 0]; this.scales[b] = 1; }
    return this;
  }

  copy(from: Body) {
    for (const b of BONES) { this.turns[b] = from.turns[b]; this.offsets[b] = from.offsets[b]; this.scales[b] = from.scales[b]; }
    return this;
  }

  /** Rotate a bone about axes of the armature's rest frame, in the order given (build.py's turn). */
  turn(bone: Bone, ...turns: [Vec, number][]) {
    let q = IDENTITY;
    for (const [axis, angle] of turns) q = mul(axisAngle(axis, angle), q);
    this.turns[bone] = q;
  }

  /** Shift a bone's head, armature axes, relative to its parent's rest frame (build.py's move). */
  move(bone: Bone, offset: Vec) { this.offsets[bone] = offset; }

  /** Every bone, armature space: how far it is turned from rest and where its head is. */
  fk(): Record<Bone, Placed> {
    const out = {} as Record<Bone, Placed>;
    for (const b of BONES) {
      const rest = REST[b], parent = rest.parent ? out[rest.parent] : undefined;
      if (!parent) { out[b] = { delta: this.turns[b], at: add(rest.armaturePosition, this.offsets[b]) }; continue; }
      const fromParent = add(sub(rest.armaturePosition, REST[rest.parent!].armaturePosition), this.offsets[b]);
      out[b] = { delta: mul(parent.delta, this.turns[b]), at: add(parent.at, rotate(parent.delta, fromParent)) };
    }
    return out;
  }

  /** A point given in rest armature space, carried along by a bone. */
  static carry(placed: Placed, bone: Bone, point: Vec): Vec {
    return add(placed.at, rotate(placed.delta, sub(point, REST[bone].armaturePosition)));
  }

  pose(): Pose {
    const pose: Pose = {};
    for (const b of BONES) {
      const rest = REST[b], g = rest.armatureRotation;
      const parentTurn = rest.parent ? REST[rest.parent].armatureRotation : IDENTITY;
      pose[b] = {
        rotation: mul(rest.rotation, mul(inv(g), mul(this.turns[b], g))),
        translation: add(rest.translation, rotate(inv(parentTurn), this.offsets[b])),
        scale: this.scales[b],
      };
    }
    return pose;
  }

  /** This body moves towards another by t (0 stays, 1 becomes it); all bones, or only those given. */
  blend(to: Body, t: number, bones: readonly Bone[] = BONES) {
    if (t <= 0) return this;
    for (const b of bones) {
      this.turns[b] = slerp(this.turns[b], to.turns[b], t);
      const a = this.offsets[b], c = to.offsets[b];
      this.offsets[b] = [lerp(a[0], c[0], t), lerp(a[1], c[1], t), lerp(a[2], c[2], t)];
      this.scales[b] = lerp(this.scales[b], to.scales[b], t);
    }
    return this;
  }
}
