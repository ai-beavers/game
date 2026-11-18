// The pure part of moving focus through a menu without a mouse: which control is next in a direction, and how a
// held stick or d-pad repeats. No DOM here, so it can be tested alone (focus.test.ts); nav.ts wires it to the page.
//
//   nextFocus(rects, current, "down")     index of the control below (wraps round at the ends), -1 for none
//   const held = newRepeat();  repeatStep(held, dir, now)   dir once on a push, then again at a calm rate while held
export type Direction = "up" | "down" | "left" | "right";
export interface Rect { x: number; y: number; w: number; h: number }

export const DELAY = 450, EVERY = 180; // ms before a held direction repeats, and then between repeats
export const PUSH = 0.5; // how far a stick is pushed before it counts as a direction

/** The control nearest in that direction from the current one; none there: up and down wrap round, left and right
 *  stay. Nothing focused yet: the first. */
export function nextFocus(rects: readonly Rect[], current: number, dir: Direction): number {
  if (!rects.length) return -1;
  const from = rects[current];
  if (!from) return 0;
  const cx = (r: Rect) => r.x + r.w / 2, cy = (r: Rect) => r.y + r.h / 2;
  const vertical = dir === "up" || dir === "down", sign = dir === "down" || dir === "right" ? 1 : -1;
  const along = (r: Rect) => (vertical ? cy(r) - cy(from) : cx(r) - cx(from)) * sign;
  const across = (r: Rect) => Math.abs(vertical ? cx(r) - cx(from) : cy(r) - cy(from));
  let best = -1, score = Infinity;
  rects.forEach((r, i) => {
    // Beside the current one and not merely nudged along: in a row, left and right never jump to another row.
    if (i === current || along(r) <= 1 || (!vertical && across(r) > from.h / 2)) return;
    const s = along(r) + across(r) * 2;
    if (s < score) { score = s; best = i; }
  });
  if (best >= 0 || !vertical) return best >= 0 ? best : current;
  // Wrap: down from the bottom row goes to the top row, up from the top to the bottom, nearest across.
  rects.forEach((r, i) => {
    const s = along(r) * 1000 + across(r);
    if (i !== current && s < score) { score = s; best = i; }
  });
  return best >= 0 ? best : current;
}

/** The direction a stick and d-pad point to, or none. Up is negative y, as on the standard mapping. */
export function padDirection(x: number, y: number, dpad: { up: boolean; down: boolean; left: boolean; right: boolean }): Direction | undefined {
  if (dpad.up) return "up";
  if (dpad.down) return "down";
  if (dpad.left) return "left";
  if (dpad.right) return "right";
  if (Math.max(Math.abs(x), Math.abs(y)) < PUSH) return undefined;
  return Math.abs(y) >= Math.abs(x) ? (y < 0 ? "up" : "down") : (x < 0 ? "left" : "right");
}

export const newRepeat = () => ({ dir: undefined as Direction | undefined, next: 0 });

/** Fires the direction when first pushed, after DELAY when still held, then every EVERY ms; nothing when let go. */
export function repeatStep(held: ReturnType<typeof newRepeat>, dir: Direction | undefined, now: number): Direction | undefined {
  if (dir !== held.dir) { held.dir = dir; held.next = now + DELAY; return dir; }
  if (!dir || now < held.next) return undefined;
  held.next = now + EVERY;
  return dir;
}
