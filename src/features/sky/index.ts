// The sky that changes: a day that passes in twelve minutes of play (from the tuned afternoon through evening,
// night and morning) and weather that comes and goes by itself (fair, cloudy, rain, fog). It drives the one
// daylight (src/light.ts), the haze and clouds (src/world/sky.ts) and the pond (src/world/water.ts), and adds rain,
// morning mist and fireflies (effects.ts).
//
//   createGame(canvas, [sky])         the feature; everything else in the game keeps working without it
//   game.sky.hour                     0 … 24, now
//   game.sky.dark                     0 … 1, how dark it is (0 day, 1 deep night): for owls, crickets, animals
//   game.sky.weather                  "fair" | "cloudy" | "rain" | "fog", the spell now (or coming)
//   game.sky.rain / clouds / fog / wind / wet     0 … 1 each, how strong now
//   game.sky.setHour(19.5)   game.sky.setWeather("rain" | "auto")   game.sky.running = false
//
// Address parameters: ?hour=19.5 starts there; ?weather=rain holds a spell; ?clock=stop holds the hour;
// ?speed=10 runs the day ten times faster. All of it stands still while stage.paused.
//
// Cost: the environment (sky drawn into a cube, then filtered by PMREM) is made anew every ENV_EVERY seconds and
// the haze read back from it then; the rest is a few uniforms a frame. See the report in lab/sky.ts.
import * as THREE from "three";
import type { CreateFeature, Game } from "../../game.ts";
import { daylightOf, ENVIRONMENT, SUN_INTENSITY } from "../../light.ts";
import { airOf } from "../../world/sky.ts";
import { waterOf } from "../../world/water.ts";
import { DAY_SECONDS, dayAt, START, type Day } from "./clock.ts";
import { makeFireflies, makeMist, makeRain } from "./effects.ts";
import { horizonReader } from "./haze.ts";
import { holdWeather, KINDS, newWeather, releaseWeather, stepWeather, type Kind } from "./weather.ts";

const ENV_EVERY = 0.5; // seconds between new environments
const HAZE_DENSITY = 0.011; // scene.fog's density in the tuned afternoon
const NIGHT_SKY = new THREE.Color(0.011, 0.025, 0.075); // radiance of the night sky at the horizon, linear
const WATER_ENV = 0.26; // the pond's own envMapIntensity at ENVIRONMENT

