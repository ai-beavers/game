// How the House of AI events are kept between Luma's feed and the players (events.ts, ADR 0006), with a fake clock,
// a fake feed and a fake store: on Cloudflare a daily run writes them to Workers KV and requests only read KV; the Bun
// server keeps its copy for a day, beside its world file when it has one. A failed fetch never loses the last good copy.
import { expect, test } from "bun:test";
import { keptEvents, KEY, kvEvents, type Store } from "./events.ts";

const HOUR = 3_600_000, DAY = 24 * HOUR, NOW = Date.parse("2026-11-22T10:00:00Z");
const at = (t: number) => new Date(t).toISOString().replace(/[-:]|\.\d+/g, "");
const ics = (name: string, start = NOW + 2 * DAY) => ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", `DTSTART:${at(start)}`,
  `DTEND:${at(start + 2 * HOUR)}`, `SUMMARY:${name}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");

/** A fake Luma: answers `text` (or fails with `status`), counting how often it is asked. */
function fakeFeed(text = ics("Community Lunch")) {
  const feed = { asked: 0, text, status: 200, fetch: async () => { feed.asked++; return new Response(feed.text, { status: feed.status }); } };
  return feed;
}
/** A fake Workers KV namespace, counting reads. */
function fakeKv() {
  const kv = { values: new Map<string, string>(), reads: 0,
    get: async (key: string) => { kv.reads++; return kv.values.get(key) ?? null; },
    put: async (key: string, value: string) => { kv.values.set(key, value); } };
  return kv;
}
const names = async (res: Response) => (await res.json() as { name: string }[]).map((e) => e.name);

test("the daily run writes the feed's events to KV, and a request answers them without asking the feed", async () => {
  const feed = fakeFeed(), kv = fakeKv(), clock = { now: NOW };
  const events = kvEvents(kv, { fetch: feed.fetch, now: () => clock.now });
  await events.renew();
  expect(feed.asked).toBe(1);
  const later = kvEvents(kv, { fetch: feed.fetch, now: () => clock.now }); // another isolate
  expect(await names(await later.answer(() => {}))).toEqual(["Community Lunch"]);
  expect(feed.asked).toBe(1);
});

test("a daily run that fails, or reads no calendar, keeps the copy in KV as it was", async () => {
  const feed = fakeFeed(), kv = fakeKv(), clock = { now: NOW };
  const events = kvEvents(kv, { fetch: feed.fetch, now: () => clock.now });
  await events.renew();
  const kept = kv.values.get(KEY);
  feed.status = 503;
  clock.now += DAY;
  await events.renew();
  feed.status = 200;
  feed.text = "<html>Luma is resting</html>";
  clock.now += DAY;
  await events.renew();
  expect(kv.values.get(KEY)).toBe(kept!);
  expect(await names(await kvEvents(kv, { fetch: feed.fetch, now: () => clock.now }).answer(() => {}))).toEqual(["Community Lunch"]);
});

test("with no copy in KV a request answers no events and starts exactly one fetch, which fills KV", async () => {
  const feed = fakeFeed(), kv = fakeKv(), started: Promise<void>[] = [];
  const events = kvEvents(kv, { fetch: feed.fetch, now: () => NOW });
  const answers = await Promise.all([events.answer((p) => started.push(p)), events.answer((p) => started.push(p))]);
  expect(await Promise.all(answers.map(names))).toEqual([[], []]);
  expect(started.length).toBe(1);
  await Promise.all(started);
  expect(feed.asked).toBe(1);
  expect(await names(await events.answer((p) => started.push(p)))).toEqual(["Community Lunch"]);
  expect(await names(await kvEvents(kv, { fetch: feed.fetch, now: () => NOW }).answer(() => {}))).toEqual(["Community Lunch"]);
  expect(feed.asked).toBe(1);
});

test("an isolate holds what it read from KV for an hour, then picks up the day's new copy", async () => {
  const feed = fakeFeed(), kv = fakeKv(), clock = { now: NOW };
  const cron = kvEvents(kv, { fetch: feed.fetch, now: () => clock.now });
  await cron.renew();
  const isolate = kvEvents(kv, { fetch: feed.fetch, now: () => clock.now });
  clock.now += DAY - 30 * 60_000;
  await isolate.answer(() => {});
  feed.text = ics("Build Night");
  clock.now += 30 * 60_000;
  await cron.renew();
  const reads = kv.reads;
  expect(await names(await isolate.answer(() => {}))).toEqual(["Community Lunch"]);
  expect(kv.reads).toBe(reads);
  clock.now += 30 * 60_000;
  expect(await names(await isolate.answer(() => {}))).toEqual(["Build Night"]);
  expect(feed.asked).toBe(2); // the two daily runs only
});

/** A fake file beside the world's. */
const fakeStore = () => { const store: Store & { text?: string } = { read: () => store.text, write: (text) => { store.text = text; } }; return store; };

test("the Bun server asks the feed once a day, answering its copy meanwhile, and keeps the copy over a restart", async () => {
  const feed = fakeFeed(), store = fakeStore(), clock = { now: NOW };
  const answer = keptEvents({ fetch: feed.fetch, now: () => clock.now, store });
  expect(await names(await answer())).toEqual(["Community Lunch"]); // no copy yet: this one waits for the feed
  clock.now += 23 * HOUR;
  expect(await names(await answer())).toEqual(["Community Lunch"]);
  expect(feed.asked).toBe(1);
  const restarted = keptEvents({ fetch: feed.fetch, now: () => clock.now, store });
  expect(await names(await restarted())).toEqual(["Community Lunch"]);
  expect(feed.asked).toBe(1);
  feed.text = ics("Build Night");
  clock.now += HOUR;
  expect(await names(await restarted())).toEqual(["Community Lunch"]); // a day old: answered still, renewed beside
  expect(feed.asked).toBe(2);
  await Bun.sleep(0);
  expect(await names(await restarted())).toEqual(["Build Night"]);
});

test("when the feed fails the Bun server keeps its last good copy and asks again after an hour", async () => {
  const feed = fakeFeed(), clock = { now: NOW };
  const answer = keptEvents({ fetch: feed.fetch, now: () => clock.now });
  await answer();
  feed.status = 503;
  clock.now += DAY;
  await answer();
  await Bun.sleep(0);
  clock.now += 59 * 60_000;
  expect(await names(await answer())).toEqual(["Community Lunch"]);
  expect(feed.asked).toBe(2);
  clock.now += 60_000;
  await answer();
  expect(feed.asked).toBe(3);
});
