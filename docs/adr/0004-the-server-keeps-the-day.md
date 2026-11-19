# The server keeps the day; the weather stays in each browser

In multiplayer every player should see the same hour. The server owns it, counting from its own clock: 16:00 when it starts, one day every 720 s. It sends the hour once in `welcome`, and each browser counts on from there in real time, not in game steps, so a hidden tab or a paused game comes back at the right hour. We did not hand the day to the host (the player in longest): the host changes when players leave, and a hidden tab's clock stands still. We also did not resend the hour all the time: one number plus a known rate needs no stream.

The weather is not synced yet. It is a random walk in each browser, so sharing it needs a seed or a weather owner of its own. That is separate work.

## Consequences

- Offline, in the tour and with no server, the browser keeps its own clock as before; the sky stations still set the hour freely.
- The address switches `?hour`, `?clock=stop` and `?speed` keep a page on its own clock even when it is connected, so pictures stay reproducible.
- Pausing does not stop the day of a shared world.
- A restarted server starts again at 16:00; the day is not saved with the world's work.
- The tour cannot check this because it plays alone; the server's tests check that two players agree.
