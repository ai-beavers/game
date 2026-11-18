/** Stations in one activity play in order, so building can use the wood gathered earlier. */
export type Station = [name: string, play: () => Promise<void>, activity?: string];

/** How the live view frames an activity: metres from the beaver, radians above the horizon (low, so the sky is in
 *  the picture), radians round from straight behind it, and metres above the beaver it looks at. */
export interface Shot { distance: number; pitch: number; side: number; lift: number }
const SHOTS: Record<string, Shot> = {
  "Around the clearing": { distance: 7, pitch: 0.14, side: 0.5, lift: 0.5 },
  "Dam work": { distance: 4.5, pitch: 0.2, side: 1.1, lift: 0.2 }, // close and from the side: teeth on the trunk
  "Pond patrol": { distance: 5.5, pitch: 0.06, side: 0.4, lift: 0.3 }, // low over the water
  "Sky watch": { distance: 7, pitch: 0.03, side: 0.9, lift: 0.7 }, // more sky
};
const SHOT: Shot = { distance: 6, pitch: 0.14, side: 0.6, lift: 0.4 };

/** On the way somewhere the camera stands back and more behind, so the way ahead is in the picture. */
export function shotFor(activity: string, walking: boolean): Shot {
  const shot = SHOTS[activity] ?? SHOT;
  return walking ? { ...shot, distance: shot.distance + 2.5, side: Math.min(shot.side, 0.5) } : shot;
}

export function liveDirector() {
  const seen = new Set<string>();
  let previous = "";
  return (available: Station[], preferred?: string) => {
    const activities = new Map<string, Station[]>();
    for (const station of available) {
      const name = station[2] ?? station[0], group = activities.get(name);
      if (group) group.push(station);
      else activities.set(name, [station]);
    }
    let choices = [...activities.keys()].filter(name => !seen.has(name));
    if (!choices.length) {
      seen.clear();
      choices = [...activities.keys()];
      if (choices.length > 1) choices = choices.filter(name => name !== previous);
    }
    if (!choices.length) return [];
    previous = preferred && choices.includes(preferred) ? preferred : choices[Math.floor(Math.random() * choices.length)]!;
    seen.add(previous);
    return activities.get(previous)!;
  };
}
