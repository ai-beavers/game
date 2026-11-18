// The one-shot sounds of the beaver and its world, each made on the spot from noise, oscillators, filters and
// envelopes. A recipe takes any BaseAudioContext, so the same code plays in the game and renders offline in
// lab/audio.ts.
//
//   SOUNDS.stepGrass(ctx, out, ctx.currentTime, 0.5)   out: a panner or a bus; the number: how hard, 0 … 1
//   noise(ctx)                                         a looping white-noise source, for the ambience
//
// Levels: a recipe peaks at about 0.3 … 0.6 at amount 1; the buses in mix.ts set how loud each kind sits.
import { pitch } from "./music.ts";

export type Recipe = (ctx: BaseAudioContext, out: AudioNode, t: number, amount: number) => void;

const buffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** A looping white-noise source; start it at a random offset so two bursts never sound the same. */
export function noise(ctx: BaseAudioContext) {
  let buffer = buffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    buffers.set(ctx, buffer);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Shape {
  /** Seconds after t. */
  at?: number;
  attack?: number;
  /** Seconds until it has fallen to 2 %. */
  decay: number;
  peak: number;
}

/** A gain that rises in `attack` and falls exponentially over `decay`. */
function envelope(ctx: BaseAudioContext, shape: Shape, t: number) {
  const gain = ctx.createGain(), start = t + (shape.at ?? 0), attack = shape.attack ?? 0.003;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(shape.peak, start + attack);
  gain.gain.setTargetAtTime(0, start + attack, shape.decay / 4);
  return { gain, start, end: start + attack + shape.decay * 1.6 };
}

/** Filtered noise; `to` sweeps the filter over the sound's length. */
function burst(ctx: BaseAudioContext, out: AudioNode, t: number, s: Shape & { filter: BiquadFilterType; freq: number; to?: number; q?: number }) {
  const { gain, start, end } = envelope(ctx, s, t), source = noise(ctx), filter = ctx.createBiquadFilter();
  filter.type = s.filter;
  filter.Q.value = s.q ?? 1;
  filter.frequency.setValueAtTime(s.freq, start);
  if (s.to) filter.frequency.exponentialRampToValueAtTime(s.to, end);
  source.connect(filter).connect(gain).connect(out);
  source.start(start, Math.random() * 1.5);
  source.stop(end);
}

/** An oscillator; `to` glides the pitch over the attack and decay. */
function tone(ctx: BaseAudioContext, out: AudioNode, t: number, s: Shape & { freq: number; to?: number; type?: OscillatorType }) {
  const { gain, start, end } = envelope(ctx, s, t), osc = ctx.createOscillator();
  osc.type = s.type ?? "sine";
  osc.frequency.setValueAtTime(s.freq, start);
  if (s.to) osc.frequency.exponentialRampToValueAtTime(s.to, start + (s.attack ?? 0.003) + s.decay);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(end);
}

/** A buzzing oscillator through a resonant filter: croaks and groans. `to` glides the pitch, `sweep` the filter. */
function buzz(ctx: BaseAudioContext, out: AudioNode, t: number, s: Shape & { freq: number; to?: number; filter: number; sweep?: number; q: number; type?: OscillatorType }) {
  const { gain, start, end } = envelope(ctx, s, t), osc = ctx.createOscillator(), f = ctx.createBiquadFilter();
  osc.type = s.type ?? "sawtooth";
  osc.frequency.setValueAtTime(s.freq, start);
  if (s.to) osc.frequency.exponentialRampToValueAtTime(s.to, end);
  f.type = "bandpass";
  f.Q.value = s.q;
  f.frequency.setValueAtTime(s.filter, start);
  if (s.sweep) f.frequency.exponentialRampToValueAtTime(s.sweep, end);
  osc.connect(f).connect(gain).connect(out);
  osc.start(start);
  osc.stop(end);
}

/** A bell: a few inharmonic partials that ring out, the high ones first. */
function bell(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, peak: number, decay = 1.6) {
  for (const [mult, share, length] of [[1, 1, 1], [2.76, 0.35, 0.5], [5.4, 0.15, 0.25]] as const) {
    tone(ctx, out, t, { freq: freq * mult, attack: 0.004, decay: decay * length, peak: peak * share });
  }
}

/** A note as the music plays it (sine with a little triangle an octave up), a touch brighter. */
function note(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, peak: number, decay: number) {
  tone(ctx, out, t, { freq, attack: 0.012, decay, peak });
  tone(ctx, out, t, { freq: freq * 2, type: "triangle", attack: 0.012, decay: decay * 0.6, peak: peak * 0.18 });
}

/** Wood struck: two resonances and a click. */
function knock(ctx: BaseAudioContext, out: AudioNode, t: number, pitch: number, peak: number) {
  tone(ctx, out, t, { freq: pitch, to: pitch * 0.94, decay: 0.07, peak: peak * 0.6 });
  tone(ctx, out, t, { freq: pitch * 2.37, decay: 0.04, peak: peak * 0.3 });
  burst(ctx, out, t, { filter: "bandpass", freq: pitch * 4, q: 1.5, decay: 0.025, peak: peak * 0.9 });
}

/** Small rising blips, as bubbles burst. */
function bubbles(ctx: BaseAudioContext, out: AudioNode, t: number, count: number, from: number, to: number, peak: number) {
  for (let i = 0; i < count; i++) {
    const f = rand(500, 1300);
    tone(ctx, out, t, { at: rand(from, to), freq: f, to: f * 1.8, attack: 0.002, decay: rand(0.025, 0.05), peak: peak * rand(0.5, 1) });
  }
}

const RECIPES = {
  /** Grass and leaves pressed down: a soft high rustle over a dull thump. */
  stepGrass(ctx, out, t, hard) {
    const v = rand(0.85, 1.15);
    burst(ctx, out, t, { filter: "bandpass", freq: 3200 * v, q: 0.8, attack: 0.006, decay: 0.1 - hard * 0.03, peak: 0.35 + hard * 0.25 });
    burst(ctx, out, t, { at: 0.02, filter: "highpass", freq: 5500 * v, decay: 0.06, peak: 0.12 + hard * 0.08 });
    tone(ctx, out, t, { freq: 95 * v + hard * 25, to: 55, decay: 0.07, peak: 0.25 + hard * 0.3 });
  },
  /** Sand and damp earth by the water: a lower crunch of grains and a firmer thump. */
  stepShore(ctx, out, t, hard) {
    const v = rand(0.85, 1.15);
    for (let i = 0; i < 5; i++) burst(ctx, out, t, { at: i * rand(0.008, 0.016), filter: "bandpass", freq: rand(900, 1600) * v, q: 1.5, attack: 0.002, decay: 0.02, peak: 0.8 + hard * 0.4 });
    burst(ctx, out, t, { filter: "lowpass", freq: 600 * v, decay: 0.08, peak: 0.3 + hard * 0.2 });
    tone(ctx, out, t, { freq: 120 * v + hard * 30, to: 60, decay: 0.07, peak: 0.2 + hard * 0.25 });
  },
  /** A foot in shallow water: a slosh that falls in pitch and a few bubbles. */
  stepWater(ctx, out, t, hard) {
    const v = rand(0.85, 1.15);
    burst(ctx, out, t, { filter: "bandpass", freq: 1600 * v, to: 450, q: 1.4, attack: 0.012, decay: 0.2, peak: 0.75 + hard * 0.35 });
    burst(ctx, out, t, { filter: "lowpass", freq: 350, decay: 0.16, peak: 0.35 + hard * 0.2 });
    bubbles(ctx, out, t, 3, 0.03, 0.15, 0.16);
  },
  /** Push off: a short rising whoosh and a little "hup". */
  jump(ctx, out, t) {
    burst(ctx, out, t, { filter: "bandpass", freq: 600, to: 2000, q: 1.2, attack: 0.04, decay: 0.16, peak: 0.35 });
    tone(ctx, out, t, { freq: 100, to: 60, decay: 0.06, peak: 0.25 });
    tone(ctx, out, t, { at: 0.01, type: "triangle", freq: 330, to: 470, attack: 0.02, decay: 0.08, peak: 0.07 });
  },
  /** Touch down: a body thump and grass, bigger with amount (how hard it fell). */
  land(ctx, out, t, amount) {
    tone(ctx, out, t, { freq: 85, to: 40, decay: 0.12 + amount * 0.1, peak: 0.3 + amount * 0.3 });
    burst(ctx, out, t, { filter: "lowpass", freq: 700, decay: 0.1 + amount * 0.05, peak: 0.2 + amount * 0.25 });
    burst(ctx, out, t, { at: 0.01, filter: "bandpass", freq: 3000, q: 0.8, decay: 0.12, peak: 0.12 + amount * 0.18 });
  },
  /** Into the pond: a crash of water, spray falling back, bubbles. */
  splash(ctx, out, t, amount) {
    burst(ctx, out, t, { filter: "lowpass", freq: 5000, to: 600, attack: 0.006, decay: 0.35 + amount * 0.3, peak: 0.35 + amount * 0.25 });
    burst(ctx, out, t, { at: 0.06, filter: "bandpass", freq: 2200, to: 1200, q: 0.8, attack: 0.05, decay: 0.5, peak: 0.12 + amount * 0.1 });
    tone(ctx, out, t, { freq: 70, to: 40, decay: 0.15, peak: 0.15 + amount * 0.2 });
    bubbles(ctx, out, t, 7, 0.05, 0.5, 0.12);
  },
  /** The tail slapped flat on the water, the beaver's alarm: a loud crack like a rifle shot, the deep whump of the
   *  water hit, spray falling back and bubbles. */
  slap(ctx, out, t, amount) {
    burst(ctx, out, t, { filter: "highpass", freq: 1400, attack: 0.001, decay: 0.035, peak: 0.6 + 0.3 * amount });
    burst(ctx, out, t, { filter: "bandpass", freq: 2600, to: 900, q: 0.9, attack: 0.001, decay: 0.12, peak: 0.45 + 0.2 * amount });
    tone(ctx, out, t, { freq: 110, to: 42, attack: 0.002, decay: 0.22, peak: 0.45 + 0.15 * amount });
    burst(ctx, out, t, { at: 0.05, filter: "lowpass", freq: 4000, to: 700, attack: 0.03, decay: 0.6, peak: 0.18 + 0.1 * amount });
    bubbles(ctx, out, t, 6, 0.1, 0.6, 0.1);
  },
  /** The tail slapped on the ground: a soft, dull thump and a puff of grit. */
  thump(ctx, out, t, amount) {
    tone(ctx, out, t, { freq: 75, to: 38, attack: 0.003, decay: 0.16, peak: 0.35 + 0.15 * amount });
    burst(ctx, out, t, { filter: "lowpass", freq: 900, attack: 0.002, decay: 0.09, peak: 0.3 + 0.1 * amount });
    burst(ctx, out, t, { at: 0.02, filter: "bandpass", freq: 2400, q: 0.7, decay: 0.15, peak: 0.08 });
  },
  /** One paddle stroke while swimming: a soft swell of water. */
  paddle(ctx, out, t, amount) {
    burst(ctx, out, t, { filter: "bandpass", freq: rand(600, 800), to: 1200, q: 1.1, attack: 0.09, decay: 0.28, peak: 0.2 + amount * 0.25 });
    bubbles(ctx, out, t, 2, 0.1, 0.25, 0.05);
  },
  /** Out of the water, shaking the fur: fast bursts of spray, then drops falling. */
  shake(ctx, out, t) {
    for (let i = 0; i < 12; i++) {
      const swell = Math.sin((i / 11) * Math.PI);
      burst(ctx, out, t, { at: i / 14, filter: "bandpass", freq: rand(2500, 4500), q: 0.9, attack: 0.012, decay: 0.05, peak: 0.08 + swell * 0.3 });
    }
    for (let i = 0; i < 10; i++) tone(ctx, out, t, { at: rand(0.25, 1.1), freq: rand(1500, 3000), to: 3600, attack: 0.001, decay: 0.02, peak: 0.05 });
  },
  /** A stick lifted: a light knock of wood and a rustle. */
  pickup(ctx, out, t) {
    knock(ctx, out, t, rand(480, 560), 0.4);
    burst(ctx, out, t, { at: 0.03, filter: "bandpass", freq: 3500, q: 0.7, decay: 0.1, peak: 0.1 });
  },
  /** A stick let go: it hits the ground and bounces once. */
  drop(ctx, out, t) {
    knock(ctx, out, t, rand(360, 420), 0.5);
    burst(ctx, out, t, { filter: "lowpass", freq: 500, decay: 0.08, peak: 0.25 });
    knock(ctx, out, t + 0.14, rand(380, 440), 0.22);
  },
  /** One bite into a tree: teeth sinking in, fibres crunching, a chip snapping off; harder as the tree gives (amount:
   *  progress 0 … 1). */
  bite(ctx, out, t, amount) {
    const v = rand(0.9, 1.1);
    for (let i = 0; i < 3; i++) burst(ctx, out, t, { at: i * 0.028, filter: "bandpass", freq: 2500 * v, q: 2.5, attack: 0.003, decay: 0.03, peak: 0.45 });
    burst(ctx, out, t, { at: 0.06, filter: "bandpass", freq: 1100 * v, q: 1.2, attack: 0.004, decay: 0.07, peak: 0.3 + 0.2 * amount });
    knock(ctx, out, t + 0.1, rand(620, 720) * (1 - 0.25 * amount), 0.3 + 0.25 * amount);
  },
  /** A gnawed tree starts to go: a slow groan of wood with fibres popping, faster and faster, then a snap. */
  creak(ctx, out, t) {
    const v = rand(0.9, 1.1);
    buzz(ctx, out, t, { freq: 62 * v, to: 38 * v, filter: 720, sweep: 380, q: 7, attack: 0.35, decay: 1.6, peak: 0.55 });
    buzz(ctx, out, t, { at: 0.5, freq: 91 * v, to: 70 * v, filter: 1100, sweep: 600, q: 9, attack: 0.2, decay: 0.9, peak: 0.25 });
    for (let i = 0, at = 0.1; i < 14; i++, at += 0.2 * 0.84 ** i) knock(ctx, out, t + at, rand(500, 900), 0.12 + i * 0.015);
    burst(ctx, out, t, { at: 1.15, filter: "highpass", freq: 1800, attack: 0.001, decay: 0.03, peak: 0.4 });
    knock(ctx, out, t + 1.15, rand(260, 300), 0.35);
  },
  /** A tree hits the ground: a deep thud, branches snapping, leaves thrashing; bigger with amount (how hard). */
  crash(ctx, out, t, amount) {
    tone(ctx, out, t, { freq: 58, to: 30, attack: 0.006, decay: 0.45 + 0.4 * amount, peak: 0.3 + 0.2 * amount });
    burst(ctx, out, t, { filter: "lowpass", freq: 1100, to: 180, attack: 0.008, decay: 0.5 + 0.6 * amount, peak: 0.35 + 0.25 * amount });
    burst(ctx, out, t, { at: 0.02, filter: "bandpass", freq: 3800, q: 0.5, attack: 0.03, decay: 0.9 + 0.8 * amount, peak: 0.18 + 0.15 * amount });
    for (let i = 0, n = 3 + Math.round(6 * amount); i < n; i++) knock(ctx, out, t + rand(0, 0.45), rand(260, 750), rand(0.15, 0.35));
    tone(ctx, out, t, { at: 0.32, freq: 50, to: 32, decay: 0.25, peak: 0.12 + 0.12 * amount }); // the bounce
  },
  /** A fallen tree breaks into wood: sharp cracks one after the other, then the logs knock on the ground. */
  crack(ctx, out, t) {
    for (let i = 0, at = 0; i < 5; i++, at += rand(0.05, 0.13)) {
      burst(ctx, out, t, { at, filter: "highpass", freq: rand(1600, 2600), attack: 0.001, decay: 0.02, peak: 0.45 });
      knock(ctx, out, t + at, rand(220, 420), 0.3);
    }
    for (const at of [0.55, 0.72, 0.84]) knock(ctx, out, t + at + rand(0, 0.04), rand(150, 210), 0.45);
  },
  /** A stick goes into the dam: a deep woody knock, a lighter one as it settles, a pat of mud. */
  place(ctx, out, t) {
    knock(ctx, out, t, rand(210, 250), 0.65);
    knock(ctx, out, t + 0.08, rand(330, 380), 0.25);
    burst(ctx, out, t, { at: 0.05, filter: "lowpass", freq: 450, attack: 0.008, decay: 0.12, peak: 0.35 });
  },
  /** The dam is finished: the tune's own notes run up and land on a chord. */
  fanfare(ctx, out, t) {
    [0, 2, 3, 4].forEach((d, i) => note(ctx, out, t + i * 0.14, pitch(d), 0.22, 0.35));
    for (const d of [5, 7, 8]) note(ctx, out, t + 0.6, pitch(d), 0.16, 2.2);
    note(ctx, out, t + 0.6, pitch(0) / 2, 0.2, 2.4);
    bell(ctx, out, t + 0.62, pitch(10), 0.06, 1.2);
  },
  /** A goal reached: two soft bell notes going up. */
  chime(ctx, out, t) {
    bell(ctx, out, t, pitch(7), 0.18);
    bell(ctx, out, t + 0.16, pitch(10), 0.15);
  },
  /** An owl far off: hoo … hoo-hoooo. */
  owl(ctx, out, t) {
    const v = rand(0.95, 1.05), hoot = (at: number, length: number, peak: number) => {
      tone(ctx, out, t, { at, freq: 400 * v, to: 370 * v, attack: 0.06, decay: length, peak });
      burst(ctx, out, t, { at, filter: "bandpass", freq: 400 * v, q: 4, attack: 0.06, decay: length, peak: peak * 0.4 });
    };
    hoot(0, 0.35, 0.3);
    hoot(0.9, 0.12, 0.2);
    hoot(1.1, 0.7, 0.3);
  },
  /** One chirp of a cricket: three quick pulses of a high tone; amount picks its pitch. */
  cricket(ctx, out, t, amount) {
    const f = 4300 + amount * 600;
    for (let i = 0; i < 3; i++) tone(ctx, out, t, { at: i * 0.026, freq: f, attack: 0.004, decay: 0.014, peak: 0.12 });
  },
  /** A frog: a low, buzzing double croak; amount picks its pitch. */
  frog(ctx, out, t, amount) {
    const f = 130 + amount * 90;
    buzz(ctx, out, t, { freq: f, to: f * 0.9, filter: 900, q: 4, attack: 0.01, decay: 0.07, peak: 0.6 });
    buzz(ctx, out, t, { at: 0.1, freq: f * 1.05, to: f * 0.85, filter: 800, q: 4, attack: 0.01, decay: 0.1, peak: 0.6 });
  },
  /** A raindrop on a leaf, close by. */
  tick(ctx, out, t, amount) {
    tone(ctx, out, t, { freq: 2200 + amount * 3000, attack: 0.001, decay: 0.012, peak: 0.12 });
  },
  /** A raindrop into water: a tiny rising plip. */
  plip(ctx, out, t, amount) {
    const f = 900 + amount * 1400;
    tone(ctx, out, t, { freq: f, to: f * 1.7, attack: 0.002, decay: 0.03, peak: 0.1 });
  },
  /** A bird far off; amount picks the song: a few tweets, a two-note whistle or a trill. */
  bird(ctx, out, t, amount) {
    const v = rand(0.9, 1.12);
    if (amount < 0.34) {
      const n = 3 + Math.floor(rand(0, 3));
      for (let i = 0; i < n; i++) tone(ctx, out, t, { at: i * 0.13, freq: 3200 * v, to: 4300 * v, attack: 0.01, decay: 0.06, peak: 0.12 });
    } else if (amount < 0.67) {
      tone(ctx, out, t, { freq: 2500 * v, to: 2600 * v, attack: 0.04, decay: 0.18, peak: 0.12 });
      tone(ctx, out, t, { at: 0.24, freq: 2000 * v, to: 1850 * v, attack: 0.04, decay: 0.28, peak: 0.1 });
    } else {
      for (let i = 0; i < 10; i++) tone(ctx, out, t, { at: i * 0.045, freq: 4600 * v, to: 3800 * v, attack: 0.004, decay: 0.03, peak: 0.08 + 0.004 * i });
    }
  },
  /** One wave against the shore. */
  lap(ctx, out, t, amount) {
    burst(ctx, out, t, { filter: "bandpass", freq: 450, to: 220, q: 1.2, attack: 0.15, decay: 0.5, peak: 0.3 + amount * 0.2 });
    burst(ctx, out, t, { at: 0.12, filter: "bandpass", freq: 1700, q: 1.5, attack: 0.01, decay: 0.08, peak: 0.06 + amount * 0.05 });
  },
} satisfies Record<string, Recipe>;

export type SoundName = keyof typeof RECIPES;
export const SOUNDS: Record<SoundName, Recipe> = RECIPES;
