import { expect, test } from "bun:test";
import { fresh, liveDirector, reason, weight, type Moment, type Station } from "./live.ts";

const play = async () => {};
const build: Station[] = [["Gather", play, "Dam work"], ["Place", play, "Dam work"]];
const swim: Station = ["Swim", play, "Pond patrol"], slap: Station = ["Slap", play, "Tail slap"];
const sky: Station = ["A day passes", play, "Sky watch"], walk: Station = ["Walk", play, "Around the clearing"];
const all = [...build, swim, slap, sky, walk];
const at = (m: Partial<Moment>): Moment => ({ now: 1000, shown: {}, hour: 9, weather: "fair", ...m });
const pick = (stations: Station[], m: Partial<Moment>) => liveDirector(stations, at(m))[0]?.[2];

test("live activities keep their stations together, in order", () => {
  expect(liveDirector([...build, swim], at({ carrying: true }))).toEqual(build);
  expect(liveDirector([...build, swim], at({ previous: "Dam work" }))).toEqual([swim]);
  expect(liveDirector([swim], at({ previous: "Pond patrol" }))).toEqual([swim]); // the only one: again
  expect(liveDirector([], at({}))).toEqual([]);
});

test("the activity not shown for longest comes next, one never shown first", () => {
  const shown = { "Dam work": 900, "Pond patrol": 100, "Tail slap": 950, "Sky watch": 990, "Around the clearing": 10 };
  expect(pick(all, { shown })).toBe("Pond patrol"); // 900 s ago, against the clearing's 990 s at a lower weight
  const { "Around the clearing": _, ...rest } = shown;
  expect(pick(all, { shown: rest })).toBe("Around the clearing");
});

test("the time of day and the weather steer it", () => {
  const even = { "Dam work": 800, "Pond patrol": 800, "Tail slap": 800, "Sky watch": 800, "Around the clearing": 800 };
  expect(pick(all, { shown: even, hour: 12.5 })).toBe("Pond patrol"); // a swim at noon
  expect(pick(all, { shown: even, hour: 19.5 })).toBe("Sky watch"); // dusk
  expect(pick(all, { shown: even, hour: 9, weather: "rain" })).toBe("Sky watch");
  const play = [swim, slap, sky, walk];
  expect(pick(play, { shown: even, hour: 9, ducks: true })).toBe("Tail slap"); // ducks on the pond to send off
  expect(pick(play, { shown: even, hour: 9, ducks: false })).toBe("Pond patrol"); // the ducks are away: no slap
});

test("the beaver says why it does what it does, by the hour, the weather and what it holds", () => {
  expect(reason("Pond patrol", at({ hour: 12.5 }))).toContain("noon");
  expect(reason("Pond patrol", at({ hour: 9 }))).not.toContain("noon");
  expect(reason("Sky watch", at({ hour: 19.5 }))).toContain("Dusk");
  expect(reason("Sky watch", at({ hour: 23 }))).toContain("Lantern");
  expect(reason("Sky watch", at({ hour: 9, weather: "rain" }))).toContain("Rain");
  expect(reason("Dam work", at({ carrying: true }))).toContain("stick");
  expect(reason("A new thing", at({}))).toBe("A new thing"); // no line of its own: its name
  expect(reason("Trading", at({ day: Date.parse("2026-12-20") }))).toBe("Wood to spare. Let's go shopping!");
  const activities = ["Dam work", "Pond patrol", "Tail slap", "Sky watch", "Regrowth", "Around the clearing", "Furious beaver", "Wears a hat", "Trading", "Sit and crawl", "Shopping", "Canoeing", "Find Mrs. Beaver", "Burn the flag", "Visit the Old Beaver", "Drive off the bear", "Mushrooms", "Meet a beaver", "Hoverboarding"];
  for (const hour of [3, 9, 12.5, 19.5, 23]) for (const weather of ["fair", "rain", "fog"]) for (const activity of activities)
    for (const day of [undefined, Date.parse("2026-11-19")]) // one row of the caption, new or not
      expect(reason(activity, at({ hour, weather, day })).length).toBeLessThanOrEqual(40);
});

test("sitting and crawling: a reason of its own, new on the day it came", () => {
  expect(reason("Sit and crawl", at({})).length).toBeLessThan(40);
  expect(reason("Sit and crawl", at({}))).toContain("sit");
  expect(fresh("Sit and crawl", at({ day: Date.parse("2026-11-18") }))).toBe(true);
  expect(fresh("Sit and crawl", at({ day: Date.parse("2026-11-25") }))).toBe(false);
});

