import { REST_DISTANCE, REST_PITCH } from "../../player/camera.ts";

/** Stations in one activity play in order, so building can use the wood gathered earlier. stream false: a test of the
 *  player's controls (a menu, a pad), played in the test but left out of the live stream. */
export type Station = [name: string, play: () => Promise<void>, activity?: string, stream?: false];

/** How the live view frames an activity: metres from the beaver, radians above the horizon, radians round from
 *  straight behind it, and metres above its look point (0.7 m up) it aims at: above the beaver, so it sits in the
 *  lower third as it does for a player. */
export interface Shot { distance: number; pitch: number; side: number; lift: number }
// The live view is the player's own: behind the beaver, as someone playing holds the camera (src/player/camera.ts),
// so the stream looks played, not filmed. An activity turns it only as a player would to see what they do.
const SHOT: Shot = { distance: REST_DISTANCE, pitch: REST_PITCH, side: 0, lift: 0.45 };
const SHOTS: Record<string, Shot> = {
  "Dam work": { ...SHOT, distance: 3.5, side: 0.45 }, // closer and round to the side, as the player's camera does for work
  "Pond patrol": { ...SHOT, distance: 4.9, pitch: 0.11 }, // lower and a little back, as it does for a swim
  "Tail slap": { ...SHOT, pitch: 0.11, side: 0.6 }, // a look from the side: the tail coming down
  "Sky watch": { ...SHOT, pitch: 0.08, lift: 0.9 }, // looking up
  "Wears a hat": { distance: 1.6, pitch: 0.3, side: 2.3, lift: 0.12 }, // turned round to the front, close: the hat on the head
};

// ---- a clear view: the beaver must always be seen ----
// Crowns, bushes, reeds, crates, the lodge have no collider (or one the camera's cast ignores); their bounds are
// known, as turned boxes or (leaves) the ellipsoids inside them. Each moment the director asks: is the beaver seen
// from the camera (most of a few points on its body with nothing in between, the camera inside nothing)? When it is
// not, it tries the other side, a bit higher, a bit closer, in that order and together; only when none of them shows
// it are the things in the way faded. A new angle holds for CALM s unless the beaver is hidden again.

export type XYZ = { x: number; y: number; z: number };
/** A box with its middle at `at` and three half-axes (turned as the thing is), or round: the ellipsoid in that box.
 *  tag: what it stands for, for whoever fades it. Made by volume(). */
export interface Volume { at: XYZ; axes: [XYZ, XYZ, XYZ]; round: boolean; inverse: number[]; lengths: number[]; tag?: unknown }

const cross = (a: XYZ, b: XYZ) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: XYZ, b: XYZ) => a.x * b.x + a.y * b.y + a.z * b.z;

export function volume(at: XYZ, axes: [XYZ, XYZ, XYZ], round = false, tag?: unknown): Volume {
  const [a, b, c] = axes, det = dot(a, cross(b, c)), rows = [cross(b, c), cross(c, a), cross(a, b)];
  return { at, axes, round, tag, inverse: rows.flatMap((r) => [r.x / det, r.y / det, r.z / det]), lengths: axes.map((v) => Math.sqrt(dot(v, v))) };
}

/** Where on the way from → to (0 … 1) it first is inside v grown by margin m; 0 when it starts inside; Infinity
 *  when it never is. */
export function enter(v: Volume, from: XYZ, to: XYZ, margin = 0): number {
  const m = v.inverse, p = [0, 0, 0], d = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const grow = 1 + margin / v.lengths[i]!, row = { x: m[3 * i]!, y: m[3 * i + 1]!, z: m[3 * i + 2]! };
    p[i] = (row.x * (from.x - v.at.x) + row.y * (from.y - v.at.y) + row.z * (from.z - v.at.z)) / grow;
    d[i] = (row.x * (to.x - from.x) + row.y * (to.y - from.y) + row.z * (to.z - from.z)) / grow;
  }
  if (v.round) {
    const a = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2, b = 2 * (p[0]! * d[0]! + p[1]! * d[1]! + p[2]! * d[2]!), c = p[0]! ** 2 + p[1]! ** 2 + p[2]! ** 2 - 1;
    if (c <= 0) return 0;
    const disc = b * b - 4 * a * c;
    if (a < 1e-12 || disc < 0) return Infinity;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t >= 0 && t <= 1 ? t : Infinity;
  }
  let lo = 0, hi = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]!) < 1e-12) { if (Math.abs(p[i]!) > 1) return Infinity; continue; }
    const t1 = (-1 - p[i]!) / d[i]!, t2 = (1 - p[i]!) / d[i]!;
    lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
    if (lo > hi) return Infinity;
  }
  return lo;
}
export const inside = (v: Volume, p: XYZ, margin = 0) => enter(v, p, p, margin) === 0;

/** m the camera keeps from crowns and bushes: its near plane and the cast ball. */
export const KEEP_OUT = 0.35;

