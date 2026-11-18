/** Stations in one activity play in order, so building can use the wood gathered earlier. stream false: a test of the
 *  player's controls (a menu, a pad), played in the test but left out of the live stream. */
export type Station = [name: string, play: () => Promise<void>, activity?: string, stream?: false];

/** How the live view frames an activity: metres from the beaver, radians above the horizon (low, so the sky is in
 *  the picture), radians round from straight behind it, and metres above the beaver it looks at. */
export interface Shot { distance: number; pitch: number; side: number; lift: number }
const SHOTS: Record<string, Shot> = {
  "Around the clearing": { distance: 7, pitch: 0.14, side: 0.5, lift: 0.5 },
  "Dam work": { distance: 4.5, pitch: 0.2, side: 1.1, lift: 0.2 }, // close and from the side: teeth on the trunk
  "Pond patrol": { distance: 5.5, pitch: 0.06, side: 0.4, lift: 0.3 }, // low over the water
  "Tail slap": { distance: 5, pitch: 0.08, side: 0.9, lift: 0.3 }, // from the side: the tail coming down
  "Sky watch": { distance: 7, pitch: 0.03, side: 0.9, lift: 0.7 }, // more sky
};
const SHOT: Shot = { distance: 6, pitch: 0.14, side: 0.6, lift: 0.4 };

/** On the way somewhere the camera stands back and more behind, so the way ahead is in the picture. */
export function shotFor(activity: string, walking: boolean): Shot {
  const shot = SHOTS[activity] ?? SHOT;
  return walking ? { ...shot, distance: shot.distance + 2.5, side: Math.min(shot.side, 0.5) } : shot;
}

/** What the director knows when it picks: the clock (s), when each activity was last shown on it, the one just
 *  shown; the hour (0 … 24) and the weather of the sky; whether the ducks are back on the pond since the last slap;
 *  whether a stick is in the beaver's hand (then the dam work goes on). */
export interface Moment {
  now: number; shown: Record<string, number>; previous?: string;
  hour?: number; weather?: string; ducks?: boolean; carrying?: boolean;
}

/** How much a viewer wants an activity now, against the others: the time of day and the weather steer it. */
export function weight(activity: string, m: Moment): number {
  const hour = m.hour ?? 12, wet = m.weather === "rain" || m.weather === "fog";
  switch (activity) {
    case "Pond patrol": return hour >= 11 && hour < 15 ? 2.5 : 1; // a swim at noon
    case "Tail slap": return m.ducks === false ? 0.2 : 1.3; // only with ducks on the pond to send off
    case "Sky watch": return (hour >= 18 && hour < 21.5) || wet ? 3 : 0.6; // dusk and rain
    case "Dam work": return 1.6; // the long work, a few sticks a visit: it comes round often
    case "Regrowth": return 1.3;
    case "Around the clearing": return 0.7;
    default: return 1;
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
