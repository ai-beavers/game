// The player's pure logic, independent of rendering and physics so it can be tested alone: when a jump starts (coyote
// time and jump buffer), the carry sequence (pickup → carrying → drop), and the bookkeeping that fills Motion.
//
//   const jump = newJump();      if (jumpStarts(jump, dt, grounded, input.jump, canJump)) vy = JUMP_SPEED;
//   const act = newAction();     const event = stepAction(act, dt, actPressed, stickInReach);  // "grab" | "release"
//   const slap = newSlap();      stepSlap(slap, dt, slapPressed, allowed);                      // the tail slap, Q
//   const dive = newDive();      stepDive(dive, dt, diveHeld, afloat, headUnder);              // diving, C held
//   const { low, slow } = stepLow(diveHeld, crawlHeld, facts);                                 // sit (C) and crawl (Y)
//   trackMotion(motion, dt, facts);                                                            // fills motion in place
import { RUN_SPEED, WALK_SPEED, type Action, type Motion } from "../contracts.ts";
import type { Input } from "./input.ts";

export const SLOPE = 40 * Math.PI / 180; // rad: steepest ground it walks up; steeper ground it slides down
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

// ---- tail slap ---------------------------------------------------------------------------------------------------

// The tail goes up, then strikes down at SLAP_HIT of the move; the next slap can start SLAP_COOLDOWN after this one did.
export const SLAP_TIME = 0.9, SLAP_HIT = 0.5, SLAP_COOLDOWN = 2.5; // s, progress 0 … 1, s
export interface Slap { progress: number; wait: number }
export const newSlap = (): Slap => ({ progress: 0, wait: 0 });

/** Once per step. pressed: the edge of the slap key; allowed: held up (ground or water) and no other action. */
export function stepSlap(s: Slap, dt: number, pressed: boolean, allowed: boolean) {
  s.wait = Math.max(0, s.wait - dt);
  if (s.progress > 0) s.progress = s.progress + dt / SLAP_TIME >= 1 ? 0 : s.progress + dt / SLAP_TIME;
  else if (pressed && allowed && s.wait === 0) { s.progress = dt / SLAP_TIME; s.wait = SLAP_COOLDOWN; }
}

/** The tail strikes between these two Motions: the slap's progress (action "none") passed SLAP_HIT. */
export const slapHits = (before: Motion, now: Motion) =>
  before.action === "none" && now.action === "none" && before.actionProgress < SLAP_HIT && now.actionProgress >= SLAP_HIT;

// ---- diving ------------------------------------------------------------------------------------------------------

// Held while swimming, the dive key takes the beaver under; it comes up when the key is let go or its breath runs
// out (no harm: it just surfaces, and dives again on a fresh press). Breath goes while the head is under and comes
// back at the surface.
export const BREATH = 20, REFILL = 6; // s of breath under water; s to get all of it back at the surface
export interface Dive { diving: boolean; breath: number; spent: boolean }
export const newDive = (): Dive => ({ diving: false, breath: BREATH, spent: false });

/** Once per step. held: the dive key; afloat: swimming; under: the head below the surface. True while it dives. */
export function stepDive(s: Dive, dt: number, held: boolean, afloat: boolean, under: boolean) {
  s.breath = under ? Math.max(0, s.breath - dt) : Math.min(BREATH, s.breath + dt * BREATH / REFILL);
  if (s.breath === 0) s.spent = true;
  else if (!held) s.spent = false;
  s.diving = held && afloat && !s.spent;
  return s.diving;
}

// ---- sit and crawl -----------------------------------------------------------------------------------------------

// On land the dive key held sits the beaver (on its haunches, tail flat on the ground) and Y held crawls it (low on
// all fours, slower than walking). Both last only while held; nothing is kept from one step to the next.
export type Low = "none" | "sit" | "crawl";
/** m/s: a crawl goes at about half the walking speed, and never runs. */
export const CRAWL_SPEED = WALK_SPEED / 2;
/** riding: on a ride (Player.ride), and which: "water" sits in the canoe, "land" stands on the Hoverboard. */
export interface LowFacts { grounded: boolean; afloat: boolean; moving: boolean; acting: boolean; jumping: boolean; riding?: "water" | "land" }

/** Once per step. sit: the dive key held; crawl: Y held. Sit holds only standing still (moving, it walks); crawl
 *  wins over sit; an action (pickup, drop, gnaw, build) or a jump gets it up while it lasts, and it goes low again
 *  after if the key is still held. The tail slap is no action here: a sitting beaver slaps sitting. slow: the crawl's
 *  speed, no running. */
export function stepLow(sit: boolean, crawl: boolean, f: LowFacts): { low: Low; slow: boolean } {
  if (f.riding === "water") return { low: "sit", slow: false }; // in the canoe it sits, keys or not
  if (f.riding === "land") return { low: "none", slow: false }; // on the Hoverboard it stands, keys or not
  const low: Low = !f.grounded || f.afloat || f.acting || f.jumping ? "none" : crawl ? "crawl" : sit && !f.moving ? "sit" : "none";
  return { low, slow: low === "crawl" };
}

// ---- riding a canoe ------------------------------------------------------------------------------------------

// Swimming it goes at SWIM_SPEED; sitting in the canoe (src/features/canoe) it paddles at RIDE_SPEED, a little above
// walking. In the canoe only the move keys and E count: jump, dive, crawl, run and the tail slap would tip it over.
export const SWIM_SPEED = 0.5;
export const RIDE_SPEED = WALK_SPEED * 1.25; // m/s
/** m/s the Hoverboard (src/features/hoverboard) glides over the land at: twice the running speed, whatever the Class. */
export const BOARD_SPEED = 2 * RUN_SPEED;
/** The input with what does nothing on a ride taken out (the canoe, the Hoverboard): it moves (steers) and E gets it
 *  off. The same keys for both. */
