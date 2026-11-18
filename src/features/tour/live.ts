/** Stations in one activity play in order, so building can use the wood gathered earlier. */
export type Station = [name: string, play: () => Promise<void>, activity?: string];

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
