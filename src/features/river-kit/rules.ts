// The River kit's rules as plain logic, apart from drawing, so they can be tested alone: how it keeps to the player's
// beaver, on land and through the water, and out of its way, what it does when the beaver stands still, and when
// it sleeps.
//
//   const kit = newKit(x, z);
//   step(kit, { x, z, land }, free, dt, random, night, afloat)     free(x, z): ground or water with nothing in the way
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
export const RISE: Partial<Record<Doing, number>> = { sit: 0.5, up: 0.5, groom: 0.5, lie: 0.8, sleep: 1.4 };

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
}

export const newKit = (x: number, z: number): Kit => ({ x, z, heading: 0, speed: 0, following: false, doing: "stand", time: 0, still: 0, rising: 0, nearest: Infinity, stuck: 0, seen: { x, z }, last: { x, z }, side: 0, along: 0, met: 0, rounded: false, afloat: false });

const turnBetween = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Advances the kit by dt s. beaver: where the player's beaver is, and whether it is on land (not afloat, not in the
 *  canoe). free: whether the kit can be at x, z, on its feet or swimming. night: whether it is dark, when it tires
 *  sooner. afloat: whether it swims where it is; swimming it only paddles, after the beaver or on the spot. */
export function step(k: Kit, beaver: XZ & { land: boolean }, free: (x: number, z: number) => boolean, dt: number, random: () => number, night = false, afloat = false) {
  const dx = beaver.x - k.x, dz = beaver.z - k.z, far = Math.hypot(dx, dz);
  k.afloat = afloat;
  k.time += dt;
  k.still += dt;
  k.speed = 0;
  // It sets off when the beaver is FAR and stops once NEAR: between the two it stays as it is, so it does not dither.
  if (far > FAR) k.following = true;
  if (far < NEAR) k.following = false;
  else if (afloat && beaver.land) k.following = true; // it does not stay in the water once the beaver is out
  k.met += Math.hypot(beaver.x - k.last.x, beaver.z - k.last.z);
  k.last = { x: beaver.x, z: beaver.z };
  // Nearer than it was, or the beaver a metre from where it was: it is getting somewhere, or has a new way to try.
  if (!k.following || far < k.nearest - 0.05 || Math.hypot(beaver.x - k.seen.x, beaver.z - k.seen.z) > 1) {
    k.nearest = far; k.stuck = 0; k.seen = { x: beaver.x, z: beaver.z }; k.rounded = false;
  } else k.stuck += dt;
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
    if (way !== undefined && k.doing !== "stand") { k.rising = RISE[k.doing] ?? 0; k.doing = "stand"; k.time = 0; }
    if (way !== undefined && k.rising > 0) { k.rising -= dt; return; }
    k.heading += Math.max(-TURN * dt, Math.min(TURN * dt, turnBetween(k.heading, way ?? straight)));
    const x = k.x + Math.sin(k.heading) * pace * dt, z = k.z + Math.cos(k.heading) * pace * dt;
    if (way !== undefined && free(x, z)) { k.x = x; k.z = z; k.speed = pace; k.time = 0; k.still = 0; return; }
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
