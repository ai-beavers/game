# Dev tools

Babylon's own debug tools, built into the dev server: the Inspector, a free camera, Spector.js and the Inspector CLI.
They come only with `bun dev` (or `bun server.ts`). The production bundle (`bun run build`,
`NODE_ENV=production bun server.ts`, Cloudflare) leaves them out, so players never get them. The code is
`src/features/debug/tools.ts`; `src/main.ts` loads it behind `import.meta.hot`, which only the dev server sets.

Their panels are HTML, not Babylon GUI: they are for us. Keep them off the stream.

## Start

```
bun dev
```

Open `http://localhost:5180/?play`. `?play` skips the start screen. Add the switches below to the address, or press
the keys in the game. On a Mac keyboard the F keys may need `fn`.

| Key | Switch | Tool |
| --- | --- | --- |
| F3 | `?debug` | the readout: beaver and camera position, facing, ground, fps, meshes. `?debug` also draws the colliders. In every build. |
| F4 | `?inspect` | the Inspector |
| F6 | `?fly` | the free camera |
| F8 | | Spector.js |
| | `?inspectable` | the scene answers the Inspector CLI |

For a calm picture to look at: `?play&hour=13&clock=stop&weather=fair&mute&inspect`.

## Inspector (F4)

Babylon's Inspector v2. F4 opens it, F4 again closes it.

The right side has a row of icons; each opens a pane. Hover an icon for its name.

- **Scene Explorer** (left): every node, mesh, light, camera, material, texture, skeleton, animation group and the GUI.
  Click one to select it. Search with the filter at the top.
- **Properties** (first icon): everything about the selected thing, live: hide it, move it, change a material's
  colour, a light's strength, the fog, the exposure. Changes last until the page reloads; copy the values you like
  into the code.
- **Gizmos** (toolbar, top left): move, rotate, scale and bounding box for the selected thing, in the picture.
- **Debug** (bug icon): helpers (grid, physics colliders, names over the meshes) and the texture channels
  (diffuse, bump, reflection and the rest), each on and off for the whole scene.
- **Stats** (bars icon): fps, draw calls, frame times, counts.
- **Tools** (wrench icon): export the scene to GLB or `.babylon`, import animations, and more further down.
- A node material, GUI or particle system opens in its editor from its properties.

## Free camera (F6)

F6 puts a free camera where the game's camera is, and F6 again goes back to the beaver. While you fly, the beaver
stands still and the world keeps running.

| Input | Moves |
| --- | --- |
| W A S D or arrows | forward, left, back, right |
| E, Q | up, down |
| drag with the mouse | look around |
| mouse wheel | forward and back |

The camera is called `fly`; the Inspector lists it under Nodes. `?fly` starts in it.

## Spector.js (F8)

Spector shows every WebGL call of one frame: what was drawn, in which order, with which shader, state and textures.
Use it when something renders wrong or a frame costs too much.

1. Press F8. Spector's bar appears at the top.
2. Press F8 again, or the red button in the bar, to capture the next frame.
3. The result opens full screen: the commands, the frame buffer after each draw, the shaders. **Close** (top
   right) goes back to the game.

The bar's fps counter reads 0; capturing works anyway.

## Inspector CLI (?inspectable)

The Inspector for agents: the scene's meshes, materials, stats and screenshots as JSON in the terminal, without any
panels. Open the page with `?inspectable`, then in the repo:

```
bunx babylon-inspector --session                       lists the open pages; starts the bridge if none runs
bunx babylon-inspector --session 1 --command           lists the commands
bunx babylon-inspector --session 1 --command get-count-stats
bunx babylon-inspector --session 1 --command query-mesh                  every mesh
bunx babylon-inspector --session 1 --command query-mesh --uniqueId 42    one mesh
bunx babylon-inspector --session 1 --command take-screenshot             a PNG, as base64
bunx babylon-inspector --stop                          stops the bridge
```

For frame times, run `start-perf-instrumentation`, play a little, then `get-frame-stats`. The draw calls in
`get-count-stats` count up from the start; they are not per frame.

The page tries to reach the bridge (port 4400) every few seconds and logs each failed try in the console. That is why
it is a switch of its own and not on by default. The Inspector (F4) can connect too, through its own toggle.

## Limits

- Photo mode (P) and the free camera at the same time are untested.
- The free camera has one speed.
- The dev page loads the Inspector, React and Fluent UI as well: it starts slower than the production build. Measure
  frame times on the production build (`docs/agents/verify.md`).
