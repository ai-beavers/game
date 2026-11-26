// The browser half of tools/listen.ts: renders the game's own audio code (src/features/audio) in an
// OfflineAudioContext, one recipe at a time or as a whole scene, the way src/features/audio/index.ts plays it.
// Bundled by tools/listen.ts and run in a blank headless Chrome tab:
//
//   await listen.recipe("bite")  → { rate, left, right }   base64 Float32 samples, as heard at the camera
//   await listen.scene("rain")   → the same for a whole scene
//   listen.recipes, listen.scenes                          the names
import { createLapping, createMix, createMusic, createNight, createRain, createWind, type Mix } from "../src/features/audio/mix.ts";
import { SOUNDS, type SoundName } from "../src/features/audio/sounds.ts";

const RATE = 48000;
const CAMERA = 4; // m, the camera's usual distance from the beaver (src/player/camera.ts)

/** A seeded Math.random, so every run renders the same samples. */
function seed(n: number) {
  Math.random = () => {
    n = (n + 0x6d2b79f5) | 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Bus = "steps" | "sfx" | "ambience";
/** How index.ts plays each recipe: its bus, how far from the camera (0: not placed) and a typical amount. */
export const PLAYED: Record<SoundName, { bus: Bus; at: number; amount: number; seconds: number }> = {
  stepGrass: { bus: "steps", at: CAMERA, amount: 0.3, seconds: 1 },
  stepShore: { bus: "steps", at: CAMERA, amount: 0.3, seconds: 1 },
  stepWater: { bus: "steps", at: CAMERA, amount: 0.3, seconds: 1.2 },
  jump: { bus: "sfx", at: CAMERA, amount: 1, seconds: 1.2 },
  land: { bus: "sfx", at: CAMERA, amount: 0.5, seconds: 1.4 },
  splash: { bus: "sfx", at: CAMERA, amount: 0.7, seconds: 2.5 },
  slap: { bus: "sfx", at: CAMERA, amount: 1, seconds: 2.5 },
  thump: { bus: "sfx", at: CAMERA, amount: 1, seconds: 1.5 },
  paddle: { bus: "sfx", at: CAMERA, amount: 0.8, seconds: 1.5 },
  shake: { bus: "sfx", at: CAMERA, amount: 1, seconds: 2.5 },
  pickup: { bus: "sfx", at: CAMERA, amount: 1, seconds: 1.2 },
  drop: { bus: "sfx", at: CAMERA, amount: 1, seconds: 1.4 },
  bite: { bus: "sfx", at: CAMERA, amount: 0.5, seconds: 1.2 },
  murmur: { bus: "sfx", at: CAMERA + 2, amount: 0.5, seconds: 1.2 }, // the Old Beaver, a few metres ahead of the beaver
  squeak: { bus: "sfx", at: CAMERA + 2, amount: 1, seconds: 1.2 }, // the River kit, left a few metres behind the beaver
  chirp: { bus: "sfx", at: CAMERA + 1, amount: 1, seconds: 1 }, // and beside it again
  doze: { bus: "ambience", at: CAMERA + 1, amount: 1, seconds: 1 }, // and asleep beside it
  creak: { bus: "sfx", at: CAMERA + 1, amount: 1, seconds: 4 },
  crash: { bus: "sfx", at: CAMERA + 2, amount: 0.7, seconds: 4 },
  crack: { bus: "sfx", at: CAMERA, amount: 1, seconds: 2.5 },
  place: { bus: "sfx", at: CAMERA, amount: 1, seconds: 1.4 },
  fanfare: { bus: "sfx", at: 0, amount: 1, seconds: 5 },
  chime: { bus: "sfx", at: 0, amount: 1, seconds: 4 },
  owl: { bus: "ambience", at: 18, amount: 1, seconds: 4 },
  deer: { bus: "ambience", at: 14, amount: 1, seconds: 2.5 },
  cricket: { bus: "ambience", at: 0, amount: 0.5, seconds: 1 },
  frog: { bus: "ambience", at: 5, amount: 0.5, seconds: 1.2 },
  tick: { bus: "ambience", at: 0, amount: 0.5, seconds: 1 },
  plip: { bus: "ambience", at: 5, amount: 0.5, seconds: 1 },
  bird: { bus: "ambience", at: 12, amount: 0.5, seconds: 2 },
  lap: { bus: "ambience", at: 5, amount: 0.5, seconds: 2 },
  crackle: { bus: "ambience", at: CAMERA + 1, amount: 0.5, seconds: 1.5 },
};

/** A panner as index.ts makes them, `distance` m to the right front of the listener at the origin. */
function placed(ctx: BaseAudioContext, out: AudioNode, distance: number, side = 0.3) {
  if (!distance) return out;
  const p = new PannerNode(ctx, { panningModel: "equalpower", distanceModel: "inverse", refDistance: 2, rolloffFactor: 1, maxDistance: 60,
    positionX: distance * Math.sin(side), positionY: 0, positionZ: -distance * Math.cos(side) });
  p.connect(out);
  return p;
}

function result(buffer: AudioBuffer) {
  const encode = (data: Float32Array) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
  };
  return { rate: buffer.sampleRate, left: encode(buffer.getChannelData(0)), right: encode(buffer.getChannelData(1)) };
}

/** listen.options.volume: the player's volume; listen.options.bypass = true: the limiter does nothing (no gain reduction, no make-up gain), to see what reaches it. */
const options = { bypass: false, volume: 0.7 }; // settings' default volume

function context(seconds: number) {
  const ctx = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE), mix = createMix(ctx);
  mix.master.gain.value = options.volume;
  if (options.bypass) { mix.limiter.threshold.value = 0; mix.limiter.ratio.value = 1; }
  return { ctx, mix };
}

