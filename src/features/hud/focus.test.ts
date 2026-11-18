// Tests for focus.ts: the order focus moves in through a menu, and a held stick's calm repeat.
import { expect, test } from "bun:test";
import { DELAY, EVERY, newRepeat, nextFocus, padDirection, repeatStep } from "./focus.ts";

const row = (y: number, x = 0, w = 300) => ({ x, y, w, h: 40 });
// The pause menu: one column of buttons.
const column = [row(0), row(50), row(100), row(150)];
// The controls page: three device buttons in a row, Back below.
const controls = [row(0, 0, 96), row(0, 100, 96), row(0, 200, 96), row(250)];

test("down and up walk a column and wrap round at the ends", () => {
  expect(nextFocus(column, 0, "down")).toBe(1);
  expect(nextFocus(column, 2, "up")).toBe(1);
  expect(nextFocus(column, 3, "down")).toBe(0);
  expect(nextFocus(column, 0, "up")).toBe(3);
});

test("nothing focused yet: the first control; an empty menu: none", () => {
  expect(nextFocus(column, -1, "down")).toBe(0);
  expect(nextFocus([], -1, "up")).toBe(-1);
});

test("left and right move along a row and stop at its ends, never into another row", () => {
  expect(nextFocus(controls, 0, "right")).toBe(1);
  expect(nextFocus(controls, 2, "left")).toBe(1);
  expect(nextFocus(controls, 2, "right")).toBe(2);
  expect(nextFocus(column, 1, "left")).toBe(1);
});

test("down from a row goes to the control below, up from it to the nearest above", () => {
  expect(nextFocus(controls, 0, "down")).toBe(3);
  expect(nextFocus(controls, 3, "up")).toBe(1);
  expect(nextFocus(controls, 1, "up")).toBe(3); // wraps round to Back
});

test("stick and d-pad: the d-pad wins, a small push is no direction, the larger axis decides", () => {
  const none = { up: false, down: false, left: false, right: false };
  expect(padDirection(0.2, 0.3, none)).toBeUndefined();
  expect(padDirection(0.1, -0.9, none)).toBe("up");
  expect(padDirection(0.8, 0.6, none)).toBe("right");
  expect(padDirection(0.9, 0, { ...none, down: true })).toBe("down");
});

test("a held direction fires once, after a pause again, then at a calm rate; let go and push again fires at once", () => {
  const held = newRepeat();
  expect(repeatStep(held, "down", 0)).toBe("down");
  expect(repeatStep(held, "down", DELAY - 1)).toBeUndefined();
  expect(repeatStep(held, "down", DELAY)).toBe("down");
  expect(repeatStep(held, "down", DELAY + EVERY - 1)).toBeUndefined();
  expect(repeatStep(held, "down", DELAY + EVERY)).toBe("down");
  expect(repeatStep(held, undefined, DELAY + EVERY + 1)).toBeUndefined();
  expect(repeatStep(held, "down", DELAY + EVERY + 2)).toBe("down");
});
