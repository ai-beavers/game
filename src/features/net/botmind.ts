// What a working bot (bot.ts) does next, from what any client sees: the shared world (BuildState), the sticks lying
// about, and where the other players are and what they hold. Pure, so it can be tested alone.
//
//   const job = decide(seen);      { kind: "fell" | "split", tree } · { kind: "fetch", stick } · build · leave · wander
//   taken(seen, x, z)              another player is on this work already (closer to it, or gnawing it)
//
// Sharing without talking: a tree another player bit a moment ago is theirs, and so is work another free player
// stands closer to; a stick in someone's hand is theirs (the server gives each stick to one hand). Calm (a real
// player is in, bot.ts --pace): fetch sticks and leave them at the dam for the player to build in, gnaw lying trees
// into wood, fell only when no wood is left anywhere; never build. Busy (bots alone): build what it carries, fetch the
// nearest stick, else make wood, else fell, and stop making wood once the lying sticks are enough for the rest.
import type { Action } from "../../contracts.ts";
import { live, LODGE, SLOTS, type BuildState } from "../build/rules.ts";

/** A tree's work spot now: its foot while it stands, the middle of its trunk while it lies. */
export interface Spot { x: number; z: number }
export interface Loose { id: number; x: number; z: number }
export interface Other { id: number; x: number; z: number; carry: number; action: Action }
export interface Seen {
  state: BuildState;
  /** By tree index, where its work is (only the trees there are). */
  trees: Spot[];
  /** Sticks on the ground that nobody holds. */
  loose: Loose[];
  others: Other[];
  /** Tree index → seconds since another player last changed it. */
  touched: Record<number, number>;
  me: { x: number; z: number; carry: number };
  calm: boolean;
  /** Where calm bots leave sticks, and how near to it a stick counts as left there. */
  site: Spot & { radius: number };
}
export type Job =
  | { kind: "fell" | "split"; tree: number }
  | { kind: "fetch"; stick: number }
  | { kind: "build" }
  | { kind: "leave" }
  | { kind: "wander" };

const MINE_FOR = 4; // s a tree stays another player's after its last bite
const NEAR = 6; // m: another free player closer than this to some work, and closer than me, is going for it

const far = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.z - b.z);

/** Whether another player has this work: free (empty hands, not busy elsewhere) and closer to it than me. */
export function taken(seen: Seen, x: number, z: number) {
  const mine = far(seen.me, { x, z });
  return seen.others.some((o) => o.carry < 0 && far(o, { x, z }) < Math.min(NEAR, mine));
}

export function decide(seen: Seen): Job {
  const { state, calm } = seen, n = state.dam.length;
  if (seen.me.carry >= 0) return calm || n >= SLOTS + LODGE ? { kind: "leave" } : { kind: "build" };
  if (n >= SLOTS + LODGE) return { kind: "wander" };

  const nearest = <T extends Spot>(list: T[]) => list.sort((a, b) => far(seen.me, a) - far(seen.me, b))[0];
  const free = (t: number) => !((seen.touched[t] ?? Infinity) < MINE_FOR) && !taken(seen, seen.trees[t]!.x, seen.trees[t]!.z);
  const trees = (lying: boolean) => seen.trees.flatMap((spot, i) => {
    const t = live(state.trees[i]);
    if (!t || (lying ? !t.rest : t.fell !== undefined) || !free(i)) return [];
    return [{ ...spot, tree: i }];
  });

  const sticks = seen.loose.filter((s) => !(calm && far(s, seen.site) < seen.site.radius));
  const stick = nearest(sticks.filter((s) => !taken(seen, s.x, s.z)));
  if (stick) return { kind: "fetch", stick: stick.id };
  // Wood enough for what is left to build (counting what is in hands), then no more.
  const held = seen.others.filter((o) => o.carry >= 0).length;
  if (!calm && seen.loose.length + held >= SLOTS + LODGE - n) return { kind: "wander" };
  const lying = nearest(trees(true));
  if (lying) return { kind: "split", tree: lying.tree };
  if (calm && seen.loose.length) return { kind: "wander" };
  const standing = nearest(trees(false));
  return standing ? { kind: "fell", tree: standing.tree } : { kind: "wander" };
}
