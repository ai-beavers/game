// The Bear's rules as plain logic, apart from drawing, sound and physics, so they can be tested alone: where its
// ground is, when it comes out of the forest, how it goes for the beaver, what a tail slap does to it.
//
//   const bear = newBear();                              away, deep in the far forest
//   comesOut(sunHeight, visit, came)                     whether it comes out now
//   const at = entry(beaver, random); arrive(bear, at.x, at.z);   it comes running out of the forest to there
//   step(bear, { x, z, land }, trunks, dt, random)       what happened: it notices, swipes, gave up, is gone
//   slap(bear, place)                                    a tail slap on land there: "hurt", "drivenOff" or undefined (out of reach)
//   leave(bear)                                          it runs back into the forest
//
// Each update says what happened, so the feature acts on each change exactly once. The beaver has no health: a Swipe
// only tosses it (index.ts). Nothing here is kept or sent (docs/adr/0009).
import { FIRST_RIM, RIM, sunsetGap } from "../../world/terrain.ts";
import { PLACE as OLD_BEAVER } from "../old-beaver/rules.ts";

export interface XZ { x: number; z: number }

/** The Health it comes out of the forest with, and what one tail slap that lands takes: five slaps drive it off. */
export const HEALTH = 100, SLAP_DAMAGE = 20;
/** m: its ground, from the middle of the Clearing: the wide meadow from just outside where the first bank stood to
 *  the animals' rim. Everything nearer the pond is safe. */
export const INNER = FIRST_RIM + 2, OUTER = RIM - 2.5;
/** m it keeps from the Old Beaver, so a Lore is heard out in peace. */
export const CLEAR = 8;
/** m from the middle where it is gone: deep in the far forest behind the bank (world/place.ts farTree), out of sight.
 *  It comes running from there and runs back there. */
export const DEN = RIM + 24;
/** m within which it notices a beaver; s it stands up and growls before it charges. */
export const NOTICE = 12, WARN = 1.2;
/** m/s: ambling about, and charging: faster than a beaver runs (contracts.ts RUN_SPEED), so only the safe ground
 *  and a tail slap stop it. */
export const AMBLE = 0.7, CHARGE = 2.4;
/** m/s it runs in from the forest, and back into it when it is driven off. */
export const RUN = 5;
/** s it stays at what it does between two ambles: nosing and digging in the ground, looking about with its nose in
 *  the wind, sitting on its haunches. */
export const PAUSE = { forage: 7, look: 4, sit: 9 };
/** m from the beaver at which it rears up; s it rears before the Swipe; m the Swipe reaches: running out in time
 *  dodges it. */
export const REAR_AT = 1.8, REAR = 0.8, SWIPE_REACH = 2.2;
/** m a tail slap reaches: shorter than the Swipe, so no spot is safe to slap from. */
export const SLAP_REACH = 2.0;
/** s it holds still after a Swipe, and after a tail slap that landed. */
export const RECOVER = 0.6, FLINCH = 0.8;
/** Swipes in a row with no tail slap landing between, after which it gives up and ignores the beaver for SULK s. */
export const SWIPES = 3, SULK = 60;
/** s it stays out at most, unless it is after the beaver; s of a visit before it first comes. */
export const STAY = 180, QUIET = 180;
/** Degrees of the sun's height above which it is about: full day, never with the deer (life/brain.ts deerHours). */
export const DAYLIGHT = 12;
/** m/s a Swipe throws the beaver: along the ground away from the bear, and up; about 2.5 m in a low arc. */
export const TOSS_SPEED = 5, TOSS_UP = 4.5;
/** s the tossed beaver stays furious, the last FURY_EASE of them calming down. */
export const FURY = 8, FURY_EASE = 2;

const TURN = 4; // rad/s it turns
const TRUNK = 1.3; // m from a trunk's middle it keeps as it goes

/** away: in the forest. arrive: running in from it. roam: about on its ground (doing). warn: reared up, growling at the beaver. charge: after it.
 *  rear: up on its hind legs, a paw raised. recover: the paw came down. flinch: a tail slap landed. leave: running
 *  back into the forest (driven off with no health left, or its time out is over). */
export type State = "away" | "arrive" | "roam" | "warn" | "charge" | "rear" | "recover" | "flinch" | "leave";
/** What it does while it roams: ambling to its goal, or one of PAUSE there. */
export type Doing = "amble" | keyof typeof PAUSE;
export interface Bear {
  state: State; x: number; z: number;
  doing: Doing;
  /** Radians it faces, as Player.facing: atan2(x, z). */
  heading: number;
  health: number;
  /** m/s it goes now. */
  speed: number;
  /** s in this state; s since it came out. */
  time: number; out: number;
  /** Swipes since the last tail slap that landed; s it still ignores the beaver. */
  swipes: number; sulk: number;
  /** Where it goes: ambling, running in, or running back into the forest. */
  goal: XZ;
}
/** What an update did. swipes: the paw came down, hit: with the beaver in reach. gaveUp: it lets the beaver be. */
export type Happening = { kind: "notices" } | { kind: "swipes"; hit: boolean } | { kind: "gaveUp" } | { kind: "gone" };

