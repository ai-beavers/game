// Mrs. Beaver's rules as plain logic, apart from rendering, so they can be tested alone: where she may be hidden,
// where her flower lies dropped on the way, which hiding place a visit picks, and the quest that rescues her: three
// steps in order (find her flower, find her, gnaw the pen open), and what the Use key offers on each.
//
//   const quest = pick(Math.random());               a visit: at HIDING[quest.place], her flower at FLOWER[quest.place]
//   offered(quest, { flower, pen, carrying, afloat })  "flower" | "gnaw" | undefined: what the Use key offers there
//   take(quest)                                      true once: the flower picked up (flower step → find)
//   find(quest, pen)                                 true once: within FIND m of the pen (find step → gnaw)
//   gnaw(quest, dt)                                  true once: gnawed GNAW s in all, the pen open (gnaw step → freed)
//   done(quest)                                      how many steps are done, 0 … 3 (the checklist's ticks)
//   rows(done, fits)                                 which step lines the checklist shows
//   wayHome(place)                                   the points she walks to in turn once freed, the last one HOME
//
// Each change says whether it changed something, so the feature tells of each step exactly once. Nothing here is
// kept: the quest lives in memory for one visit (no localStorage, no network).

export interface XZ { x: number; z: number }
/** The three hiding places: on dry land just inside where the bank stood before the clearing grew (terrain.ts
 *  FIRST_RIM; they stayed, so a rescue is no longer a walk than before), clear of the Pond, the building site, the Shop, the
 *  trading post and the spawn, each with a straight way over land to HOME (rules.test.ts checks both). West, south,
 *  north. */
export const HIDING: readonly XZ[] = [{ x: -13.3, z: -2.3 }, { x: 3.5, z: -13 }, { x: -5, z: 13.6 }];
/** Where her flower lies, one spot per hiding place (same order): about halfway along the straight way from HOME to
 *  it, on dry land, clear of the Pond, the site, the dam, the Shop, the trading post, the spawn and the sticks laid out
 *  (rules.test.ts checks it). */
export const FLOWER: readonly XZ[] = [{ x: -7.9, z: 0 }, { x: 0.8, z: -6.1 }, { x: -4, z: 9.1 }];
/** Where she waits once freed: beside the building site, on its south-west side away from the dam and the crates. */
export const HOME: XZ = { x: -2.5, z: 2.3 };
/** The bends of her way home from each hiding place (same order), walked in turn before HOME: from the north one the
 *  straight way runs into the Calendar board beside the Shop, so it bends round the board's east end, short of the
 *  crates by the site. Every leg is a straight way over dry land past nothing solid (rules.test.ts checks them). */
export const BENDS: readonly (readonly XZ[])[] = [[], [], [{ x: -3.1, z: 9.5 }]];
/** Her way home from a hiding place: the points she walks to in turn, the last one HOME. */
export const wayHome = (place: number): XZ[] => [...(BENDS[place] ?? []), HOME];
/** m from the middle of the pen to the player's feet within which the Use key offers to gnaw it open. */
export const REACH = 1.3;
/** m from the flower to the player's feet within which the Use key offers to pick it up. */
export const FLOWER_REACH = 1.2;
/** m from the middle of the pen to the player's feet within which she counts as found. */
export const FIND = 4;
/** s of held Use that gnaw the pen open; what is gnawed stays for the visit when Use is let go. */
export const GNAW = 3;

/** The step reached: the one at hand, or freed once all three are done. */
export type Step = "flower" | "find" | "gnaw" | "freed";
/** The steps in order: a step's index is how many are done when it is reached. */
const ORDER: readonly Step[] = ["flower", "find", "gnaw", "freed"];
export interface Quest { place: number; step: Step; gnawed: number }

/** A new visit: on the flower step, at the hiding place a random number 0 … 1 picks (and its flower spot). */
export function pick(random: number): Quest {
  return { place: Math.min(HIDING.length - 1, Math.max(0, Math.floor(random * HIDING.length))), step: "flower", gnawed: 0 };
}

/** What the Use key offers: "flower" within FLOWER_REACH of the flower on the flower step, "gnaw" within REACH of the
 *  pen on the gnaw step; only with free paws, on land. flower and pen: m on the ground from the player's feet. */
export function offered(quest: Quest, at: { flower: number; pen: number; carrying: boolean; afloat: boolean }): "flower" | "gnaw" | undefined {
  if (at.carrying || at.afloat) return undefined;
  if (quest.step === "flower" && at.flower <= FLOWER_REACH) return "flower";
  if (quest.step === "gnaw" && at.pen <= REACH) return "gnaw";
  return undefined;
}

/** Picks up her flower: true on the flower step (→ find), false on any other. */
export function take(quest: Quest): boolean {
  if (quest.step !== "flower") return false;
  quest.step = "find";
  return true;
}

/** Finds her: true on the find step within FIND m of the pen (pen: m from the feet), → gnaw; false otherwise. */
export function find(quest: Quest, pen: number): boolean {
  if (quest.step !== "find" || pen > FIND) return false;
  quest.step = "gnaw";
  return true;
}

/** Gnaws the pen for dt s: only on the gnaw step. True once, when all that is gnawed passes GNAW: she is freed. */
export function gnaw(quest: Quest, dt: number): boolean {
  if (quest.step !== "gnaw") return false;
  quest.gnawed = Math.min(GNAW, quest.gnawed + Math.max(0, dt));
  if (quest.gnawed < GNAW) return false;
  quest.step = "freed";
  return true;
}

/** How many of the three steps are done: 0 on the flower step … 3 once she is freed. */
export function done(quest: Quest): number {
  return ORDER.indexOf(quest.step);
}

/** The step lines (0 … 2) the checklist shows under its title with `done` steps done: all three where they fit, only
 *  the one at hand where they would not (a small, wide screen), none once she is freed. */
export function rows(done: number, fits: boolean): number[] {
  const count = ORDER.length - 1;
  if (done >= count) return [];
  return fits ? [0, 1, 2] : [Math.max(0, done)];
}
