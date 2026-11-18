// When the lantern comes out of the backpack and goes back in: at dusk the left paw reaches over the shoulder to the
// backpack and comes back down with the lantern, at dawn the same in reverse. Pure logic; the lantern feature feeds
// it the sky's dark and whether the beaver is busy, and draws what it says.
//
//   const s = newStow(sky.dark);   each frame: stepStow(s, dt, sky.dark, busy(motion, diving));  s.drawn, s.reach (→ Motion.reachBack)
import type { Motion } from "../../contracts.ts";
import { smoothstep } from "../../world/noise.ts";

/** Out above OUT, back in below IN: between the two it keeps what it did, so a slow dusk never flips it to and fro.
 *  The sky's dark follows the sun only, so rain and fog never bring the lantern out. */
const OUT = 0.15, IN = 0.05;
const RISE = 0.5, HOLD = 0.1, FALL = 0.6; // s: the paw up to the backpack, there, and back down: 1.2 s in all

export interface Stow {
  /** The lantern is out of the backpack: drawn, hanging from the left paw, giving light. */
  drawn: boolean;
  /** 0 … 1, how far the paw is on its way to the backpack (Motion.reachBack). */
  reach: number;
  /** Seconds into the switch now under way; undefined: none. */
  at?: number;
}

/** At the start of a game: out at night, in by day, no motion. */
export const newStow = (dark: number): Stow => ({ drawn: dark > OUT, reach: 0 });

const ease = (x: number) => smoothstep(0, 1, x);

/** Busy, so a switch waits: an action under way (the tail slap too), in the air, swimming or diving. */
export const busy = (m: Motion, diving: boolean) =>
  m.action !== "none" || m.actionProgress > 0 || !m.grounded || m.swimming > 0 || diving;

export function stepStow(s: Stow, dt: number, dark: number, busy: boolean): void {
  if (s.at === undefined) {
    const wanted = s.drawn ? dark >= IN : dark > OUT;
    if (wanted === s.drawn || busy) return;
    s.at = 0;
  } else if (busy) { // the rest of the motion would fight another one: done at once
    if (s.at < RISE) s.drawn = !s.drawn; // past the backpack, the lantern has already changed hands
    s.at = undefined;
    s.reach = 0;
    return;
  }
  const before = s.at, t = (s.at += dt);
  if (before < RISE && t >= RISE) s.drawn = !s.drawn; // at the backpack: the lantern changes hands
  if (t >= RISE + HOLD + FALL) { s.at = undefined; s.reach = 0; return; }
  s.reach = t < RISE ? ease(t / RISE) : t < RISE + HOLD ? 1 : 1 - ease((t - RISE - HOLD) / FALL);
}
