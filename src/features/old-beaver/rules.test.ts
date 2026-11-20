// The Old Beaver's rules as a player meets them: where he sits, when he begins a lore, how its lines follow one
// another, when he breaks off, and which lore comes next.
import { expect, test } from "bun:test";
import { placeAll, SPAWN } from "../../world/place.ts";
import { HILL, heightAt, pondRatio, RIM, SITE, slopeAt, sunsetGap, WATER_LEVEL } from "../../world/terrain.ts";
import { SHOP } from "../shop/place.ts";
import { POST } from "../trade/place.ts";
import { FLOWER, HIDING } from "../mrs-beaver/rules.ts";
import { BREAK, EARSHOT, LINE_MAX, lineTime, LORES, newVisit, PLACE, START, tell, type Visit } from "./rules.ts";

const far = (p: { x: number; z: number }, q: { x: number; z: number }, d: number) => expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(d);

test("he sits on dry, flat land about 30 m out, just inside where the bank starts, clear of everything that has a place", () => {
  const r = Math.hypot(PLACE.x, PLACE.z);
  expect(r).toBeGreaterThan(28);
  expect(r).toBeLessThan(RIM - 1);
  expect(heightAt(PLACE.x, PLACE.z)).toBeGreaterThan(WATER_LEVEL + 0.1);
  expect(heightAt(PLACE.x, PLACE.z)).toBeLessThan(0.8); // the foot of the bank, not up on it
  expect(slopeAt(PLACE.x, PLACE.z)).toBeLessThan(0.15);
  expect(pondRatio(PLACE.x, PLACE.z)).toBeGreaterThan(3);
  expect(sunsetGap(PLACE.x, PLACE.z)).toBe(0);
  far(PLACE, SITE, 15);
  far(PLACE, SHOP, 10); // the Shop and the Calendar board beside it
  far(PLACE, POST, 15);
  far(PLACE, HILL, HILL.gentle + 2);
  far(PLACE, SPAWN, 15);
  for (const p of [...HIDING, ...FLOWER]) far(PLACE, p, 8);
});

test("he sits clear of the trees, rocks, stumps, logs, bushes and sticks laid out, with trees and thicket round him", () => {
  const layout = placeAll();
  for (const s of layout.tree) far(PLACE, s, 1.6);
  for (const s of [...layout.rock, ...layout.stump]) far(PLACE, s, 1.2);
  for (const s of layout.log) far(PLACE, s, 1.9);
  for (const s of layout.bush) far(PLACE, s, 1);
  for (const s of layout.stick) far(PLACE, s, 1.5);
  // Half hidden: a tree within a few metres, and thicket close behind him.
  expect(layout.tree.filter((s) => Math.hypot(s.x - PLACE.x, s.z - PLACE.z) < 6).length).toBeGreaterThanOrEqual(1);
  expect(layout.bush.filter((s) => Math.hypot(s.x - PLACE.x, s.z - PLACE.z) < 4).length).toBeGreaterThanOrEqual(4);
});

test("coming within the start distance on land begins the first lore at its first line; afloat or farther, nothing", () => {
  expect(START).toBeGreaterThanOrEqual(3);
  expect(START).toBeLessThanOrEqual(5);
  const visit = newVisit();
  expect(tell(visit, { distance: START + 0.5, land: true }, 0.1)).toEqual([]);
  expect(tell(visit, { distance: 2, land: false }, 0.1)).toEqual([]); // swimming by, or in the canoe
  expect(visit.state).toBe("idle");
  expect(tell(visit, { distance: START - 0.1, land: true }, 0.1)).toEqual([
    { kind: "lore", lore: 0 },
    { kind: "line", lore: 0, line: 0, text: LORES[0]![0]!, words: 10 },
  ]);
  expect(visit).toMatchObject({ state: "telling", lore: 0, line: 0 });
  expect(BREAK).toBeGreaterThan(START);
});

/** Stays where it is (distance m, on land) for s seconds in steps of 1/60 s; everything that happened, in order. */
const stay = (visit: Visit, distance: number, s: number) => {
  const all = [];
  for (let t = 0; t < s; t += 1 / 60) all.push(...tell(visit, { distance, land: true }, 1 / 60));
  return all;
};