/** Points on the beaver standing at its feet: low, middle, high, and round its middle. */
export const bodyPoints = (feet: XYZ): XYZ[] => [[0, 0.2, 0], [0, 0.5, 0], [0, 0.85, 0], [0.22, 0.45, 0], [-0.22, 0.45, 0], [0, 0.45, 0.22], [0, 0.45, -0.22]]
  .map(([x, y, z]) => ({ x: feet.x + x!, y: feet.y + y!, z: feet.z + z! }));

/** What the camera at eye sees of the points: how many have something in between, and what. A volume around a point
 *  itself (the beaver in the reeds) does not count for it: no camera move helps there. solid: whether a collider is in
 *  between (the ground, trunks), for the caller to cast. */
export function sight(eye: XYZ, points: XYZ[], volumes: Volume[], solid?: (from: XYZ, to: XYZ) => boolean) {
  const by = new Set<Volume>();
  let blocked = 0;
  for (const p of points) {
    let hidden = false;
    for (const v of volumes) if (enter(v, eye, p) <= 1 && !inside(v, p)) { hidden = true; by.add(v); }
    if (hidden || solid?.(eye, p)) blocked++;
  }
  const within = volumes.some((v) => v.round && inside(v, eye, KEEP_OUT));
  /** Seen: no more than a quarter of the points covered, and the camera inside no crown or bush. */
  return { blocked, by, within, seen: !within && blocked * 4 <= points.length };
}

/** How the director varies a shot to see past something. */
export interface Choice { other: boolean; higher: boolean; closer: boolean }
const PLAIN: Choice = { other: false, higher: false, closer: false };
/** The other side, a bit higher, a bit closer, in that order, then together. */
export const CHOICES: Choice[] = [PLAIN, { ...PLAIN, other: true }, { ...PLAIN, higher: true }, { ...PLAIN, closer: true },
  { other: true, higher: true, closer: false }, { other: true, higher: false, closer: true }, { other: false, higher: true, closer: true },
  { other: true, higher: true, closer: true }];
const HIGHER = 0.3, CLOSER = 0.6; // rad up, fraction of the distance
const same = (a: Choice, b: Choice) => a.other === b.other && a.higher === b.higher && a.closer === b.closer;

/** Yaw, pitch and distance for a shot and a choice; behind: the yaw straight behind the beaver, sign: its side. */
export const framing = (behind: number, shot: Shot, sign: number, c: Choice) => ({
  yaw: behind + shot.side * sign * (c.other ? -1 : 1),
  pitch: shot.pitch + (c.higher ? HIGHER : 0),
  distance: shot.distance * (c.closer ? CLOSER : 1),
});
/** Where the camera stands looking at `look` from yaw, pitch, distance, lifted to floor (as src/player/camera.ts). */
export function eyeAt(look: XYZ, f: { yaw: number; pitch: number; distance: number }, floor?: (x: number, z: number) => number): XYZ {
  const c = Math.cos(f.pitch), x = look.x + Math.sin(f.yaw) * c * f.distance, z = look.z + Math.cos(f.yaw) * c * f.distance;
  const y = look.y + Math.sin(f.pitch) * f.distance;
  return { x, y: floor ? Math.max(y, floor(x, z)) : y, z };
}

/** The director's memory: the choice it films with, s since it changed, s the beaver has been hidden. */
export interface Hold { choice: Choice; since: number; hidden: number }
export const newHold = (): Hold => ({ choice: PLAIN, since: 0, hidden: 0 });
const CALM = 6; // s a new angle holds, unless the beaver is hidden
const REACT = 0.5; // s hidden before the camera moves (a trunk passing by is no reason)

/** One look by the director, dt s after the last: hidden now (from where the camera is), and whether a choice would
 *  show the beaver (from where it would stand). Moves to the first choice that does when the beaver has been hidden
 *  for REACT s and the camera is not on its way to a clear one already; back to the plain shot once it shows the
 *  beaver and CALM s have passed. fade: hidden, and no choice shows it. */
export function direct(hold: Hold, dt: number, hidden: boolean, shows: (c: Choice) => boolean): { hold: Hold; fade: boolean } {
  const h = { choice: hold.choice, since: hold.since + dt, hidden: hidden ? hold.hidden + dt : 0 };
  if (h.hidden >= REACT && !shows(h.choice)) {
    const next = CHOICES.find(shows);
    if (!next) return { hold: h, fade: true };
    return { hold: { choice: next, since: 0, hidden: h.hidden }, fade: false };
  }
  if (!hidden && h.since >= CALM && !same(h.choice, PLAIN) && shows(PLAIN)) return { hold: { ...h, choice: PLAIN, since: 0 }, fade: false };
  return { hold: h, fade: h.hidden >= STUCK }; // the clear angle never came (the camera pulled in by a collider)
}
const STUCK = 3; // s hidden on the way to a clear angle before fading anyway

/** One step of x (speed v) towards goal: eased in and out (a critically damped spring at `rate` 1/s), and never faster
 *  than `top` per s, so a long way is a slow glide, not a swing. */