export const newBear = (): Bear => ({ state: "away", doing: "amble", x: 0, z: DEN, heading: Math.PI, health: HEALTH, speed: 0, time: 0, out: 0, swipes: 0, sulk: 0, goal: { x: 0, z: OUTER } });

/** Whether x, z is the bear's ground: the only place it goes for a beaver, and the only place it charges over. */
export const onGround = (x: number, z: number) => {
  const r = Math.hypot(x, z);
  return r >= INNER && r <= OUTER && Math.hypot(x - OLD_BEAVER.x, z - OLD_BEAVER.z) >= CLEAR;
};
/** After the beaver: its Health bar shows. */
export const after = (b: { state: State }) => b.state === "warn" || b.state === "charge" || b.state === "rear" || b.state === "recover" || b.state === "flinch";

/** Whether it comes out of the forest now: once a Day, in full daylight, not in a visit's first QUIET s. sunHeight in
 *  degrees; visit: s played; came: it was out already this Day. */
export const comesOut = (sunHeight: number, visit: number, came: boolean) => !came && visit >= QUIET && sunHeight > DAYLIGHT;

const ring = (angle: number, r: number): XZ => ({ x: Math.sin(angle) * r, z: Math.cos(angle) * r });
/** Where it runs to as it comes: just inside its ground, a way round the Clearing from the beaver (never right
 *  behind it). */
export function entry(beaver: XZ, random: () => number): XZ {
  const from = Math.atan2(beaver.x, beaver.z), side = random() < 0.5 ? -1 : 1;
  for (let i = 0; i < 8; i++) {
    const at = ring(from + side * (0.6 + 0.6 * random() + i * 0.4), OUTER - 2);
    if (onGround(at.x, at.z)) return at;
  }
  return ring(from + Math.PI, OUTER - 2);
}
/** Its way into the far forest from x, z: straight out from the middle, but round the gap where the evening sun goes
 *  down, where no trees stand to hide it. */
