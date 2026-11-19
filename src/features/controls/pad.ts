// The pure part of the controls: dead zones and how a gamepad's buttons and sticks become the player's Input.
// No DOM here, so it can be tested alone (pad.test.ts).
//
//   const { x, y } = deadZone(axes[0], axes[1]);    radial dead zone, rescaled so a push just past it starts at 0
//   padInput(gamepad, input);                       fills input from a standard-mapping gamepad
//
// Standard mapping: left stick moves, A jumps (rises under water), X acts, B held sits (on land) or dives (swimming), RB slaps the tail, Y flashes the lantern, LB, the right
// trigger or a click on the left stick runs; the d-pad moves too. LT opens the map (src/features/hud).
import type { Input } from "../../player/input.ts";

export const INNER = 0.18; // a stick at rest drifts up to here
export const OUTER = 0.95; // and counts as fully pushed from here
export const TRIGGER = 0.3; // how far a trigger is pulled before it counts
export const WALK_PUSH = 0.5; // a stick pushed this far walks; less walks slower, more runs, full push runs fully

/** Button numbers of the standard gamepad mapping. */
export const BUTTON = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15 } as const;

/** What padInput needs of a Gamepad; a real one fits, and so does a fake in a test. */
export interface PadLike { axes: readonly number[]; buttons: readonly { pressed: boolean; value: number }[] }

/** Radial dead zone: inside INNER nothing, from there to OUTER rises to 1, the direction kept. */
export function deadZone(x: number, y: number, inner = INNER, outer = OUTER) {
  const length = Math.hypot(x, y);
  if (length <= inner) return { x: 0, y: 0 };
  const scale = Math.min(1, (length - inner) / (outer - inner)) / length;
  return { x: x * scale, y: y * scale };
}

export const down = (pad: PadLike, button: number) => {
  const b = pad.buttons[button];
  return !!b && (b.pressed || b.value > TRIGGER);
};

/** A stick pushed this far (0 … 1, after the dead zone) as the player's move and run: up to WALK_PUSH the move
 *  grows to full at walking speed, beyond it run grows to 1 at full push. */
export function stickSpeed(x: number, y: number) {
  const push = Math.min(1, Math.hypot(x, y)), scale = push > 0 ? Math.min(1, push / WALK_PUSH) / push : 0;
  return { x: x * scale, y: y * scale, run: Math.max(0, (push - WALK_PUSH) / (1 - WALK_PUSH)) };
}

/** Fills `into` from the pad: as fast as the stick is pushed, walk to run (screen up is forward); buttons as above. */
export function padInput(pad: PadLike, into: Input): Input {
  const pushed = deadZone(pad.axes[0] ?? 0, pad.axes[1] ?? 0), stick = stickSpeed(pushed.x, pushed.y);
  let x = stick.x, y = 0 - stick.y || 0; // never -0
  const dx = +down(pad, BUTTON.right) - +down(pad, BUTTON.left), dy = +down(pad, BUTTON.up) - +down(pad, BUTTON.down);
  if (dx || dy) { const length = Math.hypot(dx, dy); x = dx / length; y = dy / length; }
  into.move.x = x;
  into.move.y = y;
  into.run = [BUTTON.lb, BUTTON.rt, BUTTON.l3].some((b) => down(pad, b)) ? 1 : dx || dy ? 0 : stick.run;
  into.jump = down(pad, BUTTON.a);
  into.act = down(pad, BUTTON.x);
  into.slap = down(pad, BUTTON.rb);
  into.dive = down(pad, BUTTON.b); // B: sits on land, dives swimming (src/player)
  into.flash = down(pad, BUTTON.y);
  return into;
}

/** The first connected pad, if any. Taken fresh each time, so plugging in or pulling out just works. */
export function firstPad(pads: readonly (Gamepad | null)[] | undefined): Gamepad | undefined {
  for (const pad of pads ?? []) if (pad?.connected) return pad;
  return undefined;
}
