import { expect, test } from "bun:test";
import { liveDirector, shotFor, type Moment, type Station } from "./live.ts";

test("live shots stand back on the way, come close for dam work and stay low over the pond", () => {
  expect(shotFor("Dam work", true).distance).toBeGreaterThan(shotFor("Dam work", false).distance);
  expect(shotFor("Dam work", false).distance).toBeLessThan(shotFor("Around the clearing", false).distance);
  expect(shotFor("Pond patrol", false).pitch).toBeLessThan(shotFor("Dam work", false).pitch);
  expect(shotFor("Furious beaver", false)).toEqual(shotFor("Map", false)); // no activity of its own: the default
});

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