test("the beaver is curious about a new activity for a week, and says so", () => {
  const day = (iso: string) => ({ day: Date.parse(iso) });
  expect(fresh("Wears a hat", at(day("2026-11-20")))).toBe(true);
  expect(fresh("Wears a hat", at(day("2026-11-26")))).toBe(false); // older than a week
  expect(fresh("Wears a hat", at(day("2026-11-17")))).toBe(false); // a clock that is behind
  expect(fresh("Wears a hat", at({}))).toBe(false); // no date known
  expect(fresh("Dam work", at(day("2026-11-20")))).toBe(false);
  expect(fresh("Trading", at(day("2026-11-24")))).toBe(true); // the trading post came 2026-11-18
  expect(weight("Wears a hat", at(day("2026-11-20")))).toBeGreaterThan(weight("Dam work", at(day("2026-11-20"))));
  expect(reason("Wears a hat", at(day("2026-11-20")))).toBe("New! Let me try: Wears a hat");
  const hat: Station = ["Wears a hat", play];
  const even = { "Dam work": 800, "Pond patrol": 800, "Tail slap": 800, "Sky watch": 800, "Around the clearing": 800, "Wears a hat": 800 };
  expect(liveDirector([...all, hat], at({ shown: even, ...day("2026-11-20") }))).toEqual([hat]);
  expect(liveDirector([...all, hat], at({ shown: even, ...day("2026-12-20") }))).not.toEqual([hat]); // no longer new: the dam work
});

test("an hour of live play shows everything, never the same twice in a row, and the dam work often", () => {
  const shown: Record<string, number> = {}, seen: string[] = [];
  let now = 0;
  for (let k = 0; k < 40; k++) {
    const hour = (9 + now / 300) % 24; // a game day every two hours
    const chosen = liveDirector(all, { now, shown, previous: seen.at(-1), hour, weather: k % 9 === 4 ? "rain" : "fair", ducks: k % 3 !== 0 });
    const name = chosen[0]![2]!;
    expect(name).not.toBe(seen.at(-1)!);
    seen.push(name);
    shown[name] = now;
    now += 90;
  }
  for (const name of ["Dam work", "Pond patrol", "Tail slap", "Sky watch", "Around the clearing"]) expect(seen).toContain(name);
  expect(seen.filter((name) => name === "Dam work").length).toBeGreaterThanOrEqual(8);
});

test("looking for Mrs. Beaver: a reason of its own, new for a week from the day it came", () => {
  expect(reason("Find Mrs. Beaver", at({}))).toBe("Where is my Mrs. Beaver?");
  expect(fresh("Find Mrs. Beaver", at({ day: Date.parse("2026-11-19") }))).toBe(true);
  expect(fresh("Find Mrs. Beaver", at({ day: Date.parse("2026-11-26") }))).toBe(false);
  expect(reason("Find Mrs. Beaver", at({ day: Date.parse("2026-11-26") }))).toBe("Where is my Mrs. Beaver?");
});

test("canoeing: new on the day it came, then a reason of its own that fits the weather and the hour", () => {
  expect(fresh("Canoeing", at({ day: Date.parse("2026-11-19") }))).toBe(true);
  expect(fresh("Canoeing", at({ day: Date.parse("2026-11-26") }))).toBe(false);
  const later = Date.parse("2026-12-20");
  expect(reason("Canoeing", at({ day: later, hour: 12.5, weather: "fair" }))).toBe("Calm water. Out in the canoe.");
  expect(reason("Canoeing", at({ day: later, hour: 23, weather: "fair" }))).toContain("Lantern");
  expect(reason("Canoeing", at({ day: later, hour: 12.5, weather: "rain" }))).toContain("Rain");
});

test("mushrooms: a reason of its own, tried often in their first week and only rarely after", () => {
  const later = at({ day: Date.parse("2026-12-20") });
  expect(reason("Mushrooms", later)).toBe("Mushrooms! Just one more…");
  expect(fresh("Mushrooms", at({ day: Date.parse("2026-11-19") }))).toBe(true);
  expect(fresh("Mushrooms", at({ day: Date.parse("2026-11-26") }))).toBe(false);
  expect(weight("Mushrooms", at({ day: Date.parse("2026-11-20") }))).toBeGreaterThan(weight("Dam work", at({ day: Date.parse("2026-11-20") })));
  expect(weight("Mushrooms", later)).toBe(0.6);
  expect(weight("Mushrooms", later)).toBeLessThan(weight("Around the clearing", later));
});

