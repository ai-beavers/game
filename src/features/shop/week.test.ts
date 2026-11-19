// The Calendar board's week as a player reads it: which dates are shown, which one is today, where "Build Fridays" is.
import { expect, test } from "bun:test";
import { BUILD_FRIDAYS, clock, week } from "./week.ts";

/** A local date, as the browser's clock gives it. */
const on = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);
const dates = (w: ReturnType<typeof week>) => w.days.map((d) => d.date);

test("a mid-week date gives its week Monday to Sunday, with today marked on its own day", () => {
  const w = week(on(2026, 11, 19));
  expect(w.days.map((d) => d.name)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  expect(dates(w)).toEqual([16, 17, 18, 19, 20, 21, 22]);
  expect(w.days.filter((d) => d.today).map((d) => d.date)).toEqual([19]);
  expect(w.title).toBe("November 2026");
});

test("a Monday and a Sunday each stand in their own week", () => {
  expect(dates(week(on(2026, 11, 16, 0)))).toEqual([16, 17, 18, 19, 20, 21, 22]);
  expect(dates(week(on(2026, 11, 22, 23)))).toEqual([16, 17, 18, 19, 20, 21, 22]);
  expect(week(on(2026, 11, 16)).days[0]!.today).toBe(true);
  expect(week(on(2026, 11, 22)).days[6]!.today).toBe(true);
});

test("Friday, and only Friday, carries Build Fridays, also when Friday is today", () => {
  const w = week(on(2026, 11, 20));
  expect(w.days.map((d) => d.entries)).toEqual([[], [], [], [], [{ name: "Build Fridays", from: 16, to: 23 }], [], []]);
  expect(w.days[4]).toMatchObject({ name: "Fri", date: 20, today: true });
});

test("a week over a month's end has the right dates and names both months", () => {
  const w = week(on(2026, 12, 3));
  expect(dates(w)).toEqual([30, 1, 2, 3, 4, 5, 6]);
  expect(w.days[0]!.key).toBe("2026-11-30");
  expect(w.title).toBe("Nov – Dec 2026");
});

test("a week over the year's end has the right dates and names both years", () => {
  const w = week(on(2027, 1, 1));
  expect(dates(w)).toEqual([28, 29, 30, 31, 1, 2, 3]);
  expect(w.days.map((d) => d.key)).toContain("2027-01-03");
  expect(w.days[4]).toMatchObject({ date: 1, today: true, entries: [BUILD_FRIDAYS] });
  expect(w.title).toBe("Dec 2026 – Jan 2027");
});

test("the names are English, Monday first, whatever the locale", () => {
  const w = week(on(2026, 3, 4));
  expect(w.days.map((d) => d.name)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  expect(w.title).toBe("March 2026");
});

/** Each day's entries, as name and hours. */
const entries = (w: ReturnType<typeof week>) => w.days.map((d) => d.entries.map((e) => `${e.name} ${e.from}-${e.to}`));

test("Build Fridays runs from 16 to 23 on the Friday only, across a month, a year and a clock change", () => {
  // Mid-month; over November's end; over the year's end; the week of the European clock change (25 October 2026).
  for (const date of [on(2026, 11, 19), on(2026, 12, 3), on(2027, 1, 1), on(2026, 10, 25, 3), on(2027, 3, 28, 2)]) {
    expect(entries(week(date))).toEqual([[], [], [], [], ["Build Fridays 16-23"], [], []]);
  }
  expect(BUILD_FRIDAYS).toEqual({ name: "Build Fridays", from: 16, to: 23 });
});

test("the board shows the hours 08:00 to 24:00, and every entry lies inside them", () => {
  const w = week(on(2026, 11, 20));
  expect(w.hours).toEqual({ from: 8, to: 24 });
  expect([clock(w.hours.from), clock(w.hours.to)]).toEqual(["08:00", "24:00"]);
  for (const e of w.days.flatMap((d) => d.entries)) {
    expect(e.from).toBeGreaterThanOrEqual(w.hours.from);
    expect(e.to).toBeLessThanOrEqual(w.hours.to);
    expect(e.from).toBeLessThan(e.to);
  }
});
