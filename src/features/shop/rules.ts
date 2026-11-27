// The Shop's rules as plain logic, apart from rendering, so they can be tested alone: how much Experience the player
// has, which Outfits they own and which one they wear, their beaver's Class, and the named changes that alone change that.
//
//   const state = load(localStorage.getItem(KEY));    any stored text, broken or missing: a valid state
//   earn(state, 1)                                    one Experience for a stick built in
//   buy(state, "moss")                                true: paid and worn; false: owned already, or too dear
//   wear(state, "classic")                            true: now worn; false: not owned
//   levelOf(state.earned)                             { level: 2, into: 5, need: 30 }: the player card's LV and bar
//   choose(state, "gnawer")                           true: the beaver's class now (free, any time); false: no such class
//   classEffect(state)                                { biteTime: 0.4, swimSpeed: 0.5 }: what the class makes better
//   lampNight(sky.dark)                               0 … 1: how far into the night the shop's lights glow
//
// The state is plain JSON, kept in localStorage beside the build feature's saved game.

import { DEFAULT_LOOK, type RGB } from "../../contracts.ts";
// No class plays as every beaver does: those values are owned by the player (swimming) and the build feature (each
// bite), so they are read from there rather than copied (one owner per fact).
import { SWIM_SPEED } from "../../player/state.ts";
import { BITE_TIME } from "../build/rules.ts";

export type OutfitId = "classic" | "moss" | "sunset" | "disco" | "shark";
/** An Outfit: a matching shirt colour and hat colour, linear RGB 0 … 1, and its price in Experience. hood: it wears a
 *  shark's hood in the hat's place (hat is then the hood's grey); every other Outfit wears the felt hat. An Outfit only
 *  changes how the beaver looks, never what it can do. */
export interface Outfit { id: OutfitId; name: string; price: number; shirt: RGB; hat: RGB; hood: boolean }

/** The look every beaver has before it buys anything: free, always owned. Its colours are the beaver's own
 *  (DEFAULT_LOOK: the cream shirt as printed, the charcoal felt hat). */
export const DEFAULT: OutfitId = "classic";
export const OUTFITS: readonly Outfit[] = [
  { id: "classic", name: "Classic", price: 0, shirt: DEFAULT_LOOK.shirt, hat: DEFAULT_LOOK.hat, hood: false },
  { id: "moss", name: "Moss", price: 10, shirt: [0.3, 0.55, 0.26], hat: [0.12, 0.26, 0.1], hood: false },
  { id: "sunset", name: "Sunset", price: 25, shirt: [1, 0.42, 0.12], hat: [0.5, 0.1, 0.06], hood: false },
  { id: "disco", name: "Disco", price: 50, shirt: [0.85, 0.2, 0.75], hat: [0.95, 0.68, 0.12], hood: false },
  { id: "shark", name: "Shark", price: 75, shirt: [0.2, 0.25, 0.3], hat: [0.3, 0.34, 0.38], hood: true }, // slate shirt, grey hood
];
export const outfit = (id: OutfitId) => OUTFITS.find((o) => o.id === id)!;

export type ClassId = "gnawer" | "swimmer";
/** What a Class changes in how the player's own beaver plays: seconds per bite into a tree, swimming speed in m/s. */
export interface ClassEffect { biteTime: number; swimSpeed: number }
/** A Class: what a beaver is best at, picked for free at the shop. It adds no ability and changes nothing in the
 *  world's work (a tree takes as many bites as ever): only how long each of the player's own bites takes, or how fast
 *  their own beaver swims. */
export interface BeaverClass extends ClassEffect { id: ClassId; name: string; line: string }

/** A beaver with no class plays as every beaver does (build's BITE_TIME, the player's SWIM_SPEED). */
export const PLAIN: ClassEffect = { biteTime: BITE_TIME, swimSpeed: SWIM_SPEED };
export const NO_CLASS = null;
export const CLASSES: readonly BeaverClass[] = [
  { id: "gnawer", name: "Gnawer", line: "Bites faster", ...PLAIN, biteTime: 0.4 },
  { id: "swimmer", name: "Swimmer", line: "Swims faster", ...PLAIN, swimSpeed: 0.75 },
];
export const beaverClass = (id: ClassId | null) => CLASSES.find((c) => c.id === id);

