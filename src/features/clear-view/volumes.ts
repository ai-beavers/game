// The Clear view's geometry (GLOSSARY.md): what can hide the beaver from the camera, as volumes, and whether the
// beaver is seen. Leaves have no collider the camera's cast sees; their bounds are known, as turned boxes or (crowns
// and bushes) the ellipsoids inside them. Each look asks: is the beaver seen from the camera (most of a few points on
// its body with nothing in between, the camera inside nothing)?

export type XYZ = { x: number; y: number; z: number };
/** A box with its middle at `at` and three half-axes (turned as the thing is), or round: the ellipsoid in that box.
 *  tag: what it stands for, for whoever fades it. Made by volume(). */
export interface Volume { at: XYZ; axes: [XYZ, XYZ, XYZ]; round: boolean; inverse: number[]; lengths: number[]; tag?: unknown }

const cross = (a: XYZ, b: XYZ) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: XYZ, b: XYZ) => a.x * b.x + a.y * b.y + a.z * b.z;

export function volume(at: XYZ, axes: [XYZ, XYZ, XYZ], round = false, tag?: unknown): Volume {
  const [a, b, c] = axes, det = dot(a, cross(b, c)), rows = [cross(b, c), cross(c, a), cross(a, b)];
  return { at, axes, round, tag, inverse: rows.flatMap((r) => [r.x / det, r.y / det, r.z / det]), lengths: axes.map((v) => Math.sqrt(dot(v, v))) };
}

/** Where on the way from → to (0 … 1) it first is inside v grown by margin m; 0 when it starts inside; Infinity
 *  when it never is. */
export function enter(v: Volume, from: XYZ, to: XYZ, margin = 0): number {
  const m = v.inverse, p = [0, 0, 0], d = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const grow = 1 + margin / v.lengths[i]!, row = { x: m[3 * i]!, y: m[3 * i + 1]!, z: m[3 * i + 2]! };
    p[i] = (row.x * (from.x - v.at.x) + row.y * (from.y - v.at.y) + row.z * (from.z - v.at.z)) / grow;
    d[i] = (row.x * (to.x - from.x) + row.y * (to.y - from.y) + row.z * (to.z - from.z)) / grow;
  }
  if (v.round) {
    const a = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2, b = 2 * (p[0]! * d[0]! + p[1]! * d[1]! + p[2]! * d[2]!), c = p[0]! ** 2 + p[1]! ** 2 + p[2]! ** 2 - 1;
    if (c <= 0) return 0;
    const disc = b * b - 4 * a * c;
    if (a < 1e-12 || disc < 0) return Infinity;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t >= 0 && t <= 1 ? t : Infinity;
  }
  let lo = 0, hi = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]!) < 1e-12) { if (Math.abs(p[i]!) > 1) return Infinity; continue; }
    const t1 = (-1 - p[i]!) / d[i]!, t2 = (1 - p[i]!) / d[i]!;
    lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
    if (lo > hi) return Infinity;
  }
  return lo;
}
export const inside = (v: Volume, p: XYZ, margin = 0) => enter(v, p, p, margin) === 0;

/** m the camera keeps from crowns and bushes: its near plane and the cast ball. */
export const KEEP_OUT = 0.35;

/** Points on the beaver standing at its feet: low, middle, high, and round its middle. */
export const bodyPoints = (feet: XYZ): XYZ[] => [[0, 0.2, 0], [0, 0.5, 0], [0, 0.85, 0], [0.22, 0.45, 0], [-0.22, 0.45, 0], [0, 0.45, 0.22], [0, 0.45, -0.22]]
  .map(([x, y, z]) => ({ x: feet.x + x!, y: feet.y + y!, z: feet.z + z! }));

/** What the camera at eye sees of the points: how many have something in between, and what. A volume around a point
 *  itself (the beaver in the reeds) does not count for it: no camera move helps there. solid: whether a collider is in
 *  between (the ground, trunks), for the caller to cast. */
export function sight(eye: XYZ, points: XYZ[], volumes: Volume[], solid?: (from: XYZ, to: XYZ) => boolean) {
  const by = new Set<Volume>();
  let blocked = 0;
  for (const p of points) {
    let hidden = false;
    for (const v of volumes) if (enter(v, eye, p) <= 1 && !inside(v, p)) { hidden = true; by.add(v); }
    if (hidden || solid?.(eye, p)) blocked++;
  }
  const within = volumes.some((v) => v.round && inside(v, eye, KEEP_OUT));
  /** Seen: no more than a quarter of the points covered, and the camera inside no crown or bush. */
  return { blocked, by, within, seen: !within && blocked * 4 <= points.length };
}
