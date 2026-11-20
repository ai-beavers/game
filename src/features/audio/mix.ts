// The mixing desk and the lasting sounds: buses with their levels, a small reverb, a limiter, the wind in the
// leaves, water lapping, and the music. Works on any BaseAudioContext, so tools/listen.ts renders the full mix offline.
//
//   const mix = createMix(ctx);              mix.steps / sfx / ambience / music: connect sounds here
//   mix.master.gain.value = 0.7;             volume, before the limiter: at any volume the peaks stay under -1 dBFS
//   const wind = createWind(ctx, mix.ambience);   wind.update(ctx.currentTime, strength) every frame or so
//   rain.update(now, rain, nearWater) · night.update(now, crickets, frogs) · music.night(dark, now)
//   mix.under(cameraUnderWater, now)         muffles the whole mix and brings up the hum of the pond
//   mix.speech(now, until, depth)            someone speaks real words: ambience and music step back until then
//   carried(distance, earshot)               how much of a talking voice is heard that far off, 0 to 1
//
// Lasting sounds follow the sky by gliding their gains (setTargetAtTime), never by switching.
import { composer, pitch } from "./music.ts";
import { noise, rand, SOUNDS } from "./sounds.ts";

/** Bus levels and reverb sends: footsteps sit under the ambience, events read clearly, music stays soft. `drive`
 *  brings the sum to the loudness plan: about -16 LUFS for a scene at the default volume 0.7, a milestone or the
 *  tail slap the loudest, peaks under -1 dBFS (bun tools/listen.ts measures it; audio.test.ts holds the bands). */
export const LEVELS = {
  steps: { gain: 0.45, reverb: 0.08 },
  sfx: { gain: 0.7, reverb: 0.15 },
  ambience: { gain: 0.6, reverb: 0.05 },
  music: { gain: 0.16, reverb: 0.6 },
  drive: 7,
};

/** How far the ambience and the music step back while someone speaks real words: 10 dB, so every word is understood. */
export const SPEECH = 0.32;

/** m from a speaker within which a talking voice is heard in full. */
const BESIDE = 3;
/** How much of a talking voice is heard d m away in the open, 0 to 1, when it carries earshot m: full beside the
 *  speaker, then half at twice the distance, as sound falls in the open. That law alone never reaches silence, and a
 *  game's voice is far louder against its ambience than a real one against wind and water: so from a third of
 *  earshot on it thins out as well, and just beyond earshot nothing is left. For 20 m: -9 dB at 8 m, -12 dB at 10 m,
 *  -22 dB at 15 m, -32 dB at 18 m, silence from 22 m. */
export function carried(d: number, earshot: number) {
  const t = Math.min(1, Math.max(0, (d - earshot * 0.3) / (earshot * 0.8)));
  return Math.min(1, BESIDE / d) * (1 - t * t * (3 - 2 * t));
}

