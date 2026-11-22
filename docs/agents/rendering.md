# Rendering

What the code does not say in one place about how the picture is made. Read it before changing anything that is drawn: a material, a light, a shader, the HUD.

## Babylon.js reference

- **API of the installed version**: the `.d.ts` files in `node_modules/@babylonjs/core` and `node_modules/@babylonjs/gui`. They are the truth for the version in `package.json`.
- **Concepts and examples**: `https://doc.babylonjs.com/llms.txt` indexes the official documentation; every page is Markdown at its address plus `.md`.
- Import each class from its own module file (`@babylonjs/core/Materials/shaderMaterial.js`), as the code does. The bundle holds only what is imported.
- The game runs on the WebGL2 engine. `tools/build.ts` leaves the WebGPU shaders out of the bundle.

## One light, and shaders that light themselves

`src/light.ts` owns the light: one sky light, one sun with one shadow map that follows the player. The sky feature (`src/features/sky`) moves and colours them by the hour and the weather.

Babylon's own materials (the ground, trunks, rocks, sticks, the beaver with its fur) take that light by themselves. These parts are drawn by custom shaders that light themselves from the sky, the sun or moon and the shadow map:

| Part | File |
| --- | --- |
| grass | `src/world/grass.ts` |
| tree crowns and bushes | `src/world/foliage.ts` |
| the pond's surface | `src/world/water.ts` |
| animals | `src/features/life/shapes.ts` |

A new Babylon light, fog setting or shadow does not reach them. Whatever should light or tint the whole world needs a term in each of these shaders, or the meadow stays dark around a lit beaver. The lantern shows the pattern: `LANTERN_GLSL` and `LANTERN_UNIFORMS` in `src/light.ts`, added to the light of the grass, the leaves and the animals and fed once per frame in each material's `onBindObservable` from `daylightOf(scene)`.

The sky dome, rain, mist and fireflies (`src/features/sky/dome.ts`, `effects.ts`) and the particles (`src/features/fx/particles.ts`) are custom shaders too and take no scene light at all.

The golden hour (`game.sky.golden`: a low sun in clear air) is made in `src/features/sky/index.ts` from what every surface already takes: a stronger sun, a blue sky light, warm highlights and more bloom, and a fog that turns to sunlit air when the camera looks into the sun. That fog is one colour for the whole picture, not a term per pixel.

- Keep a term per vertex where the shader lights per vertex.
- A uniform that is zero when the effect is off costs nothing and recompiles nothing. A new light or a changed define recompiles every material when it switches on: a visible hitch.
- Every Babylon light takes a light slot in every standard and PBR material all the time, also at intensity 0.
- A custom shader with `#include<...>` works in the dev server and breaks in the production build unless `src/main.ts` imports that include.

## The picture after the scene

`src/features/post/chain.ts` finishes the picture: MSAA or FXAA, bloom, contrast, a vignette. The sky feature sets the exposure by the hour, so the night is brightened after the scene is drawn.

- Anything brighter than the bloom threshold glows. An emissive surface that looks right at noon becomes a white blob at night, when the exposure is high: check both.
- The HUD is drawn after the post chain and is not graded by it.
- Under water a pass of its own adds fog, colour by depth and caustics. Things under the surface must be fogged by it, and tinted when seen from above through the water.

## Cost

- `settings.quality` (`low`, `medium`, `high`) and `settings.effects` decide how much the picture may cost. Counts, map sizes and effects follow them; on `low` an expensive effect may be left out.
- Many equal things are instances or thin instances of one mesh, culled per instance. A new kind of thing joins that scheme instead of adding a mesh per thing.
- What nobody can see is not stepped and not drawn: animals outside their hours, life in the pond with no player near.
- The shadow map's cast list is rebuilt only when it changes. A predicate evaluated per frame marks every material's lights dirty.
- A phone is bound by the processor, not by pixels (measured, iPhone: about 45 µs for each draw, five times an M4 Max's time for the same JavaScript). Every mesh is handled in JavaScript each frame and drawn in up to three passes: the picture, the sun's shadow map, the pond's mirror. So count meshes and materials, not triangles.
- What never changes once built is one mesh per material: `mergeStatic` in `src/world/models.ts` (the Shop, the Trading Post). A rigid part on a bone is skinned to that bone in the model's script and joined with the others (`tools/blender/build.py`: a beaver is 14 meshes, was 28).
- A value on `scene.imageProcessingConfiguration` (exposure, contrast) set to something new marks every material dirty on every mesh. One that follows the day changes in steps (`src/features/sky/index.ts`).
- A static collider (`physics.fixed`) is not put in place again before each step; a body made with `physics.body` is. Use `fixed` for whatever stands still.
- Measure before and after on the device that is slow. `freezeWorldMatrix()` on every mesh that stands still took 4% off the visibility pass (M4 Max): not worth its rules. `scene.performancePriority` turns picking off for new meshes (Babylon's documentation): not for this game.

## The HUD

Everything a player sees is drawn by Babylon. The reason is in `docs/adr/0001-babylon-renders-world-and-ui.md`.

- Visible UI is Babylon GUI on the fullscreen texture `stage.hud`.
- Build it with `Overlay` from `src/features/hud/overlay.ts`: `rect`, `text`, `label`, `pill`, `toast`, `button`, `field`, `range`. For each interactive control it creates a transparent native element with the same bounds, which carries pointer input, keyboard and gamepad focus and screen readers.
- Colours, type scale and each element's place on screen come from `src/features/hud/style.ts` (`layout`, read through `hudLayout(stage)`). Regions never overlap; a new element gets a home there instead of fixed pixels.
- One face: Nunito, bundled as `assets/nunito.woff2` (OFL, `assets/nunito-OFL.txt`) and loaded by `overlay.ts`, never fetched from a font service. Every overlay lays itself out again once it has loaded. Icons are inline SVG (`hud/icons.ts`), key caps `Overlay.cap` (none on touch: it has no keys).
- Babylon GUI has no backdrop blur: panels are the 80% `PANEL` alone.
- Any change to any control sends the whole fullscreen texture to the GPU again: 18 ms on a phone (measured). Change a control only when what it shows changes, and let nothing on the HUD move by the clock on a touch screen.
- The HUD must read at 640x360, 1280x720, 1920x1080, 390x844 and 844x390.
- A test (`src/features/hud/dom.test.ts`) fails when another file creates a DOM element.
- Panels around the game on the stream (queue, titles, chat) belong to OBS, outside this repository.
