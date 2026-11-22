// The River kit's rules as plain logic, apart from drawing, so they can be tested alone: how it keeps to the player's
// beaver, on land and through the water, and out of its way, what it does when the beaver stands still, and when
// it sleeps; when it calls after the beaver, when it shakes itself dry, and where its head turns to look at it.
//
//   const kit = newKit(x, z);
//   step(kit, { x, z, land }, free, dt, random, night, afloat, deep)   free(x, z): ground or water with nothing in the way
//   look(kit, { x, z }, dt)                                            once per picture: its head turns to the beaver
//
// Its way: straight to the beaver; with something in the way, round it with the thing on one hand (as one finds the
// way out of a maze) until it is nearer the beaver than where it met the thing.
//
// Nothing here is kept or sent: each player has their own (as the Bear, docs/adr/0009).
export interface XZ { x: number; z: number }

/** m from the beaver within which it is content, and beyond which it sets off after it. */
export const NEAR = 1.4, FAR = 2.6;
/** m from the beaver beyond which it runs to catch up. */
export const HURRY = 3.4;
/** m/s it walks and runs: a little faster than the beaver walks and runs (contracts.ts), so it catches up. */
export const WALK = 1.0, RUN = 2.4;
/** m from the beaver within which it steps out of the beaver's way. */
export const CLOSE = 0.7;
/** s it stands before it finds something to do, and s it stays at what it does: nosing in the ground, looking
 *  about, upright on its haunches looking round, rubbing its muzzle with both paws, sitting, lying on its belly. */
export const IDLE = 2.5, PAUSE = { forage: 6, look: 4, up: 4, groom: 5, sit: 8, lie: 10 };
/** s beside a beaver that stays where it is before the kit lies down, by day and by night. Lain down for PAUSE.lie,
 *  it falls asleep and sleeps until the beaver goes. */
export const TIRED = { day: 30, night: 8 };
/** s on its way to a beaver that stays where it is without coming nearer to it, after which it gives up and waits
 *  where it is (the beaver is where it cannot follow: over a fence, inside the lodge) until the beaver moves: with a
 *  free way ahead, and while it goes round something (LAP: once round a house). */
export const GIVE_UP = 5, LAP = 30;
/** s it takes to get up from what it does low down, before it goes. */
export const RISE: Partial<Record<Doing, number>> = { sit: 0.5, up: 0.5, groom: 0.5, lie: 0.8, sleep: 2 };
/** s between two calls of one kind at the least, so that it never chatters. */
export const QUIET = 6;
/** s from dripping to dry once out of the water (as the beaver's coat). */
export const DRY = 12;
/** Shaking itself dry: s on dry ground after a swim before it does, s it takes, and times as fast its coat dries
 *  meanwhile. */
export const SHAKE = { after: 0.6, lasts: 1, dries: 8 };
/** Looking at the beaver: rad its head turns to either side and up at the most, m the beaver's face is above its
 *  own, and 1/s its head follows. */
export const GAZE = { yaw: 1, pitch: 0.45, above: 0.6, ease: 5 };

const TURN = 6; // rad/s it turns
const STEP = 0.35; // m ahead it looks for free ground
// Which side to go round what is in its way: rad off the straight way, nearest first, right round.
const ROUND = [0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4, 3, -3];
// Going round, it keeps what is in its way on one hand: rad from the way it last went, from into the thing to back
// the way it came.
const SWEEP = Array.from({ length: 16 }, (_, i) => -1.5 + 0.3 * i);

/** What it does while it is content: standing, one of PAUSE, or asleep. */
export type Doing = "stand" | keyof typeof PAUSE | "sleep";
export interface Kit {
  x: number; z: number;
  /** Radians it faces, as Player.facing: atan2(x, z). */
  heading: number;
  /** m/s it goes now. */
  speed: number;
  /** Whether it is on its way to the beaver. */
  following: boolean;
  doing: Doing;
  /** s at what it does now. */
  time: number;
  /** s since it last went a step. */
  still: number;
  /** s it still needs to get up before it goes. */
  rising: number;
  /** m: the nearest it came to the beaver on this way, s since then, and where the beaver was then. */
  nearest: number; stuck: number; seen: XZ;
  /** Where the beaver was a step ago. */
  last: XZ;
  /** The side it goes round what is in its way (1: to its left, -1: to its right, 0: nothing in its way), the way
   *  it last went along it (rad), and m it was from the beaver when it met it, plus all the beaver went since: it
   *  goes straight again once it is nearer than that. */
  side: number; along: number; met: number;
  /** Whether it swims: the water where it is is too deep to stand in. */
  afloat: boolean;
  /** Whether it went round something since it was last nearer the beaver: then it gives itself LAP, not GIVE_UP. */
  rounded: boolean;
  /** Whether what it gets up from, or last got up from, is its sleep: then it yawns and stretches as it does. */
  waking: boolean;
  /** Whether it ran on this way to the beaver, what it calls in this step ("left": anxious, left behind, as it
   *  starts to run; "caught": glad, beside the beaver again after a run; else ""), and s since it last called each. */
  hurried: boolean; call: Call | ""; quiet: Record<Call, number>;
  /** How wet its coat is: 0 dry … 1 dripping. */
  wet: number;
  /** Whether it swam and has not shaken itself since, s it has been on dry ground since that swim, and s its shake
   *  still lasts. */
  swam: boolean; ashore: number; shaking: number;
  /** Rad its head is turned to the beaver now: to its left, and up. */
  gaze: { yaw: number; pitch: number };
}
export type Call = "left" | "caught";

