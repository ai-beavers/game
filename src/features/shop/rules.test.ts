// The Shop's rules as a player meets them: Experience earned by building, Outfits bought with it and worn, and what
// comes back on the next visit.
import { expect, test } from "bun:test";
import { buy, choose, CLASSES, classEffect, DEFAULT, earn, levelOf, load, NO_CLASS, OUTFITS, wear } from "./rules.ts";

const price = (id: string) => OUTFITS.find((o) => o.id === id)!.price;

test("a new player has no Experience and wears the default look, which they own", () => {
  const s = load(null);
  expect(s).toEqual({ experience: 0, earned: 0, owned: [DEFAULT], wearing: DEFAULT, class: NO_CLASS });
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
  expect(s).toEqual({ experience: 2, earned: 12, owned: ["classic", "moss"], wearing: "moss", class: NO_CLASS });
});

test("an Outfit that costs more than the Experience there is cannot be bought", () => {
  const s = load(null);
  earn(s, 24);
  expect(buy(s, "sunset")).toBe(false);
  expect(s).toEqual({ experience: 24, earned: 24, owned: ["classic"], wearing: "classic", class: NO_CLASS });
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
  expect(s).toEqual({ experience: 0, earned: 10, owned: ["classic", "moss"], wearing: "moss", class: NO_CLASS });
});

test("the default is always owned, even when the saved game leaves it out", () => {
  expect(load('{"experience":5,"owned":["sunset"],"wearing":"sunset"}')).toEqual({ experience: 5, earned: 5, owned: ["classic", "sunset"], wearing: "sunset", class: NO_CLASS });
});

test("the saved state comes back as it was", () => {
  const s = load(null);
  earn(s, 60);
  buy(s, "disco");
  wear(s, "classic");
  expect(load(JSON.stringify(s))).toEqual({ experience: 10, earned: 60, owned: ["classic", "disco"], wearing: "classic", class: NO_CLASS });
});

test("a broken or tampered save starts a valid state", () => {
  expect(load("{not json")).toEqual(load(null));
  expect(load('"text"')).toEqual(load(null));
  expect(load('{"experience":-4,"owned":"all","wearing":"cape"}')).toEqual(load(null));
  // wearing an Outfit it does not own: back to the default
  expect(load('{"experience":3,"owned":[],"wearing":"disco"}')).toEqual({ experience: 3, earned: 3, owned: ["classic"], wearing: "classic", class: NO_CLASS });
});

test("a save from before levels starts its total at the Experience there is; the total never falls below it", () => {
  expect(load('{"experience":40,"owned":[],"wearing":"classic"}').earned).toBe(40);
  expect(load('{"experience":40,"earned":12}').earned).toBe(40);
  expect(load('{"experience":5,"earned":90}').earned).toBe(90);
});

test("spending Experience does not lower the level", () => {
  const s = load(null);
  earn(s, 55);
  const before = levelOf(s.earned);
  buy(s, "disco");
  expect(s.experience).toBe(5);
  expect(levelOf(s.earned)).toEqual(before);
});

test("levels: 20 Experience to level 2, then 10 more for each level after", () => {
  expect(levelOf(0)).toEqual({ level: 1, into: 0, need: 20 });
  expect(levelOf(19)).toEqual({ level: 1, into: 19, need: 20 });
  expect(levelOf(20)).toEqual({ level: 2, into: 0, need: 30 });
  expect(levelOf(25)).toEqual({ level: 2, into: 5, need: 30 });
  expect(levelOf(50)).toEqual({ level: 3, into: 0, need: 40 });
  expect(levelOf(-3)).toEqual({ level: 1, into: 0, need: 20 });
  expect(levelOf(1000).level).toBe(13); // a long season of building: 20 + 30 + … + 130 = 900
});

test("the catalogue: the default for free and four Outfits for 10, 25, 50 and 75", () => {
  expect(OUTFITS.map((o) => o.price)).toEqual([0, 10, 25, 50, 75]);
  expect(OUTFITS.at(-1)!.name).toBe("Shark");
  expect(price(DEFAULT)).toBe(0);
});

// ---- Classes ----------------------------------------------------------------------------------------------------

test("a new beaver has no class and plays as every beaver does", () => {
  const s = load(null);
  expect(s.class).toBe(NO_CLASS);
  expect(classEffect(s)).toEqual({ biteTime: 0.6, swimSpeed: 0.5 });
});

