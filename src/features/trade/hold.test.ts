// The hotbar's hold, as a player sees it: a good comes out of the backpack with one reach, goes back with one, and
// a swap is one reach too. Frames of 1/60 s. Run: bun test src/features/trade
import { expect, test } from "bun:test";
import { RISE } from "../lantern/stow.ts";
import { full, newHold, shelf, stepHold } from "./hold.ts";
import { newLedger } from "./ledger.ts";

const dt = 1 / 60;
function play(h: ReturnType<typeof newHold>, seconds: number, busy = false) {
  let most = 0;
  for (let t = 0; t < seconds; t += dt) { stepHold(h, dt, busy); most = Math.max(most, h.reach); }
  return most;
}

test("the shelf holds the goods owned, in the trading post's order", () => {
  const l = newLedger();
  expect(shelf(l)).toEqual([]);
  l.owned = { shell: 2, pinecone: 1 };
  expect(shelf(l)).toEqual(["pinecone", "shell"]);
});

test("a good comes into the paw at the backpack, and goes back the same way", () => {
  const h = newHold();
  h.want = "feather";
  play(h, RISE - 0.05);
  expect(h.held).toBeUndefined(); // the paw is not at the backpack yet
  expect(full(h)).toBe(true);
  expect(play(h, 2)).toBeGreaterThan(0.95);
  expect([h.held, h.reach, full(h)]).toEqual(["feather", 0, true]);
  h.want = undefined;
  expect(play(h, 2)).toBeGreaterThan(0.95);
  expect([h.held, full(h)]).toEqual([undefined, false]);
});

test("a swap is one reach; busy waits, and cuts one under way short", () => {
  const h = newHold();
  h.want = "pinecone";
  expect(play(h, 2, true)).toBe(0);
  expect(h.held).toBeUndefined();
  play(h, 2);
  h.want = "shell";
  play(h, 0.2);
  play(h, dt, true);
  expect([h.held, h.reach, h.at]).toEqual(["shell", 0, undefined]);
});
