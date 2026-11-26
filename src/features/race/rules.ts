// The Race's rules as plain numbers, so they can be tested without a scene: where the buoys lie on the pond, and a
// race stepped with the canoe's way since the last step.
//
//   const c = course(pond, bank)                                     the buoys in order and the start line
//   ({ state, events } = stepRace(state, c, from, to, riding, dt))   once per physics step
//
// A race: crossing the start line forwards in the canoe starts the clock; every buoy must be passed in order (only the
// next one counts); crossing the line again after the last buoy of a lap counts the lap; after LAPS laps the race is
// finished. Out of the canoe the race is abandoned and nothing is recorded. best: the fastest finished race of this
// visit, never saved.

export interface Place { x: number; z: number }

/** Laps in a race. */
export const LAPS = 3;
/** m from the pond's middle to the ring of buoys: past the lodge (0.6 m off the middle, 1.25 m round) and the canoe's
 *  half beam even on the chords between buoys, and inside the lowest pond's deep water (about 2.75 m out). */
export const RING = 2.4;
/** Buoys round the ring. */
export const BUOYS = 8;
/** m from a buoy within which the canoe (the beaver's feet) passes it. */
export const PASS = 0.7;
/** m the feet may move in one step and still be paddling: further is a jump (getting in, a teleport), no crossing. */
export const JUMP = 0.5;
/** m from the start line's middle to each of its two buoys. */
export const LINE = 0.55;

export interface Course {
  /** In the order they are passed, the first just after the start line. */
  buoys: Place[];
  /** The start line: its two buoys (inner, outer), its middle on the ring, and the way across it that counts (unit). */
  start: { a: Place; b: Place; middle: Place; forward: Place };
}

/** The ring round the pond's middle, its start line at the point nearest the canoe's bank; round anticlockwise seen
 *  from above (+x to +z). */
export function course(pond: Place, bank: Place): Course {
  const at = Math.atan2(bank.z - pond.z, bank.x - pond.x), out = { x: Math.cos(at), z: Math.sin(at) };
  const ring = (a: number, r = RING) => ({ x: pond.x + Math.cos(a) * r, z: pond.z + Math.sin(a) * r });
  const buoys = Array.from({ length: BUOYS }, (_, k) => ring(at + (k + 0.5) * 2 * Math.PI / BUOYS));
  const middle = ring(at);
  return {
    buoys,
    start: { a: ring(at, RING - LINE), b: ring(at, RING + LINE), middle, forward: { x: -out.z, z: out.x } },
  };
}

export type Race =
  | { kind: "idle" }
  /** On lap `lap` (1 … LAPS), `next` the buoy to pass next (BUOYS: every buoy of the lap is passed), time s since the start. */
  | { kind: "racing"; lap: number; next: number; time: number }
  /** Just finished in `time` s; best is the fastest of the visit now; newBest whether this one set it. since: s ago. */
  | { kind: "finished"; time: number; best: number; newBest: boolean; since: number };
/** A player's race now and the best time of the visit (undefined: none finished yet). */
export interface RaceState { race: Race; best?: number }
export type RaceEvent =
  | { name: "raceStart" }
  | { name: "buoyPassed"; index: number }
  | { name: "lap"; lap: number }
  | { name: "raceFinish"; time: number; best: number; newBest: boolean }
  | { name: "raceAbandon" };

export const newRace = (): RaceState => ({ race: { kind: "idle" } });

/** Whether the way from → to crosses the start line forwards, between its two buoys. */
export function crossesForwards(c: Course, from: Place, to: Place) {
  const { middle: m, forward: f } = c.start;
  const ahead = (p: Place) => (p.x - m.x) * f.x + (p.z - m.z) * f.z, side = (p: Place) => (p.x - m.x) * -f.z + (p.z - m.z) * f.x;
  const s0 = ahead(from), s1 = ahead(to);
  if (!(s0 < 0 && s1 >= 0)) return false;
  const k = s0 / (s0 - s1), across = side(from) + (side(to) - side(from)) * k;
  return Math.abs(across) <= LINE;
}

/** One step of the race: the canoe (the beaver's feet) went from `from` to `to` in dt s; riding: the beaver sits in it. */
export function stepRace(s: RaceState, c: Course, from: Place, to: Place, riding: boolean, dt: number): { state: RaceState; events: RaceEvent[] } {
  const r = s.race, events: RaceEvent[] = [];
  const crossed = riding && Math.hypot(to.x - from.x, to.z - from.z) <= JUMP && crossesForwards(c, from, to);
  if (!riding && r.kind !== "idle") {
    if (r.kind === "racing") events.push({ name: "raceAbandon" });
    return { state: { ...s, race: { kind: "idle" } }, events };
  }
  if (r.kind !== "racing" && crossed) {
    events.push({ name: "raceStart" });
    return { state: { ...s, race: { kind: "racing", lap: 1, next: 0, time: 0 } }, events };
  }
  if (r.kind === "finished") return { state: { ...s, race: { ...r, since: r.since + dt } }, events };
  if (r.kind !== "racing") return { state: s, events };
  let { lap, next } = r;
  const time = r.time + dt;
  const buoy = c.buoys[next];
  if (buoy && Math.hypot(to.x - buoy.x, to.z - buoy.z) < PASS) events.push({ name: "buoyPassed", index: next++ });
  if (next >= c.buoys.length && crossed) {
    events.push({ name: "lap", lap });
    if (lap >= LAPS) {
      const newBest = s.best === undefined || time < s.best, best = newBest ? time : s.best!;
      events.push({ name: "raceFinish", time, best, newBest });
      return { state: { best, race: { kind: "finished", time, best, newBest, since: 0 } }, events };
    }
    lap++; next = 0;
  }
  return { state: { ...s, race: { kind: "racing", lap, next, time } }, events };
}

/** s the race card stays up after the finish, showing the time. */
export const SHOWN = 5;
/** Whether the race card is up: while racing, and a few seconds after the finish. */
export const cardShown = (r: Race) => r.kind === "racing" || r.kind === "finished" && r.since < SHOWN;
/** A time as the race card shows it: m:ss.t. */
export function clock(seconds: number) {
  const tenths = Math.round(seconds * 10), m = Math.floor(tenths / 600), rest = tenths - m * 600;
  return `${m}:${String(Math.floor(rest / 10)).padStart(2, "0")}.${rest % 10}`;
}
