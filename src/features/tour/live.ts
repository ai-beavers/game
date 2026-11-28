/** Stations in one activity play in order, so building can use the wood gathered earlier. stream false: a test of the
 *  player's controls (a menu, a pad), played in the test but left out of the live stream. */
export type Station = [name: string, play: () => Promise<void>, activity?: string, stream?: false];

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
const NEW: Record<string, string> = { "Wears a hat": "2026-11-18", Trading: "2026-11-18", "Sit and crawl": "2026-11-18", "Shopping": "2026-11-18", Canoeing: "2026-11-18", "Find Mrs. Beaver": "2026-11-19", "Left alone": "2026-11-19", "Burn the flag": "2026-11-20", "Visit the Old Beaver": "2026-11-19", "Hold a good": "2026-11-20", "Canoe race": "2026-11-20", Mushrooms: "2026-11-19", Baking: "2026-11-20", Crafting: "2026-11-21", "Meet a beaver": "2026-11-20", Hoverboarding: "2026-11-26", "Switch on the lightbulb": "2026-11-27", "Dance night": "2026-11-28" };
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
    case "Mushrooms": return 0.6; // now and then: the stream is not often dizzy
    case "Left alone": return 0.3; // a real minute of standing still: now and then, not often
    case "Switch on the lightbulb": return DUSK(hour) || NIGHT(hour) ? 2 : 0.6; // a glow shows best in the dark
    case "Dance night": return DUSK(hour) || NIGHT(hour) ? 2 : 0.8; // the tiles glow best in the dark
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
    case "Mushrooms": return "Mushrooms! Just one more…";
    case "Visit the Old Beaver": return "Who mutters in the thicket?";
    case "Left alone": return "Nobody's touching the controls. I'll just… look at you.";
    case "Burn the flag": return "That flag has had it.";
    case "Hold a good": return "What's in my backpack again?";
    case "Canoe race": return "Three laps round my pond. Go!";
    case "Baking": return "Smells like fresh bread.";
    case "Crafting": return "A feather and a shell. I could tie those together.";
    case "Meet a beaver": return "Someone's at the pond. Say hello.";
    case "Hoverboarding": return "Long way to go. Board it is.";
    case "Switch on the lightbulb": return DUSK(hour) || NIGHT(hour) ? "Dark out. Let's switch on the bulb." : "Let's pull the cord by the bench.";
    case "Dance night": return "Music out by the bank. Let's dance.";
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
