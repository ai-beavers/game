import { expect, test } from "bun:test";
import { crestHeight, DAM, profile } from "../build/rules.ts";
import { MOST, next, offered, spot } from "./rules.ts";

test("the offer stands with empty paws once the dam's mud shows, below the cap", () => {
  expect(offered(4, false, 0)).toBe(false); // four sticks: no mud yet
  expect(offered(5, false, 0)).toBe(true);
  expect(offered(5, true, 0)).toBe(false); // a stick in the paw builds
  expect(offered(30, false, 4)).toBe(true);
  expect(offered(30, false, 5)).toBe(false); // five lie there already
});

test("leaving one adds one, never past five", () => {
  expect(next(0, "left")).toBe(1);
  expect(next(4, "left")).toBe(5);
  expect(next(5, "left")).toBe(5);
});

test("a new dawn and an emptied dam both wash them all off", () => {
  expect(next(3, "dawn")).toBe(0);
  expect(next(5, "emptied")).toBe(0);
  expect(next(0, "dawn")).toBe(0);
});

test("the n-th dropping lands on the same spot every time, each apart from the others", () => {
  const spots = Array.from({ length: MOST }, (_, n) => spot(n, 20));
  expect(spots).toEqual(Array.from({ length: MOST }, (_, n) => spot(n, 20)));
  for (const [i, a] of spots.entries()) for (const b of spots.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.06);
});

test("every spot lies on the crest's land side, spread along the dam", () => {
  const spots = Array.from({ length: MOST }, (_, n) => spot(n, 20));
  for (const s of spots) {
    expect(s.x).toBeLessThan(0); // +x is the water side
    expect(profile(s.x, s.z)).toBe(1); // on the crest, inside the dam's footprint
  }
  const zs = spots.map((s) => s.z);
  expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(DAM.length * (DAM.top / DAM.base) / 2); // over half the crest's length
});

test("a dropping rises with the crest as sticks are added", () => {
  expect(spot(0, 5).y).toBeGreaterThan(0);
  expect(spot(0, 30).y).toBeGreaterThan(spot(0, 15).y);
  expect(spot(0, 15).y).toBeGreaterThan(spot(0, 5).y);
  for (const placed of [5, 12, 20, 30]) expect(spot(0, placed).y).toBeGreaterThanOrEqual(crestHeight(placed)); // never sunk in the crest
});
