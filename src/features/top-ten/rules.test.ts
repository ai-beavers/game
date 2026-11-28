// Tests for the Top-ten board's tally: the rows a page is told, from the sticks each name built in, and a kept tally
// read back. Run: bun test src/features/top-ten
import { expect, test } from "bun:test";
import { add, keep, newTally, readTally, top } from "./rules.ts";

const built = (...names: string[]) => { const t = newTally(); for (const n of names) add(t, n); return t; };

test("an empty tally has no rows", () => {
  expect(top(newTally())).toEqual([]);
});

test("rows go by sticks, most first, each with its place", () => {
  expect(top(built("Ann", "Bo", "Bo", "Cy", "Bo", "Cy"))).toEqual([
    { place: 1, name: "Bo", sticks: 3 }, { place: 2, name: "Cy", sticks: 2 }, { place: 3, name: "Ann", sticks: 1 },
  ]);
});

test("of two with the same count, the one that reached it first stands higher", () => {
  expect(top(built("Ann", "Bo", "Bo", "Ann")).map((r) => r.name)).toEqual(["Bo", "Ann"]);
  expect(top(built("Bo", "Ann", "Ann", "Bo")).map((r) => r.name)).toEqual(["Ann", "Bo"]);
});

test("upper and lower case share a row, shown as last written", () => {
  expect(top(built("Biber", "biber", "BIBER"))).toEqual([{ place: 1, name: "BIBER", sticks: 3 }]);
});

test("at most ten rows; a stick that leaves the ten as it was does not change it", () => {
  const t = built(..."ABCDEFGHIJ".split("").flatMap((n) => [n, n]));
  expect(add(t, "K")).toBe(false); // one stick, below all ten with two
  expect(top(t)).toHaveLength(10);
  expect(top(t).map((r) => r.name).join("")).toBe("ABCDEFGHIJ");
  expect(add(t, "K")).toBe(false); // two, as many as the ten, but the last to reach it
  expect(top(t).map((r) => r.name).join("")).toBe("ABCDEFGHIJ");
  expect(add(t, "K")).toBe(true);
  expect(top(t)[0]).toEqual({ place: 1, name: "K", sticks: 3 });
  expect(top(t).at(-1)!.name).toBe("I");
});

test("a kept tally reads back the same rows, and goes on counting after them", () => {
  const t = built("Ann", "Bo", "Bo"), again = readTally(JSON.stringify({ epoch: "abc", build: [], top: keep(t) }));
  expect(top(again)).toEqual(top(t));
  add(again, "Ann");
  expect(top(again).map((r) => r.name)).toEqual(["Bo", "Ann"]); // Ann reached two after Bo did
});

test("a kept world without a tally, or a broken one, starts with an empty tally; bad rows are left out", () => {
  for (const text of [undefined, "", "{", JSON.stringify({ epoch: "abc", build: [] }), JSON.stringify({ top: "x" }), "null"]) {
    expect(top(readTally(text))).toEqual([]);
  }
  const rows = [["Ann", 2, 2], ["", 1, 3], ["Bo", -1, 4], ["Cy", 1.5, 5], "Dee", ["ann", 9, 9], ["Ed\u0000\u0000die", 1, 6]];
  expect(top(readTally(JSON.stringify({ top: rows })))).toEqual([{ place: 1, name: "Ann", sticks: 2 }, { place: 2, name: "Ed die", sticks: 1 }]);
});
