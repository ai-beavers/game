/** Stations in one activity play in order, so building can use the wood gathered earlier. stream false: a test of the
 *  player's controls (a menu, a pad), played in the test but left out of the live stream. */
export type Station = [name: string, play: () => Promise<void>, activity?: string, stream?: false];

// ---- a clear view: the beaver must always be seen ----
// The live tour films with the player's own camera (src/player/camera.ts), behind the beaver, so the stream looks
// played, not filmed. Crowns, bushes, reeds, crates, the lodge have no collider (or one the camera's cast ignores);
// their bounds are known, as turned boxes or (leaves) the ellipsoids inside them. Each moment the tour asks: is the
// beaver seen from the camera (most of a few points on its body with nothing in between, the camera inside nothing)?
// When it is not for a moment, the things in the way are faded.

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
const NEW: Record<string, string> = { "Wears a hat": "2026-11-18", Trading: "2026-11-18", "Sit and crawl": "2026-11-18", "Shopping": "2026-11-18", Canoeing: "2026-11-18", "Find Mrs. Beaver": "2026-11-19", "Left alone": "2026-11-19", "Burn the flag": "2026-11-20", "Visit the Old Beaver": "2026-11-19", "Hold a good": "2026-11-20", "Drive off the bear": "2026-11-20", "Canoe race": "2026-11-20" };
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
    case "Left alone": return 0.3; // a real minute of standing still: now and then, not often
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
    case "Trading": return "Wood to spare. Let's go shopping!";
    case "Sit and crawl": return "Legs tired. Let me sit a bit.";
    case "Shopping": return "Saved up. Time for a new look.";
    case "Canoeing": return m.weather === "rain" ? "Rain on the pond. Paddling anyway." : m.weather === "fog" ? "Foggy pond. Paddle slowly."
      : NIGHT(hour) ? "Moonlit pond. Lantern and paddle." : DUSK(hour) ? "Still water at dusk. Canoe time." : "Calm water. Out in the canoe.";
    case "Find Mrs. Beaver": return "Where is my Mrs. Beaver?";
    case "Visit the Old Beaver": return "Who mutters in the thicket?";
    case "Left alone": return "Nobody's touching the controls. I'll just… look at you.";
    case "Burn the flag": return "That flag has had it.";
    case "Drive off the bear": return "A bear! Not in my clearing.";
    case "Hold a good": return "What's in my backpack again?";
    case "Canoe race": return "Three laps round my pond. Go!";
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
