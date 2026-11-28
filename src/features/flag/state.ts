// The Flag's life as plain numbers, so it can be tested without a scene: whole → burning → charred → whole (a fresh
// one at the next dawn).
//
//   flag = stepFlag(flag, dt, lit, dawnCame(hourBefore, hourNow))     once per physics step
//
// flag.burnt is how far the fire has climbed the cloth, 0 (whole) … 1 (a charred rag at the top).

/** Where the pole stands: on dry ground north-west of the building site, above the pond's highest level, clear of the
 *  dam, the way from the site to the Shop and the one from the spawn to the trading post. */
export const POLE = { x: -1.4, z: 7.3, height: 2.15, radius: 0.035 };

export type FlagState = "whole" | "burning" | "charred";
export interface Flag { readonly state: FlagState; readonly burnt: number }

/** Seconds of play from lighting to the charred rag. */
export const BURN_SECONDS = 8;
/** The early morning a fresh Flag is raised in: the hour entering it is a new dawn. */
export const DAWN = { from: 5, to: 7 };

export const raised = (): Flag => ({ state: "whole", burnt: 0 });

const atDawn = (hour: number) => hour >= DAWN.from && hour < DAWN.to;
/** Whether a new dawn came between two readings of the hour: it entered the early morning (by the clock running on,
 *  or set there). */
export const dawnCame = (before: number, now: number) => atDawn(now) && !atDawn(before);

/** One step: `lit` is the player's action at the pole, `dawn` a new dawn in this step. Only a whole Flag catches fire;
 *  the fire ends by itself; only a charred Flag is replaced. */
export function stepFlag(flag: Flag, dt: number, lit: boolean, dawn: boolean): Flag {
  switch (flag.state) {
    case "whole": return lit ? { state: "burning", burnt: 0 } : flag;
    case "burning": {
      const burnt = flag.burnt + dt / BURN_SECONDS;
      return burnt >= 1 ? { state: "charred", burnt: 1 } : { state: "burning", burnt };
    }
    case "charred": return dawn ? raised() : flag;
  }
}