test("a line stays up one slow murmur syllable a word plus a pause; then the next line, and after the last the lore ends", () => {
  expect(lineTime("one two three four five six seven eight nine ten")).toBeGreaterThan(4); // 10 words: time to read
  expect(lineTime("one two three four five six seven eight nine ten")).toBeLessThan(8);
  expect(lineTime("a b c d e f")).toBeLessThan(lineTime("a b c d e f g h i j k l"));
  const visit = newVisit(), first = LORES[0]!;
  tell(visit, { distance: 2, land: true }, 0);
  expect(stay(visit, 2, lineTime(first[0]!) - 0.1)).toEqual([]);
  expect(stay(visit, 2, 0.2).map((h) => h.kind === "line" && h.line)).toEqual([1]);
  const rest = stay(visit, 2, first.slice(1).reduce((s, l) => s + lineTime(l), 0));
  expect(rest.map((h): string => h.kind)).toEqual([...first.slice(2).map(() => "line"), "ended"]);
  expect(visit.state).toBe("away");
});

/** s the whole of lore i takes. */
const loreTime = (i: number) => LORES[i]!.reduce((s, l) => s + lineTime(l), 0);

test("staying close after a lore ends begins no other; leaving beyond the break-off distance and coming back begins the next", () => {
  const visit = newVisit();
  stay(visit, 2, loreTime(0) + 0.5);
  expect(visit.state).toBe("away");
  expect(stay(visit, 2, 30)).toEqual([]); // standing next to him: no lore after lore
  expect(stay(visit, BREAK - 1, 2)).toEqual([]); // a few steps off is not leaving
  expect(stay(visit, 2, 1)).toEqual([]);
  expect(stay(visit, BREAK + 1, 1)).toEqual([]);
  expect(stay(visit, 3, 0.1)[0]).toEqual({ kind: "lore", lore: 1 });
});

test("after the last lore, the next approach begins the first again", () => {
  const visit = newVisit(), begun: number[] = [];
  for (let k = 0; k < LORES.length + 2; k++) {
    for (const h of stay(visit, 2, 0.1)) if (h.kind === "lore") begun.push(h.lore);
    stay(visit, 2, 60);
    stay(visit, BREAK + 2, 0.1);
  }
  expect(LORES.length).toBeGreaterThanOrEqual(5);
  expect(begun).toEqual([...LORES.map((_, i) => i), 0, 1]);
});

test("walking off mid-lore he tells on as far as a voice carries; out of earshot he breaks off exactly once, and is ready for the next lore", () => {
  expect(EARSHOT).toBeGreaterThanOrEqual(15); // a talking voice over a clearing
  expect(EARSHOT).toBeLessThanOrEqual(30);
  const visit = newVisit();
  stay(visit, 2, lineTime(LORES[0]![0]!) + 0.5);
  expect(stay(visit, BREAK + 0.5, 0.5)).toEqual([]); // left his side, still within earshot: he goes on
  expect(stay(visit, EARSHOT - 0.5, 0.5)).toEqual([]);
  expect(tell(visit, { distance: EARSHOT - 0.5, land: false }, 0.1)).toEqual([]); // heard from the water, too
  expect(stay(visit, EARSHOT + 0.5, 1)).toEqual([{ kind: "broke", lore: 0 }]);
  expect(stay(visit, EARSHOT + 3, 5)).toEqual([]);
  expect(visit.state).toBe("idle");
  expect(stay(visit, 3, 0.1)[0]).toEqual({ kind: "lore", lore: 1 });
});

test("every lore is two or three lines, each short enough for one or two rows of the speech box", () => {
  for (const lore of LORES) {
    expect(lore.length).toBeGreaterThanOrEqual(2);
    expect(lore.length).toBeLessThanOrEqual(3);
    for (const line of lore) expect(line.length, line).toBeLessThanOrEqual(LINE_MAX);
  }
  expect(LINE_MAX).toBeLessThanOrEqual(64);
});

test("going into the water or the canoe near him mid-lore breaks off once, and the next lore waits until the player has left", () => {
  const visit = newVisit();
  tell(visit, { distance: 2, land: true }, 0.1);
  expect(tell(visit, { distance: 3, land: false }, 0.1)).toEqual([{ kind: "broke", lore: 0 }]);
  expect(tell(visit, { distance: 3, land: false }, 0.1)).toEqual([]);
  expect(stay(visit, 2, 5)).toEqual([]); // back on land beside him: no new lore yet
  stay(visit, BREAK + 1, 0.1);
  expect(stay(visit, 3, 0.1)[0]).toEqual({ kind: "lore", lore: 1 });
});
