import { hex } from "../../world/color.ts";
// The day's numbers and the weather's rules: the tuned afternoon at the start, a believable sun, no jumps.
import { describe, expect, test } from "bun:test";
import { ENVIRONMENT, EXPOSURE, SUN_COLOR, SUN_DIRECTION, SUN_INTENSITY } from "../../light.ts";
import { dayAt, START } from "./clock.ts";
import { newClock } from "./day.ts";
import { holdWeather, newWeather, nextKind, stepWeather } from "./weather.ts";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";

const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe("clock", () => {
  test("at the start hour the light is daylight()'s own", () => {
    const day = dayAt(START);
    expect(Vector3.Distance(day.light, SUN_DIRECTION)).toBeLessThan(1e-6);
    expect(day.intensity).toBeCloseTo(SUN_INTENSITY, 6);
    expect(day.exposure).toBeCloseTo(EXPOSURE, 6);
    expect(day.environment).toBeCloseTo(ENVIRONMENT, 6);
    expect(day.color.toHexString()).toBe(hex(SUN_COLOR).toHexString());
    expect(day.night).toBe(0);
    expect(day.mist).toBe(0);
  });
  test("the sun rises before six, sets after eight, stands highest at one", () => {
    const up = (h: number) => dayAt(h).sunHeight;
    expect(up(5.7)).toBeLessThan(0);
    expect(up(6)).toBeGreaterThan(0);
    expect(up(20)).toBeGreaterThan(0);
    expect(up(20.3)).toBeLessThan(0);
    expect(up(13)).toBeGreaterThan(up(12));
    expect(up(13)).toBeGreaterThan(up(14));
    expect(up(1)).toBeLessThan(-10);
  });
  test("the moon is up in the night and lights it", () => {
    const night = dayAt(1);
    expect(night.moonHeight).toBeGreaterThan(30);
    expect(night.intensity).toBeGreaterThan(0.3);
    expect(night.light.y).toBeLessThan(0);
    expect(night.night).toBe(1);
    expect(night.dark).toBe(1);
  });
  test("the moon stands high over the evening and lights the whole night from above", () => {
    for (const h of [21, 23, 1, 3]) {
      const night = dayAt(h);
      expect(night.moonHeight).toBeGreaterThan(20);
      expect(night.intensity).toBeGreaterThan(1);
      expect(Vector3.Distance(night.light, night.moon.negate())).toBeLessThan(1e-6);
    }
    expect(dayAt(5.6).moonHeight).toBeGreaterThan(0); // still up when the sun takes over
  });
  test("the eye opens up at night: no dark gap at dusk, night not a dimmed day", () => {
    expect(dayAt(23).exposure / dayAt(START).exposure).toBeGreaterThan(2.5);
    // From the golden hour into the night the exposure only grows, and the moon is full once the sky is.
    for (let m = 18 * 60; m < 22 * 60; m++) {
      const a = dayAt(m / 60), b = dayAt((m + 1) / 60);
      expect(b.exposure).toBeGreaterThanOrEqual(a.exposure);
      if (a.night === 1) expect(a.intensity).toBeGreaterThan(1);
    }
  });
  test("no jumps from minute to minute", () => {
    for (let m = 0; m < 24 * 60; m++) {
      const a = dayAt(m / 60), b = dayAt((m + 1) / 60);
      expect(Math.abs(a.intensity - b.intensity)).toBeLessThan(0.08);
      expect(Math.abs(a.exposure - b.exposure)).toBeLessThan(0.015);
      expect(Math.abs(a.environment - b.environment)).toBeLessThan(0.05); // half a second of play: a ramp, not a step
      expect(Math.abs(a.night - b.night)).toBeLessThan(0.02);
      // Where the light's direction switches (sun to moon) it is dark.
      if (Vector3.Distance(a.light, b.light) > 0.05) expect(Math.min(a.intensity, b.intensity)).toBeLessThan(0.02);
    }
  });
  test("mist only in the morning", () => {
    expect(dayAt(6.5).mist).toBe(1);
    expect(dayAt(12).mist).toBe(0);
    expect(dayAt(20).mist).toBe(0);
  });
});

