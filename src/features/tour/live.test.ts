import { expect, test } from "bun:test";
import { liveDirector, type Station } from "./live.ts";

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
