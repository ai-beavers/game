// The mushrooms' rules as plain logic, apart from rendering, so they can be tested alone: where the mushrooms grow,
// what the Use key offers there, the appetite that eating raises, and the dizzy view that too many too quickly bring.
//
//   const m = fresh();                                        a visit: every spot grown, no appetite, the view clear
//   offered(m, { distances, carrying, afloat })               the spot the Use key offers to eat, or undefined
//   eat(m, spot)                                              true: this made the view dizzy (or full strength again)
//   step(m, dt)                                               dt s of game time: the appetite drains, the view moves on
//   dizzy(m)                                                  0 … 1: how dizzy the view is now
//   dawn(m)                                                   every spot grows back; passedDawn(before, after): the hour went over dawn
//
// All times are game time (the fast tour runs them faster, as everything else). Nothing here is kept: the mushrooms
// live in memory for one visit (no localStorage, no network).

export interface XZ { x: number; z: number }
/** Where the mushrooms grow: at the foot of trees of the layout (placeAll), on the side towards the meadow, on dry
 *  land, clear of everything the player goes to for something else (rules.test.ts checks it). They stay when the tree
 *  is felled. Three near each other to the south-east and south, then south-west, west-south-west (clear of the brush pile at Mrs. Beaver's west-north-west hiding place), north. */
export const SPOTS: readonly XZ[] = [{ x: 4.3, z: -7.4 }, { x: 7.4, z: -8.6 }, { x: 0.1, z: -10.3 }, { x: -5.6, z: -11.2 }, { x: -8.1, z: -6 }, { x: 0.3, z: 13.6 }];
/** m from a spot to the player's feet within which the Use key offers to eat it. */
export const REACH = 1.0;
/** Mushrooms eaten within WINDOW s that make the view dizzy. */
export const THRESHOLD = 3;
/** s a mushroom counts towards the appetite: then it has drained away again. */
export const WINDOW = 120;
/** s the dizzy view takes to come, how long it holds at full strength, and how long it takes to go. */
export const FADE_IN = 2, HOLD = 20, FADE_OUT = 5;
/** The hour of dawn, when eaten mushrooms have grown back. */
export const DAWN = 5;

export interface Mushrooms {
  /** Per spot: eaten (gone until dawn). */
  eaten: boolean[];
  /** s ago each mushroom still counting towards the appetite was eaten. */
  meals: number[];
  /** The dizzy view: its strength before easing (0 … 1), whether it is still coming, s left at full strength. */
  level: number; rising: boolean; hold: number;
}

/** A new visit: every spot grown, no appetite, the view clear. */
export const fresh = (): Mushrooms => ({ eaten: SPOTS.map(() => false), meals: [], level: 0, rising: false, hold: 0 });

/** The appetite: how many mushrooms were eaten within the last WINDOW s. */
export const appetite = (m: Mushrooms) => m.meals.length;

/** The spot the Use key offers to eat: the nearest uneaten one within REACH (distances: m from each spot to the
 *  feet, in SPOTS' order); none while carrying, afloat or riding. */
export function offered(m: Mushrooms, at: { distances: readonly number[]; carrying: boolean; afloat: boolean }): number | undefined {
  if (at.carrying || at.afloat) return undefined;
  let best: number | undefined;
  at.distances.forEach((d, i) => {
    if (d <= REACH && !m.eaten[i] && (best === undefined || d < at.distances[best]!)) best = i;
  });
  return best;
}

/** Eats the mushroom at a spot, if it has one: it is gone until dawn and the appetite rises by one. True when this
 *  made the view dizzy, or (while dizzy) started the full strength again. */
export function eat(m: Mushrooms, spot: number): boolean {
  if (m.eaten[spot] !== false) return false;
  m.eaten[spot] = true;
  m.meals.push(0);
  if (m.level <= 0 && appetite(m) < THRESHOLD) return false;
  m.rising = m.level < 1;
  m.hold = HOLD;
  return true;
}

/** dt s of game time: the appetite drains, and the dizzy view comes, holds or goes. */
export function step(m: Mushrooms, dt: number) {
  m.meals = m.meals.map((t) => t + dt).filter((t) => t < WINDOW);
  if (m.rising) {
    m.level = Math.min(1, m.level + dt / FADE_IN);
    if (m.level >= 1) m.rising = false;
  } else if (m.hold > 0) m.hold = Math.max(0, m.hold - dt);
  else m.level = Math.max(0, m.level - dt / FADE_OUT);
}

/** 0 … 1: how dizzy the view is now, eased so it never starts or stops with a jolt. */
export function dizzy(m: Mushrooms): number {
  const t = Math.min(1, Math.max(0, m.level));
  return t * t * (3 - 2 * t);
}

/** Every spot grows back. */
export function dawn(m: Mushrooms) {
  m.eaten = SPOTS.map(() => false);
}

/** Whether the clock went over dawn going from hour `before` to hour `after` (0 … 24, forwards, across midnight). */
export function passedDawn(before: number, after: number): boolean {
  const went = (after - before + 24) % 24, toDawn = (DAWN - before + 24) % 24;
  return toDawn > 0 && toDawn <= went;
}