export interface SkyState {
  hour: number; dark: number; weather: Kind; clouds: number; rain: number; fog: number; wind: number; wet: number;
  /** false: the hour stands still. */
  running: boolean;
  /** Days run this many times faster than DAY_SECONDS. */
  speed: number;
  setHour(hour: number): void;
  /** A spell held from now on, or "auto" to let the weather go its own way again. */
  setWeather(kind: Kind | "auto"): void;
  /** Milliseconds the last new environment took on the CPU side (the GPU work runs behind it). */
  envMs: number;
  /** Milliseconds a frame of this feature takes on the CPU, averaged (new environments included). */
  frameMs: number;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const create: CreateFeature = (game: Game) => {
  const { scene, renderer, camera } = game.stage;
  const light = daylightOf(scene), air = airOf(scene), water = waterOf(scene);
  if (!light) return {};
  const params = new URLSearchParams(location.search);
  const haze = horizonReader(light);
  haze.read(renderer); // the tuned afternoon, before anything changes: the haze's calibration
  const rain = makeRain(scene), mist = makeMist(scene), flies = makeFireflies(scene);

  const weather = newWeather();
  const held = params.get("weather") as Kind | null;
  if (held && KINDS.includes(held)) holdWeather(weather, held);
  const state: SkyState = {
    hour: Number(params.get("hour") ?? START), dark: 0, weather: weather.kind, clouds: 0, rain: 0, fog: 0, wind: 0, wet: 0,
    running: params.get("clock") !== "stop", speed: Number(params.get("speed") ?? 1), envMs: 0, frameMs: 0,
    setHour(hour) { state.hour = ((hour % 24) + 24) % 24; sinceEnv = ENV_EVERY; },
    setWeather(kind) { if (kind === "auto") releaseWeather(weather); else holdWeather(weather, kind); sinceEnv = ENV_EVERY; },
  };
  Object.assign(game, { sky: state });
  Object.assign(window, { sky: state });

  // Wet ground: the world's own vertex-coloured materials (ground, grass, trees, rocks) darken and shine a little.
  const wettable: { material: THREE.MeshStandardMaterial; color: THREE.Color; roughness: number }[] = [];
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m || Array.isArray(m) || !m.isMeshStandardMaterial || (m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial || !m.vertexColors) return;
    if (!wettable.some((w) => w.material === m)) wettable.push({ material: m, color: m.color.clone(), roughness: m.roughness });
  });

  const random = Math.random, wind = new THREE.Vector2(), fogColor = new THREE.Color(), tint = new THREE.Color();
  const overcastColor = new THREE.Color(), forward = new THREE.Vector3(), white = new THREE.Color(1, 1, 1);
  let time = 0, sinceEnv = ENV_EVERY, day: Day = dayAt(state.hour), lastWet = -1;

  const apply = () => {
    day = dayAt(state.hour);
    const { clouds, fog } = weather, showers = weather.rain;
    const lit = Math.min(1, day.intensity / SUN_INTENSITY) * (day.sunHeight > -1 ? 1 : 0); // sunlight, not moon
    // The sun and moon: dimmer under clouds and in fog.
    const cover = smooth(0.3, 1, clouds);
    light.sun.color.copy(day.color).lerp(white, cover * 0.5);
    light.sun.intensity = day.intensity * (1 - 0.82 * cover) * (1 - 0.5 * fog);
    light.towards.copy(day.light);
    light.follow(light.place);
    renderer.toneMappingExposure = day.exposure * (1 + (0.12 + 0.33 * (1 - day.night)) * cover + 0.06 * fog); // by day the eye opens up under a grey sky
    scene.environmentIntensity = day.environment * (1 + (0.5 + 1.1 * (1 - day.night)) * cover); // under clouds the light comes from all of the sky
    if (water) water.material.envMapIntensity = WATER_ENV * scene.environmentIntensity / ENVIRONMENT;

    // The sky dome.
    const u = light.air;
    u.sunPosition!.value.copy(day.sun);
    u.moonPosition!.value.copy(day.moon);
    u.night!.value = day.night;
    u.nightColor!.value.copy(NIGHT_SKY).multiplyScalar(1 + 2.5 * day.twilight);
    u.cloudCoverage!.value = 0.4 + 0.45 * clouds;
    u.cloudDensity!.value = 0.4 + 0.5 * clouds;
    u.time!.value = time * (0.5 + 2 * weather.wind); // the dome's own clouds drift
    // A grey layer under the clouds, as bright as the light that comes through them.
    overcastColor.setRGB(0.8, 0.85, 0.92).multiplyScalar((0.12 + 0.88 * Math.sqrt(lit)) * (0.12 + 0.88 * smooth(-1, 25, day.sunHeight))).lerp(day.color, 0.15 * lit * day.golden);
    overcastColor.lerp(tint.copy(NIGHT_SKY).multiplyScalar(1.3), day.night);
    u.overcastColor!.value.copy(overcastColor);
    u.overcast!.value = Math.min(1, smooth(0.5, 1, clouds) * 0.92 + fog * 0.75);
    u.stars!.value = 1 - cover;

    // The cloud cards far away: lit by the sun, warm when it is low, dark at night, greyer and thinner in overcast.
    if (air) {
      tint.copy(white).lerp(day.color, 0.6 * day.golden).multiplyScalar(0.06 + 0.94 * Math.sqrt(lit)).lerp(overcastColor.clone().multiplyScalar(2.2), cover);
      for (const card of air.clouds) {
        card.material.color.copy(tint);
        card.material.opacity = 0.85 * (0.35 + 0.65 * Math.sqrt(lit)) * (1 - 0.6 * cover);
      }
    }

    // Haze: thicker in fog, rain and morning mist; its colour is the horizon's, read from the sky.
    camera.getWorldDirection(forward);
    const sideways = (1 - smooth(4, 22, day.sunHeight)) * (1 - day.night) * (1 - cover);
    haze.color(Math.atan2(forward.x, forward.z), renderer.toneMappingExposure, sideways, fogColor);
    if (scene.fog) {
      scene.fog.color.copy(fogColor);
      (scene.fog as THREE.FogExp2).density = HAZE_DENSITY + 0.055 * fog * fog + 0.012 * showers + 0.006 * day.mist;
    }
    if (water) water.rain.value = showers;

    // Wet ground, changed only when it is wetter or drier by a step that cannot be seen.
    if (Math.abs(weather.wet - lastWet) > 0.01) {
      lastWet = weather.wet;
      for (const w of wettable) {
        w.material.color.copy(w.color).multiplyScalar(1 - 0.32 * weather.wet);
        w.material.roughness = w.roughness - (w.roughness - 0.7) * weather.wet; // a little sheen, no glare
      }
    }

    wind.set(0.8, 0.45).multiplyScalar(0.5 + 4 * weather.wind);
        rain.update(time, showers, wind, camera.position, tint.copy(fogColor).multiplyScalar(1.5).addScalar(0.04));
    // Mist is lit from above: lighter than the haze behind it, or it would not be seen against the trees.
    mist.update(time, Math.min(1, day.mist * (1 - 0.7 * weather.wind) + 0.5 * fog), tint.copy(fogColor).multiplyScalar(1.7).addScalar(0.02));
    flies.update(time, smooth(0.35, 0.8, day.dark) * (1 - showers) * (1 - fog * 0.7), renderer.domElement.height);

    Object.assign(state, { dark: day.dark, weather: weather.kind, clouds, rain: showers, fog, wind: weather.wind, wet: weather.wet });
  };

  return {
    step(dt) {
      time += dt;
      if (state.running) state.hour = (state.hour + (dt * 24 * state.speed) / DAY_SECONDS) % 24;
      stepWeather(weather, dt, random);
    },
    update(dt) {
      const start = performance.now();
      apply();
      if (!game.stage.paused) sinceEnv += dt;
      if (sinceEnv >= ENV_EVERY) {
        sinceEnv = 0;
        const t0 = performance.now();
        light.relight();
        haze.read(renderer);
        state.envMs = performance.now() - t0;
      }
      state.frameMs += (performance.now() - start - state.frameMs) * 0.02;
    },
  };
};
