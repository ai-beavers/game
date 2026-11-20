// The House of AI events as the server reads them from the Luma calendar's iCal feed: timed events with their real
// moments, whatever time zone the feed writes them in; all-day and cancelled events left out; names kept short; and
// text that is no calendar giving no events rather than an error. Also what the browser accepts from the server.
import { expect, test } from "bun:test";
import { parse, readEvents, upcoming } from "./feed.ts";

const ics = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Luma//House of AI Hamburg//EN",
  ...events.flatMap((e) => ["BEGIN:VEVENT", ...e.split("\n"), "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");

test("timed events are read with their real moments, in UTC and in a named time zone", () => {
  expect(parse(ics(
    "DTSTART:20261118T080000Z\nDTEND:20261118T163000Z\nSUMMARY:LLMday Hamburg 2026 Q4",
    "DTSTART;TZID=Europe/Berlin:20261120T100000\nDTEND;TZID=Europe/Berlin:20261120T120000\nSUMMARY:AI & Matcha: Frühstücksevent",
    "DTSTART;TZID=Europe/Berlin:20260715T183000\nDTEND;TZID=Europe/Berlin:20260715T200000\nSUMMARY:Summer talk",
  ))).toEqual([
    { name: "LLMday Hamburg 2026 Q4", start: "2026-11-18T08:00:00.000Z", end: "2026-11-18T16:30:00.000Z" },
    { name: "AI & Matcha: Frühstücksevent", start: "2026-11-20T09:00:00.000Z", end: "2026-11-20T11:00:00.000Z" },
    { name: "Summer talk", start: "2026-07-15T16:30:00.000Z", end: "2026-07-15T18:00:00.000Z" }, // summer time, UTC+2
  ]);
});

test("names folded over lines and escaped are read whole; a duration stands in for a missing end", () => {
  expect(parse(ics("DTSTART:20261123T170000Z\nDURATION:PT1H30M\nSUMMARY:Future of Software\\, Hamburg \; part\n  two"))).toEqual([
    { name: "Future of Software, Hamburg ; part two", start: "2026-11-23T17:00:00.000Z", end: "2026-11-23T18:30:00.000Z" },
  ]);
});

test("all-day and cancelled events are left out", () => {
  expect(parse(ics(
    "DTSTART;VALUE=DATE:20261121\nDTEND;VALUE=DATE:20261122\nSUMMARY:Open day",
    "DTSTART:20261121T100000Z\nDTEND:20261121T120000Z\nSUMMARY:Called off\nSTATUS:CANCELLED",
    "DTSTART:20261121T130000Z\nDTEND:20261121T140000Z\nSUMMARY:On",
  )).map((e) => e.name)).toEqual(["On"]);
});

test("very long names are cut to about 60 characters", () => {
  const [event] = parse(ics(`DTSTART:20261113T150000Z\nDTEND:20261113T220000Z\nSUMMARY:${"build fridays hamburg - work on your startup alongside others (bring laptop) ".repeat(3)}`));
  expect(event!.name.length).toBeLessThanOrEqual(60);
  expect(event!.name).toStartWith("build fridays hamburg - work on your startup");
  expect(event!.name).toEndWith("…");
});

test("text that is no calendar, or events without a readable time, give no events and no error", () => {
  expect(parse("")).toEqual([]);
  expect(parse("<html>Service unavailable</html>")).toEqual([]);
  expect(parse(ics("DTSTART:tomorrow\nDTEND:20261121T120000Z\nSUMMARY:Broken", "DTSTART;TZID=Nowhere/Land:20261121T100000\nDTEND;TZID=Nowhere/Land:20261121T120000\nSUMMARY:Lost",
    "SUMMARY:No time"))).toEqual([]);
  expect(parse("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261121T100000Z")).toEqual([]);
});

test("the server answers the events from a week back through the coming weeks", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  const at = (start: string) => ({ name: start, start, end: new Date(Date.parse(start) + 3600_000).toISOString() });
  const events = ["2026-11-01T10:00:00.000Z", "2026-11-16T08:00:00.000Z", "2026-11-23T10:00:00.000Z", "2026-12-20T10:00:00.000Z", "2027-02-01T10:00:00.000Z"].map(at);
  expect(upcoming(events, now).map((e) => e.name)).toEqual(["2026-11-16T08:00:00.000Z", "2026-11-23T10:00:00.000Z", "2026-12-20T10:00:00.000Z"]);
});

test("the browser keeps only well-formed events from the server's answer, names cut short", () => {
  expect(readEvents([
    { name: "Ok", start: "2026-11-20T09:00:00.000Z", end: "2026-11-20T11:00:00.000Z" },
    { name: "x".repeat(200), start: "2026-11-20T09:00:00.000Z", end: "2026-11-20T11:00:00.000Z" },
    { name: 5, start: "2026-11-20T09:00:00.000Z", end: "2026-11-20T11:00:00.000Z" },
    { name: "Backwards", start: "2026-11-20T11:00:00.000Z", end: "2026-11-20T09:00:00.000Z" },
    { name: "No date", start: "soon", end: "later" },
    null,
  ])?.map((e) => e.name.length)).toEqual([2, 60]);
  expect(readEvents({ error: "down" })).toBeUndefined();
});
