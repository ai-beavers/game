// Tests for firstOf: the first actor with something to do gets the context key, and is stepped until it is done.
import { expect, test } from "bun:test";
import { firstOf } from "./actors.ts";
import type { Actor, Offer } from "./index.ts";

const actor = (name: string, here: () => boolean, steps: string[]): Actor => {
  let left = 0;
  return {
    begin: () => here() ? (left = 2, { action: "build" }) : undefined,
    offer: (): Offer | undefined => here() ? { action: "build", text: name } : undefined,
    step: () => { steps.push(name); return --left > 0 ? 0.5 : undefined; },
  };
};

test("the first actor with something to do here starts, offers, and is stepped until it ends", () => {
  let atDam = true;
  const steps: string[] = [], both = firstOf(actor("dam", () => atDam, steps), actor("post", () => true, steps));
  expect(both.offer!(true)?.text).toBe("dam");
  expect(both.begin(true)).toEqual({ action: "build" });
  while (both.step(0.1, true) !== undefined);
  expect(steps).toEqual(["dam", "dam"]);
  atDam = false;
  expect(both.offer!(true)?.text).toBe("post");
  both.begin(true);
  while (both.step(0.1, true) !== undefined);
  expect(steps).toEqual(["dam", "dam", "post", "post"]);
  expect(both.step(0.1, true)).toBeUndefined(); // nothing runs
});