describe("the shared day", () => {
  /** A clock on a real time we move by hand (ms). */
  const fake = (hour?: number, speed?: number) => { const real = { now: 0 }; return { real, clock: newClock(hour, speed, true, () => real.now) }; };
  test("alone it starts at 16:00 and runs one day in 720 s of play, faster with speed", () => {
    const { clock } = fake();
    expect(clock.hour).toBe(16);
    for (let i = 0; i < 300; i++) clock.step(1);
    expect(clock.hour).toBeCloseTo(26 - 24, 9);
    const fast = fake(16, 4).clock;
    fast.step(30);
    expect(fast.hour).toBeCloseTo(20, 9);
  });
  test("following, the hour is the given one plus the real time since, whatever the game steps or its speed", () => {
    const { clock, real } = fake(13, 4);
    clock.follow(23);
    expect(clock.hour).toBe(23);
    clock.step(30); // play at 4x: would be two hours on its own
    expect(clock.hour).toBe(23);
    real.now += 60_000; // a minute of real time: two hours, past midnight
    expect(clock.hour).toBeCloseTo(1, 9);
    real.now += 600_000; // a hidden tab or a paused game: no steps at all
    expect(clock.hour).toBeCloseTo(21, 9);
  });
  test("alone again it runs on from where it was; setHour and a stopped clock end following", () => {
    const { clock, real } = fake();
    clock.follow(23);
    real.now += 30_000;
    clock.alone();
    expect(clock.hour).toBeCloseTo(0, 9);
    real.now += 600_000;
    expect(clock.hour).toBeCloseTo(0, 9); // real time no longer counts
    clock.step(30);
    expect(clock.hour).toBeCloseTo(1, 9);

    clock.follow(5);
    clock.setHour(12);
    real.now += 60_000;
    expect(clock.hour).toBe(12);

    clock.follow(5);
    real.now += 30_000;
    clock.running = false;
    real.now += 60_000;
    clock.step(30);
    expect(clock.hour).toBeCloseTo(6, 9);
  });
});

describe("weather", () => {
  test("starts fair and stays fair for a while", () => {
    const w = newWeather(), random = seeded(1);
    for (let t = 0; t < 200; t += 0.1) stepWeather(w, 0.1, random);
    expect(w.kind).toBe("fair");
    expect(w.clouds).toBe(0);
  });
  test("rain follows only clouds, fog only fair weather", () => {
    const random = seeded(7);
    for (let i = 0; i < 500; i++) {
      expect(nextKind("fair", random)).not.toBe("rain");
      expect(nextKind("fog", random)).toBe("fair");
      expect(nextKind("rain", random)).toBe("cloudy");
    }
  });
  test("clouds close before rain falls, rain stops before they break, ground dries slowly", () => {
    const w = holdWeather(newWeather(), "fair");
    holdWeather(w, "fair").kind = "rain";
    let rainedAt = -1, t = 0;
    for (; t < 200; t += 0.1) {
      stepWeather(w, 0.1, Math.random);
      if (w.rain > 0 && rainedAt < 0) { rainedAt = t; expect(w.clouds).toBeGreaterThan(0.85); }
    }
    expect(w.rain).toBe(1);
    expect(w.wet).toBe(1);
    w.kind = "fair";
    for (let s = 0; s < 30; s += 0.1) {
      stepWeather(w, 0.1, Math.random);
      expect(w.clouds).toBeGreaterThanOrEqual(Math.min(1, w.rain * 3) - 1e-9);
    }
    expect(w.rain).toBe(0);
    expect(w.wet).toBeGreaterThan(0.7);
  });
  test("runs through every kind over a long time", () => {
    const w = newWeather(), random = seeded(3), seen = new Set<string>();
    for (let t = 0; t < 4 * 3600; t += 0.5) { stepWeather(w, 0.5, random); seen.add(w.kind); }
    expect([...seen].sort()).toEqual(["cloudy", "fair", "fog", "rain"]);
  });
});
