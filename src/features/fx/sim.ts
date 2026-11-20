// How one particle of the fx feature lives: position, velocity, lifetime and surface interactions.
//
//   const p = spawn(pool);  Object.assign(p, { kind: KIND.puff, life: 0.8, … });
//   advance(p, dt, floorAt);          each frame while the world runs
//   alpha(p), size(p)                 what the picture draws this frame
//
// A particle fades in after birth and out before death (and quickly when told to `vanish`), so nothing pops.

/** Shapes the shader knows. Keep in step with SHAPES in particles.ts. */
export const KIND = { puff: 0, drop: 1, ring: 2, chip: 3, blade: 4, leaf: 5, mote: 6, foam: 7, seed: 8, flame: 9, smoke: 10 } as const;
/** How the quad stands: facing the camera, flat on the water, flat on the ground, or stretched along its velocity. */
export const MODE = { face: 0, water: 1, ground: 2, streak: 3 } as const;
/** What happens when it reaches the ground (or the water, for drops). */
export const FLOOR = { none: 0, die: 1, rest: 2 } as const;

export interface Particle {
  alive: boolean;
  kind: number; mode: number; floor: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Seconds lived, and seconds to live. */
  age: number; life: number;
  fadeIn: number; fadeOut: number;
  /** Size at birth and at death, metres; the change eases out. */
  size: number; grow: number;
  /** Turn in the picture plane, radians, and its speed; squash is width over height (leaf tumble, chip shape). */
  rot: number; spin: number; squash: number;
  /** 1 … 0: what is left while vanishing; vanish > 0 is how fast it goes, per second. */
  fade: number; vanish: number;
  /** Fall: 1 is full gravity, negative rises. Drag slows it, per second. */
  gravity: number; drag: number;
  /** Leaves: how hard they swing from side to side while falling. */
  flutter: number;
  /** Linear colour and the most opaque it gets. */
  r: number; g: number; b: number; a: number;
  /** 0 … 1, for shape noise in the shader. */
  seed: number;
  /** Has hit the ground once (chips bounce once, then lie). */
  landed: boolean;
}

const GRAVITY = 9.81;

export function blank(): Particle {
  return {
    alive: false, kind: 0, mode: 0, floor: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, fadeIn: 0.1, fadeOut: 0.3,
    size: 0.1, grow: 0.1, rot: 0, spin: 0, squash: 1, fade: 1, vanish: 0, gravity: 0, drag: 0, flutter: 0,
    r: 1, g: 1, b: 1, a: 1, seed: 0, landed: false,
  };
}

/** A free particle from the pool, reset; undefined when all are busy (the effect is then a little thinner). */
export function spawn(pool: Particle[], limit = pool.length): Particle | undefined {
  for (let i = 0; i < limit; i++) {
    const p = pool[i]!;
    if (!p.alive) { Object.assign(p, blank(), { alive: true }); return p; }
  }
  return undefined;
}

/** Opacity now: fades in, fades out, never above `a`. */
export function alpha(p: Particle) {
  const rise = p.fadeIn > 0 ? Math.min(1, p.age / p.fadeIn) : 1;
  const fall = p.fadeOut > 0 ? Math.min(1, Math.max(0, p.life - p.age) / p.fadeOut) : 1;
  const ease = (t: number) => t * t * (3 - 2 * t);
  return p.a * ease(rise) * ease(fall) * p.fade;
}

export function size(p: Particle) {
  const t = Math.min(1, p.age / p.life);
  return p.size + (p.grow - p.size) * (1 - (1 - t) * (1 - t));
}

/** One frame of life. floorAt(x, z) is where it stops falling. */
export function advance(p: Particle, dt: number, floorAt: (x: number, z: number) => number) {
  p.age += dt;
  if (p.vanish > 0) p.fade = Math.max(0, p.fade - p.vanish * dt);
  if (p.age >= p.life || p.fade <= 0) { p.alive = false; return; }
  p.vy -= GRAVITY * p.gravity * dt;
  const keep = Math.exp(-p.drag * dt);
  p.vx *= keep; p.vy *= keep; p.vz *= keep;
  if (p.flutter) {
    const swing = Math.sin(p.age * 2.6 + p.seed * 20) * p.flutter;
    p.vx += Math.cos(p.seed * 40) * swing * dt;
    p.vz += Math.sin(p.seed * 40) * swing * dt;
  }
  p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  p.rot += p.spin * dt;
  if (p.floor === FLOOR.none) return;
  const floor = floorAt(p.x, p.z);
  if (p.y > floor) return;
  p.y = floor;
  if (p.floor === FLOOR.die) {
    if (!p.vanish) { p.vanish = 12; p.vx = p.vy = p.vz = 0; p.gravity = 0; }
    return;
  }
  // Rest: a bounce the first time, then it lies still.
  if (!p.landed && p.vy < -1) {
    p.landed = true;
    p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; p.spin *= 0.5;
    return;
  }
  p.landed = true;
  p.vx = p.vy = p.vz = 0; p.spin = 0; p.gravity = 0; p.flutter = 0;
  if (p.mode === 0) p.mode = 2; // lies flat on the ground now
}
