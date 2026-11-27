// The Lightbulb's switch and glow as plain numbers, so they can be tested without a scene: off → on → off, one pull of
// the cord each, and how brightly the glass shines for the sky's dark.
//
//   bulb = pull(bulb)              E at the cord: flips it, unless a pull is still under way
//   bulb = stepBulb(bulb, dt)      once a frame: the tug plays out
//   glow(bulb.on, sky.dark)        the glass's brightness, 0 (off) … GLOW.night

export interface Bulb {
  readonly on: boolean;
  /** s left of the tug under way; 0: none, the cord can be pulled. */
  readonly pulling: number;
}

/** s the paw takes to tug the cord, up and back down. */
export const PULL_SECONDS = 0.7;
/** The glass's brightness when lit: by day (a touch over the sunlit glass) and at full night. */
export const GLOW = { day: 0.45, night: 1.3 };

/** Every visit starts here. */
export const switchedOff = (): Bulb => ({ on: false, pulling: 0 });

/** A pull of the cord: the bulb switches at once and the tug begins. While a tug is under way another pull does nothing. */
export const pull = (bulb: Bulb): Bulb => bulb.pulling > 0 ? bulb : { on: !bulb.on, pulling: PULL_SECONDS };

export const stepBulb = (bulb: Bulb, dt: number): Bulb =>
  bulb.pulling > 0 ? { on: bulb.on, pulling: Math.max(0, bulb.pulling - dt) } : bulb;

/** How brightly the glass shines: nothing off; lit, from GLOW.day to GLOW.night as the sky's dark (0 … 1) deepens, by
 *  the same night factor as the shop's café lamps (src/features/shop/building.ts). */
export function glow(on: boolean, dark: number): number {
  if (!on) return 0;
  const night = Math.min(1, Math.max(0, (dark - 0.08) / 0.4));
  return GLOW.day + (GLOW.night - GLOW.day) * night;
}