function den(x: number, z: number): XZ {
  const angle = Math.atan2(x, z);
  for (let i = 0; i < 40; i++) {
    const at = ring(angle + (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 0.1, DEN);
    if (sunsetGap(at.x, at.z) === 0) return at;
  }
  return ring(angle, DEN);
}

/** A place to amble to: on its ground, not far round the Clearing from where it is, so the way there stays on it. */
function roamGoal(b: Bear, random: () => number): XZ {
  const angle = Math.atan2(b.x, b.z);
  for (let i = 0; i < 8; i++) {
    const at = ring(angle + (random() - 0.5) * 1.2, INNER + 1 + random() * (OUTER - INNER - 2));
    if (onGround(at.x, at.z)) return at;
  }
  return ring(angle + Math.PI / 2, (INNER + OUTER) / 2);
}

/** It comes with all its health: running out of the far forest to x, z. */
export function arrive(b: Bear, x: number, z: number) {
  const from = den(x, z);
  Object.assign(b, newBear(), { state: "arrive", x: from.x, z: from.z, heading: Math.atan2(x - from.x, z - from.z), goal: { x, z } });
}

const to = (b: Bear, state: State) => { b.state = state; b.time = 0; b.doing = "amble"; };
/** It runs back into the forest, wherever it is and whatever it does. */
export function leave(b: Bear) {
  if (b.state === "away" || b.state === "leave") return;
  to(b, "leave");
  b.goal = den(b.x, b.z);
}
const turnBetween = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const face = (b: Bear, heading: number, dt: number) => { b.heading += Math.max(-TURN * dt, Math.min(TURN * dt, turnBetween(b.heading, heading))); };

/** Turns towards a heading and goes at pace, bending round the trunks. */
function go(b: Bear, heading: number, pace: number, trunks: readonly XZ[], dt: number) {
  const hx = Math.sin(heading), hz = Math.cos(heading);
  let dx = hx, dz = hz;
  for (const t of trunks) {
    const ox = b.x - t.x, oz = b.z - t.z, d = Math.hypot(ox, oz);
    if (d >= TRUNK || d < 1e-3) continue;
    // Away from the trunk and round it, to the side its way already leans to.
    const push = 3 * (TRUNK - d) / TRUNK, tx = -oz / d, tz = ox / d, side = tx * hx + tz * hz >= 0 ? 1 : -1;
    dx += (ox / d + side * tx) * push; dz += (oz / d + side * tz) * push;
  }
  face(b, Math.atan2(dx, dz), dt);
  b.speed = pace;
  b.x += Math.sin(b.heading) * pace * dt; b.z += Math.cos(b.heading) * pace * dt;
}

/** Advances the bear by dt s. beaver: where the player's beaver is, and whether it is on land (not afloat, not in
 *  the canoe). Returns what happened. */
export function step(b: Bear, beaver: XZ & { land: boolean }, trunks: readonly XZ[], dt: number, random: () => number): Happening[] {
  if (b.state === "away") return [];
  b.time += dt; b.out += dt; b.sulk = Math.max(0, b.sulk - dt); b.speed = 0;
  const far = Math.hypot(beaver.x - b.x, beaver.z - b.z), towards = Math.atan2(beaver.x - b.x, beaver.z - b.z);
  const prey = beaver.land && onGround(beaver.x, beaver.z), x = b.x, z = b.z;
  if (b.state === "arrive") {
    // A beaver on its ground it has seen from afar: it runs straight for it, and rears up once it is near.
    const on = onGround(x, z), goal = prey ? beaver : b.goal;
    if (prey && on && far < NOTICE) { to(b, "warn"); return [{ kind: "notices" }]; }
    if (Math.hypot(goal.x - x, goal.z - z) < 1) { to(b, "roam"); return []; }
    go(b, Math.atan2(goal.x - x, goal.z - z), RUN, trunks, dt);
    if (on && !onGround(b.x, b.z)) { b.x = x; b.z = z; to(b, "roam"); b.goal = { x, z }; } // the edge of its ground: it stays on it
    return [];
  }
  if (b.state === "roam") {
    if (prey && b.sulk === 0 && far < NOTICE) { to(b, "warn"); return [{ kind: "notices" }]; }
    if (b.out > STAY) { leave(b); return []; }
    if (b.doing !== "amble") {
      if (b.time >= PAUSE[b.doing]) { b.doing = "amble"; b.goal = roamGoal(b, random); b.time = 0; }
      return [];
    }
    if (Math.hypot(b.goal.x - x, b.goal.z - z) < 0.6) { const r = random(); b.doing = r < 0.5 ? "forage" : r < 0.8 ? "look" : "sit"; b.time = 0; return []; }
    if (b.time > 30) { b.goal = roamGoal(b, random); b.time = 0; }
    go(b, Math.atan2(b.goal.x - x, b.goal.z - z), AMBLE, trunks, dt);
    if (onGround(x, z) && !onGround(b.x, b.z)) { b.x = x; b.z = z; b.goal = roamGoal(b, random); }
    return [];
  }
  if (b.state === "leave") {
    // Driven off it runs for its life; with its time out it lopes home.
    go(b, Math.atan2(b.goal.x - x, b.goal.z - z), b.health > 0 ? CHARGE : RUN, trunks, dt);
    if (Math.hypot(b.goal.x - b.x, b.goal.z - b.z) > 1) return [];
    to(b, "away");
    return [{ kind: "gone" }];
  }
  if (b.state === "flinch") { if (b.time >= FLINCH) to(b, "charge"); return []; }
  // After the beaver, only while it is on land on the bear's ground.
  if (!prey) { to(b, "roam"); b.swipes = 0; b.goal = { x, z }; return [{ kind: "gaveUp" }]; }
  if (b.state === "charge" && far > REAR_AT) {
    go(b, towards, CHARGE, trunks, dt);
    if (!onGround(b.x, b.z)) { b.x = x; b.z = z; b.speed = 0; } // it stops at the edge of its ground
    return [];
  }
  face(b, towards, dt);
  if (b.state === "warn") { if (b.time >= WARN) to(b, "charge"); }
  else if (b.state === "charge") to(b, "rear");
  else if (b.state === "rear") {
    if (b.time < REAR) return [];
    b.swipes++;
    to(b, "recover");
    return [{ kind: "swipes", hit: far <= SWIPE_REACH }];
  } else if (b.time >= RECOVER) {
    if (b.swipes < SWIPES) to(b, "charge");
    else { to(b, "roam"); b.swipes = 0; b.sulk = SULK; b.goal = { x, z }; return [{ kind: "gaveUp" }]; }
  }
  return [];
}

/** A tail slap on land at `from`: within SLAP_REACH of a bear that is out it takes SLAP_DAMAGE of its health, breaks
 *  a Swipe it was rearing for and ends its sulk; with no health left it is driven off. undefined: out of reach. */
export function slap(b: Bear, from: XZ): "hurt" | "drivenOff" | undefined {
  if (b.state === "away" || b.state === "leave" || Math.hypot(from.x - b.x, from.z - b.z) > SLAP_REACH) return undefined;
  b.health = Math.max(0, b.health - SLAP_DAMAGE);
  b.swipes = b.sulk = 0;
  if (b.health > 0) { to(b, "flinch"); return "hurt"; }
  leave(b);
  return "drivenOff";
}
