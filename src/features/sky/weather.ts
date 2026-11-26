// Weather that comes and goes by itself, as plain numbers: spells of fair, cloudy, rain and fog follow each other,
// and a few amounts ease towards what the spell wants, in an order that looks right: clouds thicken before rain
// falls, rain stops before they break, the ground dries slower than it got wet.
//
//   const weather = newWeather();             fair, and it stays fair for a while
//   stepWeather(weather, dt, Math.random);    once per step of play
//   holdWeather(weather, "rain");             this spell from now on, at full strength at once (for pictures)
export type Kind = "fair" | "cloudy" | "rain" | "fog";
export const KINDS: Kind[] = ["fair", "cloudy", "rain", "fog"];

export interface Weather {
  kind: Kind;
  /** Seconds until the next spell; Infinity while held. */
  left: number;
  /** 0 … 1 each. clouds: 0 is the fair sky of the tuned afternoon, 1 overcast. */
  clouds: number; rain: number; fog: number; wind: number;
  /** 0 … 1, how wet the ground is: follows the rain, slowly. */
  wet: number;
}

type Amounts = Pick<Weather, "clouds" | "rain" | "fog" | "wind">;
const WANTS: Record<Kind, Amounts> = {
  fair: { clouds: 0, rain: 0, fog: 0, wind: 0.25 },
  cloudy: { clouds: 0.7, rain: 0, fog: 0, wind: 0.5 },
  rain: { clouds: 1, rain: 1, fog: 0.25, wind: 0.85 },
  fog: { clouds: 0.4, rain: 0, fog: 1, wind: 0.05 },
};
// Per second, how fast each amount may change.
const RATE = { clouds: 1 / 45, rain: 1 / 20, fog: 1 / 40, wind: 1 / 25, wetUp: 1 / 30, wetDown: 1 / 150 };
// What may follow what, with weights: rain comes only out of clouds, fog only out of fair weather.
const NEXT: Record<Kind, [Kind, number][]> = {
  fair: [["fair", 2], ["cloudy", 3], ["fog", 1]],
  cloudy: [["rain", 3], ["fair", 2], ["cloudy", 1]],
  rain: [["cloudy", 1]],
  fog: [["fair", 1]],
};
const LENGTH: Record<Kind, [number, number]> = { fair: [150, 300], cloudy: [70, 150], rain: [90, 180], fog: [70, 130] };

export const newWeather = (): Weather => ({ kind: "fair", left: 240, ...WANTS.fair, wet: 0 });

export function nextKind(kind: Kind, random: () => number): Kind {
  const choices = NEXT[kind], total = choices.reduce((sum, [, w]) => sum + w, 0);
  let pick = random() * total;
  for (const [next, weight] of choices) if ((pick -= weight) < 0) return next;
  return choices[choices.length - 1]![0];
}

const toward = (value: number, goal: number, step: number) => value < goal ? Math.min(goal, value + step) : Math.max(goal, value - step);

export function stepWeather(w: Weather, dt: number, random: () => number) {
  if ((w.left -= dt) <= 0) {
    w.kind = nextKind(w.kind, random);
    const [a, b] = LENGTH[w.kind];
    w.left = a + random() * (b - a);
  }
  const want = WANTS[w.kind];
  // Rain waits for the clouds to close; the clouds wait for the rain to stop before they break.
  const rain = w.clouds > 0.85 ? want.rain : 0;
  w.clouds = toward(w.clouds, Math.max(want.clouds, Math.min(1, w.rain * 3)), RATE.clouds * dt);
  w.rain = toward(w.rain, rain, RATE.rain * dt);
  w.fog = toward(w.fog, want.fog, RATE.fog * dt);
  w.wind = toward(w.wind, Math.max(want.wind, w.rain * 0.8), RATE.wind * dt);
  w.wet = toward(w.wet, w.rain > 0.2 ? 1 : 0, (w.rain > 0.2 ? RATE.wetUp : RATE.wetDown) * dt);
  return w;
}

/** This spell, held until another is held or release() is called; amounts jump to it. */
export function holdWeather(w: Weather, kind: Kind) {
  Object.assign(w, WANTS[kind], { kind, left: Infinity, wet: kind === "rain" ? 1 : 0 });
  return w;
}
export const releaseWeather = (w: Weather) => void (w.left = 60);
