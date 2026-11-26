// Track's follows: a value that belongs to a step value blends only within it. bun test src/features/net/track
import { expect, test } from "bun:test";
import { Track } from "./track.ts";

test("a progress blends within one action and holds across a change of action", () => {
  const t = new Track({ steps: [0], follows: { 1: 0 } });
  t.push(0, [0, 0.2]); t.push(100, [0, 0.4]); t.push(200, [3, 0.9]);
  expect(t.at(50)[1]).toBeCloseTo(0.3); // the same action: blended
  expect(t.at(150)).toEqual([0, 0.4]); // a gnaw starting at 0.9 does not pull the slap's 0.4 up through its strike
});