test("a Gnawer bites faster and swims as before; a Swimmer swims faster and bites as before", () => {
  const s = load(null);
  expect(choose(s, "gnawer")).toBe(true);
  expect(s.class).toBe("gnawer");
  expect(classEffect(s)).toEqual({ biteTime: 0.4, swimSpeed: 0.5 });
  expect(choose(s, "swimmer")).toBe(true);
  expect(classEffect(s)).toEqual({ biteTime: 0.6, swimSpeed: 0.75 });
});

test("going back to no class brings today's values back", () => {
  const s = load(null);
  choose(s, "swimmer");
  expect(choose(s, NO_CLASS)).toBe(true);
  expect(s.class).toBe(NO_CLASS);
  expect(classEffect(s)).toEqual(classEffect(load(null)));
});

test("an unknown class is refused and changes nothing", () => {
  const s = load(null);
  choose(s, "gnawer");
  expect(choose(s, "wizard" as never)).toBe(false);
  expect(s.class).toBe("gnawer");
});

test("a class costs no Experience, and Outfits leave the class alone", () => {
  const s = load(null);
  earn(s, 30);
  choose(s, "swimmer");
  expect(s.experience).toBe(30);
  buy(s, "moss");
  wear(s, "classic");
  expect(s.class).toBe("swimmer");
});

test("the class every class row shows: a name and one short line", () => {
  expect(CLASSES.map((c) => [c.id, c.name, c.line])).toEqual([["gnawer", "Gnawer", "Bites faster"], ["swimmer", "Swimmer", "Swims faster"]]);
});

test("the class comes back from the saved game; a missing, unknown or broken one is no class", () => {
  const s = load(null);
  earn(s, 12); buy(s, "moss"); choose(s, "gnawer");
  expect(load(JSON.stringify(s))).toEqual({ experience: 2, earned: 12, owned: ["classic", "moss"], wearing: "moss", class: "gnawer" });
  expect(load('{"experience":3,"class":"wizard"}').class).toBe(NO_CLASS);
  expect(load('{"experience":3,"class":7}').class).toBe(NO_CLASS);
  expect(load("{broken").class).toBe(NO_CLASS);
  // a save from before classes: everything kept, no class
  expect(load('{"experience":5,"earned":40,"owned":["moss"],"wearing":"moss"}')).toEqual({ experience: 5, earned: 40, owned: ["classic", "moss"], wearing: "moss", class: NO_CLASS });
});

// ---- the Shark ----------------------------------------------------------------------------------------------------

test("the Shark cannot be bought with 74 Experience", () => {
  const s = load(null);
  earn(s, 74);
  expect(buy(s, "shark")).toBe(false);
  expect(s).toEqual({ experience: 74, earned: 74, owned: ["classic"], wearing: "classic", class: NO_CLASS });
});

test("with 75 Experience the Shark is bought and worn at once, the level unchanged", () => {
  const s = load(null);
  earn(s, 75);
  const level = levelOf(s.earned);
  expect(buy(s, "shark")).toBe(true);
  expect(s).toEqual({ experience: 0, earned: 75, owned: ["classic", "shark"], wearing: "shark", class: NO_CLASS });
  expect(levelOf(s.earned)).toEqual(level);
});

test("the Shark is taken off and worn again for free, the class kept", () => {
  const s = load(null);
  earn(s, 80);
  choose(s, "swimmer");
  buy(s, "shark");
  expect(wear(s, "classic")).toBe(true);
  expect(wear(s, "shark")).toBe(true);
  expect(s).toEqual({ experience: 5, earned: 80, owned: ["classic", "shark"], wearing: "shark", class: "swimmer" });
  expect(classEffect(s)).toEqual({ biteTime: 0.6, swimSpeed: 0.75 });
});

test("a saved game that owns and wears the Shark loads with it owned and worn", () => {
  expect(load('{"experience":2,"earned":77,"owned":["shark"],"wearing":"shark"}')).toEqual({ experience: 2, earned: 77, owned: ["classic", "shark"], wearing: "shark", class: NO_CLASS });
});

test("the Shark, and only the Shark, wears a hood in the hat's place", () => {
  expect(OUTFITS.filter((o) => o.hood).map((o) => o.id)).toEqual(["shark"]);
});