export function createMix(ctx: BaseAudioContext) {
  const master = ctx.createGain(), limiter = ctx.createDynamicsCompressor(), reverb = ctx.createConvolver(), wet = ctx.createGain();
  const drive = ctx.createGain(), rumble = ctx.createBiquadFilter(), air = ctx.createBiquadFilter();
  drive.gain.value = LEVELS.drive;
  // Below 40 Hz phones and laptops play nothing and the stream's encoder wastes bits; above 9 kHz the noise layers hiss.
  rumble.type = "highpass"; rumble.frequency.value = 40; rumble.Q.value = 0.7;
  air.type = "highshelf"; air.frequency.value = 9000; air.gain.value = -4;
  limiter.threshold.value = -4;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.15;
  // The limiter lets a sharp crack overshoot by a dB or so: a soft clip rounds what is above -3 dBFS off below -1 dBFS.
  const ceiling = ctx.createWaveShaper(), curve = new Float32Array(1025);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / 512 - 1), a = Math.abs(x);
    curve[i] = a <= 0.68 ? x : Math.sign(x) * (0.68 + 0.18 * Math.tanh((a - 0.68) / 0.18));
  }
  ceiling.curve = curve;
  ceiling.oversample = "4x";
  // Under water (mix.under): everything through a low-pass with a gentle resonance; open above, it passes all.
  const muffle = ctx.createBiquadFilter();
  muffle.type = "lowpass"; muffle.frequency.value = UNDER.open; muffle.Q.value = UNDER.openQ;
  drive.connect(rumble).connect(air).connect(muffle).connect(master).connect(limiter).connect(ceiling).connect(ctx.destination);
  // A small glade: 1.4 s of decaying stereo noise, darker towards its end.
  const length = Math.floor(ctx.sampleRate * 1.4), impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const k = i / length;
      low += (Math.random() * 2 - 1 - low) * (0.6 - 0.5 * k);
      data[i] = low * Math.exp(-5 * k) * 0.5;
    }
  }
  reverb.buffer = impulse;
  wet.gain.value = 0.5;
  reverb.connect(wet).connect(drive);
  const bus = (level: { gain: number; reverb: number }) => {
    const gain = ctx.createGain(), send = ctx.createGain();
    gain.gain.value = level.gain;
    send.gain.value = level.reverb;
    gain.connect(drive);
    gain.connect(send).connect(reverb);
    return gain;
  };
  const ambience = bus(LEVELS.ambience), music = bus(LEVELS.music);
  let spoken = 0; // the context's time until which someone speaks (speech)
  /** An event starts at t: the ambience steps back 5 dB for a moment, so a bite or a knock reads over rain and wind.
   *  While someone speaks it is back already, and stays there until they have finished. */
  const duck = (t: number) => {
    if (t < spoken) return;
    ambience.gain.cancelScheduledValues(t);
    ambience.gain.setTargetAtTime(LEVELS.ambience.gain * 0.56, t, 0.015);
    ambience.gain.setTargetAtTime(LEVELS.ambience.gain, t + 0.25, 0.35);
  };
  /** Someone speaks real words from t until `until` (the Old Beaver's Voice): the ambience and the music step back
   *  under them (to `depth` of their level: SPEECH for a speaker close by, 1 for one too far off to follow), and
   *  come back when they have finished. Called again for the same line, it only moves the end. */
  const speech = (t: number, until: number, depth = SPEECH) => {
    spoken = until;
    for (const [gain, level] of [[ambience.gain, LEVELS.ambience.gain], [music.gain, LEVELS.music.gain]] as const) {
      gain.cancelScheduledValues(t);
      gain.setTargetAtTime(level * depth, t, 0.08);
      gain.setTargetAtTime(level, until, 0.4);
    }
  };
  // The pond's own sound under water: a low, slowly swelling rush, silent until the camera goes under.
  const hum = noise(ctx), humTone = ctx.createBiquadFilter(), humLevel = ctx.createGain(), swell = ctx.createOscillator(), swellDepth = ctx.createGain();
  humTone.type = "lowpass"; humTone.frequency.value = 220; humTone.Q.value = 0.9;
  humLevel.gain.value = 0;
  swell.frequency.value = 0.13;
  swellDepth.gain.value = 0;
  swell.connect(swellDepth).connect(humLevel.gain);
  hum.connect(humTone).connect(humLevel).connect(ambience);
  hum.start(ctx.currentTime, 4.5); // no Math.random: tools/listen.ts renders from a seed
  swell.start(ctx.currentTime);
  let below = false;
  /** The camera goes under the surface (true) or comes up: the low-pass and the hum ease in or out over about 0.2 s. */
  const under = (on: boolean, t: number) => {
    if (on === below) return;
    below = on;
    muffle.frequency.setTargetAtTime(on ? UNDER.cutoff : UNDER.open, t, UNDER.ease);
    muffle.Q.setTargetAtTime(on ? UNDER.q : UNDER.openQ, t, UNDER.ease);
    humLevel.gain.setTargetAtTime(on ? UNDER.hum : 0, t, UNDER.ease);
    swellDepth.gain.setTargetAtTime(on ? UNDER.hum * 0.35 : 0, t, UNDER.ease);
  };
  return { master, limiter, duck, speech, under, steps: bus(LEVELS.steps), sfx: bus(LEVELS.sfx), ambience, music };
}

/** Under water: the master's low-pass (Hz, its resonance Q), how fast it eases (time constant: about there in 0.2 s), the hum's level. */
export const UNDER = { cutoff: 600, q: 1.6, open: 22000, openQ: 0.707, ease: 0.06, hum: 0.2 };
export type Mix = ReturnType<typeof createMix>;

/** How strong the wind sounds for the sky's wind (0 … 1): 1 at a light breeze (0.25), as before the sky. */
export const windLoudness = (wind: number) => 0.95 + 0.2 * wind;

/** Wind in the leaves: a low stereo rush and a high rustle that swell and fade by themselves, louder and brighter
 *  with `strength` (the sky's wind; 0.25 a light breeze). */
