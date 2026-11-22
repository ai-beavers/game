// The House of AI events as both servers answer them on EVENTS_PATH (server.ts, worker.ts; ADR 0006): fetched from the
// House of AI Hamburg's public Luma calendar (an iCal feed, read by feed.ts) about once a day, so players' browsers
// never ask Luma and Luma is asked far less often than a server starts. A copy is the events with the moment they
// were fetched; a failed fetch or a feed that does not read keeps the last good copy.
//
//   On Cloudflare (worker.ts): a daily Cron Trigger renews one copy in Workers KV; requests only read it.
//     const events = kvEvents(env.EVENTS, { feed })
//     scheduled:                       ctx.waitUntil(events.renew())
//     if (pathname === EVENTS_PATH)    return events.answer((p) => ctx.waitUntil(p))
//   The Bun server (server.ts): one copy fresh for a day, kept beside WORLD_FILE when there is one.
//     const answer = keptEvents({ feed, store })        once per server
//     if (pathname === EVENTS_PATH) return answer()      a JSON Response: [{ name, start, end }, …]
import { parse, readEvents, upcoming, type HouseEvent } from "./feed.ts";

/** The public iCal feed of the House of AI Hamburg's Luma calendar (lu.ma/house-of-ai-hamburg, "Subscribe"). Public,
 *  no secret. A server may be given another one (the tests' fixture). */
export const FEED = "https://api.lu.ma/ics/get?entity=calendar&id=cal-4ldiIVdmUBYsAMV";
/** The Workers KV key the one copy is kept under. */
export const KEY = "house-of-ai-events";
const HOUR = 3_600_000, DAY = 24 * HOUR; // ms
const FRESH = DAY; // ms the Bun server's copy is fresh before the feed is asked again
const RETRY = HOUR; // ms before the feed is asked again after it failed
const HOLD = HOUR; // ms a Worker isolate holds what it read from KV before it reads again
const WAIT = 10_000; // ms the feed has to answer

/** The events of one good fetch of the feed and when it was made (ms). */
export interface Copy { events: HouseEvent[]; at: number }
/** Where the copy comes from and the clock: the real ones unless a test gives others. */
export interface Sources { feed?: string; fetch?: (url: string, init: RequestInit) => Promise<Response>; now?: () => number }
/** The few calls of a Workers KV namespace used here. */
export interface Kv { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> }
/** Where the Bun server keeps its copy as text (a file beside the world's). */
export interface Store { read(): string | undefined; write(text: string): void }

/** One fetch of the feed as a copy; throws when the feed does not answer a calendar. */
async function fetchCopy({ feed = FEED, fetch: get = fetch, now = Date.now }: Sources): Promise<Copy> {
  const res = await get(feed, { signal: AbortSignal.timeout(WAIT), headers: { Accept: "text/calendar" } });
  const text = res.ok ? await res.text() : "";
  if (!/^BEGIN:VCALENDAR/m.test(text)) throw new Error(`no calendar (HTTP ${res.status})`);
  return { events: parse(text), at: now() };
}
/** A copy read back from its stored text, or undefined for none or text that is no copy. */
function readCopy(text: string | null | undefined): Copy | undefined {
  if (!text) return undefined;
  try {
    const { events, at } = JSON.parse(text) as Partial<Copy>;
    const read = readEvents(events);
    return read && typeof at === "number" ? { events: read, at } : undefined;
  } catch { return undefined; }
}
/** The answer to a browser: the upcoming events of the copy, or none without one. */
function answerOf(copy: Copy | undefined, now: number): Response {
  return Response.json(upcoming(copy?.events ?? [], now), { headers: { "Cache-Control": "public, max-age=300" } });
}
const failed = (error: unknown) =>
  console.warn(`House of AI events: the feed could not be read, keeping the last copy (${(error as Error).message})`);

/** The Worker's side: renew() fetches the feed into KV (the daily Cron Trigger); answer() reads KV, held in the
 *  isolate for HOLD, and never asks the feed, but when KV holds no copy at all (the very first start): then it
 *  answers no events and hands one renewal to `later` (ctx.waitUntil), at most once per RETRY. */
export function kvEvents(kv: Kv, sources: Sources = {}) {
  const now = sources.now ?? Date.now;
  let held: Copy | undefined, readAt = 0, triedAt = -Infinity;
  const renew = async () => {
    try {
      const copy = await fetchCopy(sources);
      await kv.put(KEY, JSON.stringify(copy));
      held = copy;
      readAt = now();
    } catch (error) { failed(error); }
  };
  return {
    renew,
    async answer(later: (work: Promise<void>) => void): Promise<Response> {
      if (!held || now() - readAt >= HOLD) {
        const stored = readCopy(await kv.get(KEY).catch(() => null));
        if (stored) { held = stored; readAt = now(); }
      }
      if (!held && now() - triedAt >= RETRY) { triedAt = now(); later(renew()); }
      return answerOf(held, now());
    },
  };
}

/** The Bun server's side: answers its copy, fresh for FRESH. The request that finds it older answers it still and
 *  starts the fetch beside; only one without any copy waits for the feed. A failed fetch is tried again after RETRY.
 *  With a store, the copy is written there and read back at start, so a restart within the day asks nothing. */
export function keptEvents(sources: Sources & { store?: Store } = {}) {
  const now = sources.now ?? Date.now, store = sources.store;
  let held = readCopy(store?.read()), due = held ? held.at + FRESH : 0;
  let asking: Promise<void> | undefined;
  const renew = () => asking ??= fetchCopy(sources).then((copy) => {
    held = copy;
    due = copy.at + FRESH;
    store?.write(JSON.stringify(copy));
  }, (error) => {
    failed(error);
    due = now() + RETRY;
  }).finally(() => { asking = undefined; });
  return async (): Promise<Response> => {
    if (now() >= due) {
      const renewing = renew();
      if (!held) await renewing;
    }
    return answerOf(held, now());
  };
}
