// What the player has chosen (volume, picture quality, …), kept in the browser between visits. Features read
// it and listen for changes; the pause menu writes it.
//
//   game.settings.values.volume            game.settings.set({ mute: true })
//   game.settings.on((values) => apply(values));    called at once and after every change
//   ?quality=low                           picture quality for this page only, never saved (for stream tiles)
export interface Settings {
  /** What the player calls themselves; shown over their beaver to others. Empty until they have chosen. */
  name: string;
  /** 0 … 1. */
  volume: number;
  mute: boolean;
  /** Background music, apart from the sounds of the world. */
  music: boolean;
  /** How much the picture may cost: grass density, fur layers, effects. */
  quality: "low" | "medium" | "high";
  /** Extra picture effects (bloom, grading). */
  effects: boolean;
  invertY: boolean;
  /** Shows frames per second. */
  fps: boolean;
}

const DEFAULTS: Settings = { name: "", volume: 0.7, mute: false, music: true, quality: "high", effects: true, invertY: false, fps: false };
const KEY = "beaver.settings";
const QUALITIES: Settings["quality"][] = ["low", "medium", "high"];

export function createSettings() {
  let stored: Partial<Settings> = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { /* a broken or blocked store: defaults */ }
  const quality = new URLSearchParams(location.search).get("quality"), forced = QUALITIES.find((q) => q === quality);
  const values: Settings = { ...DEFAULTS, ...stored, ...(forced && { quality: forced }) }, listeners = new Set<(values: Settings) => void>();
  return {
    values,
    set(change: Partial<Settings>) {
      Object.assign(values, change);
      Object.assign(stored, change); // only what was chosen is kept, never the address's quality
      try { localStorage.setItem(KEY, JSON.stringify(stored)); } catch { /* not kept, still applied */ }
      for (const listener of listeners) listener(values);
    },
    on(listener: (values: Settings) => void) {
      listeners.add(listener);
      listener(values);
      return () => void listeners.delete(listener);
    },
  };
}
export type SettingsStore = ReturnType<typeof createSettings>;