export const newKit = (x: number, z: number): Kit => ({ x, z, heading: 0, speed: 0, following: false, doing: "stand", time: 0, still: 0, rising: 0, nearest: Infinity, stuck: 0, seen: { x, z }, last: { x, z }, side: 0, along: 0, met: 0, rounded: false, afloat: false, waking: false, hurried: false, call: "", quiet: { left: QUIET, caught: QUIET }, wet: 0, swam: false, ashore: 0, shaking: 0, gaze: { yaw: 0, pitch: 0 } });

const turnBetween = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Says the call, unless it called the same less than QUIET s ago. */
function call(k: Kit, kind: Call) {
  if (k.quiet[kind] < QUIET) return;
  k.call = kind;
  k.quiet[kind] = 0;
}

/** Advances the kit by dt s. beaver: where the player's beaver is, and whether it is on land (not afloat, not in the
 *  canoe). free: whether the kit can be at x, z, on its feet or swimming. night: whether it is dark, when it tires
 *  sooner. afloat: whether it swims where it is; swimming it only paddles, after the beaver or on the spot. deep:
 *  how deep it stands in the water, 0 on dry ground … 1 where it swims. */
export function step(k: Kit, beaver: XZ & { land: boolean }, free: (x: number, z: number) => boolean, dt: number, random: () => number, night = false, afloat = false, deep = afloat ? 1 : 0) {
  const dx = beaver.x - k.x, dz = beaver.z - k.z, far = Math.hypot(dx, dz);
  k.afloat = afloat;
  k.time += dt;
  k.still += dt;
  k.speed = 0;
  k.call = "";
  k.quiet.left += dt;
  k.quiet.caught += dt;
  // Its coat is as wet as the water is deep, drips dry in DRY s, and much sooner while it shakes itself.
  k.wet = Math.max(deep, k.wet - (k.shaking > 0 ? SHAKE.dries : 1) * dt / DRY);
  // Once after each swim it shakes itself dry: a moment after it has dry ground under it again, never in the water.
  if (afloat) k.swam = true;
  k.ashore = k.swam && deep <= 0 ? k.ashore + dt : 0;
  if (k.ashore >= SHAKE.after) { k.swam = false; k.shaking = SHAKE.lasts; k.doing = "stand"; }
  // It sets off when the beaver is FAR and stops once NEAR: between the two it stays as it is, so it does not dither.
  if (far > FAR) k.following = true;
  if (far < NEAR) {
    k.following = false;
    if (k.hurried) { k.hurried = false; call(k, "caught"); } // it ran to get here: a glad chirp
  }
  else if (afloat && beaver.land) k.following = true; // it does not stay in the water once the beaver is out
  k.met += Math.hypot(beaver.x - k.last.x, beaver.z - k.last.z);
  k.last = { x: beaver.x, z: beaver.z };
  // Nearer than it was, or the beaver a metre from where it was: it is getting somewhere, or has a new way to try.
  if (!k.following || far < k.nearest - 0.05 || Math.hypot(beaver.x - k.seen.x, beaver.z - k.seen.z) > 1) {
    k.nearest = far; k.stuck = 0; k.seen = { x: beaver.x, z: beaver.z }; k.rounded = false;
  } else k.stuck += dt;
  // Shaking, it stays where it is; the shake is short, and it catches up after it.
  if (k.shaking > 0) { k.shaking -= dt; return; }
  // A beaver that comes right up to it, it makes room for: away from it, as it would go to it.
  const aside = beaver.land && far < CLOSE;
  if (k.following || aside) {
    const straight = aside ? Math.atan2(-dx, -dz) : Math.atan2(dx, dz), pace = far > HURRY ? RUN : WALK;
    // Free both a step ahead and right where it treads next: round a bank the far point can be dry and the near one wet.
    const ahead = (a: number, d: number) => free(k.x + Math.sin(a) * d, k.z + Math.cos(a) * d);
    const open = (a: number) => ahead(a, STEP) && ahead(a, pace * dt);
    let way: number | undefined;
    if (k.side && far < k.met - 0.1 && open(straight)) k.side = 0; // round it: straight on again
    if (k.stuck > (k.rounded ? LAP : GIVE_UP) && !aside) k.side = 0;
    else {
      if (!k.side && open(straight)) way = straight;
      else if (!k.side) {
        // Something in its way: it takes the side with the nearer way round, and remembers how far off it was.
        const off = ROUND.find((o) => open(straight + o));
        if (off !== undefined) { k.side = Math.sign(off); k.along = straight; k.met = far; k.rounded = true; }
      }
      if (k.side) {
        // Along it: the first free way next to a way that is not (so the thing stays on that hand).
        const at = SWEEP.map((o) => k.along + k.side * o), shut = at.findIndex((a) => !open(a));
        way = shut < 0 ? undefined : at.slice(shut).find(open);
        if (way === undefined) k.side = 0; // lost it, or shut in
        else k.along = way;
      }
    }
    // It turns to the way it found and goes once it faces free ground; with no way on (the beaver is where it found
    // no way to) it waits here, looking after it.
    // From what it does low down (sat, lain, asleep) it gets up first.
    if (way !== undefined && k.doing !== "stand") { k.rising = RISE[k.doing] ?? 0; k.waking = k.doing === "sleep"; k.doing = "stand"; k.time = 0; }
    if (way !== undefined && k.rising > 0) { k.rising -= dt; return; }
    k.heading += Math.max(-TURN * dt, Math.min(TURN * dt, turnBetween(k.heading, way ?? straight)));
    const x = k.x + Math.sin(k.heading) * pace * dt, z = k.z + Math.cos(k.heading) * pace * dt;
    if (way !== undefined && free(x, z)) {
      // Left behind, it calls after the beaver as it starts to run, once on a way.
      if (pace === RUN && !k.hurried) { k.hurried = true; call(k, "left"); }
      k.x = x; k.z = z; k.speed = pace; k.time = 0; k.still = 0;
      return;
    }
    if (way !== undefined) return; // still turning
  }
  if (afloat) { k.doing = "stand"; k.time = 0; k.still = 0; return; } // in the water it only paddles, which is no rest
  if (k.doing === "stand") {
    if (k.time < IDLE) return;
    const r = random();
    k.doing = k.following ? "sit" : k.still > (night ? TIRED.night : TIRED.day) ? "lie"
      : r < 0.35 ? "forage" : r < 0.55 ? "look" : r < 0.7 ? "up" : r < 0.85 ? "groom" : "sit";
    k.time = 0;
  } else if (k.doing === "lie" && k.time >= PAUSE.lie) { k.doing = "sleep"; k.time = 0; }
  else if (k.doing !== "sleep" && k.doing !== "lie" && k.time >= PAUSE[k.doing] && !k.following) { k.doing = "stand"; k.time = 0; } // waiting for the beaver, it stays sat
}

/** Where its head would be turned to look at the beaver's face: rad to its left and up, no further than GAZE. It
 *  looks at the beaver only while it stands or sits; busy with anything else, its head is its own. */
export function gazeAt(k: Kit, beaver: XZ) {
  const idle = (k.doing === "stand" || k.doing === "sit") && k.speed === 0 && k.rising <= 0 && k.shaking <= 0 && !k.afloat;
  if (!idle) return { yaw: 0, pitch: 0 };
  const dx = beaver.x - k.x, dz = beaver.z - k.z;
  return {
    yaw: Math.max(-GAZE.yaw, Math.min(GAZE.yaw, turnBetween(k.heading, Math.atan2(dx, dz)))),
    pitch: Math.min(GAZE.pitch, Math.atan2(GAZE.above, Math.hypot(dx, dz))),
  };
}

/** Turns its head by dt s: after the beaver, or back when it is busy, eased so that it never snaps. */
export function look(k: Kit, beaver: XZ, dt: number) {
  const to = gazeAt(k, beaver), part = 1 - Math.exp(-GAZE.ease * dt);
  k.gaze.yaw += (to.yaw - k.gaze.yaw) * part;
  k.gaze.pitch += (to.pitch - k.gaze.pitch) * part;
}
