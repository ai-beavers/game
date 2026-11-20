// When the beaver does a Stare (GLOSSARY.md): once nobody has touched the controls for THRESHOLD s of game time, it
// comes on slowly over TURN s; any input, or a moment where a stare is not allowed, lets it go within RELEASE s.
// Pure logic, after the lantern's stow.ts; the stare feature (index.ts) feeds it and turns the beaver by it.
//
//   const s = newStare();   each frame: const weight = stepStare(s, dt, touched, allowed);   0 … 1, Motion.stare.weight
//                                       const walk = stepApproach(s, dt, off, distance);    walk towards the lens now
//                                       approaching(s)                                       the camera holds still for it
//
// The approach, the Stare's second phase: once the stare is full and the body faces the camera within FACING rad, the
// beaver walks up to the lens until its eyes are STOP m from it, or until it has not got closer for BLOCKED s
// (something in the way). Then it stands and stares on. It ends with the stare, at once.
import { smoothstep } from "../../world/noise.ts";

/** s of game time with nothing touched before a stare; s it takes to come on fully; s to let it go again. */
export const THRESHOLD = 60, TURN = 3.5, RELEASE = 0.3;

/** rad off the camera that counts as facing it; m from the eyes to the lens where the approach stops; s without
 *  getting closer that counts as blocked; m closer that counts as progress. */
export const FACING = 0.2, STOP = 0.28, BLOCKED = 1, PROGRESS = 0.02;

export interface Stare {
  /** s nothing has been touched while a stare was allowed. */
  still: number;
  /** Staring now (counted past THRESHOLD), or on the way back. */
  staring: boolean;
  /** 0 … 1, how far it is on, linear in time; the weight is this eased. */
  on: number;
  /** The approach: not yet (or over), walking up to the lens, or standing at the end of it. */
  approach: "none" | "walking" | "stopped";
  /** m: the closest the eyes got to the lens in this approach, and s since they last got closer. */
  closest: number;
  stuck: number;
}

export const newStare = (): Stare => ({ still: 0, staring: false, on: 0, approach: "none", closest: Infinity, stuck: 0 });

/** The camera holds still for the approach: from its start until the stare is let go. */
export const approaching = (s: Stare) => s.approach !== "none";

/** One frame of the approach, after stepStare: off, rad between the body's facing and the way to the camera; distance,
 *  m from the eyes to the lens. Returns whether the beaver walks towards the lens now. */
export function stepApproach(s: Stare, dt: number, off: number, distance: number): boolean {
  if (!s.staring) { s.approach = "none"; return false; }
  if (s.approach === "none" && s.on >= 1 && Math.abs(off) < FACING) { s.approach = "walking"; s.closest = distance; s.stuck = 0; }
  if (s.approach !== "walking") return false;
  if (distance < s.closest - PROGRESS) { s.closest = distance; s.stuck = 0; } else s.stuck += dt;
  if (distance <= STOP || s.stuck >= BLOCKED) s.approach = "stopped";
  return s.approach === "walking";
}

/** One frame of dt s: touched, any input in it; allowed, a stare may happen now. Returns the weight, 0 … 1. */
export function stepStare(s: Stare, dt: number, touched: boolean, allowed: boolean): number {
  if (touched || !allowed) { s.still = 0; s.staring = false; }
  else if ((s.still += dt) >= THRESHOLD) s.staring = true;
  s.on = Math.min(1, Math.max(0, s.on + (s.staring ? dt / TURN : -dt / RELEASE)));
  return smoothstep(0, 1, s.on);
}
