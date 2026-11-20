# The House of AI events come through our own server

The Calendar board shows the House of AI events: the public Luma calendar of the House of AI in Hamburg. It is the game's first data from outside. The server (both `server.ts` and the Worker) fetches the calendar's public iCal feed and answers the browser on one path of its own with the events as a short list, keeping a copy for an hour. We did not let the browser fetch Luma itself: a page on another origin cannot count on reading the feed, and every player would hit Luma on each load. We did not take a snapshot at build time: the game is deployed only on pushes, so the board would go stale between them.

## Consequences

- Each browser fetches the events itself; they are not part of the shared world and not synced through the room.
- When the feed or the server cannot be reached (offline, the tour, an outage), the board keeps what it had, at least Build Fridays, which stays fixed in the code.
- The tour plays without the network, so it hands the board a fixed list of events; the feed's parsing is checked by tests.
- The feed's address is public and lives in the code; no secret is needed.
