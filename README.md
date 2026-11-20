# Beaver

A beaver you steer through a small world in the browser, in third person. Babylon.js and Babylon GUI with Rapier
physics, TypeScript, built and served by Bun. In multiplayer, the server synchronizes players and dam progress over
WebSocket: the Bun server on a local network, a Worker on Cloudflare for everyone (see "On Cloudflare").

```
bun install --frozen-lockfile
bun dev                      the game on port 5180, for everyone on the network (server.ts); prints the addresses
bun shot <url> --out shots/x.png      look at a page without a desktop: screenshot + console (tools/shot.ts)
bun run check                typecheck and tests
bun run tour --once --here   the whole tour once as a check, on the files as they are: one line per station, exit code 0 or 1;
                             --station Name (repeatable) plays only those. The tour's world is kept between runs
                             (its server's file, recordings/tour-world.json.tour), so the second run reaches the lodge
bun run tour --once --here --repeat 30 [--beside]
                             the soak: that many whole tours in a row, exit code 1 if any failed (--beside: under load)
/?mute                       the game with its sound off, without touching the saved settings (for stream tiles)
/?quality=low                the game at low picture quality, without touching the saved settings (for stream tiles)
/?play&tour=live             watch the bot play in real time: it picks what the beaver wants most now, says why, and holds the camera as a player does
/?play&tour=fast             run the full game tour at 4× speed
/?play&tour&station=Walk     run only the named station; repeat station for its prerequisites
/?play&tour                  the beaver plays every feature by itself, round after round, and checks each (src/features/tour)
bun run tour                 the same as a test without end, headless, 4× fast, on what is committed; failures as clips (tools/tour.ts)
bun run build                static files in dist/
bunx wrangler dev            the game as it runs on Cloudflare, on port 8787, from dist/ (worker.ts); needs no account
```

## On Cloudflare

Everyone plays at <https://beaver.uq-dev.workers.dev/>, in one shared world of up to 16 players.

- **Publishing**: every push to `main` that passes `check` is deployed by the `deploy` job of `.github/workflows/check.yml`
  (`wrangler deploy`). Players reconnect by themselves and load the new build once. The world's work stays.
- **What runs there**: one Worker (`worker.ts`, `wrangler.jsonc`). Cloudflare serves the files of `dist/` itself. One
  Durable Object holds the world with the same rules as `server.ts`: both run `src/features/net/room.ts`.
- **House of AI events**: both servers answer `/net/events` from the House of AI Hamburg's public Luma calendar
  (`src/features/shop/events.ts`), one copy kept for an hour; the Calendar board asks it hourly (ADR 0006).
- **Credentials**: the GitHub environment `production` holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and
  takes runs from `main` only.
- **Starting the world afresh**: set the token once with `bunx wrangler secret put RESET_TOKEN`, then
  `curl -X POST -H "Authorization: Bearer <token>" https://beaver.uq-dev.workers.dev/net/reset`. Without the secret
  the address answers 404.

## Layout

```
src/contracts.ts   what the parts promise each other; read this first
src/engine.ts      starts Babylon.js, the HUD and Rapier; steps physics and renders frames
src/light.ts       daylight: the one light everything is tuned for
src/main.ts        the game: where the parts meet
src/beaver/        the animal: mesh, fur, shirt, hat
src/anim/          how it moves: Motion in, Pose out, pure maths
src/player/        input, Rapier character, camera
src/world/         ground, pond, sky, things to carry
src/props/         trees, rocks, sticks: loads assets/props.glb
src/features/      dam building, the trading post, the shop, the canoe, multiplayer, controls, HUD, wildlife, weather, audio, effects, photo mode and tour
server.ts          the game and its multiplayer server on Bun, for a local network
worker.ts          the same multiplayer on Cloudflare: a Worker and a Durable Object
assets/            beaver.glb (from tools/blender/build.py), props.glb (from tools/blender/props.py), logo.png
tools/blender/     the models, built in Blender from code
```

## Conventions

Right-handed, y up, 1 unit = 1 m. The beaver is 1 m tall, stands on y = 0 of its root and faces +z. Physics runs in
fixed steps of 1/60 s. `?debug` in the address draws the colliders.

Models are rebuilt with Blender, headless:
`/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/build.py -- assets/beaver.glb`