async function recipe(name: SoundName) {
  seed(7);
  const how = PLAYED[name], { ctx, mix } = context(how.seconds);
  SOUNDS[name](ctx, placed(ctx, mix[how.bus], how.at), 0.1, how.amount); // at 0 Chrome drops much of the attack
  return result(await ctx.startRendering());
}

/** What index.ts keeps running: the ambience, the music, the birds and the owl, for the sky given by `sky(now)`. */
function world(ctx: BaseAudioContext, mix: Mix, music: boolean) {
  const shore = placed(ctx, mix.ambience, 5) as PannerNode;
  shore.refDistance = 1.5;
  const wind = createWind(ctx, mix.ambience), lapping = createLapping(ctx, shore), tune = createMusic(ctx, mix.music);
  const rain = createRain(ctx, mix.ambience, shore), night = createNight(ctx, mix.ambience, shore);
  tune.set(music, 0);
  let bird = 3, owl = 4;
  const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return (now: number, dt: number, sky: { dark: number; rain: number; wind: number; evening?: boolean }) => {
    const { dark, rain: wet } = sky;
    wind.update(now, sky.wind);
    lapping.update(now);
    rain.update(now, wet, 0.8);
    night.update(now, smooth(0.4, 0.85, dark) * (1 - 0.7 * wet), sky.evening ? Math.sin(Math.PI * smooth(0.15, 0.95, dark)) * (1 - 0.5 * wet) : 0);
    tune.night(dark, now);
    tune.update(now);
    const birds = (1 - smooth(0.2, 0.6, dark)) * (1 - 0.8 * wet);
    if ((bird -= dt * birds) <= 0) {
      bird = 4 + Math.random() * 7;
      SOUNDS.bird(ctx, placed(ctx, mix.ambience, 8 + Math.random() * 10, Math.random() * 6), now, Math.random());
    }
    if ((owl -= dt * smooth(0.6, 0.9, dark) * (1 - 0.6 * wet)) <= 0) {
      owl = 15 + Math.random() * 25;
      SOUNDS.owl(ctx, placed(ctx, mix.ambience, 14 + Math.random() * 10, Math.random() * 6), now, 1);
    }
  };
}

type Play = (name: SoundName, t: number, amount?: number, distance?: number) => void;
interface Scene {
  seconds: number; music?: boolean; sky?: (now: number) => { dark: number; rain: number; wind: number; evening?: boolean }; events?: (play: Play) => void;
  /** Seconds from … to: the camera under water (mix.under). */
  under?: [number, number];
}