export const rideKeys = (input: Input): Input => ({ ...input, move: { ...input.move }, run: 0, jump: false, slap: false, dive: false, crawl: false });

// ---- motion ------------------------------------------------------------------------------------------------------

/** The Motion with what only this player's own beaver tells: diving (under the surface on purpose). It does not
 *  travel over the network (net/protocol.ts packs Motion's own fields); others see a dive in the feet's depth and
 *  in `vertical`, which pitches the swimming body (src/anim). */
export type SwimMotion = Motion & { diving?: boolean };

export const newMotion = (): Motion => ({
  speed: 0, distance: 0, turning: 0, grounded: false, vertical: 0, airTime: 0, sinceLanding: 100, landingSpeed: 0,
  swimming: 0, action: "none", actionProgress: 0, carrying: false, anger: 0, time: 0, reachBack: 0,
});

/** What happened in one step, measured from where the character really went. */
export interface StepFacts {
  moved: number; // horizontal metres this step
  vertical: number; // m/s
  turning: number; // rad/s, positive to the left
  grounded: boolean;
  afloat: boolean;
  act: ActionState;
  /** The tail slap's progress, 0: none (Slap.progress). */
  slap?: number;
  /** Diving (Dive.diving); left out by those that never dive (bots). */
  diving?: boolean;
  /** Sitting or crawling (stepLow); left out by those that never go low (bots). */
  low?: Low;
  /** Sitting in a canoe and paddling it: no stride, no swimming, the paddle in the right paw. */
  ride?: boolean;
  /** Standing on the Hoverboard, gliding: no stride, however fast (Motion.glide). */
  glide?: boolean;
}

/** Fills every field of motion in place, except anger (which belongs to whoever sets it). Afloat counts as held
 *  up: no air time, and coming into the water is a landing. */
export function trackMotion(m: SwimMotion, dt: number, f: StepFacts): void {
  const supported = f.grounded || f.afloat, wasSupported = m.airTime === 0;
  m.time += dt;
  m.speed = f.moved / dt;
  if (f.grounded && !f.ride && !f.glide) m.distance += f.moved;
  m.turning = f.turning;
  if (supported && !wasSupported) { m.sinceLanding = 0; m.landingSpeed = Math.max(0, -m.vertical); }
  else m.sinceLanding += dt;
  m.airTime = supported ? 0 : m.airTime + dt;
  m.grounded = f.grounded;
  m.vertical = f.vertical;
  const target = f.afloat && !f.ride ? 1 : 0, ease = dt / SWIM_EASE;
  m.swimming += Math.max(-ease, Math.min(ease, target - m.swimming));
  m.action = f.act.action;
  m.actionProgress = f.act.action === "none" ? f.slap ?? 0 : f.act.progress;
  m.carrying = f.act.carrying;
  if (f.diving !== undefined) m.diving = f.diving;
  if (f.ride) m.low = "sit";
  else if (f.low === "sit" || f.low === "crawl") m.low = f.low;
  else delete m.low;
  if (f.ride) m.paddle = true;
  else delete m.paddle;
  if (f.glide) m.glide = true;
  else delete m.glide;
}

// ---- steering ----------------------------------------------------------------------------------------------------

// Turning has weight: the turn rate builds up and dies down at TURN_ACCEL instead of jumping between 0 and full
// (which read as a snap), and near the new heading it slows in proportion to what is left (TURN_SETTLE, 1/s), so it
// arrives without a kink. TURN_RATE is above the old constant 10 rad/s, so a reversal takes as long as before.
export const TURN_RATE = 12, TURN_ACCEL = 240, TURN_SETTLE = 30; // rad/s, rad/s², 1/s
// Faster than a walk it cannot turn as sharply (its feet grip only so much sideways): at a run it curves into the new
// heading instead of snapping round. Up to walking speed TURN_RATE holds.
export const TURN_GRIP = TURN_RATE * WALK_SPEED; // m/s², the most sideways acceleration a turn asks of it
export interface Steering { facing: number; spin: number; speed: number }
export const newSteering = (): Steering => ({ facing: 0, spin: 0, speed: 0 });

/** Once per step: turns facing towards `want` (radians as facing; undefined: stops turning), and brings speed towards
 *  `top` times `amount` (0 … 1, how far the stick is pushed) times how much of the wish lies ahead: it walks along
 *  its facing, so a wish behind it first stops it, then it turns. */
export function steer(s: Steering, want: number | undefined, amount: number, top: number, accel: number, brake: number, dt: number) {
  const left = want === undefined ? 0 : Math.atan2(Math.sin(want - s.facing), Math.cos(want - s.facing));
  // let go, it stops turning twice as hard: at most 0.22 rad on from where the stick was released
  const most = Math.min(TURN_RATE, TURN_GRIP / Math.abs(s.speed));
  s.spin = approach(s.spin, Math.max(-most, Math.min(most, TURN_SETTLE * left)), (want === undefined ? 2 : 1) * TURN_ACCEL * dt);
  s.facing += s.spin * dt;
  const along = want === undefined ? 0 : Math.max(0, Math.cos(want - s.facing)) * amount;
  s.speed = approach(s.speed, top * along, (top * along > s.speed ? accel : brake) * dt);
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
