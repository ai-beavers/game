// Sound for the game, all synthesised with Web Audio: the beaver's steps, jumps, splashes, tail slaps, swimming and work (bites,
// a tree creaking, crashing and cracking, sticks knocked into the dam, a fanfare when it holds, a chime per goal); wind,
// rain, birds, crickets, frogs, an owl and water around it, placed in space around the camera; the owl and the deer
// that src/features/life shows, calling from where they are; the Bear's growl and its grunt at a tail slap (src/features/bear); the steps and splashes of other players
// (src/features/net); the Old Beaver's murmur (src/features/old-beaver); and a quiet tune that composes itself. With the camera under water all of it is muffled.
// The one sound not made here is the Old Beaver's Voice: the server sends it as ElevenLabs makes it, and it plays through the same mix.
//
// The sky (game.sky, when the sky feature runs) drives the ambience: rain and wind follow its rain and wind, birds
// sing by day and less in rain, frogs at dusk, crickets and the owl at night, the music goes quieter and lower at
// night. Without it the day stays the tuned afternoon.
//
//   createGame(canvas, [create])      starts at once where autoplay is allowed, else with the first key press or click
//
// Follows settings.volume / mute / music, goes quiet while stage.paused. `played` counts every sound started, by
// name (window.audio.played in the game; tools/listen.ts renders the sounds offline). The recipes live in sounds.ts, buses and lasting sounds in mix.ts.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { gait } from "../../anim/index.ts";
import { RUN_SPEED, WALK_SPEED } from "../../contracts.ts";
import type { CreateFeature } from "../../game.ts";
import { findWater, groundAt } from "./ground.ts";
import { carried, createLapping, createMix, createMusic, createNight, createRain, createWind, SPEECH } from "./mix.ts";
import { rand, SOUNDS, type SoundName } from "./sounds.ts";

export const played: Partial<Record<string, number>> = {};

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** What src/features/net shows of another player (window.net.remotes): where its feet are. */
interface Remote { node: TransformNode }

