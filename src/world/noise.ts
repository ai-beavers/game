// Small deterministic helpers for the world: a seeded random and smooth 2D value noise. Everything that looks random
// in the world comes from here, so it is the same on every load.
//
//   const random = seeded(7);  random() → 0 … 1
//   noise(x, z) → -1 … 1, smooth;  fbm(x, z, octaves) → about -1 … 1, with detail

/** mulberry32: a fast seeded random, 0 … 1. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (x: number, z: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 * 2 - 1;
};
const fade = (t: number) => t * t * (3 - 2 * t);

export function noise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = fade(x - ix), fz = fade(z - iz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export function fbm(x: number, z: number, octaves = 4) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) { sum += noise(x * f + i * 17.3, z * f - i * 9.1) * amp; f *= 2; amp *= 0.5; }
  return sum;
}

export const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
