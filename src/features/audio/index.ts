// Sound for the game, all synthesised with Web Audio: the beaver's steps, jumps, splashes, tail slaps, swimming and work (bites,
// a tree creaking, crashing and cracking, sticks knocked into the dam, a fanfare when it holds, a chime per goal); wind,
// rain, birds, crickets, frogs, an owl and water around it, placed in space around the camera; the steps and splashes of
// other players (src/features/net); and a quiet tune that composes itself.
//
// The sky (game.sky, when the sky feature runs) drives the ambience: rain and wind follow its rain and wind, birds
// sing by day and less in rain, frogs at dusk, crickets and the owl at night, the music goes quieter and lower at
// night. Without it the day stays the tuned afternoon.
//
//   createGame(canvas, [create])      starts with the first key press or click (browsers allow sound only then)
//
// Follows settings.volume / mute / music, goes quiet while stage.paused. `played` counts every sound started, by
// name (lab/audio.ts reads it; window.audio.played in the game). The recipes live in sounds.ts, buses and lasting sounds in mix.ts.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { gait } from "../../anim/index.ts";
import { RUN_SPEED, WALK_SPEED } from "../../contracts.ts";
import type { CreateFeature } from "../../game.ts";
import { findWater, groundAt } from "./ground.ts";
import { createLapping, createMix, createMusic, createNight, createRain, createWind } from "./mix.ts";
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
    mix.master.gain.setTargetAtTime(settings.values.mute || paused ? 0 : settings.values.volume, now, 0.08);
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

  /** Starts a sound at a place in the world (none: not placed, as music is); nothing before the first key press or
   *  while paused. */
  function play(name: SoundName, place: Vector3 | undefined, amount = 1, bus: "steps" | "sfx" | "ambience" | "music" = "sfx", delay = 0) {
    if (!live || live.paused || live.ctx.state !== "running") return;
    const out = place ? live.panner(live.mix[bus], place.x, place.y + 0.3, place.z) : live.mix[bus];
    SOUNDS[name](live.ctx, out, live.ctx.currentTime + delay, amount);
    if (bus === "sfx") live.mix.duck(live.ctx.currentTime + delay);
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
  events.on("tailSlap", ({ place, water }) => play(water ? "slap" : "thump", place));
  events.on("pickup", ({ place }) => play("pickup", place));
  events.on("drop", ({ place }) => play("drop", place));

  // The beaver's work, as the build feature tells it (src/features/build).
  events.on("gnaw", ({ place, progress }) => play("bite", place, progress));
  events.on("treeFalls", ({ place }) => play("creak", place.add(new Vector3(0, 2, 0))));
  events.on("treeLands", ({ place, speed }) => play("crash", place, clamp(speed / 12)));
  events.on("treeSplits", ({ place }) => play("crack", place));
  events.on("stickPlaced", ({ place }) => play("place", place));
  // The sfx bus, not the music's: these say something happened, so they sound with the music turned off too.
  events.on("damFinished", () => play("fanfare", undefined, 1, "sfx", 0.3));
  events.on("goalDone", () => play("chime", undefined, 1, "sfx", 0.1));
  // Half the dam: a chime on the way, so the long middle of the work has a moment too.
  events.on("stickPlaced", ({ count, total }) => { if (count * 2 === total) play("chime", undefined, 1, "sfx", 0.25); });

  // Lasting sounds: paddling, counted in physics steps so it stops with the pause.
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
      if (motion.swimming >= 0.5) {
        stroke += dt * (0.9 + 1.4 * Math.min(1, motion.speed));
        if (stroke >= 1) { stroke = 0; play("paddle", at, clamp(motion.speed / 1.2)); }
      } else stroke = 0.6;
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
      listenToOthers(dt);
    },
  };
};
