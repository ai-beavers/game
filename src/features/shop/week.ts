// The Calendar board's week: the real week, Monday to Sunday, in which the given local date falls. Depends on nothing
// but that date (the browser's own clock, not the Clearing's Day), so every edge of the calendar can be tested here.
//
//   week(new Date()) → { title: "November 2026", days: [{ name: "Mon", date: 16, key: "2026-11-16", today, entries }, …] }

export interface CalendarDay {
  /** English weekday, short: Mon … Sun. */
  name: string;
  /** The day of the month. */
  date: number;
  /** The local date as YYYY-MM-DD. */
  key: string;
  today: boolean;
  /** What is on this day: "Build Fridays" on every Friday, nothing else. */
  entries: string[];
}
export interface CalendarWeek { title: string; days: CalendarDay[] }

const NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const short = (m: number) => MONTHS[m]!.slice(0, 3);
export const BUILD_FRIDAYS = "Build Fridays";

/** The local date as YYYY-MM-DD. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function week(now: Date): CalendarWeek {
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
    days: days.map((d, i) => ({ name: NAMES[i]!, date: d.getDate(), key: dayKey(d), today: i === back, entries: i === 4 ? [BUILD_FRIDAYS] : [] })),
  };
}
