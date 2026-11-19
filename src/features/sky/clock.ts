import { hex } from "../../world/color.ts";
// The day by the hour, as plain numbers: where sun and moon stand, and what light, exposure and sky fill that
// makes. No scene here, so the tests can check it.
//
//   const day = dayAt(19.5);    day.sun / day.moon (unit vectors towards them), day.light (the way the light
//                               travels), day.intensity, day.color, day.exposure, day.environment, day.night, …
//
// The sun runs on a summer day at 45° north with summer time (highest at 13:00); its declination is chosen so that
// at START (16:00) it stands exactly where src/light.ts has always put it, and the whole path is turned so its
// compass direction matches too. Everything else is read from tables over the sun's height, so morning and evening
// mirror each other; at START every value is the one daylight() starts with.
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { ENVIRONMENT, EXPOSURE, SUN_COLOR, SUN_DIRECTION, SUN_INTENSITY } from "../../light.ts";

import { START } from "./day.ts";
export { DAY_SECONDS, START } from "./day.ts";
const DEG = Math.PI / 180, LATITUDE = 45 * DEG, NOON = 13;
const MOON_DECLINATION = 12 * DEG, MOON_NOON = 23.5; // highest at half past eleven, about 57° up: high over the evening, low by dawn

/** Unit vector to a body at this hour: x east, y up, z north, before the path is turned. */
function local(hour: number, declination: number, noon: number, out = new Vector3()) {
  const h = ((hour - noon) / 24) * Math.PI * 2;
  return out.set(
    -Math.cos(declination) * Math.sin(h),
    Math.sin(LATITUDE) * Math.sin(declination) + Math.cos(LATITUDE) * Math.cos(declination) * Math.cos(h),
    Math.cos(LATITUDE) * Math.sin(declination) - Math.sin(LATITUDE) * Math.cos(declination) * Math.cos(h),
  ).normalize();
}

// The sun's declination that puts it at the old height at START (bisection; the height grows with it).
const towardsSun = SUN_DIRECTION.clone().negate();
let low = 0, high = 40 * DEG;
for (let i = 0; i < 60; i++) {
  const mid = (low + high) / 2;
  if (local(START, mid, NOON).y < towardsSun.y) low = mid; else high = mid;
}
const DECLINATION = (low + high) / 2;
const atStart = local(START, DECLINATION, NOON);
const TURN = Math.atan2(towardsSun.x, towardsSun.z) - Math.atan2(atStart.x, atStart.z);
const compass = Quaternion.RotationAxis(Vector3.Up(), TURN);

export const sunAt = (hour: number, out = new Vector3()) => local(hour, DECLINATION, NOON, out).applyRotationQuaternionInPlace(compass);
export const moonAt = (hour: number, out = new Vector3()) => local(hour, MOON_DECLINATION, MOON_NOON, out).applyRotationQuaternionInPlace(compass);

