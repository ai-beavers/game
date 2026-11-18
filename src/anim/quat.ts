// Small quaternion and vector maths for the animator, quaternions are [x, y, z, w] like glTF.

export type Quat = [number, number, number, number];
export type Vec = [number, number, number];

export const IDENTITY: Quat = [0, 0, 0, 1];

export const axisAngle = (axis: Vec, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};

export const mul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

export const inv = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

export const rotate = (q: Quat, v: Vec): Vec => {
  const p = mul(mul(q, [v[0], v[1], v[2], 0]), inv(q));
  return [p[0], p[1], p[2]];
};

export const normalize = (q: Quat): Quat => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};

/** Spherical blend from a to b, the short way round. */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  d *= s;
  if (d > 0.9995) return normalize([0, 1, 2, 3].map((i) => a[i]! + (s * b[i]! - a[i]!) * t) as Quat);
  const angle = Math.acos(d), sa = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / sa, wb = (s * Math.sin(t * angle)) / sa;
  return [0, 1, 2, 3].map((i) => wa * a[i]! + wb * b[i]!) as Quat;
}

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scaleV = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
/** Blender's smoothstep from build.py: 0 below lo, 1 above hi. */
export const smooth = (lo: number, hi: number, x: number) => { const t = clamp((x - lo) / (hi - lo)); return t * t * (3 - 2 * t); };
