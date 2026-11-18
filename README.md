# Beaver

A beaver you steer through a small world in the browser, in third person. Babylon.js and Babylon GUI with Rapier
physics, TypeScript, built and served by Bun. In multiplayer, the Bun server synchronizes players and dam progress over WebSocket.

```
bun install --frozen-lockfile
bun dev                      the game on port 5180, for everyone on the network (server.ts); prints the addresses
bun shot <url> --out shots/x.png      look at a page without a desktop: screenshot + console (tools/shot.ts)
bun run check                typecheck and tests
bun run tour --once --here   the whole tour once as a check, on the files as they are: one line per station, exit code 0 or 1;
                             --station Name (repeatable) plays only those. The saved game is kept between runs
                             (recordings/tour-save.json), so the second run reaches the lodge
/?play&tour=live             watch the bot choose activities around the clearing in real time
/?play&tour=fast             run the full game tour at 4× speed
/?play&tour&station=Walk     run only the named station; repeat station for its prerequisites
/?play&tour                  the beaver plays every feature by itself, round after round, and checks each (src/features/tour)
bun run tour                 the same as a test without end, headless, 4× fast, on what is committed; failures as clips (tools/tour.ts)
bun run build                static files in dist/
```

## Layout

```
src/contracts.ts   what the parts promise each other; read this first
src/engine.ts      starts Babylon.js, the HUD and Rapier; steps physics and renders frames
src/light.ts       daylight: the one light everything is tuned for
src/main.ts        the game: where the parts meet
src/beaver/        the animal: mesh, fur, shirt
src/anim/          how it moves: Motion in, Pose out, pure maths
src/player/        input, Rapier character, camera
src/world/         ground, pond, sky, things to carry
src/props/         trees, rocks, sticks: loads assets/props.glb
src/features/      dam building, multiplayer, controls, HUD, wildlife, weather, audio, effects, photo mode and tour
assets/            beaver.glb (from tools/blender/build.py), props.glb (from tools/blender/props.py), logo.png
tools/blender/     the models, built in Blender from code
```

## Conventions

Right-handed, y up, 1 unit = 1 m. The beaver is 1 m tall, stands on y = 0 of its root and faces +z. Physics runs in
fixed steps of 1/60 s. `?debug` in the address draws the colliders.

Models are rebuilt with Blender, headless:
`/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/build.py -- assets/beaver.glb`
