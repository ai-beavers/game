// The House of AI events from the Luma calendar's public iCal feed, as plain logic shared by both servers (server.ts,
// worker.ts) and the browser. No I/O here: the servers fetch the text (events.ts), the browser fetches their answer.
//
//   parse(icsText)            → [{ name, start, end }, …]   timed events only, start and end as ISO moments
//   upcoming(events, now)     → those a week back through the coming weeks: what the server answers
//   readEvents(json)          → the well-formed events of an answer, or undefined if it is no list
//
// The text is untrusted: a name is only ever drawn as plain text on the Calendar board, cut to NAME characters.

/** A House of AI event: its name and its start and end as ISO moments (what the server answers, as JSON). */
export interface HouseEvent { name: string; start: string; end: string }

/** The most characters of a name kept; a longer one ends in "…". */
export const NAME = 60;
const DAY = 86_400_000; // ms
/** ms back and ahead of now the server answers: back over the week shown, ahead over the coming weeks. */
const BACK = 8 * DAY, AHEAD = 35 * DAY;

/** A name cut to NAME characters, control characters and runs of space made one space. */
function cut(name: string) {
  const plain = name.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  return plain.length > NAME ? `${plain.slice(0, NAME - 1).trimEnd()}…` : plain;
}

/** ms that the zone's clock is ahead of UTC at the moment t; throws for a zone Intl does not know. */
function offset(zone: string, t: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
    .formatToParts(t);
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - t;
}

/** An iCal date-time (with its parameters) as ms; undefined for a date alone (all day) or what cannot be read.
 *  Without Z or TZID it is floating: read in the calendar's own zone, else UTC. */
function moment(value: string, params: Record<string, string>, calendarZone: string | undefined): number | undefined {
  if (params.VALUE === "DATE") return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value.trim());
  if (!m) return undefined;
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
  const zone = m[7] ? undefined : params.TZID ?? calendarZone;
  if (!zone) return wall;
  // The wall clock in that zone: take its offset near there, then again at the moment found (a clock change between).
  const first = wall - offset(zone, wall);
  return wall - offset(zone, first);
}

/** An iCal duration (P1D, PT1H30M, …) in ms, or undefined. */
function duration(value: string) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  return m ? ((+(m[1] ?? 0) * 7 + +(m[2] ?? 0)) * 24 * 3600 + +(m[3] ?? 0) * 3600 + +(m[4] ?? 0) * 60 + +(m[5] ?? 0)) * 1000 : undefined;
}

const unescape = (text: string) => text.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? " " : c));

/** The timed events of an iCal text, in its order; text that is no calendar gives none. */
export function parse(text: string): HouseEvent[] {
  if (!/^BEGIN:VCALENDAR/m.test(text)) return [];
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const calendarZone = lines.find((l) => l.startsWith("X-WR-TIMEZONE:"))?.slice(14).trim() || undefined;
  const out: HouseEvent[] = [];
  let event: Map<string, { value: string; params: Record<string, string> }> | undefined;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { event = new Map(); continue; }
    if (line === "END:VEVENT" && event) {
      try {
        const read = readEvent(event, calendarZone);
        if (read) out.push(read);
      } catch { /* a zone or a date this runtime cannot read: the event is left out */ }
      event = undefined;
      continue;
    }
    const colon = line.indexOf(":");
    if (!event || colon < 0) continue;
    const [key, ...rest] = line.slice(0, colon).split(";");
    const params = Object.fromEntries(rest.map((p) => { const eq = p.indexOf("="); return [p.slice(0, eq).toUpperCase(), p.slice(eq + 1).replace(/^"|"$/g, "")]; }));
    event.set(key!.toUpperCase(), { value: line.slice(colon + 1), params });
  }
  return out;
}

/** One VEVENT's properties as an event, or undefined when it is all day, cancelled, nameless or has no readable time. */
function readEvent(event: Map<string, { value: string; params: Record<string, string> }>, zone: string | undefined): HouseEvent | undefined {
  const start = event.get("DTSTART"), end = event.get("DTEND"), length = event.get("DURATION");
  if (!start || event.get("STATUS")?.value.trim().toUpperCase() === "CANCELLED") return undefined;
  const from = moment(start.value, start.params, zone);
  if (from === undefined) return undefined;
  const to = end ? moment(end.value, end.params, zone) : length ? from + (duration(length.value) ?? NaN) : undefined;
  if (to === undefined || !(to > from)) return undefined;
  const name = cut(unescape(event.get("SUMMARY")?.value ?? ""));
  if (!name) return undefined;
  return { name, start: new Date(from).toISOString(), end: new Date(to).toISOString() };
}

/** The events from a week back through the coming weeks of `now` (ms): what the server answers, by start. */
export function upcoming(events: readonly HouseEvent[], now: number): HouseEvent[] {
  return events.filter((e) => Date.parse(e.end) > now - BACK && Date.parse(e.start) < now + AHEAD)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** The well-formed events of the server's answer (untrusted JSON), names cut short; undefined when it is no list. */
export function readEvents(json: unknown): HouseEvent[] | undefined {
  if (!Array.isArray(json)) return undefined;
  return json.flatMap((e: unknown) => {
    if (!e || typeof e !== "object") return [];
    const { name, start, end } = e as Record<string, unknown>;
    if (typeof name !== "string" || typeof start !== "string" || typeof end !== "string") return [];
    const from = Date.parse(start), to = Date.parse(end);
    if (!(to > from)) return [];
    return [{ name: cut(name), start: new Date(from).toISOString(), end: new Date(to).toISOString() }];
  });
}
