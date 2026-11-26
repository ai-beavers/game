// The Calendar board's week: the real week, Monday to Sunday, in which the given local date falls, with Build Fridays
// and the House of AI events of that week. Depends on nothing but that date and those events (the browser's own clock,
// not the Clearing's Day), so every edge of the calendar can be tested here.
//
//   week(new Date(), events) → { title: "November 2026", hours: { from: 8, to: 24 },
//                                days: [{ name: "Mon", date: 16, key: "2026-11-16", today, entries: [] }, …] }
//   clock(18.5) → "18:30"   span(BUILD_FRIDAYS) → "16:00 – 23:00"
import type { HouseEvent } from "./feed.ts";

export interface CalendarDay {
  /** English weekday, short: Mon … Sun. */
  name: string;
  /** The day of the month. */
  date: number;
  /** The local date as YYYY-MM-DD. */
  key: string;
  today: boolean;
  /** What is on this day, by start: Build Fridays on every Friday, and the House of AI events on it. */
  entries: CalendarEntry[];
}
/** An event on the board, in local clock hours (18.5 is 18:30), within the board's hours. Overlapping entries of a day
 *  stand side by side: this one in `lane` (0 on the left) of `lanes`. */
export interface CalendarEntry { name: string; from: number; to: number; lane: number; lanes: number }
export interface CalendarWeek {
  title: string;
  /** The hours the board shows, in whole local clock hours (to 24 is midnight). */
  hours: { from: number; to: number };
  days: CalendarDay[];
}

const NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const short = (m: number) => MONTHS[m]!.slice(0, 3);
/** Every Friday, 16:00 to 23:00 by the viewer's own clock. */
export const BUILD_FRIDAYS: Readonly<{ name: string; from: number; to: number }> = Object.freeze({ name: "Build Fridays", from: 16, to: 23 });
/** A House of AI event that is Build Fridays itself (the feed calls it "build fridays hamburg - …"). */
const isBuildFridays = (name: string) => /^\s*build fridays\b/i.test(name);
const HOURS = Object.freeze({ from: 8, to: 24 });

/** A clock time in hours as written on the board, to the minute: 8 → "08:00", 18.5 → "18:30", 24 → "24:00". */
export const clock = (h: number) => {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
/** From one time to another as written on the board: "16:00 – 23:00". */
export const span = (r: { from: number; to: number }) => `${clock(r.from)} – ${clock(r.to)}`;

/** The local date as YYYY-MM-DD. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The local clock hour of a moment on the day starting at `midnight`: 0 before it, 24 from the next midnight on. */
function hourOn(t: number, midnight: Date, next: Date) {
  if (t <= midnight.getTime()) return 0;
  if (t >= next.getTime()) return 24;
  const d = new Date(t);
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

/** Each entry's lane among those it overlaps: the lowest lane free at its start; `lanes` is the most lanes any group of
 *  entries overlapping one another needs. Entries come in sorted by start. */
function lay(entries: { name: string; from: number; to: number }[]): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  let group: CalendarEntry[] = [], end = -Infinity;
  const close = () => { const n = Math.max(0, ...group.map((e) => e.lane + 1)); for (const e of group) e.lanes = n; group = []; };
  for (const e of entries) {
    if (e.from >= end) { close(); end = -Infinity; }
    const busy = group.filter((g) => g.to > e.from).map((g) => g.lane);
    let lane = 0;
    while (busy.includes(lane)) lane++;
    const entry = { ...e, lane, lanes: 1 };
    group.push(entry); out.push(entry);
    end = Math.max(end, e.to);
  }
  close();
  return out;
}

/** The week of the local date `now`, with Build Fridays and the House of AI events (absolute moments) on the days they
 *  cover, each clipped to its day and to the board's hours; what is left of none is left out. */
export function week(now: Date, events: readonly HouseEvent[] = []): CalendarWeek {
  const back = (now.getDay() + 6) % 7; // days since Monday
  // Noon, so a clock change in the night never moves a day.
  const days = NAMES.map((name, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back + i, 12));
  const first = days[0]!, last = days[6]!;
  const title = first.getMonth() === last.getMonth()
    ? `${MONTHS[first.getMonth()]} ${first.getFullYear()}`
    : first.getFullYear() === last.getFullYear()
      ? `${short(first.getMonth())} – ${short(last.getMonth())} ${last.getFullYear()}`
      : `${short(first.getMonth())} ${first.getFullYear()} – ${short(last.getMonth())} ${last.getFullYear()}`;
  return {
    title,
    hours: { ...HOURS },
    days: days.map((d, i) => {
      const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()), next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      const on: { name: string; from: number; to: number }[] = i === 4 ? [{ ...BUILD_FRIDAYS }] : [];
      for (const e of events) {
        if (i === 4 && isBuildFridays(e.name)) continue; // drawn once, at its fixed hours
        const from = Math.max(HOURS.from, hourOn(Date.parse(e.start), midnight, next));
        const to = Math.min(HOURS.to, hourOn(Date.parse(e.end), midnight, next));
        if (to > from) on.push({ name: e.name, from, to });
      }
      on.sort((a, b) => a.from - b.from || b.to - a.to || a.name.localeCompare(b.name));
      return { name: NAMES[i]!, date: d.getDate(), key: dayKey(d), today: i === back, entries: lay(on) };
    }),
  };
}
