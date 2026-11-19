# On Cloudflare a Durable Object holds the world; the Bun server stays for development

Viewers of the stream should play the game at a public address, and every merge should be published by itself. The game is static files plus one small server that relays what players send and checks the world's work; the loose things are simulated by the host's browser. So the game runs as one Cloudflare Worker: Cloudflare serves the files, and one Durable Object is the shared world. It holds the WebSockets and keeps the world's work in its own storage. A push to `main` deploys it.

The Bun server stays. `bun dev`, the tests and the tour need a server on the machine, with live reload and no account. Two servers could drift apart, so the rules of a world live once, in the room (`src/features/net/room.ts`), which knows neither Bun nor Cloudflare. Each server only gives it sockets and a place to keep the world.

We did not run the Bun server in a container on Cloudflare: a container's disk is not kept when it sleeps, so the world file would be lost, and it would start cold. We did not rent a machine for the Docker image: it works unchanged, but someone has to run it. We did not use the WebSocket Hibernation API: players send their state 20 times a second, so the object is awake whenever someone plays, and hibernation would mean keeping every socket's state outside memory for nothing.

## Consequences

- A deploy ends the object without warning. Every player is disconnected, reconnects and loads the new build once. Work of the last two seconds can be lost.
- The day starts again at 16:00 with each deploy and whenever the object was asleep because nobody played.
- There is one world for everyone, of 16 players. More worlds are one object per name, which needs a way to choose one in the game.
- A tab that stays connected without playing keeps the object awake and billed.
- `bun run check` starts the Worker in wrangler's local runtime and runs the server tests against it too. The file-only cases (a broken world file, a world aged between restarts) run against the Bun server alone.
- The world can be reset only by a request with the reset token, since the object has no terminal.
