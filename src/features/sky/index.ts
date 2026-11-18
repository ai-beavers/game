import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves.js";
import { Scene } from "@babylonjs/core/scene.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Vector2 } from "@babylonjs/core/Maths/math.vector.js";
import type { CreateFeature } from "../../game.ts";
import { daylightOf, EXPOSURE, SKY_FILL, SUN_INTENSITY } from "../../light.ts";
import { waterOf } from "../../world/water.ts";
import { DAY_SECONDS, dayAt, START } from "./clock.ts";
import { createDome } from "./dome.ts";
import { makeFireflies, makeMist, makeRain } from "./effects.ts";
import { holdWeather, KINDS, newWeather, releaseWeather, stepWeather, type Kind } from "./weather.ts";

export interface SkyState {
  hour: number; dark: number; weather: Kind; clouds: number; rain: number; fog: number; wind: number; wet: number;
  running: boolean;
  speed: number;
  setHour(hour: number): void;
  setWeather(kind: Kind | "auto"): void;
}

const WHITE = Color3.White();
const DAY_HORIZON = new Color3(0.76, 0.86, 0.92), DUSK = new Color3(0.99, 0.61, 0.41);
const NIGHT = new Color3(0.054, 0.079, 0.155), GREY = new Color3(0.53, 0.59, 0.65), MOONLIT = new Color3(0.46, 0.58, 0.95);

export const create: CreateFeature = game => {
  const { scene } = game.stage;
  const light = daylightOf(scene);
  if (!light) return {};
  const { sun, sky } = light;
  const params = new URLSearchParams(location.search);
  const hour = Number(params.get("hour") ?? START), speed = Number(params.get("speed") ?? 1);
  const weather = newWeather(), held = params.get("weather") as Kind | null;
  if (held && KINDS.includes(held)) holdWeather(weather, held);
  const state: SkyState = {
    hour: Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : START,
    speed: Number.isFinite(speed) && speed >= 0 ? speed : 1,
    running: params.get("clock") !== "stop", dark: 0, weather: weather.kind,
    clouds: weather.clouds, rain: weather.rain, fog: weather.fog, wind: weather.wind, wet: weather.wet,
    setHour(value) { if (Number.isFinite(value)) state.hour = ((value % 24) + 24) % 24; },
    setWeather(kind) { if (kind === "auto") releaseWeather(weather); else if (KINDS.includes(kind)) holdWeather(weather, kind); },
  };
  game.sky = state;
  Object.assign(window, { sky: state });

  const water = waterOf(scene), rain = makeRain(scene), mist = makeMist(scene), fireflies = makeFireflies(scene), dome = createDome(scene);
  const ground = scene.getMeshByName("ground")?.material;
  const dry = ground instanceof StandardMaterial ? ground.diffuseColor.clone() : null;
  const horizon = new Color3(), wind = new Vector2();
  scene.fogMode = Scene.FOGMODE_EXP2;
  const grade = scene.imageProcessingConfiguration, curves = new ColorCurves();
  curves.shadowsHue = curves.midtonesHue = 228;
  grade.colorCurves = curves;
  grade.colorCurvesEnabled = true; // on all day (neutral by day), so the shader never recompiles at dusk
  let time = 0;
  function update() {
    const day = dayAt(state.hour), { clouds, fog, wet } = weather;
    Color3.LerpToRef(DAY_HORIZON, DUSK, day.golden, horizon);
    Color3.LerpToRef(horizon, GREY, Math.min(1, clouds * 0.8 + fog * 0.45), horizon);
    Color3.LerpToRef(horizon, NIGHT, day.night, horizon);
    dome(day, horizon, clouds, time);
    scene.fogColor.copyFrom(horizon);
    scene.fogDensity = 0.012 + fog * 0.058 + weather.rain * 0.012 + day.mist * 0.006;
    sun.direction.copyFrom(day.light);
    sun.diffuse.copyFrom(day.color);
    sun.intensity = day.intensity / SUN_INTENSITY * 1.6 * (1 - clouds * 0.77) * (1 - fog * 0.35);
    sky.intensity = (1.15 - day.night * 0.75) * (1 - clouds * 0.23);
    Color3.LerpToRef(WHITE, MOONLIT, day.night, sky.diffuse); // a cool floor: at night nothing sinks into black
    grade.exposure = day.exposure / EXPOSURE; // the eye opens up as it gets dark
    // and sees less colour, more blue, under the moon; the highlights keep theirs, so warm points stay warm.
    curves.shadowsSaturation = curves.midtonesSaturation = -30 * day.night;
    curves.shadowsDensity = 100 * day.night;
    curves.midtonesDensity = 90 * day.night;
    sky.diffuse.scaleInPlace(1 - (1 - SKY_FILL) * (1 - day.night) * (1 - clouds)); // room for the sun's shadows by day
    if (water) Object.assign(water.sky, { rain: weather.rain, clouds, night: day.night });
    if (dry && ground instanceof StandardMaterial) {
      dry.scaleToRef(1 - wet * 0.32, ground.diffuseColor);
      ground.specularColor.setAll(0.06 + wet * 0.2);
    }
    wind.set(0.8, 0.45).scaleInPlace(0.5 + 4 * weather.wind);
    rain(time, weather.rain, wind, (scene.activeCamera ?? game.stage.camera).position, horizon);
    mist(time, Math.min(1, day.mist + fog * 0.45), game.world.waterLevel, horizon);
    fireflies(time, day.dark * (1 - weather.rain) * (1 - fog * 0.7), game.world.waterLevel);
    Object.assign(state, { dark: day.dark, weather: weather.kind, clouds, fog, rain: weather.rain, wind: weather.wind, wet });
  }
  update();
  return {
    step(dt) {
      time += dt;
      if (state.running) state.hour = (state.hour + dt * 24 * state.speed / DAY_SECONDS) % 24;
      stepWeather(weather, dt, Math.random);
    },
    update,
  };
};
