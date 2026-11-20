// When the beaver does a Stare (GLOSSARY.md): once nobody has touched the controls for THRESHOLD s of game time, it
// comes on slowly over TURN s; any input, or a moment where a stare is not allowed, lets it go within RELEASE s.
// Pure logic, after the lantern's stow.ts; the stare feature (index.ts) feeds it and turns the beaver by it.
//
//   const s = newStare();   each frame: const weight = stepStare(s, dt, touched, allowed);   0 … 1, Motion.stare.weight
import { smoothstep } from "../../world/noise.ts";

/** s of game time with nothing touched before a stare; s it takes to come on fully; s to let it go again. */
export const THRESHOLD = 60, TURN = 3.5, RELEASE = 0.3;

export interface Stare {
  /** s nothing has been touched while a stare was allowed. */
  still: number;
  /** Staring now (counted past THRESHOLD), or on the way back. */
  staring: boolean;
  /** 0 … 1, how far it is on, linear in time; the weight is this eased. */
  on: number;
}

export const newStare = (): Stare => ({ still: 0, staring: false, on: 0 });

/** One frame of dt s: touched, any input in it; allowed, a stare may happen now. Returns the weight, 0 … 1. */
export function stepStare(s: Stare, dt: number, touched: boolean, allowed: boolean): number {
  if (touched || !allowed) { s.still = 0; s.staring = false; }
  else if ((s.still += dt) >= THRESHOLD) s.staring = true;
  s.on = Math.min(1, Math.max(0, s.on + (s.staring ? dt / TURN : -dt / RELEASE)));
  return smoothstep(0, 1, s.on);
}
