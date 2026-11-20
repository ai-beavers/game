// The race's rules on the real pond: where the buoys lie, and what counts as a start, a buoy, a lap and a finish.
import { expect, test } from "bun:test";
import { heightAt, POND, SITE, WATER_LEVEL } from "../../world/terrain.ts";
import { CACHE_AT, POND_RISE } from "../build/rules.ts";
import { bankPlace } from "../canoe/place.ts";
import { cardShown, clock, course, LAPS, SHOWN, newRace, stepRace, type RaceEvent, type RaceState } from "./rules.ts";

/** m the lodge's mound reaches out at the water's surface: a ball 1.25 m round whose middle stays 1.3 m under the
 *  surface fully grown (build/dam.ts), deeper before; 1.25 × √(1 − (1.3 / 1.95)²) ≈ 0.93. */
const LODGE_REACH = 1.0;
const spawn = { x: -1.5, z: -3 }, low = WATER_LEVEL - POND_RISE;
const bank = bankPlace(POND, spawn, heightAt, low);
const c = course(POND, bank);
const from = (p: { x: number; z: number }, o: { x: number; z: number } = POND) => Math.hypot(p.x - o.x, p.z - o.z);
/** Points along the way the canoe paddles: buoy to buoy, round the ring. */
const way = () => c.buoys.flatMap((b, i) => {
  const n = c.buoys[(i + 1) % c.buoys.length]!;
  return Array.from({ length: 10 }, (_, k) => ({ x: b.x + (n.x - b.x) * k / 10, z: b.z + (n.z - b.z) * k / 10 }));
});

test("the ring is open water at the lowest pond, and clears the lodge and the food cache with room for the canoe", () => {
  const across = { x: POND.x - SITE.x, z: POND.z - SITE.z }, l = Math.hypot(across.x, across.z);
  const lodge = { x: POND.x + across.x / l * 0.6, z: POND.z + across.z / l * 0.6 }; // build/dam.ts lodgeAt
  for (const p of way()) {
    expect(low - heightAt(p.x, p.z)).toBeGreaterThan(0.3); // the canoe needs 0.25 m under its seat
    expect(from(p, lodge)).toBeGreaterThan(LODGE_REACH + 0.3 + 0.1); // the lodge, half the canoe's beam, a little
    expect(from(p, CACHE_AT)).toBeGreaterThan(0.4 + 0.3);
  }
  expect(c.buoys.length).toBeGreaterThanOrEqual(6);
});

test("the start line lies on the ring at the point nearest the canoe's bank, across the way round", () => {
  const { a, b, middle, forward } = c.start;
  const toBank = Math.atan2(bank.z - POND.z, bank.x - POND.x), atMiddle = Math.atan2(middle.z - POND.z, middle.x - POND.x);
  expect(Math.abs(Math.atan2(Math.sin(toBank - atMiddle), Math.cos(toBank - atMiddle)))).toBeLessThan(0.01);
  expect(from(a) < from(middle) && from(middle) < from(b) || from(b) < from(middle) && from(middle) < from(a)).toBe(true);
  // Forward runs along the ring towards the first buoy.
  const first = c.buoys[0]!, last = c.buoys[c.buoys.length - 1]!;
  expect((first.x - middle.x) * forward.x + (first.z - middle.z) * forward.z).toBeGreaterThan(0);
  expect((last.x - middle.x) * forward.x + (last.z - middle.z) * forward.z).toBeLessThan(0);
});

