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

const svg = (body: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">${body}</svg>`;
export const SKY_ICONS: Record<SkyIcon, string> = {
  sun: svg(`<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>`),
  moon: svg(`<path d="M12.5 10.2A5 5 0 0 1 5.8 3.5a5 5 0 1 0 6.7 6.7z"/>`),
  cloud: svg(`<path d="M4.5 12h7a2.5 2.5 0 0 0 .2-5 3.5 3.5 0 0 0-6.7-.6A2.8 2.8 0 0 0 4.5 12z"/>`),
  rain: svg(`<path d="M4.5 9h7a2.5 2.5 0 0 0 .2-5 3.5 3.5 0 0 0-6.7-.6A2.8 2.8 0 0 0 4.5 9z"/><path d="M5.5 11.5l-.7 2M8.5 11.5l-.7 2M11.5 11.5l-.7 2"/>`),
  fog: svg(`<path d="M2.5 5.5h11M1.5 8.5h13M3.5 11.5h9"/>`),
};
