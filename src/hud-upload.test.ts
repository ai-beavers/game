// Which parts of the HUD's canvas go to the GPU after a picture (src/hud-upload.ts).
import { expect, test } from "bun:test";
import { changed } from "./hud-upload.ts";

test("a small change is sent as its own rectangle, with a margin, inside the canvas", () => {
  expect(changed([[100, 50, 139, 69]], 1000, 500)).toEqual([{ x: 98, y: 48, w: 44, h: 24 }]);
  expect(changed([[-20, -5, 9, 9]], 1000, 500)).toEqual([{ x: 0, y: 0, w: 12, h: 12 }]); // cut at the canvas's edge
  expect(changed([[990, 490, 1200, 700]], 1000, 500)).toEqual([{ x: 988, y: 488, w: 12, h: 12 }]);
});

test("changes far apart stay apart, overlapping ones are sent as one", () => {
  const stick = [20, 400, 119, 479] as [number, number, number, number], map = [800, 10, 979, 189] as [number, number, number, number];
  expect(changed([stick, map], 1000, 500)).toHaveLength(2); // the stick's knob and the map: not the screen between them
  expect(changed([[100, 100, 149, 149], [140, 140, 199, 199]], 1000, 500)).toEqual([{ x: 98, y: 98, w: 104, h: 104 }]);
  // a third that joins two that were apart leaves one
  expect(changed([[0, 0, 49, 49], [200, 0, 249, 49], [40, 0, 210, 49]], 1000, 500)).toEqual([{ x: 0, y: 0, w: 252, h: 52 }]);
});

test("the whole canvas is sent when nothing is known, when most of it changed, or when the changes are many", () => {
  expect(changed([], 1000, 500)).toBeUndefined();
  expect(changed([[0, 0, 999, 499]], 1000, 500)).toBeUndefined();
  expect(changed([[0, 0, 999, 260]], 1000, 500)).toBeUndefined(); // more than half
  expect(changed(Array.from({ length: 9 }, (_, i) => [i * 100, 0, i * 100 + 9, 9] as [number, number, number, number]), 1000, 500)).toBeUndefined();
  expect(changed([[2000, 2000, 2100, 2100]], 1000, 500)).toEqual([]); // off the canvas: nothing to send
});
