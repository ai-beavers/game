// Where the Hoverboard lies and where the beaver goes stepping on and off: plain numbers from the spawn, the path and
// the ground's height, so they can be tested alone.
//
//   homePlace(spawn, pathAt, heightAt, level)          where it lies after a reload: beside the path near the spawn
//   stepOff(board, toward, heightAt, level, clear?)    where the feet go stepping off: beside it, on dry ground
//   near(feet, board)                                  whether the feet are near enough to step on

export interface Place { x: number; z: number }
export type HeightAt = (x: number, z: number) => number;
/** 0 … 1: how much of the worn path is at x, z (src/world/terrain.ts pathAt). */
export type PathAt = (x: number, z: number) => number;

/** The plank, m: length nose to tail, width, thickness. */
export const PLANK = { length: 1.0, width: 0.38, thickness: 0.05 };
/** m the plank's top floats over the ground, and the beaver's feet with it: a hand's width. */
export const HOVER = 0.1;

/** m south of the spawn (along the path, back) the board lies: beside the path, not where the beaver stands at first. */
const BACK = 0.6;
/** m from the path's edge to the board's middle: the plank clear of the trodden middle. */
const OFF_PATH = 0.5;
/** m of dry ground the board needs round its middle. */
const DRY = 0.7;
/** m from the board's middle to where the feet go stepping off: its half width, the beaver's half width, a gap. */
const SIDE = 0.7;
/** m from the board's middle line within which the beaver can step on. */
const NEAR = 0.9;

const forward = (heading: number) => ({ x: Math.sin(heading), z: Math.cos(heading) });

/** Whether there is dry ground round x, z, r m about: the ground above the water at the middle and four points. */
const dryAt = (x: number, z: number, r: number, heightAt: HeightAt, level: number) =>
  [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dz]) => heightAt(x + dx!, z + dz!) > level + 0.1);

/** Where the board lies after a reload: its middle and heading (radians, as Player.facing: atan2(x, z)), its nose up
 *  the path (north, to the building site). A little behind the spawn, on the west of the path, past its worn edge;
 *  on the east when the west is wet. */
export function homePlace(spawn: Place, pathAt: PathAt, heightAt: HeightAt, level: number) {
  const z = spawn.z - BACK;
  for (const side of [-1, 1]) for (let d = 0.5; d < 4; d += 0.1) {
    const x = spawn.x + side * d;
    if (pathAt(x, z) > 0.02) continue;
    const at = { x: x + side * OFF_PATH, z };
    if (pathAt(at.x, at.z) < 0.1 && dryAt(at.x, at.z, DRY, heightAt, level)) return { ...at, heading: 0 };
    break; // past the path on this side, but wet: the other side
  }
  return { x: spawn.x - 2, z, heading: 0 };
}

/** Where the feet go stepping off the board lying at `board` (its middle and heading): beside it, on the side
 *  `toward` (radians, as facing: the way the beaver looks) points to when that is dry and `clear`, else the other side;
 *  a little further out where neither is dry right beside it. */
export function stepOff(board: Place & { heading: number }, toward: number, heightAt: HeightAt, level: number, clear: (x: number, z: number) => boolean = () => true): Place {
  const f = forward(board.heading), t = forward(toward), left = { x: f.z, z: -f.x }, right = { x: -f.z, z: f.x };
  const sides = left.x * t.x + left.z * t.z >= 0 ? [left, right] : [right, left];
  const dry = (x: number, z: number) => heightAt(x, z) > level + 0.05;
  for (let k = SIDE; k < SIDE + 1.5; k += 0.1) for (const d of sides) {
    const x = board.x + d.x * k, z = board.z + d.z * k;
    if (dry(x, z) && clear(x, z)) return { x, z };
  }
  for (let k = SIDE; k < SIDE + 1.5; k += 0.1) for (const d of sides) { // all in the way: dry ground still
    const x = board.x + d.x * k, z = board.z + d.z * k;
    if (dry(x, z)) return { x, z };
  }
  return { x: board.x, z: board.z }; // nowhere dry beside it (it never goes over water): where it is
}

/** Whether feet at `feet` are near the board lying at `board`: within NEAR of its middle line, nose to tail. */
export function near(feet: Place, board: Place & { heading: number }) {
  const f = forward(board.heading), dx = feet.x - board.x, dz = feet.z - board.z;
  const along = Math.max(-PLANK.length / 2, Math.min(PLANK.length / 2, dx * f.x + dz * f.z));
  return Math.hypot(dx - f.x * along, dz - f.z * along) < NEAR;
}
