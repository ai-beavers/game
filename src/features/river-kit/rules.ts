// The River kit's rules as plain logic, apart from drawing, so they can be tested alone: how it keeps to the player's
// beaver, where it will not go, and what it does when the beaver stands still.
//
//   const kit = newKit(x, z);
//   step(kit, { x, z, land }, free, dt, random)     free(x, z): dry ground with no trunk in the way
//
// Nothing here is kept or sent: each player has their own (as the Bear, docs/adr/0009).
export interface XZ { x: number; z: number }

/** m from the beaver within which it is content, and beyond which it sets off after it. */
export const NEAR = 1.4, FAR = 2.6;
/** m from the beaver beyond which it runs to catch up. */
export const HURRY = 3.4;
/** m/s it walks and runs: a little faster than the beaver walks and runs (contracts.ts), so it catches up. */
export const WALK = 1.0, RUN = 2.4;
/** s it stands before it finds something to do, and s it stays at what it does: nosing in the ground, looking
 *  about, sitting on its haunches. */
export const IDLE = 2.5, PAUSE = { forage: 6, look: 4, sit: 8 };

const TURN = 6; // rad/s it turns
const STEP = 0.35; // m ahead it looks for free ground
// Ways round what is in its way (water, a trunk), rad off the straight way, nearest first.
const ROUND = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8];

/** What it does while it is content: standing, or one of PAUSE. */
export type Doing = "stand" | keyof typeof PAUSE;
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
}

export const newKit = (x: number, z: number): Kit => ({ x, z, heading: 0, speed: 0, following: false, doing: "stand", time: 0 });

const turnBetween = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Advances the kit by dt s. beaver: where the player's beaver is, and whether it is on land (not afloat, not in the
 *  canoe). free: whether the kit can stand at x, z. It never goes into the water: it waits on the bank. */
export function step(k: Kit, beaver: XZ & { land: boolean }, free: (x: number, z: number) => boolean, dt: number, random: () => number) {
  const dx = beaver.x - k.x, dz = beaver.z - k.z, far = Math.hypot(dx, dz);
  k.time += dt;
  k.speed = 0;
  // It sets off when the beaver is FAR and stops once NEAR: between the two it stays as it is, so it does not dither.
  if (far > FAR) k.following = true;
  if (far < NEAR) k.following = false;
  if (k.following) {
    const straight = Math.atan2(dx, dz), pace = far > HURRY ? RUN : WALK;
    // Free both a step ahead and right where it treads next: round a bank the far point can be dry and the near one wet.
    const ahead = (a: number, d: number) => free(k.x + Math.sin(a) * d, k.z + Math.cos(a) * d);
    // To a beaver in the water it only goes ways that bring it nearer: it comes to the bank and stays, where
    // towards one on land it would walk on round the water.
    const way = ROUND.filter((off) => beaver.land || Math.abs(off) < 1.5).map((off) => straight + off).find((a) => ahead(a, STEP) && ahead(a, pace * dt));
    // It turns to the way it found and goes once it faces free ground; with no way on (the beaver swims, or stands
    // beyond the water) it waits here, looking after it.
    k.heading += Math.max(-TURN * dt, Math.min(TURN * dt, turnBetween(k.heading, way ?? straight)));
    const x = k.x + Math.sin(k.heading) * pace * dt, z = k.z + Math.cos(k.heading) * pace * dt;
    if (way !== undefined && free(x, z)) { k.x = x; k.z = z; k.speed = pace; k.doing = "stand"; k.time = 0; return; }
    if (way !== undefined) return; // still turning
  }
  if (k.doing === "stand") {
    if (k.time < IDLE) return;
    const r = random();
    k.doing = k.following ? "sit" : r < 0.45 ? "forage" : r < 0.75 ? "look" : "sit";
    k.time = 0;
  } else if (k.time >= PAUSE[k.doing] && !k.following) { k.doing = "stand"; k.time = 0; } // waiting for the beaver, it stays sat
}