// ---- the race, stepped as the feature steps it: the canoe's feet from where they were to where they are ------------
type P = { x: number; z: number };
const dt = 0.1;
/** A paddler: moves the canoe in steps no longer than 0.3 m, and keeps every event. */
function paddler(state: RaceState = newRace()) {
  let at: P = { x: c.start.middle.x - c.start.forward.x * 1.5, z: c.start.middle.z - c.start.forward.z * 1.5 };
  const events: RaceEvent[] = [];
  let steps = 0, started = 0, finished = 0;
  const self = {
    get state() { return state; }, events,
    /** Steps from the step after the start to the finish. */
    get since() { return finished - started; },
    /** In a straight line to p, riding (or swimming). */
    to(p: P, riding = true) {
      const d = Math.hypot(p.x - at.x, p.z - at.z), n = Math.max(1, Math.ceil(d / 0.3));
      const from = at;
      for (let k = 1; k <= n; k++) {
        const next = { x: from.x + (p.x - from.x) * k / n, z: from.z + (p.z - from.z) * k / n };
        const r = stepRace(state, c, at, next, riding, dt);
        state = r.state; events.push(...r.events); at = next; steps++;
        if (r.events.some((e) => e.name === "raceStart")) started = steps;
        if (r.events.some((e) => e.name === "raceFinish")) finished = steps;
      }
      return self;
    },
    /** Across the start line forwards, from just behind it to just past it. */
    across(riding = true) {
      const { middle: m, forward: f } = c.start;
      return self.to({ x: m.x - f.x * 0.6, z: m.z - f.z * 0.6 }, riding).to({ x: m.x + f.x * 0.1, z: m.z + f.z * 0.1 }, riding);
    },
    /** Round every buoy of a lap in order. */
    round() { for (const b of c.buoys) self.to(b); return self; },
    names: () => events.map((e) => e.name),
  };
  return self;
}

test("crossing the start line in the canoe starts a race; swimming across it does not", () => {
  const swim = paddler().across(false);
  expect(swim.state.race.kind).toBe("idle");
  expect(swim.names()).toEqual([]);
  const ride = paddler().across();
  expect(ride.names()).toEqual(["raceStart"]);
  expect(ride.state.race).toMatchObject({ kind: "racing", lap: 1, next: 0 });
});

test("only the next buoy counts: one passed out of order is ignored, and a missed one stays next", () => {
  const p = paddler().across();
  const { middle: m, forward: f } = c.start;
  p.to({ x: m.x - f.x * 0.6, z: m.z - f.z * 0.6 }).to(POND).to(c.buoys[2]!); // back, and across the middle to the third
  expect(p.names()).toEqual(["raceStart"]);
  expect(p.state.race).toMatchObject({ next: 0 });
  p.to(c.buoys[0]!).to(c.buoys[1]!).to(c.buoys[2]!);
  expect(p.events.filter((e) => e.name === "buoyPassed")).toEqual([0, 1, 2].map((index) => ({ name: "buoyPassed", index })));
  expect(p.state.race).toMatchObject({ next: 3 });
});

test("crossing the line before every buoy of the lap is passed, or backwards, counts no lap", () => {
  const p = paddler().across();
  p.to(c.buoys[0]!).to(c.buoys[1]!);
  const { middle: m, forward: f } = c.start;
  p.to({ x: m.x - f.x * 0.6, z: m.z - f.z * 0.6 }).across(); // back over the line, and forwards again
  expect(p.names()).toEqual(["raceStart", "buoyPassed", "buoyPassed"]);
  expect(p.state.race).toMatchObject({ kind: "racing", lap: 1, next: 2 });
});

test("three full laps finish the race in the time they took", () => {
  const p = paddler().across();
  for (let lap = 1; lap <= LAPS; lap++) p.round().across();
  const laps = p.events.filter((e) => e.name === "lap");
  expect(laps).toEqual([1, 2, 3].map((lap) => ({ name: "lap", lap })));
  expect(p.state.race.kind).toBe("finished");
  const finish = p.events.at(-1)!;
  expect(finish.name).toBe("raceFinish");
  expect(p.events.filter((e) => e.name === "buoyPassed")).toHaveLength(3 * c.buoys.length);
  if (finish.name !== "raceFinish") return;
  expect(finish.time).toBeCloseTo(p.since * dt, 6); // the game's time from the start to the finish
  expect(finish).toMatchObject({ best: finish.time, newBest: true });
});

