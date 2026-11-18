// What a working bot (bot.ts) does next, from what any client sees: the shared world (BuildState), the sticks lying
// about, and where the other players are and what they hold. Pure, so it can be tested alone.
//
//   const job = decide(seen);      { kind: "fell" | "split", tree } · { kind: "fetch", stick } · build · cache · wait
//                                  · leave · { kind: "look", at } · { kind: "wander", how }
//   taken(seen, x, z)              another player is on this work already (closer to it, or gnawing it)
//   atPile(seen)                   another player is at the food cache with a stick: one at a time down there
//   yields(me, others)             stop a moment: another beaver comes the other way, and it has the right of way
//   overdue(age)                   the watchdog: a job this old is stuck, think again
//   milestone(placed)              what to say in the chat when this stick finished something
//
// Sharing without talking: a tree another player bit a moment ago is theirs, and so is work another free player
// stands closer to; a stick in someone's hand is theirs (the server gives each stick to one hand); the cache's pile is
// for the one with a stick nearest to it, the others wait their turn nearby. Calm (a real player is in, bot.ts --pace):
// fetch sticks and leave them at the dam for the player to build in or dive down, gnaw lying trees into wood, fell
// only when no wood is left anywhere; never build. Busy (bots alone): build what it carries (dam, lodge, then the
// cache), fetch the nearest stick, else make wood, else fell, and stop making wood once the lying sticks are enough
// for the rest. Between jobs: look at a real player who comes close, else walk, swim, dive for a look at the basin or
// slap the tail (rarely at the forest's edge, where deer graze at dusk).
import type { Action } from "../../contracts.ts";
import { CACHE_AT, live, LODGE, SLOTS, STICKS, type BuildState } from "../build/rules.ts";

/** A tree's work spot now: its foot while it stands, the middle of its trunk while it lies. */
export interface Spot { x: number; z: number }
export interface Loose { id: number; x: number; z: number }
/** Another player as its last state said: feet, facing, speed, what it holds and does; real: not a bot. */
export interface Other { id: number; x: number; y?: number; z: number; f?: number; speed?: number; carry: number; action: Action; real?: boolean }
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
  /** 0 … 1, a dice for what to do between jobs; seconds since the last tail slap; trees to leave alone a while (the
   *  watchdog gave up on them). */
  roll?: number;
  sinceSlap?: number;
  skip?: number[];
}
export type Job =
  | { kind: "fell" | "split"; tree: number }
  | { kind: "fetch"; stick: number }
  | { kind: "build" }
  | { kind: "cache" }
  | { kind: "wait" }
  | { kind: "leave" }
  | { kind: "look"; at: number }
  | { kind: "wander"; how?: "walk" | "swim" | "dive" | "slap" };

const MINE_FOR = 4; // s a tree stays another player's after its last bite
const NEAR = 6; // m: another free player closer than this to some work, and closer than me, is going for it
export const PILE = 2.2; // m round the cache: one with a stick in here has the pile
const LOOK = 3; // m: a real player this close gets looked at
const EDGE = 11; // m from the middle: the forest's edge begins, where deer come out at dusk
const SLAP_EVERY = 45, SLAP_EDGE = 300; // s between slaps, and at the edge
const MEET = 1.4; // m: another beaver this close ahead, coming at me, is met head-on
export const WATCHDOG = 55; // s: no job takes longer (the longest, a calm walk across the clearing with a stick, about 40)

const far = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.z - b.z);

/** Whether another player has this work: free (empty hands, not busy elsewhere) and closer to it than me. */
export function taken(seen: Seen, x: number, z: number) {
  const mine = far(seen.me, { x, z });
  return seen.others.some((o) => o.carry < 0 && far(o, { x, z }) < Math.min(NEAR, mine));
}

/** Whether another player is at the cache's pile with a stick, nearer to it than me: it goes down first. */
export const atPile = (seen: Seen) => seen.others.some((o) => o.carry >= 0 && far(o, CACHE_AT) < PILE && far(o, CACHE_AT) < far(seen.me, CACHE_AT));

export function decide(seen: Seen): Job {
  const { state, calm } = seen, n = state.dam.length;
  if (seen.me.carry >= 0) {
    if (calm || n >= STICKS) return { kind: "leave" };
    if (n < SLOTS + LODGE) return { kind: "build" };
    return atPile(seen) ? { kind: "wait" } : { kind: "cache" };
  }
  if (n >= STICKS) return idle(seen);

  const nearest = <T extends Spot>(list: T[]) => list.sort((a, b) => far(seen.me, a) - far(seen.me, b))[0];
  const free = (t: number) => !((seen.touched[t] ?? Infinity) < MINE_FOR) && !seen.skip?.includes(t) && !taken(seen, seen.trees[t]!.x, seen.trees[t]!.z);
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
  if (!calm && seen.loose.length + held >= STICKS - n) return idle(seen);
  const lying = nearest(trees(true));
  if (lying) return { kind: "split", tree: lying.tree };
  if (calm && seen.loose.length) return idle(seen);
  const standing = nearest(trees(false));
  return standing ? { kind: "fell", tree: standing.tree } : idle(seen);
}

/** Between jobs: a real player close by gets looked at; else, by the dice, a slap of the tail (seldom at the forest's
 *  edge: a browser's dusk is its own, so the bot cannot tell when deer graze there), a dive, a swim or a walk. */
function idle(seen: Seen): Job {
  const near = seen.others.filter((o) => o.real && far(o, seen.me) < LOOK).sort((a, b) => far(seen.me, a) - far(seen.me, b))[0];
  if (near) return { kind: "look", at: near.id };
  const roll = seen.roll ?? 1, edge = Math.hypot(seen.me.x, seen.me.z) > EDGE;
  if (roll < 0.15 && (seen.sinceSlap ?? Infinity) > (edge ? SLAP_EDGE : SLAP_EVERY)) return { kind: "wander", how: "slap" };
  if (roll < 0.35) return { kind: "wander", how: "dive" };
  if (roll < 0.6) return { kind: "wander", how: "swim" };
  return { kind: "wander", how: "walk" };
}

/** Whether to stop a moment: another beaver close ahead, moving, coming my way (each in front of the other), with the
 *  lower id: it goes on (round me), I wait. One far above or below (diving) does not meet me. */
export function yields(me: { id: number; x: number; y: number; z: number; f: number }, others: Other[]) {
  return others.some((o) => {
    const dx = o.x - me.x, dz = o.z - me.z, d = Math.hypot(dx, dz);
    if (!(d < MEET) || o.id > me.id || (o.speed ?? 0) < 0.2 || Math.abs((o.y ?? me.y) - me.y) > 1) return false;
    const ahead = (dx * Math.sin(me.f) + dz * Math.cos(me.f)) / d, back = -(dx * Math.sin(o.f ?? 0) + dz * Math.cos(o.f ?? 0)) / d;
    return ahead > 0.5 && back > 0.5;
  });
}

/** The watchdog: a job going on this long is stuck (walking into something, waiting for what never comes). */
export const overdue = (age: number) => age > WATCHDOG;

/** A line for the chat when the stick laid as number `placed` finished something; undefined for the others. */
export const milestone = (placed: number) =>
  placed === SLOTS ? "Dam's done!" : placed === SLOTS + LODGE ? "The lodge stands." : placed === STICKS ? "Cache is full. Ready for winter." : undefined;