/** experience: what there is to spend; earned: all Experience ever earned, which spending does not lower (the level);
 *  class: the beaver's Class, or null for none. */
export interface ShopState { experience: number; earned: number; owned: OutfitId[]; wearing: OutfitId; class: ClassId | null }

/** Experience from one level to the next: 20 from level 1 to 2, then 10 more for each level after (30, 40, …). */
export const toNext = (level: number) => 10 + 10 * level;

/** The player's level from all Experience earned, and how far into it: levelOf(25) → { level: 2, into: 5, need: 30 }. */
export function levelOf(earned: number) {
  let level = 1, into = Math.max(0, Math.floor(earned));
  while (into >= toNext(level)) into -= toNext(level++);
  return { level, into, need: toNext(level) };
}

const known = (id: unknown): id is OutfitId => OUTFITS.some((o) => o.id === id);

/** A valid state from whatever was stored: nothing, broken JSON, an older or tampered state. The default is always owned. */
export function load(stored: string | null | undefined): ShopState {
  let raw: Partial<Record<keyof ShopState, unknown>> = {};
  try { const parsed = JSON.parse(stored ?? "null"); if (parsed && typeof parsed === "object") raw = parsed; } catch { /* a new state */ }
  const count = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  const experience = count(raw.experience);
  // A save from before levels has no total: it starts at the Experience there is. Never below it.
  const earned = Math.max(experience, count(raw.earned));
  const owned = OUTFITS.map((o) => o.id).filter((id) => id === DEFAULT || (Array.isArray(raw.owned) && raw.owned.includes(id)));
  const wearing = known(raw.wearing) && owned.includes(raw.wearing) ? raw.wearing : DEFAULT;
  const chosen = beaverClass(raw.class as ClassId)?.id ?? NO_CLASS; // missing, unknown or rubbish: no class
  return { experience, earned, owned, wearing, class: chosen };
}

/** n Experience earned (one per stick built in): to spend, and towards the level. */
export function earn(s: ShopState, n: number) {
  if (Number.isFinite(n) && n > 0) { s.experience += Math.floor(n); s.earned += Math.floor(n); }
}

/** Pays for an Outfit and puts it on. Refused (false, nothing changes) when it is owned already or costs more than the
 *  Experience there is. */
export function buy(s: ShopState, id: OutfitId): boolean {
  if (!known(id) || s.owned.includes(id) || outfit(id).price > s.experience) return false;
  s.experience -= outfit(id).price;
  s.owned = OUTFITS.map((o) => o.id).filter((o) => o === id || s.owned.includes(o));
  s.wearing = id;
  return true;
}

/** Puts on an owned Outfit (or the default), for free. False: not owned. */
export function wear(s: ShopState, id: OutfitId): boolean {
  if (!s.owned.includes(id)) return false;
  s.wearing = id;
  return true;
}

/** Makes the beaver a Gnawer, a Swimmer, or (null) no class: free, at any time. False: no such class, nothing changes. */
export function choose(s: ShopState, id: ClassId | null): boolean {
  if (id !== NO_CLASS && !beaverClass(id)) return false;
  s.class = id;
  return true;
}

/** The bite time and swim speed of the state's class; today's values with no class. */
export function classEffect(s: ShopState): ClassEffect {
  const c = beaverClass(s.class) ?? PLAIN;
  return { biteTime: c.biteTime, swimSpeed: c.swimSpeed };
}

/** 0 by day … 1 at night: how far the shop's bulbs and café lamps are into their night glow, by the sky's dark (0 … 1).
 *  The Lightbulb at the workbench glows by it too (src/features/lightbulb/state.ts). */
export const lampNight = (dark: number) => Math.min(1, Math.max(0, (dark - 0.08) / 0.4));
