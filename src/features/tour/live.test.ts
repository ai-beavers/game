import { expect, test } from "bun:test";
import { bodyPoints, CHOICES, direct, enter, eyeAt, framing, glide, inside, liveDirector, newHold, shotFor, sight, volume, type Choice, type Moment, type Station, type Volume, type XYZ } from "./live.ts";

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

// ---- a clear view ----
const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number, round = false) =>
  volume({ x, y, z }, [{ x: hx, y: 0, z: 0 }, { x: 0, y: hy, z: 0 }, { x: 0, y: 0, z: hz }], round);
const feet = { x: 0, y: 0, z: 0 }, look = { x: 0, y: 0.7, z: 0 }, points = bodyPoints(feet);
const shot = shotFor("Dam work", false), behind = Math.PI; // the beaver faces +z: behind it is -z
const shows = (volumes: Volume[]) => (c: Choice) => sight(eyeAt(look, framing(behind, shot, 1, c)), points, volumes).seen;

test("volumes: a box or a round crown in the way, a turned one, the start inside", () => {
  const crate = box(0, 0.5, 2, 0.5, 0.5, 0.5);
  expect(enter(crate, { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0.5, z: 4 })).toBeCloseTo(0.375);
  expect(enter(crate, { x: 2, y: 0.5, z: 0 }, { x: 2, y: 0.5, z: 4 })).toBe(Infinity);
  expect(enter(crate, { x: 0, y: 0.5, z: 2 }, { x: 0, y: 0.5, z: 4 })).toBe(0);
  // The corner of a crown's box is air: the ellipsoid lets that ray by.
  expect(enter(box(0, 0, 0, 1, 1, 1, true), { x: -2, y: 0.9, z: 0.9 }, { x: 2, y: 0.9, z: 0.9 })).toBe(Infinity);
  expect(enter(box(0, 0, 0, 1, 1, 1), { x: -2, y: 0.9, z: 0.9 }, { x: 2, y: 0.9, z: 0.9 })).toBeCloseTo(0.25);
  // A log lying turned 45°: thin across, long along.
  const s = Math.SQRT1_2, log = volume({ x: 0, y: 0, z: 0 }, [{ x: 2 * s, y: 0, z: 2 * s }, { x: 0, y: 0.2, z: 0 }, { x: -0.2 * s, y: 0, z: 0.2 * s }]);
  expect(inside(log, { x: 1.2, y: 0, z: 1.2 })).toBe(true);
  expect(inside(log, { x: 1.2, y: 0, z: -1.2 })).toBe(false);
  expect(inside(log, { x: 0, y: 0.35, z: 0 }, 0.2)).toBe(true); // grown by a margin
});

test("the beaver is hidden behind stacked crates, seen past them, and a crown round it does not count", () => {
  const eye = { x: 0, y: 1, z: -5 }, crates = box(0, 0.75, -2.5, 0.8, 0.75, 0.3);
  expect(sight(eye, points, [crates]).seen).toBe(false);
  expect(sight(eye, points, [box(3, 0.75, -2.5, 0.8, 0.75, 0.3)]).seen).toBe(true);
  expect(sight(eye, points, [box(0, 0.5, 0, 1.5, 1, 1.5)]).seen).toBe(true); // among reeds: no camera move helps
  expect(sight(eye, points, [box(0, 1, -5, 1, 1, 1, true)]).within).toBe(true); // the camera in a bush
  expect(sight(eye, points, [], (_, p) => p.y < 0.4).seen).toBe(true); // the ground hides the feet only
});

test("a clear angle: the other side, then higher, then closer; none when it is walled in", () => {
  const side = (sign: number) => eyeAt(look, framing(behind, shot, sign, CHOICES[0]!));
  const wall = (at: XYZ, round = false) => box((at.x + look.x) / 2, 0.5, (at.z + look.z) / 2, 0.6, 0.6, 0.6, round);
  expect(CHOICES.find(shows([]))).toEqual(CHOICES[0]!);
  expect(CHOICES.find(shows([wall(side(1))]))).toMatchObject({ other: true, higher: false });
  // Crates on both sides, low: over them.
  expect(CHOICES.find(shows([wall(side(1)), wall(side(-1))]))).toMatchObject({ other: false, higher: true, closer: false });
  // A bush where the camera would stand, on both sides and high: closer, in front of it.
  const far = (sign: number, higher: boolean) => box(side(sign).x, eyeAt(look, framing(behind, shot, sign, { other: false, higher, closer: false })).y, side(sign).z, 0.8, 0.8, 0.8, true);
  expect(CHOICES.find(shows([far(1, false), far(-1, false), far(1, true), far(-1, true)]))).toMatchObject({ closer: true });
  // Walled in all round, close: no angle shows it.
  const ring = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => box(Math.sin(k * Math.PI / 4) * 1.2, 1.5, Math.cos(k * Math.PI / 4) * 1.2, 0.6, 1.5, 0.6));
  expect(CHOICES.find(shows(ring))).toBe(undefined);
});

test("calm: a new angle only for a hidden beaver, held for seconds, and a fade when none shows it", () => {
  const all = () => true, otherOnly = (c: Choice) => c.other, none = () => false;
  let { hold } = direct(newHold(), 0.25, true, otherOnly);
  expect(hold.choice.other).toBe(false); // hidden for a moment only: no move yet
  ({ hold } = direct(hold, 0.3, true, otherOnly));
  expect(hold.choice.other).toBe(true);
  for (let t = 0; t < 5; t += 0.25) ({ hold } = direct(hold, 0.25, false, all));
  expect(hold.choice.other).toBe(true); // seen, and the plain shot clear again: still held
  for (let t = 0; t < 1.5; t += 0.25) ({ hold } = direct(hold, 0.25, false, all));
  expect(hold.choice.other).toBe(false); // after CALM s back to the plain shot
  const hidden = direct(direct(newHold(), 0.3, true, none).hold, 0.3, true, none);
  expect(hidden.fade).toBe(true);
  expect(direct(newHold(), 0.3, false, none).fade).toBe(false);
});

test("the camera glides: eased in, never faster than its bound, and gets there", () => {
  let x = 0, v = 0, top = 0;
  const steps: number[] = [];
  for (let t = 0; t < 30; t += 1 / 60) {
    const was = x;
    [x, v] = glide(x, v, 3, 1.5, 0.4, 1 / 60);
    steps.push((x - was) * 60);
    top = Math.max(top, (x - was) * 60);
  }
  expect(top).toBeLessThanOrEqual(0.4 + 1e-9);
  expect(steps[0]!).toBeLessThan(0.1); // starts slowly: no jolt
  expect(x).toBeCloseTo(3, 2);
});
