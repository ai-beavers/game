// The player's pure logic, independent of rendering and physics so it can be tested alone: when a jump starts (coyote
// time and jump buffer), the carry sequence (pickup → carrying → drop), and the bookkeeping that fills Motion.
//
//   const jump = newJump();      if (jumpStarts(jump, dt, grounded, input.jump, canJump)) vy = JUMP_SPEED;
//   const act = newAction();     const event = stepAction(act, dt, actPressed, stickInReach);  // "grab" | "release"
//   trackMotion(motion, dt, facts);                                                            // fills motion in place
import type { Action, Motion } from "../contracts.ts";

export const COYOTE = 0.1; // s after leaving the ground in which a jump still starts
export const BUFFER = 0.1; // s a press before landing is remembered
export const PICKUP_TIME = 1.0, DROP_TIME = 0.6; // s for the whole action; the hand closes or opens at half
export const SWIM_EASE = 0.5; // s for motion.swimming to go from 0 to 1

// ---- jump --------------------------------------------------------------------------------------------------------

export interface Jump { sinceGround: number; sincePress: number; held: boolean }
export const newJump = (): Jump => ({ sinceGround: Infinity, sincePress: Infinity, held: false });

/** Once per step. True when the jump starts this step: a fresh press (or one at most BUFFER old) while on the
 *  ground (or at most COYOTE after leaving it). Each press and each stay on the ground give one jump. */
export function jumpStarts(s: Jump, dt: number, grounded: boolean, held: boolean, allowed: boolean): boolean {
  s.sinceGround = grounded ? 0 : s.sinceGround + dt;
  s.sincePress = held && !s.held ? 0 : s.sincePress + dt;
  s.held = held;
  if (!allowed || s.sincePress > BUFFER + 1e-9 || s.sinceGround > COYOTE + 1e-9) return false;
  s.sincePress = s.sinceGround = Infinity;
  return true;
}

// ---- carrying ----------------------------------------------------------------------------------------------------

export interface ActionState { action: Action; progress: number; carrying: boolean }
export const newAction = (): ActionState => ({ action: "none", progress: 0, carrying: false });

/** Once per step. `pressed` is the edge of the context key; `inReach` whether a stick could be picked up now.
 *  Returns "grab" in the step the pickup reaches half way, "release" when the drop does. */
export function stepAction(s: ActionState, dt: number, pressed: boolean, inReach: boolean): "grab" | "release" | undefined {
  if (s.action === "none") {
    if (pressed && s.carrying) s.action = "drop";
    else if (pressed && inReach) s.action = "pickup";
    else return;
    s.progress = 0;
    return;
  }
  if (s.action !== "pickup" && s.action !== "drop") return;
  const before = s.progress;
  s.progress = Math.min(1, before + dt / (s.action === "pickup" ? PICKUP_TIME : DROP_TIME));
  let event: "grab" | "release" | undefined;
  if (before < 0.5 && s.progress >= 0.5) {
    event = s.action === "pickup" ? "grab" : "release";
    s.carrying = event === "grab";
  }
  if (s.progress >= 1) { s.action = "none"; s.progress = 0; }
  return event;
}

// ---- motion ------------------------------------------------------------------------------------------------------

export const newMotion = (): Motion => ({
  speed: 0, distance: 0, turning: 0, grounded: false, vertical: 0, airTime: 0, sinceLanding: 100, landingSpeed: 0,
  swimming: 0, action: "none", actionProgress: 0, carrying: false, anger: 0, time: 0,
});

/** What happened in one step, measured from where the character really went. */
export interface StepFacts {
  moved: number; // horizontal metres this step
  vertical: number; // m/s
  turning: number; // rad/s, positive to the left
  grounded: boolean;
  afloat: boolean;
  act: ActionState;
}

/** Fills every field of motion in place, except anger (which belongs to whoever sets it). Afloat counts as held
 *  up: no air time, and coming into the water is a landing. */
export function trackMotion(m: Motion, dt: number, f: StepFacts): void {
  const supported = f.grounded || f.afloat, wasSupported = m.airTime === 0;
  m.time += dt;
  m.speed = f.moved / dt;
  if (f.grounded) m.distance += f.moved;
  m.turning = f.turning;
  if (supported && !wasSupported) { m.sinceLanding = 0; m.landingSpeed = Math.max(0, -m.vertical); }
  else m.sinceLanding += dt;
  m.airTime = supported ? 0 : m.airTime + dt;
  m.grounded = f.grounded;
  m.vertical = f.vertical;
  const target = f.afloat ? 1 : 0, ease = dt / SWIM_EASE;
  m.swimming += Math.max(-ease, Math.min(ease, target - m.swimming));
  m.action = f.act.action;
  m.actionProgress = f.act.progress;
  m.carrying = f.act.carrying;
}

// ---- small maths -------------------------------------------------------------------------------------------------

/** The angle a turned towards b by at most `max`, the short way round. */
export function turnTowards(a: number, b: number, max: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + Math.max(-max, Math.min(max, d));
}

/** Moves value towards target by at most step. */
export const approach = (value: number, target: number, step: number) =>
  value < target ? Math.min(target, value + step) : Math.max(target, value - step);
