# Beaver

A beaver you steer through a small world in the browser, in third person. three.js (WebGLRenderer) with Rapier
physics, TypeScript, built and served by Bun.

```
bun install
bun dev                      the game on port 5180, for everyone on the network (server.ts); prints the addresses
bun shot <url> --out shots/x.png      look at a page without a desktop: screenshot + console (tools/shot.ts)
bun check                    types and tests
/?play&tour                  the beaver plays every feature by itself, round after round, and checks each (src/features/tour)
bun run tour                 the same as a test without end, headless, 4× fast, on what is committed; failures as clips (tools/tour.ts)
bun run build                static files in dist/
```

## Layout

```
src/contracts.ts   what the parts promise each other; read this first
src/engine.ts      starts three.js and Rapier, the loop: fixed physics steps, then a picture
src/light.ts       daylight: the one light everything is tuned for
src/main.ts        the game: where the parts meet
src/beaver/        the animal: mesh, fur, shirt
src/anim/          how it moves: Motion in, Pose out, pure maths
src/player/        input, Rapier character, camera
src/world/         ground, pond, sky, things to carry
src/props/         trees, rocks, sticks: loads assets/props.glb
assets/            beaver.glb (from tools/blender/build.py), props.glb (from tools/blender/props.py), logo.png
tools/blender/     the models, built in Blender from code
```

## Conventions

Right-handed, y up, 1 unit = 1 m. The beaver is 1 m tall, stands on y = 0 of its root and faces +z. Physics runs in
fixed steps of 1/60 s. `?debug` in the address draws the colliders.

Models are rebuilt with Blender, headless:
`/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/build.py -- assets/beaver.glb`
