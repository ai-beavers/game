# Verifying a change

How to prove a change works before it is handed over. The commands are in `README.md`; this file holds what they do not say.

## Looking at the game

- **Where Chrome runs** (a normal checkout): `bun shot "<url>" --size 640x360 --out <dir>/<name>.png`, then read the PNG. Headless Chrome needs the GPU: in a sandbox it does not start.
- **In a sandbox**: your task names a `look` command. It takes the same options as `bun shot` and is answered by a Chrome outside the sandbox. The host plays the tour for you; `bun run tour` does not run there. Looks at one game take turns, so two pages at once (a soak with a second tour beside it) cannot be played from a sandbox: say so in your commit and leave that check to the host. Tools built on `tools/chrome.ts` (the sound tests in `bun run check`, `bun tools/listen.ts`) borrow the host's Chrome there by themselves, through `LOOK_PORT`; it loads pages only from this machine.
- **Picture budget**: about a dozen pictures per task, at `640x360`. Every picture read stays in your context for the rest of the session. Take a larger size only to judge fine detail, and keep one before picture of what you change.
- **Read state instead of pixels** where a number answers the question: `--eval "<expression>"` prints its value as JSON. The page exposes `game`, `sky`, `tour`, `life`, `net`, `audio`, `hud`, `build`, `trade`, `bakery`, `workbench`, `lightbulb`, `danceFloor`, `shop`, `mrsBeaver`, `mushrooms`, `flag`, `droppings`, `oldBeaver`, `canoe`, `hoverboard`, `race` and `riverKit` on `window`.
- **Sound** never starts in headless Chrome. `bun tools/listen.ts` renders the game's sounds offline and prints their loudness.

## Address switches

Combine them with `&`. `README.md` lists the tour ones.

| Switch | Effect |
| --- | --- |
| `play` | skips the start screen |
| `hour=13`, `clock=stop`, `speed=60` | the hour of the day, a clock that stands still, a faster day; each keeps the page on its own day when connected to a shared world |
| `weather=fair` | holds one kind of weather; the kinds are `KINDS` in `src/features/sky/weather.ts` |
| `spawn=x,z` | where the beaver starts |
| `anger=1` | a furious beaver |
| `mute` | sound off without touching the saved settings |
| `quality=low` | picture quality (`low`, `medium`, `high`) for this page, without touching the saved settings |
| `touch` | touch controls on a desktop page |
| `debug` | draws the colliders |
| `standins` | plain shapes instead of `assets/props.glb` |
| `inspect`, `fly` | dev server only: Babylon's Inspector, a free camera (F4, F6; F8 Spector). See `docs/dev-tools.md` |
| `engine=webgpu` | Babylon's WebGPU engine instead of WebGL2, where the browser has it (a trial); shaders compile for seconds after `ready` |

A fixed picture for comparing before and after: `?play&hour=13&clock=stop&weather=fair&mute`.

## Order of checks

1. **While building**: the dev server reloads the page on every save (`PORT=<your port> bun server.ts`). Play only your own station: `?play&tour=fast&station=<Name>` in a picture, or `bun run tour --once --here --port <your tour port> --station "<Name>"` where Chrome runs.
2. **Once at the end**: each station you added or changed, once in real time (`?play&tour&station=<Name>`, or `--speed real`): the fast tour hops over the ways the beaver walks, so a way that is blocked shows only there. Then `bun run check`, then the whole tour with `bun run tour --once --here --port <your tour port> --repeat 2`. Exit code 0 means every station passed. The first run starts in a fresh world, so the lodge and cache stations are skipped until the second.
3. **Once at the end, for shader or asset changes**: the production build, `bun run build`, and one picture from `NODE_ENV=production PORT=<your port> bun server.ts`. The bundle holds only the shader includes that `src/main.ts` imports.

A station that fails on an untouched `main` in the same way is a flake of the tour, not of your change: report it with the failing line instead of changing the station.

## Sharing the machine

Other agents run game servers and browsers on the same machine and share one GPU.

- Use only the ports your task names. Stop only your own server: `lsof -ti tcp:<your port> | xargs kill`.
- Measure frame time, draw calls or load time with nothing else of yours running, on the production build. Report before and after from the same view.
- Measure a phone over `https://` only. On a plain `http://` page Safari on an iPhone (iOS 27, measured 2026-11-22) runs JavaScript without its compiler: a loop that takes 20 ms takes 450 ms, a physics step 22 times as long, and the game showed 11 pictures a second where it shows 58 over `https://`. A quick tunnel (`cloudflared tunnel --url http://localhost:<your port>`) gives a server on this machine an `https://` address; it is public while it runs, so ask before opening one and close it after. WebGPU, too, exists only on `https://` pages and on `localhost`.

## Stations

A station proves a behavior the way a player meets it: it gives the same input a person would and then checks what the game did (an event, the HUD's text, the sky's state). `AGENTS.md` says where stations live.

- A station starts settled at the spawn, on land, with free hands. It must pass alone and in the whole tour.
- A station that cannot apply right now (wrong hour, feature missing) skips itself with a reason; see how "Deer at dusk" does it.
- Changing what an existing station checks is part of the change only when the task changes that behavior.
