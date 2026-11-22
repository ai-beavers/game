// Droppings (a viewer's wish) as plain numbers, so they can be tested without a scene: how many lie on the dam, when
// E offers to leave one, and where the n-th lands.
//
//   offered(placed, carrying, count)        whether "Leave a dropping" stands (the dam's stick count, a stick in the paw)
//   count = next(count, "left" | "dawn" | "emptied")
//   spot(n, placed)                         where the n-th lands, in the dam's frame (src/features/build/dam.ts)
import { DAM, moundHeight, mudHeight } from "../build/rules.ts";
import { seeded } from "../../world/noise.ts";

/** The most droppings on the dam at once. */
export const MOST = 5;

/** Whether E may leave a dropping: the dam's mud shows, the paws are empty and there is room for one more. */
export const offered = (placed: number, carrying: boolean, count: number) => moundHeight(placed) > 0 && !carrying && count < MOST;

/** What happened to the droppings: one left, a new dawn (dawnCame, src/features/flag/state.ts), the dam emptied (the
 *  world starting anew). */
export type Happening = "left" | "dawn" | "emptied";
/** The count after it. */
export const next = (count: number, what: Happening) => what === "left" ? Math.min(MOST, count + 1) : 0;

/** The places, once: along the crest (t, -1 … 1 of its half length) in an order that jumps about, so no two in a row
 *  land side by side; across, into the land-side half of the crest (u, 0 … 1 of the way to its edge). */
const PLACES = (() => {
  const random = seeded(110);
  return [0.05, -0.7, 0.65, -0.3, 0.35].map((t) => ({ t: t + (random() - 0.5) * 0.1, u: 0.55 + random() * 0.4 }));
})();

/** Where the n-th dropping on the dam lies (n from 0), in the dam's frame: x across (+x the water side), z along,
 *  y the mud's height above the ground there with this many sticks placed, so it rises with the crest. */
export function spot(n: number, placed: number) {
  const p = PLACES[n % PLACES.length]!, crest = DAM.top / DAM.base, half = (DAM.length / 2) * crest;
  const z = p.t * half, x = -p.u * DAM.base * crest * Math.sqrt(1 - p.t * p.t);
  return { x, z, y: mudHeight(x, z, placed) };
}