/** Piecewise linear over sorted keys. */
function table(keys: number[], values: number[]) {
  return (x: number) => {
    if (x <= keys[0]!) return values[0]!;
    for (let i = 1; i < keys.length; i++) if (x <= keys[i]!) {
      const t = (x - keys[i - 1]!) / (keys[i]! - keys[i - 1]!);
      return values[i - 1]! + (values[i]! - values[i - 1]!) * t;
    }
    return values[values.length - 1]!;
  };
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const START_HEIGHT = Math.asin(towardsSun.y) / DEG; // 42.7°
// Over the sun's height in degrees. The column at START_HEIGHT holds daylight()'s own values.
const H = [-18, -10, -5, -1, 0, 3, 8, 15, 25, START_HEIGHT, 90];
const sunIntensity = table(H, [0, 0, 0, 0, 0.35, 1.4, 2.5, 3.3, 3.85, SUN_INTENSITY, 4.5]);
// The eye opens up fully by the end of the blue hour, so the hand-over from sun to moon has no dark gap.
const exposure = table(H, [1.4, 1.36, 1.2, 0.94, 0.86, 0.72, 0.66, 0.58, 0.52, EXPOSURE, 0.48]);
const environment = table(H, [2.4, 2.4, 2.0, 1.45, 1.15, 0.8, 0.52, 0.4, 0.36, ENVIRONMENT, 0.35]);
const SUN_COLORS: [number, Color3][] = [
  [0, hex(0xff7034)], [3, hex(0xff9455)], [8, hex(0xffb47a)], [15, hex(0xffcc96)],
  [25, hex(0xffe2b8)], [START_HEIGHT, hex(SUN_COLOR)], [90, hex(0xfff6e6)],
];
const MOON_LIGHT = new Color3(0.55, 0.68, 1.0), MOON_INTENSITY = 1.1;

function sunColor(height: number, out: Color3) {
  if (height <= SUN_COLORS[0]![0]) return out.copyFrom(SUN_COLORS[0]![1]);
  for (let i = 1; i < SUN_COLORS.length; i++) {
    const [h, c] = SUN_COLORS[i]!, [h0, c0] = SUN_COLORS[i - 1]!;
    if (height <= h) return Color3.LerpToRef(c0, c, (height - h0) / (h - h0), out);
  }
  return out.copyFrom(SUN_COLORS[SUN_COLORS.length - 1]![1]);
}

export interface Day {
  hour: number;
  /** Unit vectors towards sun and moon. */
  sun: Vector3; moon: Vector3;
  /** Heights above the horizon, degrees. */
  sunHeight: number; moonHeight: number;
  /** The way the one shadow-casting light travels: from the sun while it is up, from the moon at night. */
  light: Vector3;
  /** That light's colour and strength (before weather). */
  color: Color3; intensity: number;
  exposure: number;
  /** scene.environmentIntensity: how strongly the sky fills the shadows. */
  environment: number;
  /** 0 by day … 1 in full night: how much of the night sky (dark blue, stars, moon) is drawn. */
  night: number;
  /** 0 … 1, how dark it is for others (sound, animals): 0 in daylight, 1 deep in the night. */
  dark: number;
  /** 0 … 1: the low warm sun of morning and evening. */
  golden: number;
  /** 0 … 1: mist over the pond, at dawn and in the early morning. */
  mist: number;
  /** 0 … 1: the blue hour, the sun just under the horizon; the sky is still much brighter than at night. */
  twilight: number;
}

export function dayAt(hourOfDay: number): Day {
  const hour = ((hourOfDay % 24) + 24) % 24;
  const sun = sunAt(hour), moon = moonAt(hour);
  const sunHeight = Math.asin(sun.y) / DEG, moonHeight = Math.asin(moon.y) / DEG;
  const color = new Color3(), moonUp = smooth(-1, 8, moonHeight) * smooth(-1, -5, sunHeight);
  let intensity = sunIntensity(sunHeight), light: Vector3;
  // The light switches from sun to moon while both are at nothing (the sun just under the horizon), so the
  // shadows never jump.
  if (sunHeight > -1) { light = sun.clone().negate(); sunColor(sunHeight, color); }
  else { light = moon.clone().negate(); color.copyFrom(MOON_LIGHT); intensity = MOON_INTENSITY * moonUp; }
  const night = 1 - smooth(-8, 4, sunHeight); // the blue hour starts before the sun is gone
  const mist = smooth(4.3, 5.8, hour) * (1 - smooth(7.5, 9.8, hour));
  return {
    hour, sun, moon, sunHeight, moonHeight, light, color, intensity,
    exposure: exposure(sunHeight), environment: environment(sunHeight), night,
    twilight: smooth(-11, -3, sunHeight) * (1 - smooth(-1, 4, sunHeight)),
    dark: 1 - smooth(-12, 4, sunHeight), golden: smooth(25, 4, sunHeight) * smooth(-4, 1, sunHeight), mist,
  };
}
