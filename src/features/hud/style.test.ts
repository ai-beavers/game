// Tests for style.ts: every element has a home on screen, no two homes overlap, and the type reads on a stream.
import { expect, test } from "bun:test";
import { fitType, homes, layout, unit } from "./style.ts";

const none = { top: 0, right: 0, bottom: 0, left: 0 };
const screens: [number, number][] = [[640, 360], [1280, 720], [1440, 810], [1920, 1080]];
// Phones and touch layouts are not tested automatically.
const modes = [{ touch: false, live: false }, { touch: false, live: true }];

test("the type grows with a stream's picture and keeps a minimum", () => {
  expect(unit(1366, 772, true)).toBe(17); // the stream's main view
  expect(unit(1920, 1080, true)).toBe(24);
  expect(unit(640, 360, true)).toBe(12);
  expect(unit(1280, 720, false)).toBe(16);
  expect(unit(3840, 2160, false)).toBe(18);
});

for (const [w, h] of screens) for (const mode of modes) {
  test(`${w}x${h} ${mode.live ? "live" : "desktop"}: on screen, none over another`, () => {
    const l = layout(w, h, none, mode), all = homes(l);
    for (const [name, b] of all) {
      expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h, `${name} ${JSON.stringify(b)} off screen`).toBe(true);
    }
    for (const [i, [a, p]] of all.entries()) for (const [b, q] of all.slice(i + 1)) {
      const over = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
      expect(over, `${a} ${JSON.stringify(p)} lies on ${b} ${JSON.stringify(q)}`).toBe(false);
    }
    expect(l.middle.top < l.middle.bottom, "no middle left free").toBe(true);
  });
}

test("live shows nothing to press: no pause, no chat", () => {
  const l = layout(1440, 810, none, { touch: false, live: true });
  expect(l.pause).toBeUndefined();
  expect(l.chatRow.h).toBe(0);
  expect(l.map!.w).toBeGreaterThan(150);
  expect(layout(640, 360, none, { touch: false, live: true }).map).toBeUndefined();
});

test("the hints sit low, under the middle of the picture, over the prompt and the hotbar", () => {
  const l = layout(1280, 720, none, { touch: false, live: false });
  expect(l.hints.y).toBeGreaterThan(720 * 0.7);
  expect(l.hints.x + l.hints.w / 2).toBe(640);
  expect(l.prompt.y + l.prompt.h).toBeLessThanOrEqual(l.hotbar.y);
  expect(Math.abs(l.hotbar.x + l.hotbar.w / 2 - 640)).toBeLessThanOrEqual(1); // on whole pixels
  expect(l.hotbar.w).toBeGreaterThanOrEqual(5 * l.slot);
  expect(l.hotbar.y + l.hotbar.h).toBe(720 - 12); // on the bottom margin
});

test("the Old Beaver's speech box sits over the hints, sharing the breath's home, with room for his name and a line", () => {
  const phones: [number, number][] = [[390, 844], [844, 390]], cases = [...screens.flatMap(([w, h]) => modes.map((mode) => ({ w, h, mode }))),
    ...phones.flatMap(([w, h]) => [{ touch: false, live: false }, { touch: true, live: false }].map((mode) => ({ w, h, mode })))];
  for (const { w, h, mode } of cases) {
    const l = layout(w, h, none, mode), at = `${w}x${h} ${JSON.stringify(mode)}`;
    expect(l.speech.y + l.speech.h, at).toBe(l.breath.y + l.breath.h);
    expect(l.speech.y + l.speech.h, at).toBeLessThanOrEqual(l.hints.y);
    expect(l.speech.x, at).toBe(l.hints.x);
    expect(l.speech.h, at).toBeGreaterThanOrEqual(l.small * 1.3 + l.u * 1.3);
    expect(l.middle.top < l.middle.bottom, at).toBe(true);
  }
});

test("a line too long for its row gets smaller type, down to a limit", () => {
  expect(fitType(24, 800, 30)).toBe(24); // fits as it is
  const long = fitType(24, 600, 55);
  expect(long).toBeLessThan(24);
  expect(long * 0.58 * 55).toBeLessThanOrEqual(600 - 24); // on the one row
  expect(fitType(24, 300, 55)).toBe(Math.floor(0.7 * 24)); // never smaller than this: it wraps instead
});