export const create: CreateFeature = (game) => {
  const { stage, world, events, settings, player } = game, motion = player.motion;
  // The pond's level changes (the dam holds water back): the water cells are found again when it has moved.
  let water = findWater(world.heightAt, world.waterLevel), waterAt = world.waterLevel;
  const ground = (x: number, z: number) => {
    if (Math.abs(world.waterLevel - waterAt) > 0.02) { waterAt = world.waterLevel; water = findWater(world.heightAt, waterAt); }
    return groundAt(world.heightAt, world.waterLevel, water, x, z);
  };
  let live: ReturnType<typeof start> | undefined;

  function start() {
    const ctx = new AudioContext({ latencyHint: "interactive" }), mix = createMix(ctx);
    const panner = (out: AudioNode, x: number, y: number, z: number) => {
      const p = new PannerNode(ctx, { panningModel: "equalpower", distanceModel: "inverse", refDistance: 2, rolloffFactor: 1, maxDistance: 60, positionX: x, positionY: y, positionZ: z });
      p.connect(out);
      return p;
    };
    const shore = panner(mix.ambience, 0, world.waterLevel, 0);
    shore.refDistance = 1.5;
    const wind = createWind(ctx, mix.ambience), lapping = createLapping(ctx, shore), music = createMusic(ctx, mix.music);
    const rain = createRain(ctx, mix.ambience, shore), night = createNight(ctx, mix.ambience, shore);
    return { ctx, mix, panner, shore, wind, lapping, music, rain, night, paused: false };
  }

  const apply = () => {
    if (!live) return;
    const { ctx, mix, music, paused } = live, now = ctx.currentTime;
    mix.master.gain.setTargetAtTime(settings.values.mute || paused || new URLSearchParams(location.search).has("mute") ? 0 : settings.values.volume, now, 0.08);
    music.set(settings.values.music, now);
  };
  settings.on(apply);

  const unlock = () => {
    live ??= start();
    if (live.ctx.state !== "running") void live.ctx.resume();
    apply();
  };
  Object.assign(window, { audio: { played } }); // for tools: what has started, by name
  addEventListener("keydown", unlock);
  addEventListener("pointerdown", unlock);
  // Where sound may start without a key press (OBS's browser source), it starts now: the live bot presses no keys.
  // Elsewhere the context stays suspended until the first key press or click resumes it.
  unlock();

  /** When each sound last started: the same sound twice within SAME seconds plays once (a world caught up after a
   *  reconnect replays every bite and stick in one frame; ten bites stacked are just louder). */
  const last: Partial<Record<SoundName, number>> = {}, SAME = 0.05;
  /** Starts a sound at a place in the world (none: not placed, as music is); nothing before the first key press or
   *  while paused. A little ahead of now, so its attack is not already past when the audio thread gets to it. */
  function play(name: SoundName, place: Vector3 | undefined, amount = 1, bus: "steps" | "sfx" | "ambience" | "music" = "sfx", delay = 0) {
    if (!live || live.paused || live.ctx.state !== "running") return;
    const t = live.ctx.currentTime + 0.02 + delay;
    if (Math.abs(t - (last[name] ?? -1)) < SAME) return;
    last[name] = t;
    const out = place ? live.panner(live.mix[bus], place.x, place.y + 0.3, place.z) : live.mix[bus];
    SOUNDS[name](live.ctx, out, t, amount);
    if (bus === "sfx") live.mix.duck(t);
    played[name] = (played[name] ?? 0) + 1;
  }

  events.on("footstep", ({ place, speed }) => {
    if (motion.swimming >= 0.5) return;
    const hard = clamp((speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)), kind = ground(place.x, place.z);
    play(kind === "water" ? "stepWater" : kind === "shore" ? "stepShore" : "stepGrass", place, hard, "steps");
  });
  events.on("jump", ({ place }) => play("jump", place));
  events.on("land", ({ place, speed }) => {
    play("land", place, clamp(speed / 7));
    if (ground(place.x, place.z) === "water") play("stepWater", place, 1, "steps");
  });
  events.on("enterWater", ({ place, speed }) => play("splash", place, clamp(0.3 + speed / 5)));
  events.on("leaveWater", ({ place }) => play("shake", place, 1, "sfx", 0.2));
  // A tail slap, this beaver's or another player's (src/features/net/remote.ts emits theirs).
  // Struck in the air (the leap at the Bear) it meets no ground: silent unless it lands on the Bear (the smack below).
  events.on("tailSlap", ({ place, water, air }) => { if (!air) play(water ? "slap" : "thump", place); });
  events.on("pickup", ({ place }) => play("pickup", place));
  events.on("drop", ({ place }) => play("drop", place));

  // The beaver's work, as the build feature tells it (src/features/build).
  events.on("gnaw", ({ place, progress }) => play("bite", place, progress));
  events.on("munch", ({ place }) => { for (const delay of [0.15, 0.5, 0.85]) play("bite", place, 0, "sfx", delay); }); // munching a mushroom: three soft bites
  events.on("treeFalls", ({ place }) => play("creak", place.add(new Vector3(0, 2, 0))));
  events.on("treeLands", ({ place, speed }) => play("crash", place, clamp(speed / 12)));
  events.on("treeSplits", ({ place }) => play("crack", place));
  events.on("stickPlaced", ({ place }) => play("place", place));
  // The sfx bus, not the music's: these say something happened, so they sound with the music turned off too.
  events.on("damFinished", () => play("fanfare", undefined, 1, "sfx", 0.3));
  events.on("goalDone", () => play("chime", undefined, 1, "sfx", 0.1));
  // Half the dam: a chime on the way, so the long middle of the work has a moment too.
  events.on("stickPlaced", ({ count, total }) => { if (count * 2 === total) play("chime", undefined, 1, "sfx", 0.25); });

  // The Bear growls as it notices the beaver, and grunts when a tail slap lands (src/features/bear).
  events.on("bearNotices", ({ place }) => play("growl", place));
  events.on("bearSlapped", ({ place }) => { play("smack", place); play("grunt", place); });

  // A burning Flag crackles until it is burnt down (src/features/flag).
  let fire: Vector3 | undefined, crackle = 0;
  events.on("flagLit", ({ place }) => { fire = place; crackle = 0; });
  events.on("flagBurnt", () => { fire = undefined; });

  // The Old Beaver murmurs a line from where he sits, one slow syllable a word (src/features/old-beaver). Counted in
  // physics steps, so it stops with the pause; a new line (his closing word, when the beaver walks off) cuts the rest
  // of the one before.
  let murmur: { place: Vector3; left: number; next: number; syllable: number } | undefined;
  // His Voice, where the server says his lines: its sound comes a piece at a time while it is made (src/features/net
  // passes it on) and each piece plays right after the one before, from where he sits, on the same bus as his
  // murmur. A new line, or his falling silent, cuts what is left of it. Not counted in physics steps: a pause makes
  // it silent, as it does all sound, but the line goes on.
  // ElevenLabs sends it at about -26 LUFS. The mix adds about 11 dB to whatever is on the sfx bus (its level, the
  // drive, the volume), so beside him it stands at about -14 LUFS with VOICE_GAIN, a little over the scene. It must
  // stay under the limiter: a louder voice is pressed flat there, and then the limiter, not the distance, sets how
  // loud he is, until far off. How much of it is heard goes by how far the player's beaver is from him, not the
  // camera: the camera stands some metres behind its beaver, on either side of it, and the rules that say when he
  // tells count from the beaver too. It falls as a voice does in the open and is gone just beyond where he stops
  // telling (mix.ts carried); the panner only gives its direction, with the head's own filtering (HRTF), so before,
  // behind and beside differ. With distance the air takes some of its highs (BRIGHT Hz beside him, DULL Hz at the
  // edge of earshot). The ambience and the music step back under it only for a beaver close enough to follow the
  // words: fully within a fifth of earshot, not at all from two fifths on.
  const VOICE_GAIN = 1.2, BRIGHT = 9000, DULL = 3000;
  const voice = {
    place: undefined as Vector3 | undefined, earshot: 0, tail: 0, ducked: false, sources: new Set<AudioBufferSourceNode>(),
    out: undefined as { gain: GainNode; tone: BiquadFilterNode } | undefined,
  };
  /** His voice for a beaver where the player's is now: its level, the Hz the air leaves of it, and how far the
   *  ambience steps back under it (mix.speech's depth). */
  const voiceNow = () => {
    const d = Vector3.Distance(player.node.position, voice.place!), e = voice.earshot;
    return { gain: VOICE_GAIN * carried(d, e), tone: BRIGHT * (DULL / BRIGHT) ** clamp(d / e), depth: SPEECH + (1 - SPEECH) * smooth(0.2 * e, 0.4 * e, d) };
  };
  events.on("oldBeaverSpeaks", ({ place, words, syllable, earshot }) => {
    murmur = words > 0 ? { place, left: words, next: 0, syllable } : undefined;
    for (const source of voice.sources) source.stop();
    voice.sources.clear();
    if (live && voice.ducked) live.mix.speech(live.ctx.currentTime, live.ctx.currentTime); // cut mid-line: the ambience comes back
    Object.assign(voice, { place, earshot, out: undefined, tail: 0, ducked: false });
  });
  events.on("oldBeaverVoice", ({ pcm, rate }) => {
    if (!live || live.paused || live.ctx.state !== "running" || !voice.place) return;
    const { ctx } = live, samples = new Int16Array(pcm), buffer = ctx.createBuffer(1, samples.length, rate), data = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) data[i] = samples[i]! / 32768;
    if (!voice.tail) played.voice = (played.voice ?? 0) + 1; // one per line, as the murmur counts its syllables
    const source = new AudioBufferSourceNode(ctx, { buffer }), at = Math.max(ctx.currentTime + 0.05, voice.tail);
    if (!voice.out) {
      const from = live.panner(live.mix.sfx, voice.place.x, voice.place.y + 0.3, voice.place.z), now = voiceNow();
      Object.assign(from, { panningModel: "HRTF", rolloffFactor: 0 }); // its direction only: its level is `carried`
      const gain = new GainNode(ctx, { gain: now.gain }), tone = new BiquadFilterNode(ctx, { type: "lowpass", frequency: now.tone, Q: 0.5 });
      gain.connect(tone).connect(from);
      voice.out = { gain, tone };
    }
    source.connect(voice.out.gain);
    source.onended = () => voice.sources.delete(source);
    source.start(at);
    voice.tail = at + buffer.duration;
    voice.sources.add(source);
  });

  // Lasting sounds: paddling and the fire's crackle, counted in physics steps so they stop with the pause.
  let stroke = 0;
  const at = player.node.position, camera = stage.camera, forward = new Vector3(), up = new Vector3(), here = new Vector3();
  let bird = rand(2, 6), owl = rand(8, 20);

  // Other players: footsteps from how far their feet move (in the stride the animator uses), a splash when they go in.
  const others = new Map<Remote, { x: number; z: number; steps: number; wet: boolean }>();
  function listenToOthers(dt: number) {
    const remotes = (window as { net?: { remotes?: Map<number, Remote> } }).net?.remotes;
    if (!remotes) return;
    for (const r of others.keys()) if (![...remotes.values()].includes(r)) others.delete(r);
    for (const r of remotes.values()) {
      const p = r.node.position, seen = others.get(r);
      if (!r.node.isEnabled()) continue;
      if (!seen) { others.set(r, { x: p.x, z: p.z, steps: 0, wet: false }); continue; }
      const moved = Math.hypot(p.x - seen.x, p.z - seen.z), speed = dt > 0 ? moved / dt : 0;
      seen.x = p.x; seen.z = p.z;
      const deep = world.waterLevel - world.heightAt(p.x, p.z), wet = deep > 0.35 && p.y < world.waterLevel - 0.1;
      if (wet && !seen.wet) play("splash", p, clamp(0.3 + speed / 5));
      seen.wet = wet;
      if (wet || moved > 2 || p.y > world.heightAt(p.x, p.z) + 0.15) { seen.steps = 0; continue; } // swimming, teleported, in the air
      seen.steps += moved / (gait(speed, 0).cycle / 2);
      if (seen.steps >= 1) {
        seen.steps %= 1;
        const kind = ground(p.x, p.z), hard = clamp((speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED));
        play(kind === "water" ? "stepWater" : kind === "shore" ? "stepShore" : "stepGrass", p, hard, "steps");
      }
    }
  }

  return {
    step(dt) {
      if (murmur && (murmur.next -= dt) <= 0) {
        play("murmur", murmur.place, Math.random(), "sfx", rand(0, 0.06));
        murmur.next += murmur.syllable;
        if (--murmur.left <= 0) murmur = undefined;
      }
      if (motion.swimming >= 0.5) {
        stroke += dt * (0.9 + 1.4 * Math.min(1, motion.speed));
        if (stroke >= 1) { stroke = 0; play("paddle", at, clamp(motion.speed / 1.2)); }
      } else stroke = 0.6;
      if (fire && (crackle -= dt) <= 0) { crackle = rand(0.25, 0.5); play("crackle", fire, Math.random(), "ambience"); }
    },
    update(dt) {
      if (!live) return;
      const { ctx, shore, wind, lapping, music, rain, night } = live, now = ctx.currentTime;
      if (live.paused !== stage.paused) { live.paused = stage.paused; apply(); }
      here.copyFrom(camera.position);
      forward.copyFrom(camera.getForwardRay().direction);
      up.copyFrom(camera.getDirection(Vector3.Up()));
      const l = ctx.listener;
      if (l.positionX) {
        l.positionX.value = here.x; l.positionY.value = here.y; l.positionZ.value = here.z;
        l.forwardX.value = forward.x; l.forwardY.value = forward.y; l.forwardZ.value = forward.z;
        l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
      } else {
        l.setPosition(here.x, here.y, here.z);
        l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
      }
      if (live.paused) return;
      // His Voice while he speaks: its level, its highs and how far the ambience steps back follow the beaver.
      if (voice.out && voice.place && voice.tail > now) {
        const heard = voiceNow();
        voice.out.gain.gain.setTargetAtTime(heard.gain, now, 0.08);
        voice.out.tone.frequency.setTargetAtTime(heard.tone, now, 0.1);
        // Only a page whose beaver is close steps its ambience back; one that has walked off gives it back at once.
        const close = heard.depth < 1;
        if (close || voice.ducked) live.mix.speech(now, close ? voice.tail : now, heard.depth);
        voice.ducked = close;
      }
      // The camera under the pond's surface (as src/features/post/underwater.ts finds it): everything muffled, the
      // pond humming; a tail slap on the surface comes down as a thump.
      live.mix.under(here.y < world.waterLevel && world.heightAt(here.x, here.z) < world.waterLevel, now);
      const pond = water.nearest(here.x, here.z);
      shore.positionX.value = pond.x;
      shore.positionY.value = world.waterLevel;
      shore.positionZ.value = pond.z;
      // The sky as it is now; without the sky feature the tuned afternoon, fair and in a light breeze.
      const sky = game.sky, dark = sky?.dark ?? 0, wet = sky?.rain ?? 0, evening = (sky?.hour ?? 16) > 12;
      wind.update(now, sky?.wind ?? 0.25);
      lapping.update(now);
      rain.update(now, wet, 1 - smooth(4, 25, pond.distance));
      // Crickets as the dark comes, fewer in rain; frogs at dusk (and in the evening's first dark), more by the pond.
      night.update(now, smooth(0.4, 0.85, dark) * (1 - 0.7 * wet), evening ? Math.sin(Math.PI * smooth(0.15, 0.95, dark)) * (1 - 0.5 * wet) : 0);
      music.night(dark, now);
      music.update(now);
      // Birds now and then, somewhere around and above, by day and fewer in rain; sometimes a second one answers.
      const birds = (1 - smooth(0.2, 0.6, dark)) * (1 - 0.8 * wet);
      if ((bird -= dt * birds) <= 0) {
        bird = rand(4, 11);
        for (let i = 0, n = Math.random() < 0.4 * birds ? 2 : 1; i < n; i++) {
          const angle = rand(0, Math.PI * 2), distance = rand(8, 18);
          const place = new Vector3(here.x + Math.cos(angle) * distance, here.y + rand(3, 7), here.z + Math.sin(angle) * distance);
          play("bird", place, Math.random(), "ambience", i * rand(0.8, 1.6));
        }
      }
      // An owl now and then in the deep night, far off in the trees.
      if ((owl -= dt * smooth(0.6, 0.9, dark) * (1 - 0.6 * wet)) <= 0) {
        owl = rand(15, 40);
        const angle = rand(0, Math.PI * 2), distance = rand(14, 24);
        play("owl", new Vector3(here.x + Math.cos(angle) * distance, here.y + rand(4, 8), here.z + Math.sin(angle) * distance), 1, "ambience");
      }
      // The larger animals call from where they are (src/features/life): the owl on its branch, a deer bounding off.
      const heard = (window as { life?: { heard?: { name: "owl" | "deer"; x: number; y: number; z: number }[] } }).life?.heard;
      for (let call = heard?.shift(); call; call = heard!.shift()) play(call.name, new Vector3(call.x, call.y, call.z), 1, "ambience");
      listenToOthers(dt);
    },
  };
};