test("visiting the Old Beaver: a reason of its own, new for a week from the day he came", () => {
  expect(reason("Visit the Old Beaver", at({}))).toBe("Who mutters in the thicket?");
  expect(reason("Visit the Old Beaver", at({})).length).toBeLessThan(40);
  expect(fresh("Visit the Old Beaver", at({ day: Date.parse("2026-11-19") }))).toBe(true);
  expect(fresh("Visit the Old Beaver", at({ day: Date.parse("2026-11-26") }))).toBe(false);
});

test("left alone: the beaver gives its reason in its own words, and is curious about it for its first week", () => {
  expect(reason("Left alone", at({}))).toBe("Nobody's touching the controls. I'll just… look at you.");
  expect(fresh("Left alone", at({ day: Date.parse("2026-11-19") }))).toBe(true);
  expect(fresh("Left alone", at({ day: Date.parse("2026-11-26") }))).toBe(false);
  // after its week a real minute of standing still comes round less often than the rest
  expect(weight("Left alone", at({ day: Date.parse("2026-12-20") }))).toBeLessThan(weight("Around the clearing", at({})));
});

test("driving off the bear: a reason of its own, new on the day it came", () => {
  expect(reason("Drive off the bear", at({}))).toBe("A bear! Not in my clearing.");
  expect(fresh("Drive off the bear", at({ day: Date.parse("2026-11-20") }))).toBe(true);
  expect(fresh("Drive off the bear", at({ day: Date.parse("2026-11-27") }))).toBe(false);
});

test("baking: its own reason, and while it is new the beaver tries it first", () => {
  const later = at({ day: Date.parse("2026-12-20") });
  expect(reason("Baking", later)).toBe("Smells like fresh bread.");
  expect(reason("Baking", later).length).toBeLessThan(40);
  expect(reason("Baking", at({ day: Date.parse("2026-11-21") }))).toBe("New! Let me try: Baking");
  const bake: Station = ["Bake a loaf", play, "Baking"];
  const shown = { "Dam work": 0, "Pond patrol": 0, "Tail slap": 0, "Sky watch": 0, "Around the clearing": 0, Baking: 0 };
  expect(pick([...all, bake], { shown, day: Date.parse("2026-11-21") })).toBe("Baking");
  expect(fresh("Baking", at({ day: Date.parse("2026-11-28") }))).toBe(false);
});

test("crafting: its own reason, and while it is new the beaver tries it first", () => {
  const later = at({ day: Date.parse("2026-12-20") });
  expect(reason("Crafting", later)).toBe("A feather and a shell. I could tie those together.");
  expect(reason("Crafting", at({ day: Date.parse("2026-11-22") }))).toBe("New! Let me try: Crafting");
  const craft: Station = ["Make a charm", play, "Crafting"];
  const shown = { "Dam work": 0, "Pond patrol": 0, "Tail slap": 0, "Sky watch": 0, "Around the clearing": 0, Crafting: 0 };
  expect(pick([...all, craft], { shown, day: Date.parse("2026-11-21") })).toBe("Crafting");
  expect(fresh("Crafting", at({ day: Date.parse("2026-11-27") }))).toBe(true);
  expect(fresh("Crafting", at({ day: Date.parse("2026-11-28") }))).toBe(false);
});

test("meeting a beaver: its own reason, and while it is new the beaver tries it first", () => {
  const later = at({ day: Date.parse("2026-12-20") });
  expect(reason("Meet a beaver", later)).toBe("Someone's at the pond. Say hello.");
  expect(reason("Meet a beaver", later).length).toBeLessThan(40);
  const meet: Station = ["Meet a beaver", play];
  const shown = { "Dam work": 0, "Pond patrol": 0, "Tail slap": 0, "Sky watch": 0, "Around the clearing": 0, "Meet a beaver": 0 };
  expect(pick([...all, meet], { shown, day: Date.parse("2026-11-22") })).toBeUndefined(); // its own activity: no group name
  expect(liveDirector([...all, meet], at({ shown, day: Date.parse("2026-11-22") }))).toEqual([meet]);
  expect(fresh("Meet a beaver", at({ day: Date.parse("2026-11-26") }))).toBe(true);
  expect(fresh("Meet a beaver", at({ day: Date.parse("2026-11-27") }))).toBe(false);
});

test("hoverboarding: new for a week from the day it came, then a reason of its own", () => {
  expect(fresh("Hoverboarding", at({ day: Date.parse("2026-11-26") }))).toBe(true);
  expect(reason("Hoverboarding", at({ day: Date.parse("2026-11-28") }))).toBe("New! Let me try: Hoverboarding");
  expect(fresh("Hoverboarding", at({ day: Date.parse("2026-12-03") }))).toBe(false);
  expect(reason("Hoverboarding", at({ day: Date.parse("2026-12-10") }))).toBe("Long way to go. Board it is.");
});
