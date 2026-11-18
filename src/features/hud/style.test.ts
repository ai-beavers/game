// Tests for style.ts: every element has a home on screen, no two homes overlap, and the type reads on a stream.
import { expect, test } from "bun:test";
import { homes, layout, unit } from "./style.ts";

const none = { top: 0, right: 0, bottom: 0, left: 0 }, notch = { top: 47, right: 0, bottom: 34, left: 0 };
const screens: [number, number][] = [[640, 360], [1280, 720], [1440, 810], [1920, 1080], [390, 844], [844, 390]];
const modes = [{ touch: false, live: false }, { touch: true, live: false }, { touch: false, live: true }];

test("the type grows with a stream's picture and keeps a minimum", () => {
  expect(unit(1440, 810, true)).toBe(24);
  expect(unit(1920, 1080, true)).toBe(32);
  expect(unit(640, 360, true)).toBe(12);
  expect(unit(1280, 720, false)).toBe(16);
  expect(unit(390, 844, false)).toBe(13);
  expect(unit(3840, 2160, false)).toBe(18);
});

// A touch screen as small as a stream tile is no device anyone plays on: 640×360 is tested on a desktop and live.
for (const [w, h] of screens) for (const mode of modes) for (const inset of w < h ? [none, notch] : [none]) if (!(mode.touch && w === 640)) {
  test(`${w}x${h} ${mode.live ? "live" : mode.touch ? "touch" : "desktop"}${inset === notch ? " with a notch" : ""}: on screen, none over another`, () => {
    const l = layout(w, h, inset, mode), all = homes(l);
    for (const [name, b] of all) {
      expect(b.x >= 0 && b.y >= inset.top && b.x + b.w <= w && b.y + b.h <= h - inset.bottom, `${name} ${JSON.stringify(b)} off screen`).toBe(true);
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

test("the hints sit low, under the middle of the picture", () => {
  const l = layout(1280, 720, none, { touch: false, live: false });
  expect(l.hints.y).toBeGreaterThan(720 * 0.8);
  expect(l.hints.x + l.hints.w / 2).toBe(640);
});