const NOON = { dark: 0, rain: 0, wind: 0.25 };
const walk = (play: Play, from: number, to: number, every = 0.32, kind: SoundName = "stepGrass") => {
  for (let t = from; t < to; t += every) play(kind, t, 0.3);
};
export const SCENES: Record<string, Scene> = {
  /** A calm noon at the pond: wind, water, birds, the music. */
  noon: { seconds: 20 },
  /** The same without music. */
  noonQuiet: { seconds: 20, music: false },
  /** Hard rain and wind, the beaver walking. */
  rain: { seconds: 20, sky: () => ({ dark: 0.3, rain: 1, wind: 0.7 }), events: (play) => walk(play, 4, 10) },
  /** A strong wind, dry. */
  wind: { seconds: 20, sky: () => ({ dark: 0.1, rain: 0, wind: 0.8 }) },
  /** Deep night: crickets, the owl, the music low; frogs in the evening's first dark. */
  night: { seconds: 20, sky: () => ({ dark: 1, rain: 0, wind: 0.15 }) },
  dusk: { seconds: 20, sky: () => ({ dark: 0.55, rain: 0, wind: 0.2, evening: true }) },
  /** Gnawing a tree until it falls, then splitting it. */
  fell: {
    seconds: 20, events: (play) => {
      const bites = 8;
      for (let i = 0; i < bites; i++) play("bite", 1 + i * 0.6, i / bites);
      const falls = 1 + bites * 0.6;
      play("creak", falls, 1, 5);
      play("crash", falls + 2.2, 0.8, 6);
      for (let i = 0; i < 4; i++) play("bite", falls + 5 + i * 0.6, i / 4);
      play("crack", falls + 5 + 4 * 0.6);
    },
  },
  /** Building the dam: carry a stick over, put it in, five times; the half-way chime and the fanfare. */
  dam: {
    seconds: 24, events: (play) => {
      for (let i = 0; i < 6; i++) {
        const t = 0.5 + i * 3.6;
        play("pickup", t);
        walk(play, t + 0.4, t + 2.4);
        play("place", t + 2.6);
        if (i === 2) play("chime", t + 2.85, 1, 0);
      }
      play("fanfare", 0.5 + 5 * 3.6 + 2.9, 1, 0);
    },
  },
  /** Into the pond, swimming, out again and shaking. */
  swim: {
    seconds: 16, events: (play) => {
      walk(play, 0.5, 2, 0.3, "stepShore");
      play("splash", 2.2, 0.9);
      for (let t = 2.8; t < 11; t += 1 / 2.3) play("paddle", t, 0.8);
      walk(play, 11.4, 12.4, 0.3, "stepWater");
      play("shake", 12.8);
    },
  },
  /** Diving: paddling on the surface, then under (all muffled, the pond's hum), another beaver's tail slaps heard
   *  from below as thumps, up again. */
  underwater: {
    seconds: 16, under: [3, 13], events: (play) => {
      for (let t = 0.5; t < 3; t += 1 / 2.3) play("paddle", t, 0.8);
      for (let t = 3.4; t < 12.6; t += 1 / 1.6) play("paddle", t, 0.5, 2);
      for (const t of [6, 9.5]) play("slap", t, 1, 5);
      for (let t = 13.4; t < 16; t += 1 / 2.3) play("paddle", t, 0.8);
    },
  },
  /** Tail slaps on the water, the alarm, one after another. */
  slap: { seconds: 14, events: (play) => { for (const t of [2, 5, 5.9, 9]) play("slap", t); } },
  /** The milestones over the music: two goal chimes, the fanfare. */
  chimes: { seconds: 16, events: (play) => { play("chime", 3, 1, 0); play("chime", 6, 1, 0); play("fanfare", 9, 1, 0); } },
  /** Running about: steps as fast as the gait makes them, a jump and a landing. */
  run: { seconds: 12, events: (play) => { walk(play, 1, 10, 0.2); play("jump", 5); play("land", 5.6, 0.8); } },
  /** Only the music. */
  music: { seconds: 30, sky: () => ({ dark: 0, rain: 0, wind: 0 }) },
};

async function scene(name: string) {
  const s = SCENES[name];
  if (!s) throw new Error(`no scene ${name}`);
  seed(11);
  const { ctx, mix } = context(s.seconds), sky = s.sky ?? (() => NOON);
  const tick = world(ctx, mix, s.music ?? true);
  if (name === "music") mix.ambience.disconnect(); // only the tune
  const events: { t: number; go: () => void }[] = [];
  s.events?.((sound, t, amount, distance) => events.push({ t, go: () => {
    const how = PLAYED[sound];
    SOUNDS[sound](ctx, placed(ctx, mix[how.bus], distance ?? how.at), t, amount ?? how.amount);
    if (how.bus === "sfx") mix.duck(t);
  } }));
  events.sort((a, b) => a.t - b.t);
  // index.ts updates every frame; here at 30 a second, all scheduled before the render.
  for (let now = 0, dt = 1 / 30; now < s.seconds; now += dt) {
    while (events[0] && events[0].t < now + 0.1) events.shift()!.go();
    if (s.under) mix.under(now >= s.under[0] && now < s.under[1], now);
    tick(now, dt, sky(now));
  }
  return result(await ctx.startRendering());
}

Object.assign(window, { listen: { options, recipe, scene, recipes: Object.keys(PLAYED), scenes: Object.keys(SCENES) } });
