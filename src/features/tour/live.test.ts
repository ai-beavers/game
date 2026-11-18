import { expect, test } from "bun:test";
import { liveDirector, shotFor, type Station } from "./live.ts";

test("live shots stand back on the way, come close for dam work and stay low over the pond", () => {
  expect(shotFor("Dam work", true).distance).toBeGreaterThan(shotFor("Dam work", false).distance);
  expect(shotFor("Dam work", false).distance).toBeLessThan(shotFor("Around the clearing", false).distance);
  expect(shotFor("Pond patrol", false).pitch).toBeLessThan(shotFor("Dam work", false).pitch);
  expect(shotFor("Furious beaver", false)).toEqual(shotFor("Map", false)); // no activity of its own: the default
});

test("live activities keep prerequisites together and include newly available stations", () => {
  const play = async () => {};
  const build: Station[] = [["Gather", play, "Build"], ["Place", play, "Build"]];
  const inspect: Station = ["Inspect the pond", play];
  const direct = liveDirector();
  expect(direct(build, "Build")).toEqual(build);
  expect(direct([...build, inspect], "Build")).toEqual([inspect]);
  expect(direct([...build, inspect])).toEqual(build);
  expect(direct([inspect])).toEqual([inspect]);
  expect(direct([])).toEqual([]);
});
