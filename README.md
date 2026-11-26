# Beaver

A beaver you steer through a small world in the browser, in third person. Babylon.js and Babylon GUI with Havok
physics, TypeScript, built and served by Bun. In multiplayer, the server synchronizes players and dam progress over
WebSocket: the Bun server on a local network, a Worker on Cloudflare for everyone (see "On Cloudflare").

```
bun install --frozen-lockfile
bun dev                      the game on port 5180, for everyone on the network (server.ts); prints the addresses.
                             With ELEVENLABS_API_KEY in .env the Old Beaver says his lores in his voice, and the
                             terminal shows every talk with ElevenLabs; without it he murmurs.
                             In it: F4 Inspector, F6 free camera, F8 Spector (docs/dev-tools.md)
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

Everyone plays at <https://game.ai-beavers.com/>, in one shared world of up to 16 players.

- **Addresses**: `game.ai-beavers.com` is a custom hostname (Cloudflare for SaaS) on the `uq.dev` zone: the
  ai-beavers.com owner's proxied CNAME points it at `aib-game.uq.dev`, and the Worker route `aib-game.uq.dev/*`, set in
  the dashboard and not in `wrangler.jsonc`, sends both to the Worker. <https://beaver.uq-dev.workers.dev/> still works.

- **Publishing**: every push to `main` that passes `check` is deployed by the `deploy` job of `.github/workflows/check.yml`
  (`wrangler deploy`). Players reconnect by themselves and load the new build once. The world's work stays.
- **What runs there**: one Worker (`worker.ts`, `wrangler.jsonc`). Cloudflare serves the files of `dist/` itself. One
  Durable Object holds the world with the same rules as `server.ts`: both run `src/features/net/room.ts`.
- **House of AI events**: both servers answer `/net/events` from the House of AI Hamburg's public Luma calendar
  (`src/features/shop/events.ts`); the Calendar board asks it hourly (ADR 0006). On Cloudflare the Cron Trigger
  `17 4 * * *` (`wrangler.jsonc`) fetches the feed once a day into the Workers KV namespace `beaver-house-of-ai-events`
  (binding `EVENTS`, fixed id, so a deploy never makes one), and requests only read it. The Bun server asks once a day
  and, with `WORLD_FILE`, keeps its copy in `${WORLD_FILE}.events` over restarts.
- **Credentials**: the GitHub environment `production` holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and
  takes runs from `main` only.
- **Starting the world afresh**: set the token once with `bunx wrangler secret put RESET_TOKEN`, then
  `curl -X POST -H "Authorization: Bearer <token>" https://game.ai-beavers.com/net/reset`. Without the secret
  the address answers 404.
- **The Old Beaver's voice**: set the key once with `bunx wrangler secret put ELEVENLABS_API_KEY`. The world's
  Durable Object asks ElevenLabs for each line once and sends the sound to every player (ADR 0010); every talk with
  ElevenLabs is in the Worker's logs. Without the secret he murmurs.

## Layout

```
src/contracts.ts   what the parts promise each other; read this first
src/engine.ts      starts Babylon.js, the HUD and Havok; steps physics and renders frames
src/physics.ts     Havok: collision groups, shapes, rays and shape casts
src/light.ts       daylight: the one light everything is tuned for
src/main.ts        the game: where the parts meet
src/beaver/        the animal: mesh, fur, shirt, hat
src/anim/          how it moves: Motion in, Pose out, pure maths
src/player/        input, the capsule and its mover, camera
src/world/         ground, pond, sky, things to carry
src/props/         trees, rocks, sticks: loads assets/props.glb
src/features/      dam building, the trading post, the shop, the canoe, its race, the Hoverboard, multiplayer, controls, HUD, wildlife, the bear, the river kit, weather, audio, effects, photo mode and tour
server.ts          the game and its multiplayer server on Bun, for a local network
worker.ts          the same multiplayer on Cloudflare: a Worker and a Durable Object
assets/            beaver.glb (from tools/blender/build.py), props.glb (from tools/blender/props.py), bear.glb (from tools/blender/bear.py), kit.glb (from tools/comfyui and tools/blender/kit.py), logo.png
tools/blender/     the models, built in Blender from code
tools/comfyui/     animal models from pictures: the ComfyUI workflow and how to run it
```

## Conventions

Right-handed, y up, 1 unit = 1 m. The beaver is 1 m tall, stands on y = 0 of its root and faces +z. Physics runs in
fixed steps of 1/60 s. `?debug` in the address draws the colliders.

Models are rebuilt with Blender, headless:
`/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/build.py -- assets/beaver.glb`

`/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/bear.py -- assets/bear.glb`