export function createWind(ctx: BaseAudioContext, out: AudioNode) {
  const make = (pan: number, filter: BiquadFilterType, freq: number) => {
    const source = noise(ctx), f = ctx.createBiquadFilter(), gain = ctx.createGain(), panner = ctx.createStereoPanner();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = 0.6;
    gain.gain.value = 0;
    panner.pan.value = pan;
    source.connect(f).connect(gain).connect(panner).connect(out);
    source.start(ctx.currentTime, Math.random() * 1.5);
    return { f, gain };
  };
  const rush = [make(-0.7, "lowpass", 380), make(0.7, "lowpass", 420)], leaves = [make(-0.5, "bandpass", 2600), make(0.5, "bandpass", 3400)];
  let swell = 0.4, target = 0.6, change = 0, flutter = 0;
  return {
    update(now: number, strength = 0.25) {
      if (now > change) { target = rand(0.15 + 0.4 * strength, 1); change = now + rand(4, 10); } // strong wind seldom drops
      if (now < flutter) return;
      flutter = now + rand(0.12, 0.3);
      swell += (target - swell) * 0.08;
      const loud = windLoudness(strength), bright = Math.max(0, strength - 0.25);
      for (const r of rush) {
        r.gain.gain.setTargetAtTime(0.16 * loud * swell * rand(0.85, 1.15), now, 1.2);
        r.f.frequency.setTargetAtTime(250 + 350 * swell + 300 * bright, now, 1.2);
      }
      for (const l of leaves) l.gain.gain.setTargetAtTime(0.13 * loud * swell * swell * rand(0.4, 1.3), now, 0.15);
    },
  };
}

/** Water against the shore: a quiet bed and waves now and then. Put `out` in a panner at the nearest shore. */
export function createLapping(ctx: BaseAudioContext, out: AudioNode) {
  const source = noise(ctx), f = ctx.createBiquadFilter(), gain = ctx.createGain();
  f.type = "lowpass";
  f.frequency.value = 500;
  gain.gain.value = 0.12;
  source.connect(f).connect(gain).connect(out);
  source.start(ctx.currentTime);
  let next = 0;
  return {
    update(now: number) {
      if (next < now) next = now + 0.05;
      while (next < now + 0.3) { SOUNDS.lap(ctx, out, next, Math.random()); next += rand(0.7, 1.7); }
    },
  };
}

/** Rain: a hiss on the leaves all around with drops ticking close by, and drops plipping into the pond. `out` is
 *  around the listener; `water` a panner at the nearest shore. update(now, rain 0 … 1, near 0 … 1: how close the pond). */
export function createRain(ctx: BaseAudioContext, out: AudioNode, water: AudioNode) {
  const layer = (to: AudioNode, filter: BiquadFilterType, freq: number, q: number, pan: number) => {
    const source = noise(ctx), f = ctx.createBiquadFilter(), gain = ctx.createGain(), panner = ctx.createStereoPanner();
    f.type = filter; f.frequency.value = freq; f.Q.value = q; gain.gain.value = 0; panner.pan.value = pan;
    source.connect(f).connect(gain).connect(panner).connect(to);
    source.start(ctx.currentTime, Math.random() * 1.5);
    return gain;
  };
  const hiss = [layer(out, "bandpass", 3600, 0.5, -0.6), layer(out, "bandpass", 4400, 0.5, 0.6)], body = layer(out, "lowpass", 700, 0.7, 0);
  const pond = layer(water, "bandpass", 1300, 0.6, 0), ticks = ctx.createGain(), plips = ctx.createGain();
  ticks.connect(out); plips.connect(water);
  let next = 0, level = 0, near = 0;
  return {
    update(now: number, rain: number, nearWater: number) {
      level = rain; near = nearWater;
      // Soft enough that a bite or a knock still stands over it (bun tools/listen.ts --only rain).
      for (const h of hiss) h.gain.setTargetAtTime(0.02 * rain, now, 1.5);
      body.gain.setTargetAtTime(0.025 * rain, now, 1.5);
      pond.gain.setTargetAtTime(0.06 * rain * near, now, 1.5);
      if (next < now) next = now + 0.05;
      // Single drops close by, more the harder it rains; none are made while it is dry.
      while (next < now + 0.2) {
        if (level > 0.02) {
          const pan = ctx.createStereoPanner();
          pan.pan.value = rand(-0.9, 0.9);
          pan.connect(ticks);
          SOUNDS.tick(ctx, pan, next, Math.random());
          if (Math.random() < near) SOUNDS.plip(ctx, plips, next + rand(0, 0.05), Math.random());
        }
        next += rand(0.03, 0.09) / Math.max(0.1, level);
      }
      ticks.gain.setTargetAtTime(0.35 * Math.sqrt(level), now, 1);
      plips.gain.setTargetAtTime(0.7 * Math.sqrt(level) * near, now, 1);
    },
  };
}