/** A whole race, three laps, with `slow` extra s of dawdling at the pond's middle on the way. */
const race = (p: ReturnType<typeof paddler>, slow = 0) => {
  p.across();
  for (let lap = 1; lap <= LAPS; lap++) {
    p.round();
    if (lap === 1) for (let t = 0; t < slow; t += dt) p.to(c.buoys[c.buoys.length - 1]!);
    p.across();
  }
  return p.events.at(-1)!;
};

test("a new race starts straight after a finish; the best time keeps the fastest, and only beating it is a new best", () => {
  const p = paddler();
  const first = race(p, 5);
  const second = race(p); // faster
  const third = race(p, 10); // slower
  expect(first).toMatchObject({ name: "raceFinish", newBest: true });
  expect(second).toMatchObject({ name: "raceFinish", newBest: true });
  if (second.name !== "raceFinish" || third.name !== "raceFinish" || first.name !== "raceFinish") return;
  expect(second.time).toBeLessThan(first.time - 4);
  expect(second.best).toBe(second.time);
  expect(third).toMatchObject({ newBest: false, best: second.time });
  expect(third.time).toBeGreaterThan(second.time + 9);
  expect(p.state.best).toBe(second.time);
  expect(p.events.filter((e) => e.name === "raceStart")).toHaveLength(3);
});

test("a tie with the best time is no new best", () => {
  const p = paddler(), a = race(p), b = race(p);
  expect(a).toMatchObject({ newBest: true });
  expect(b).toMatchObject({ newBest: false });
});

test("leaving the canoe mid-race abandons it: back to idle, no time recorded, the best time untouched", () => {
  const p = paddler();
  const done = race(p);
  p.across().round();
  p.to(POND, false); // out of the canoe, swimming
  expect(p.events.at(-1)).toEqual({ name: "raceAbandon" });
  expect(p.state.race).toEqual({ kind: "idle" });
  expect(p.state.best).toBe(done.name === "raceFinish" ? done.time : NaN);
  const fresh = paddler();
  fresh.across().round().to(POND, false);
  expect(fresh.state.best).toBeUndefined();
});

test("a finished race shows a while; getting out after it goes back to idle without abandoning anything", () => {
  const p = paddler();
  race(p);
  p.to(POND);
  expect(p.state.race).toMatchObject({ kind: "finished" });
  const shown = p.state.race.kind === "finished" ? p.state.race.since : 0;
  expect(shown).toBeGreaterThan(0);
  p.to(POND, false);
  expect(p.state.race).toEqual({ kind: "idle" });
  expect(p.names()).not.toContain("raceAbandon");
});

test("the race card: shown while racing and a few seconds after the finish, hidden otherwise; the time as m:ss.t", () => {
  expect(cardShown({ kind: "idle" })).toBe(false);
  expect(cardShown({ kind: "racing", lap: 1, next: 0, time: 0 })).toBe(true);
  expect(cardShown({ kind: "finished", time: 40, best: 40, newBest: true, since: SHOWN - 0.1 })).toBe(true);
  expect(cardShown({ kind: "finished", time: 40, best: 40, newBest: true, since: SHOWN })).toBe(false);
  expect(clock(0)).toBe("0:00.0");
  expect(clock(65.34)).toBe("1:05.3");
  expect(clock(59.97)).toBe("1:00.0"); // rounded to the tenth, not shown as 0:60.0
});

test("a jump of the feet (getting in, put somewhere) across the line is no crossing: only paddling counts", () => {
  const { middle: m, forward: f } = c.start;
  const far = { x: m.x - f.x * 3, z: m.z - f.z * 3 }, past = { x: m.x + f.x * 0.2, z: m.z + f.z * 0.2 };
  const r = stepRace(newRace(), c, far, past, true, dt);
  expect(r.events).toEqual([]);
  expect(r.state.race.kind).toBe("idle");
});
