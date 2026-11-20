// Tests for input.ts: what counts as the player touching the controls (keys.touched, which the Stare watches).
import { expect, test } from "bun:test";
import { keyboard, newInput } from "./input.ts";

test("holding a key counts every step; holding only the sit key counts once, so a sitting beaver may still stare", () => {
  const keys = keyboard(new EventTarget() as unknown as Window), into = newInput();
  const steps = (n: number) => { for (let i = 0; i < n; i++) keys.read(into); return keys.touched; };
  expect(steps(10)).toBe(0);
  keys.hold(["KeyW"]);
  expect(steps(10)).toBe(10);
  keys.hold(["KeyC"]);
  expect(steps(10)).toBe(11); // sat down: one touch
  keys.hold(["KeyC", "KeyW"]);
  expect(steps(2)).toBe(13);
});
