// Labels over the beavers: apart, wrapped, and what each is busy with. bun test src/features/net/tags
import { expect, test } from "bun:test";
import { newMotion } from "../../player/state.ts";
import { doing, GAP, MARGIN, place, wrap, type Label } from "./tags.ts";

const overlap = (a: Label & { x: number }, b: Label & { x: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("a label sits centred over its point, its bottom on it", () => {
  expect(place([{ x: 320, y: 200, w: 60, h: 20 }], 640, 360)).toEqual([{ x: 290, y: 180 }]);
});

test("three beavers side by side: their tags stack upwards, none on another, the nearest stays put", () => {
  const labels = [{ x: 320, y: 200, w: 60, h: 20 }, { x: 330, y: 198, w: 60, h: 20 }, { x: 310, y: 202, w: 70, h: 20 }];
  const at = place(labels, 640, 360), boxes = at.map((p, i) => ({ ...labels[i]!, ...p }));
  expect(at[0]).toEqual({ x: 290, y: 180 });
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(overlap(boxes[i]!, boxes[j]!)).toBe(false);
  for (let i = 0; i < 3; i++) expect(at[i]!.y + labels[i]!.h).toBeLessThanOrEqual(labels[i]!.y); // never down over a beaver
  expect(at[1]!.y).toBe(180 - GAP - 20);
});

test("tags far enough apart stay where they are", () => {
  const at = place([{ x: 100, y: 200, w: 60, h: 20 }, { x: 300, y: 200, w: 60, h: 20 }], 640, 360);
  expect(at.map((p) => p.y)).toEqual([180, 180]);
});

test("labels stay on screen at the sides and the top", () => {
  const at = place([{ x: 2, y: 10, w: 80, h: 30 }, { x: 640, y: 200, w: 80, h: 30 }], 640, 360);
  expect(at[0]).toEqual({ x: MARGIN, y: MARGIN });
  expect(at[1]!.x).toBe(640 - 80 - MARGIN);
});

const measure = (s: string) => s.length * 10; // every letter 10 px

test("a chat line wraps at words, a long word breaks, and what does not fit ends in an ellipsis", () => {
  expect(wrap("the dam needs more sticks", 100, measure)).toEqual(["the dam", "needs more", "sticks"]);
  expect(wrap("aaaaaaaaaaaaaaa", 100, measure)).toEqual(["aaaaaaaaaa", "aaaaa"]);
  const cut = wrap("one two three four five six seven eight", 100, measure, 2);
  expect(cut).toHaveLength(2);
  expect(cut[1]!.endsWith("…")).toBe(true);
  expect(measure(cut[1]!)).toBeLessThanOrEqual(100);
  expect(wrap("  ", 100, measure)).toEqual([]);
});

test("what a beaver is busy with, from its Motion", () => {
  const m = newMotion();
  expect(doing(m, 0)).toBe("");
  expect(doing({ ...m, action: "gnaw" }, 0)).toBe("gnawing");
  expect(doing({ ...m, carrying: true }, 0)).toBe("carrying");
  expect(doing({ ...m, carrying: true, action: "build" }, 0)).toBe("building");
  expect(doing({ ...m, swimming: 1 }, 0)).toBe("swimming");
  expect(doing({ ...m, carrying: true }, 5000)).toBe("away");
});
