// The Calendar board's week as a player reads it: which dates are shown, which one is today, which hours it shows, and when "Build Fridays" is.
import { expect, test } from "bun:test";
import { BUILD_FRIDAYS, clock, span, week } from "./week.ts";

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
  expect(w.days.map((d) => d.entries)).toEqual([[], [], [], [], [{ name: "Build Fridays", from: 16, to: 23, lane: 0, lanes: 1 }], [], []]);
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

// ---- House of AI events: each at its real moment on the viewer's own clock ----------------------------------------

/** Runs `body` with the browser's clock in the time zone `tz`. */
function inZone<T>(tz: string, body: () => T): T {
  const was = process.env.TZ;
  process.env.TZ = tz;
  try { return body(); } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
}
/** Each day's entries as the board writes them: name and clock span. */
const said = (w: ReturnType<typeof week>) => w.days.map((d) => d.entries.map((e) => `${e.name} ${span(e)}`));

test("a House of AI event starting at half past stands on its day between the hour lines and reads 18:30", () => {
  inZone("Europe/Berlin", () => {
    const w = week(on(2026, 11, 19), [{ name: "Vue.js Meetup", start: "2026-11-17T17:30:00Z", end: "2026-11-17T20:00:00Z" }]);
    expect(w.days[1]!.entries).toEqual([{ name: "Vue.js Meetup", from: 18.5, to: 21, lane: 0, lanes: 1 }]);
    expect(said(w)[1]).toEqual(["Vue.js Meetup 18:30 – 21:00"]);
    expect(clock(18.5)).toBe("18:30");
    expect(clock(9.75)).toBe("09:45");
  });
});

test("one moment lands on the day and hour of each viewer's own clock, across a change of day", () => {
  const events = [{ name: "LLMday", start: "2026-11-18T23:30:00Z", end: "2026-11-19T03:00:00Z" }];
  // Berlin (UTC+1): Thursday 00:30 – 04:00, before the board's hours: nothing shows.
  inZone("Europe/Berlin", () => expect(said(week(on(2026, 11, 19), events)).flat()).toEqual(["Build Fridays 16:00 – 23:00"]));
  // New York (UTC−5): Wednesday 18:30 – 22:00.
  inZone("America/New_York", () => expect(said(week(on(2026, 11, 19), events))[2]).toEqual(["LLMday 18:30 – 22:00"]));
  // Tokyo (UTC+9): Thursday 08:30 – 12:00.
  inZone("Asia/Tokyo", () => expect(said(week(on(2026, 11, 19), events))[3]).toEqual(["LLMday 08:30 – 12:00"]));
});

test("an event is clipped to the board's hours: an early start shows from 08:00", () => {
  inZone("UTC", () => {
    const w = week(on(2026, 11, 19), [{ name: "Breakfast", start: "2026-11-20T06:00:00Z", end: "2026-11-20T09:15:00Z" }]);
    expect(said(w)[4]).toEqual(["Breakfast 08:00 – 09:15", "Build Fridays 16:00 – 23:00"]);
  });
});

test("an event past midnight shows on each of its days, each part clipped to its day", () => {
  inZone("UTC", () => {
    const w = week(on(2026, 11, 19), [{ name: "Hackathon", start: "2026-11-17T20:00:00Z", end: "2026-11-18T11:00:00Z" }]);
    expect(said(w)).toEqual([[], ["Hackathon 20:00 – 24:00"], ["Hackathon 08:00 – 11:00"], [], ["Build Fridays 16:00 – 23:00"], [], []]);
  });
});

test("events wholly outside the board's hours or outside the week are left off", () => {
  inZone("UTC", () => {
    const w = week(on(2026, 11, 19), [
      { name: "Night owls", start: "2026-11-18T01:00:00Z", end: "2026-11-18T07:00:00Z" },
      { name: "Last week", start: "2026-11-13T10:00:00Z", end: "2026-11-13T12:00:00Z" },
      { name: "Next week", start: "2026-11-23T10:00:00Z", end: "2026-11-23T12:00:00Z" },
      { name: "Ends at eight", start: "2026-11-19T06:00:00Z", end: "2026-11-19T08:00:00Z" },
    ]);
    expect(said(w)).toEqual([[], [], [], [], ["Build Fridays 16:00 – 23:00"], [], []]);
  });
});

test("events that overlap on a day stand side by side; one after them takes the whole column again", () => {
  inZone("UTC", () => {
    const w = week(on(2026, 11, 19), [
      { name: "Workshop", start: "2026-11-21T10:00:00Z", end: "2026-11-21T14:00:00Z" },
      { name: "Lunch", start: "2026-11-21T12:00:00Z", end: "2026-11-21T13:00:00Z" },
      { name: "Talk", start: "2026-11-21T13:30:00Z", end: "2026-11-21T15:00:00Z" },
      { name: "Party", start: "2026-11-21T19:00:00Z", end: "2026-11-21T23:00:00Z" },
    ]);
    expect(w.days[5]!.entries.map((e) => `${e.name} ${e.lane}/${e.lanes}`)).toEqual(["Workshop 0/2", "Lunch 1/2", "Talk 1/2", "Party 0/1"]);
  });
});

test("Build Fridays is drawn once, at its fixed hours, when the House of AI calendar lists it too", () => {
  inZone("Europe/Berlin", () => {
    const w = week(on(2026, 11, 19), [
      { name: "build fridays hamburg - work on your startup alongside others", start: "2026-11-20T15:00:00Z", end: "2026-11-20T22:00:00Z" },
      { name: "AI & Matcha", start: "2026-11-20T09:00:00Z", end: "2026-11-20T11:00:00Z" },
    ]);
    expect(said(w)[4]).toEqual(["AI & Matcha 10:00 – 12:00", "Build Fridays 16:00 – 23:00"]);
  });
});

test("without events the week is what it always was", () => {
  expect(week(on(2026, 11, 19), [])).toEqual(week(on(2026, 11, 19)));
  expect(said(week(on(2026, 11, 19)))).toEqual([[], [], [], [], ["Build Fridays 16:00 – 23:00"], [], []]);
});