/** The night chorus: three crickets around, each chirping in its own rhythm, and frogs croaking in bouts at the
 *  pond. update(now, crickets 0 … 1, frogs 0 … 1); `pond` a panner at the nearest shore. */
export function createNight(ctx: BaseAudioContext, out: AudioNode, pond: AudioNode) {
  const crickets = ctx.createGain(), frogs = ctx.createGain();
  crickets.gain.value = frogs.gain.value = 0;
  crickets.connect(out); frogs.connect(pond);
  const singers = [-0.7, 0.1, 0.8].map((p) => {
    const pan = ctx.createStereoPanner();
    pan.pan.value = p;
    pan.connect(crickets);
    return { pan, every: rand(0.42, 0.7), pitch: Math.random(), next: 0 };
  });
  let croak = 0, bout = 0, cricketLevel = 0, frogLevel = 0;
  return {
    update(now: number, cricket: number, frog: number) {
      cricketLevel = cricket; frogLevel = frog;
      crickets.gain.setTargetAtTime(cricket, now, 2);
      frogs.gain.setTargetAtTime(frog, now, 2);
      for (const s of singers) {
        if (s.next < now) s.next = now + rand(0, s.every);
        while (s.next < now + 0.3) {
          if (cricketLevel > 0.01) SOUNDS.cricket(ctx, s.pan, s.next, s.pitch);
          s.next += s.every * rand(0.97, 1.03);
        }
      }
      if (croak < now) croak = now + rand(0.5, 2);
      while (croak < now + 0.3) {
        if (frogLevel > 0.01) SOUNDS.frog(ctx, frogs, croak, Math.random());
        // A bout of a few croaks, then a pause.
        if (--bout > 0) croak += rand(0.35, 0.6);
        else { bout = 2 + Math.floor(rand(0, 5)); croak += rand(2, 6); }
      }
    },
  };
}

/** The music: soft notes that compose themselves, and now and then a low note under them. At night (music.night)
 *  quieter and darker, and its phrases go down an octave. */
export function createMusic(ctx: BaseAudioContext, out: AudioNode) {
  const level = ctx.createGain(), hush = ctx.createGain(), tone = ctx.createBiquadFilter(), next = composer();
  tone.type = "lowpass";
  tone.frequency.value = 1800;
  level.gain.value = 0;
  tone.connect(level).connect(hush).connect(out);
  let at = 0, count = 0, on = false, dark = 0, octave = 1;
  const voice = (freq: number, t: number, length: number, peak: number) => {
    // Stops once 60 dB down: at t + length + 3 a long note was still 20 dB down and stopped with a click.
    const gain = ctx.createGain(), end = t + 0.3 + length * 0.6 * 7;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.25);
    gain.gain.setTargetAtTime(0, t + 0.3, length * 0.6);
    gain.connect(tone);
    for (const [type, mult, share] of [["sine", 1, 1], ["triangle", 2, 0.12]] as const) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq * mult;
      g.gain.value = share;
      osc.connect(g).connect(gain);
      osc.start(t);
      osc.stop(end);
    }
  };
  return {
    set(play: boolean, now: number) {
      on = play;
      level.gain.setTargetAtTime(play ? 1 : 0, now, 1.2);
    },
    /** How dark it is, 0 … 1: glides the level and the tone; the octave changes only where a phrase begins. */
    night(value: number, now: number) {
      dark = value;
      hush.gain.setTargetAtTime(1 - 0.5 * dark, now, 3);
      tone.frequency.setTargetAtTime(1800 - 1000 * dark, now, 3);
    },
    update(now: number) {
      if (!on) return;
      if (at < now) at = now + 0.2;
      while (at < now + 0.5) {
        if (count % 8 === 0) octave = dark > 0.5 ? 0.5 : 1;
        const note = next();
        if (!note.rest) voice(pitch(note.degree) * octave, at, note.length, 0.16);
        if (count++ % 6 === 0) voice((pitch(note.degree < 4 ? 0 : 3) / 2) * octave, at, 7, 0.1);
        at += note.length;
      }
    },
  };
}
