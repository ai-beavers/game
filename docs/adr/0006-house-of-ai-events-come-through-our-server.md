# The House of AI events come through our own server

The Calendar board shows the House of AI events: the public Luma calendar of the House of AI in Hamburg. It is the game's first data from outside. The server (both `server.ts` and the Worker) fetches the calendar's public iCal feed and answers the browser on one path of its own with the events as a short list. Luma is asked about once a day: on Cloudflare a daily Cron Trigger writes the events to Workers KV and requests only read them; the Bun server keeps a copy for a day, beside its world file when it has one. We did not let the browser fetch Luma itself: a page on another origin cannot count on reading the feed, and every player would hit Luma on each load. We did not take a snapshot at build time: the game is deployed only on pushes, so the board would go stale between them. A copy kept in each server's memory asked Luma far more often than the events change: Cloudflare runs several isolates and starts new ones often, and the Bun server loses its memory on every restart. Luma sends no `cache-control`, `etag` or `last-modified`, so "only if changed" cannot be asked. We did not use Cloudflare's edge cache: it keeps a copy per data center, not one. We did not use a Durable Object: KV is enough for one value written once a day, and its delay of about a minute until every location sees a new copy does not matter.

## Consequences

- A new or changed House of AI event reaches the board within a day; a failed fetch keeps the last good copy. Only the very first start on Cloudflare, with KV empty, answers no events once while it fetches.
- Each browser fetches the events itself; they are not part of the shared world and not synced through the room.
- When the feed or the server cannot be reached (offline, the tour, an outage), the board keeps what it had, at least Build Fridays, which stays fixed in the code.
- The tour plays without the network, so it hands the board a fixed list of events; the feed's parsing is checked by tests.
- The feed's address is public and lives in the code; no secret is needed.