export function glide(x: number, v: number, goal: number, rate: number, top: number, dt: number): [number, number] {
  const e = x - goal, k = v + rate * e, decay = Math.exp(-rate * dt);
  const to = goal + (e + k * dt) * decay, speed = (v - rate * k * dt) * decay, most = top * dt;
  return [x + Math.max(-most, Math.min(most, to - x)), Math.max(-top, Math.min(top, speed))];
}

/** On the way somewhere the camera is straight behind at the player's distance, so the way ahead is in the picture. */
export function shotFor(activity: string, walking: boolean): Shot {
  const shot = SHOTS[activity] ?? SHOT;
  return walking ? { ...shot, distance: Math.max(shot.distance, SHOT.distance), side: 0, lift: SHOT.lift } : shot;
}

/** What the director knows when it picks: the clock (s), when each activity was last shown on it, the one just
 *  shown; the hour (0 … 24) and the weather of the sky; whether the ducks are back on the pond since the last slap;
 *  whether a stick is in the beaver's hand (then the dam work goes on). */
export interface Moment {
  now: number; shown: Record<string, number>; previous?: string;
  hour?: number; weather?: string; ducks?: boolean; carrying?: boolean;
  /** The real date, ms: an activity is new for FRESH days after it came into the game. */
  day?: number;
}

/** The activities the newest features added, and the day each came (UTC). A feature with an activity of its own
 *  enters it here; the beaver is curious about it for FRESH days. Drop an entry once it is older. */
const NEW: Record<string, string> = { "Wears a hat": "2026-11-18" };
const FRESH = 7; // days
export const fresh = (activity: string, m: Moment) => {
  const since = m.day === undefined || !NEW[activity] ? NaN : (m.day - Date.parse(NEW[activity]!)) / 86_400_000;
  return since >= 0 && since < FRESH;
};
const NOON = (h: number) => h >= 11 && h < 15, DUSK = (h: number) => h >= 18 && h < 21.5, NIGHT = (h: number) => h >= 21.5 || h < 5;

/** How much the beaver wants an activity now, against the others: the time of day, the weather and what is new
 *  steer it. The wish grows with the time since it last did it (liveDirector). */
export function weight(activity: string, m: Moment): number {
  const hour = m.hour ?? 12, wet = m.weather === "rain" || m.weather === "fog";
  if (fresh(activity, m)) return 3; // curious about what is new
  switch (activity) {
    case "Pond patrol": return NOON(hour) ? 2.5 : 1; // a swim at noon
    case "Tail slap": return m.ducks === false ? 0.2 : 1.3; // only with ducks on the pond to send off
    case "Sky watch": return DUSK(hour) || wet ? 3 : NIGHT(hour) ? 1.5 : 0.6; // dusk and rain; at night the lantern
    case "Dam work": return 1.6; // the long work, a few sticks a visit: it comes round often
    case "Regrowth": return 1.3;
    case "Around the clearing": return 0.7;
    default: return 1;
  }
}

/** Why the beaver does this activity now, in its own words: the live caption, so a viewer reads a player with a
 *  reason, not a list being played. One short line (under 40 characters: the caption is one row). An activity
 *  without a line of its own says its name. */
export function reason(activity: string, m: Moment): string {
  const hour = m.hour ?? 12;
  if (fresh(activity, m)) return `New! Let me try: ${activity}`;
  switch (activity) {
    case "Dam work": return m.carrying ? "Got a stick. Off to the dam." : "My dam won't build itself.";
    case "Pond patrol": return NOON(hour) ? "Warm noon. Time for a swim." : "A lap round my pond.";
    case "Tail slap": return "Ducks on my pond. Not for long!";
    case "Sky watch": return m.weather === "rain" ? "Rain. Let me watch the weather." : m.weather === "fog" ? "Fog. Can I still see the sky?"
      : NIGHT(hour) ? "Dark out. Lantern on." : DUSK(hour) ? "Dusk. The deer come out now." : "What is the sky up to?";
    case "Regrowth": return "Are my trees growing back?";
    case "Around the clearing": return "Stretching my legs.";
    case "Furious beaver": return "That makes me furious!";
    default: return activity;
  }
}

/** Picks the next activity from the stations that can be played now, and returns its stations in their order. Pure:
 *  the activity not shown for longest wins, that time multiplied by its weight; never one twice in a row (unless it is
 *  the only one); one never shown before comes first. With a stick in hand, the dam work goes on. */
export function liveDirector(available: Station[], m: Moment): Station[] {
  const activities = new Map<string, Station[]>();
  for (const station of available) {
    const name = station[2] ?? station[0], group = activities.get(name);
    if (group) group.push(station);
    else activities.set(name, [station]);
  }
  if (m.carrying && activities.has("Dam work")) return activities.get("Dam work")!;
  let best: string | undefined, top = -Infinity;
  for (const name of activities.keys()) {
    if (name === m.previous && activities.size > 1) continue;
    const score = (m.now - (m.shown[name] ?? -1e6)) * weight(name, m);
    if (score > top) { top = score; best = name; }
  }
  return best === undefined ? [] : activities.get(best)!;
}
