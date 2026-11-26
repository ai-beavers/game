// When the lantern comes out of the backpack and goes back in: at dusk the left paw reaches over the shoulder to the
// backpack and comes back down with the lantern, at dawn the same in reverse. Pure logic; the lantern feature feeds
// it the sky's dark and whether the beaver is busy, and draws what it says.
//
//   const s = newStow(sky.dark);   each frame: stepStow(s, dt, sky.dark, busy(motion, diving));  s.drawn, s.reach (→ Motion.reachBack)
//   flash(s);                       the flash button went down: the lantern off or on again (s.off), only while drawn
import type { Motion } from "../../contracts.ts";
import { smoothstep } from "../../world/noise.ts";

/** Out above OUT, back in below IN: between the two it keeps what it did, so a slow dusk never flips it to and fro.
 *  The sky's dark follows the sun only, so rain and fog never bring the lantern out. */
const OUT = 0.15, IN = 0.05;
/** s: the paw up to the backpack, there, and back down: 1.2 s in all. The trade feature reaches the same way. */
export const RISE = 0.5, HOLD = 0.1, FALL = 0.6;

export interface Stow {
  /** The lantern is out of the backpack: drawn, hanging from the left paw, giving light. */
  drawn: boolean;
  /** 0 … 1, how far the paw is on its way to the backpack (Motion.reachBack). */
  reach: number;
  /** The player switched it off (a flash): no glow, no light. Back on when it goes into the backpack. */
  off: boolean;
  /** Seconds into the switch now under way; undefined: none. */
  at?: number;
}

/** At the start of a game: out at night, in by day, no motion. */
export const newStow = (dark: number): Stow => ({ drawn: dark > OUT, reach: 0, off: false });

/** Whether the lantern should be out with this dark, given whether it is: between IN and OUT it keeps what it did. */
export const wantsOut = (drawn: boolean, dark: number) => drawn ? dark >= IN : dark > OUT;

/** The flash button went down: switches the lantern off, or on again. In the backpack it does nothing. */
export function flash(s: Stow): void {
  if (s.drawn) s.off = !s.off;
}

const ease = (x: number) => smoothstep(0, 1, x);
/** How far the paw is on its way to the backpack (Motion.reachBack), t s into a reach: up, there, back down. */
export const reachAt = (t: number) => t < RISE ? ease(t / RISE) : t < RISE + HOLD ? 1 : t < RISE + HOLD + FALL ? 1 - ease((t - RISE - HOLD) / FALL) : 0;

/** Busy, so a switch waits: an action under way (the tail slap too), in the air, swimming or diving, sitting or
 *  crawling (the reach over the shoulder would fight the pose). */
export const busy = (m: Motion, diving: boolean) =>
  m.action !== "none" || m.actionProgress > 0 || !m.grounded || m.swimming > 0 || diving || m.low !== undefined;

export function stepStow(s: Stow, dt: number, dark: number, busy: boolean): void {
  if (s.at === undefined) {
    const wanted = wantsOut(s.drawn, dark);
    if (wanted === s.drawn || busy) return;
    s.at = 0;
  } else if (busy) { // the rest of the motion would fight another one: done at once
    if (s.at < RISE) hand(s); // past the backpack, the lantern has already changed hands
    s.at = undefined;
    s.reach = 0;
    return;
  }
  const before = s.at, t = (s.at += dt);
  if (before < RISE && t >= RISE) hand(s); // at the backpack: the lantern changes hands
  if (t >= RISE + HOLD + FALL) { s.at = undefined; s.reach = 0; return; }
  s.reach = reachAt(t);
}

/** The lantern changes hands: out of the backpack, or into it, where it is switched on again for the next dusk. */
function hand(s: Stow) {
  s.drawn = !s.drawn;
  if (!s.drawn) s.off = false;
}
