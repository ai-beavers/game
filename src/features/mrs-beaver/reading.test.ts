// The Reading's rules, without a scene: when it may go on, who reads which line, and where the story stands.
import { expect, test } from "bun:test";
import { placeAll, SPAWN } from "../../world/place.ts";
import { heightAt, SITE, slopeAt, WATER_LEVEL } from "../../world/terrain.ts";
import { begin, CAMPFIRE, canRead, FIRE, LINE, reader, SEAT, SHORT, SIT_REACH, step, STORIES } from "./reading.ts";
import { HIDING, HOME, wayHome, type XZ } from "./rules.ts";

test("nothing is shown while the Reading can't go on", () => {
  const r = begin();
  for (let i = 0; i < 10; i++) expect(step(r, 1, false)).toBeUndefined();
  expect(r).toMatchObject({ story: 0, line: 0 });
});

test("sitting by the fire she reads the first line, and after LINE s the player reads the next", () => {
  const r = begin();
  expect(step(r, 0.1, true)).toEqual({ text: STORIES[0]![0]!, reader: "her" });
  expect(step(r, LINE - 0.2, true)).toEqual({ text: STORIES[0]![0]!, reader: "her" }); // still up: time to read it
  expect(step(r, 0.2, true)).toEqual({ text: STORIES[0]![1]!, reader: "player" });
  expect(step(r, LINE, true)).toEqual({ text: STORIES[0]![2]!, reader: "her" });
});

test("in every story the first line is hers and the readers alternate", () => {
  STORIES.forEach((story) => story.forEach((_, i) => expect(reader(i)).toBe(i % 2 === 0 ? "her" : "player")));
  expect(reader(0)).toBe("her");
  expect(reader(1)).toBe("player");
});

test("standing up hides the line and keeps it; sitting again shows that same line afresh", () => {
  const r = begin();
  step(r, 0, true);
  step(r, LINE + 1, true); // the player's line, 1 s up
  expect(step(r, 0.5, false)).toBeUndefined();
  expect(step(r, 30, false)).toBeUndefined(); // time standing moves nothing on
  expect(step(r, 0.1, true)).toEqual({ text: STORIES[0]![1]!, reader: "player" });
  expect(step(r, LINE - 0.3, true)?.text).toBe(STORIES[0]![1]!); // a whole LINE s again, not what was left
  expect(step(r, 0.3, true)?.text).toBe(STORIES[0]![2]!);
});

test("after a story's last line the next story begins with her, and after the last story the first", () => {
  const r = begin();
  step(r, 0, true);
  step(r, LINE * STORIES[0]!.length, true);
  expect(r).toMatchObject({ story: 1, line: 0 });
  expect(step(r, 0, true)).toEqual({ text: STORIES[1]![0]!, reader: "her" });
  const rest = STORIES.slice(1).reduce((n, s) => n + s.length, 0);
  for (let i = 0; i < rest; i++) step(r, LINE, true);
  expect(r).toMatchObject({ story: 0, line: 0 });
  expect(step(r, 0, true)?.text).toBe("Long ago the pond was only a thin brook.");
});

test("a few stories about the clearing, 6 to 8 lines each, every line short enough for one speech line", () => {
  expect(STORIES.length).toBeGreaterThanOrEqual(3);
  for (const story of STORIES) {
    expect(story.length).toBeGreaterThanOrEqual(6);
    expect(story.length).toBeLessThanOrEqual(8);
    for (const line of story) { expect(line.length).toBeLessThan(SHORT); expect(line.length).toBeGreaterThan(0); }
  }
});

test("a Reading goes on only sitting near the fire with her home", () => {
  expect(canRead({ sitting: true, fire: 1, home: true })).toBe(true);
  expect(canRead({ sitting: true, fire: 2.5, home: true })).toBe(true);
  expect(canRead({ sitting: true, fire: 2.6, home: true })).toBe(false); // sitting far off: ordinary Sit
  expect(canRead({ sitting: false, fire: 1, home: true })).toBe(false);
  expect(canRead({ sitting: true, fire: 1, home: false })).toBe(false); // not yet rescued, or still on her way
});

test("the Campfire stands about 1.5 m from her waiting spot, away from the site, clear of her ways home, the dam, the crates and anything solid", () => {
  const near = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);
  expect(near(FIRE, HOME)).toBeGreaterThan(1.3);
  expect(near(FIRE, HOME)).toBeLessThan(1.7);
  expect(near(FIRE, SITE)).toBeGreaterThan(near(HOME, SITE) + 1); // the side away from the building site
  expect(near(FIRE, SITE)).toBeGreaterThan(SITE.radius + 2);
  expect(near(FIRE, { x: SITE.x + 1.1, z: SITE.z })).toBeGreaterThan(4); // the dam
  expect(near(FIRE, SPAWN)).toBeGreaterThan(3);
  expect(heightAt(FIRE.x, FIRE.z)).toBeGreaterThan(WATER_LEVEL + 0.05);
  expect(slopeAt(FIRE.x, FIRE.z)).toBeLessThan(0.1);
  const layout = placeAll();
  for (const s of [...layout.tree, ...layout.rock, ...layout.stump, ...layout.log, ...layout.crate, ...layout.bush]) {
    expect(near(FIRE, s)).toBeGreaterThan(2);
    expect(near(SEAT, s)).toBeGreaterThan(1.5);
  }
  for (const s of layout.stick) expect(near(FIRE, s)).toBeGreaterThan(1); // a loose stick lies out of the ring of stones
  // Every leg of her ways home passes the fire with room to spare, her last steps to HOME too.
  HIDING.forEach((p, i) => {
    let from = p;
    for (const to of wayHome(i)) {
      for (let t = 0; t <= 1; t += 0.01) expect(near(FIRE, { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t })).toBeGreaterThan(CAMPFIRE.solid + 0.35);
      from = to;
    }
  });
});

test("the seat is beside the fire, within reach to read, facing her across it, on dry ground a beaver sits on", () => {
  const near = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);
  expect(near(SEAT, FIRE)).toBeGreaterThan(CAMPFIRE.solid + 0.4);
  expect(near(SEAT, FIRE)).toBeLessThan(SIT_REACH - 1);
  expect(near(SEAT, HOME)).toBeGreaterThan(near(FIRE, HOME) + 0.5); // across the fire from her
  // Seen from behind the seat, facing the fire, she stands off to one side of it, not hidden behind the beaver.
  const look = Math.atan2(FIRE.x - SEAT.x, FIRE.z - SEAT.z), toHer = Math.atan2(HOME.x - SEAT.x, HOME.z - SEAT.z);
  const side = Math.abs(Math.atan2(Math.sin(toHer - look), Math.cos(toHer - look)));
  expect(side).toBeGreaterThan(0.25);
  expect(side).toBeLessThan(0.7); // still in the picture
  expect(heightAt(SEAT.x, SEAT.z)).toBeGreaterThan(WATER_LEVEL + 0.05);
});
