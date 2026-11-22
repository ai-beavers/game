// The hotbar as plain logic: which good the beaver holds in its paw, which it wants there, and the reach over the
// shoulder that swaps them (the lantern's reach, src/features/lantern/stow.ts). The trade feature (index.ts) feeds it
// the keys and draws what it says.
//
//   shelf(ledger)                  the goods in slots 2 … 6: those owned, in the goods list's order
//   const h = newHold();
//   h.want = "feather";            a slot selected: the good wanted in the paw (undefined: none, the paw empty)
//   stepHold(h, dt, busy);         each frame: h.held, h.reach (→ Motion.reachBack)
//   useUp(h, ["feather", "shell"]) goods used up at the workbench: one of them in the paw (or selected) empties it
//
// One reach does it all: the paw goes up to the backpack with what it holds, leaves that there at the top, and comes
// back down with what is wanted (or nothing). A held good still counts in the backpack.
import { RISE, HOLD, FALL, reachAt } from "../lantern/stow.ts";
import { GOODS, type Ledger } from "./ledger.ts";

/** Slots on the hotbar: 1 what the beaver carries (a stick), 2 … SLOTS the goods. */
export const SLOTS = 6;

/** The goods in slots 2 … SLOTS, in order: each good owned, in the goods list's order. */
export const shelf = (l: Ledger) => GOODS.filter((g) => (l.owned[g.id] ?? 0) > 0).map((g) => g.id).slice(0, SLOTS - 1);

export interface Hold {
  /** The good in the paw now; undefined: none. */
  held?: string;
  /** The good the player selected; undefined: none (slot 1). The reach brings held to it. */
  want?: string;
  /** s into the reach under way; undefined: none. */
  at?: number;
  /** 0 … 1, how far the paw is on its way to the backpack (Motion.reachBack). */
  reach: number;
}
export const newHold = (): Hold => ({ reach: 0 });

/** Something in the paw, or on its way there or back. */
export const full = (h: Hold) => h.held !== undefined || h.at !== undefined;

/** Once per frame. busy: the reach would fight another motion (as the lantern's, or a stick in the hand): it waits,
 *  and one under way is done at once. */
export function stepHold(h: Hold, dt: number, busy: boolean): void {
  if (h.at === undefined) {
    if (h.want === h.held || busy) return;
    h.at = 0;
  } else if (busy) {
    h.held = h.want;
    h.at = undefined;
    h.reach = 0;
    return;
  }
  const before = h.at, t = (h.at += dt);
  if (before < RISE && t >= RISE) h.held = h.want; // at the backpack: in with the one, out with the other
  if (t >= RISE + HOLD + FALL) { h.held = h.want; h.at = undefined; h.reach = 0; return; }
  h.reach = reachAt(t);
}

/** Goods used up (at the workbench): when one of them is in the paw, or selected, or on its way, the selection is
 *  cleared and the paw is empty at once (slot 1): it never holds a good the backpack no longer has. */
export function useUp(h: Hold, goods: readonly string[]): void {
  if (!goods.some((g) => g === h.held || g === h.want)) return;
  h.held = h.want = h.at = undefined;
  h.reach = 0;
}
