// The House of AI events as both servers answer them on EVENTS_PATH (server.ts, worker.ts; ADR 0006): fetched from the
// House of AI Hamburg's public Luma calendar (an iCal feed, read by feed.ts), one copy kept for an hour, so players'
// browsers never each ask Luma. When the feed cannot be had or read, the answer is the last good copy, or no events.
//
//   const answer = houseOfAiEvents(process.env.HOUSE_OF_AI_FEED)    once per server
//   if (pathname === EVENTS_PATH) return answer()                   a JSON Response: [{ name, start, end }, …]
import { parse, upcoming, type HouseEvent } from "./feed.ts";

/** The public iCal feed of the House of AI Hamburg's Luma calendar (lu.ma/house-of-ai-hamburg, "Subscribe"). Public,
 *  no secret. A server may be given another one (the tests' fixture). */
export const FEED = "https://api.lu.ma/ics/get?entity=calendar&id=cal-4ldiIVdmUBYsAMV";
const KEEP = 3_600_000; // ms a good copy is kept before the feed is asked again
const RETRY = 300_000; // ms before the feed is asked again after it failed
const WAIT = 10_000; // ms the feed has to answer

export function houseOfAiEvents(url: string = FEED) {
  let kept: HouseEvent[] = [], until = 0;
  let asking: Promise<void> | undefined;
  const ask = async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(WAIT), headers: { Accept: "text/calendar" } });
      const text = res.ok ? await res.text() : "";
      if (!/^BEGIN:VCALENDAR/m.test(text)) throw new Error(`no calendar (HTTP ${res.status})`);
      kept = parse(text);
      until = Date.now() + KEEP;
    } catch (error) {
      console.warn(`House of AI events: the feed could not be read, answering the last copy (${(error as Error).message})`);
      until = Date.now() + RETRY;
    }
  };
  return async (): Promise<Response> => {
    if (Date.now() >= until) await (asking ??= ask().finally(() => { asking = undefined; }));
    return Response.json(upcoming(kept, Date.now()), { headers: { "Cache-Control": "public, max-age=300" } });
  };
}
