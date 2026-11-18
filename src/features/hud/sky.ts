// The small sign of the hour and the weather beside the map, from game.sky (src/features/sky). Pure, tested in
// sky.test.ts; the icons are inline SVG in currentColor, so they take the HUD's colour and need no font.
//
//   skyLabel(hour, weather, dark)   → { time: "19:30", icon: "moon", text: "Rain" }
export type SkyIcon = "sun" | "moon" | "cloud" | "rain" | "fog";

const WORDS: Record<string, string> = { fair: "Clear", cloudy: "Cloudy", rain: "Rain", fog: "Fog" };

export function skyLabel(hour: number, weather: string, dark: number) {
  const minutes = Math.floor((((hour % 24) + 24) % 24) * 60 / 10) * 10; // in steps of ten minutes: calm, not ticking
  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const icon: SkyIcon = weather === "rain" ? "rain" : weather === "fog" ? "fog" : weather === "cloudy" ? "cloud" : dark > 0.5 ? "moon" : "sun";
  return { time, icon, text: WORDS[weather] ?? weather };
}
