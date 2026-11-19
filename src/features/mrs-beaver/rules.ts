// Mrs. Beaver's rules as plain logic, apart from rendering, so they can be tested alone: where she may be hidden,
// which hiding place a visit picks, the rescue (missing → freed, once), and when the Use key offers to free her.
//
//   const rescue = pick(Math.random());          a visit: missing, at HIDING[rescue.place]
//   offered(rescue, { away, carrying, afloat })   true: the Use key says "Free Mrs. Beaver"
//   free(rescue)                                 true once: now freed; false after
//
// Nothing here is kept: the rescue lives in memory for one visit (no localStorage, no network).

export interface XZ { x: number; z: number }
/** The three hiding places: on dry land just inside the bank, clear of the Pond, the building site, the Shop, the
 *  trading post and the spawn, each with a straight way over land to HOME (rules.test.ts checks both). West, south,
 *  north. */
export const HIDING: readonly XZ[] = [{ x: -13.3, z: -2.3 }, { x: 3.5, z: -13 }, { x: -5, z: 13.6 }];
/** Where she waits once freed: beside the building site, on its south-west side away from the dam and the crates. */
export const HOME: XZ = { x: -2.5, z: 2.3 };
/** m from the middle of the pen to the player's feet within which the Use key offers to free her. */
export const REACH = 1.3;

export type State = "missing" | "freed";
export interface Rescue { place: number; state: State }

/** A new visit: missing, at the hiding place a random number 0 … 1 picks. */
export function pick(random: number): Rescue {
  return { place: Math.min(HIDING.length - 1, Math.max(0, Math.floor(random * HIDING.length))), state: "missing" };
}

/** Frees her: true the first time (missing → freed), false once she is freed already. */
export function free(rescue: Rescue): boolean {
  if (rescue.state !== "missing") return false;
  rescue.state = "freed";
  return true;
}

/** Whether the Use key offers "Free Mrs. Beaver": she is still missing, the player's feet are within REACH of the
 *  pen's middle (away, m on the ground), the paws are free and the beaver is on land. */
export function offered(rescue: Rescue, at: { away: number; carrying: boolean; afloat: boolean }): boolean {
  return rescue.state === "missing" && at.away <= REACH && !at.carrying && !at.afloat;
}
