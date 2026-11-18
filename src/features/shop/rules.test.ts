// The Shop's rules as a player meets them: Experience earned by building, Outfits bought with it and worn, and what
// comes back on the next visit.
import { expect, test } from "bun:test";
import { buy, DEFAULT, earn, load, OUTFITS, wear } from "./rules.ts";

const price = (id: string) => OUTFITS.find((o) => o.id === id)!.price;

test("a new player has no Experience and wears the default look, which they own", () => {
  const s = load(null);
  expect(s).toEqual({ experience: 0, owned: [DEFAULT], wearing: DEFAULT });
});

test("each stick built in earns one Experience", () => {
  const s = load(null);
  earn(s, 1); earn(s, 1); earn(s, 1);
  expect(s.experience).toBe(3);
});

test("buying an affordable Outfit takes its price and puts it on", () => {
  const s = load(null);
  earn(s, 12);
  expect(buy(s, "moss")).toBe(true);
  expect(s).toEqual({ experience: 2, owned: ["classic", "moss"], wearing: "moss" });
});

test("an Outfit that costs more than the Experience there is cannot be bought", () => {
  const s = load(null);
  earn(s, 24);
  expect(buy(s, "sunset")).toBe(false);
  expect(s).toEqual({ experience: 24, owned: ["classic"], wearing: "classic" });
});

test("an Outfit owned already is not paid for twice", () => {
  const s = load(null);
  earn(s, 30);
  buy(s, "moss");
  expect(buy(s, "moss")).toBe(false);
  expect(s.experience).toBe(20);
});

test("an owned Outfit and the default can be worn for free; one not owned cannot", () => {
  const s = load(null);
  earn(s, 10);
  buy(s, "moss");
  expect(wear(s, "classic")).toBe(true);
  expect(s.wearing).toBe("classic");
  expect(wear(s, "disco")).toBe(false);
  expect(s.wearing).toBe("classic");
  expect(wear(s, "moss")).toBe(true);
  expect(s).toEqual({ experience: 0, owned: ["classic", "moss"], wearing: "moss" });
});

test("the default is always owned, even when the saved game leaves it out", () => {
  expect(load('{"experience":5,"owned":["sunset"],"wearing":"sunset"}')).toEqual({ experience: 5, owned: ["classic", "sunset"], wearing: "sunset" });
});

test("the saved state comes back as it was", () => {
  const s = load(null);
  earn(s, 60);
  buy(s, "disco");
  wear(s, "classic");
  expect(load(JSON.stringify(s))).toEqual({ experience: 10, owned: ["classic", "disco"], wearing: "classic" });
});

test("a broken or tampered save starts a valid state", () => {
  expect(load("{not json")).toEqual(load(null));
  expect(load('"text"')).toEqual(load(null));
  expect(load('{"experience":-4,"owned":"all","wearing":"cape"}')).toEqual(load(null));
  // wearing an Outfit it does not own: back to the default
  expect(load('{"experience":3,"owned":[],"wearing":"disco"}')).toEqual({ experience: 3, owned: ["classic"], wearing: "classic" });
});

test("the catalogue: the default for free and three Outfits for 10, 25 and 50", () => {
  expect(OUTFITS.map((o) => o.price)).toEqual([0, 10, 25, 50]);
  expect(price(DEFAULT)).toBe(0);
});
