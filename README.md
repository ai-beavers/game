# Beaver

A browser game in which a player steers a beaver through a small world and builds a dam. Play it at
<https://game.ai-beavers.com/>, in one shared world of up to 16 players.

Agents build the game. A viewer of the live stream asks for something in the chat (a wish), an agent works the wish
out into a spec, which is an issue here, and once it is approved another agent builds it on its own branch. Before a
change is merged the game plays itself through every feature: that tour is the merge gate
(`docs/adr/0002-the-tour-is-the-merge-gate.md`). Changes come in through that flow: pull requests from outside are not
taken. `GLOSSARY.md` has the words, `docs/adr/` the decisions, `AGENTS.md` what an agent reads first.

Babylon.js and Babylon GUI with Havok physics, TypeScript, built and served by Bun. In multiplayer, the server
synchronizes players and dam progress over WebSocket: the Bun server on a local network, a Worker on Cloudflare for
everyone (`docs/cloudflare.md`).

## Running it

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

`Dockerfile` puts the game and the Bun server into one container, for a host of your own; its first lines say how.

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
src/features/      dam building, the trading post, the shop, the canoe, its race, the Hoverboard, multiplayer, controls, HUD, wildlife, the river kit, weather, audio, effects, photo mode and tour
server.ts          the game and its multiplayer server on Bun, for a local network
worker.ts          the same multiplayer on Cloudflare: a Worker and a Durable Object
assets/            beaver.glb (from tools/blender/build.py), props.glb (from tools/blender/props.py), kit.glb (from tools/comfyui and tools/blender/kit.py), logo.png
tools/blender/     the models, built in Blender from code
tools/comfyui/     animal models from pictures: the ComfyUI workflow and how to run it
```

## Conventions

Right-handed, y up, 1 unit = 1 m. The beaver is 1 m tall, stands on y = 0 of its root and faces +z. Physics runs in
fixed steps of 1/60 s. `?debug` in the address draws the colliders.

Models are rebuilt with Blender, headless:
`/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/build.py -- assets/beaver.glb`

## Licence

MIT (`LICENSE`) for the code and for the models. `beaver.glb` and `props.glb` are built from code
(`tools/blender/`). `kit.glb` is made from a picture that ChatGPT drew for us, with the open models that
`tools/comfyui/README.md` names.

Two files are not under it:

- `assets/logo.png` is the AI Beavers logo. Use it to name this project, and for nothing else.
- `assets/nunito.woff2` is the font Nunito, under the SIL Open Font License 1.1 (`assets/nunito-OFL.txt`).

The packages in `package.json` keep their own licences: Babylon.js is Apache-2.0, Havok MIT.
