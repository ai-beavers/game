// What the context key (E) does right now, worked out the way src/player/index.ts decides it, so the prompt on
// screen never promises what the player will not do. Pure maths, tested in reach.test.ts.
//
//   contextAction({ feet, facing, carrying, ready, sticks })   → "pickup" | "drop" | undefined
//
// shortcut: REACH and REACH_RADIUS are copies of the player's private constants; if the player exports its own
// inReach() (or the stick it would take), use that instead.
export const REACH = 0.6, REACH_RADIUS = 0.45;

interface Point { x: number; y: number; z: number }

export interface ReachState {
  feet: Point;
  /** Radians, 0 = +z, as PlayerControls.facing. */
  facing: number;
  carrying: boolean;
  /** On the ground or afloat, and no action under way: only then does a press of E start one. */
  ready: boolean;
  /** Where the sticks lie that can be taken (the carried one and disabled ones left out). */
  sticks: Point[];
}

/** Index of the stick the player would pick up, or -1. */
export function stickInReach(feet: Point, facing: number, sticks: Point[]) {
  const fx = feet.x + Math.sin(facing) * REACH, fy = feet.y + 0.1, fz = feet.z + Math.cos(facing) * REACH;
  let best = -1, bestDistance = REACH_RADIUS;
  sticks.forEach((at, i) => {
    const d = Math.hypot(at.x - fx, (at.y - fy) * 0.5, at.z - fz);
    if (d < bestDistance) { best = i; bestDistance = d; }
  });
  return best;
}

export function contextAction(s: ReachState): "pickup" | "drop" | undefined {
  if (!s.ready) return undefined;
  if (s.carrying) return "drop";
  return stickInReach(s.feet, s.facing, s.sticks) >= 0 ? "pickup" : undefined;
}
