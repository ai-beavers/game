// The game: all parts and all features (src/game.ts puts them together).
import { FEATURES } from "./features/index.ts";
import { createGame } from "./game.ts";
// Custom shaders with #include<instances…> (grass, animals): the production bundle has only the includes imported here.
import "@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration.js";
import "@babylonjs/core/Shaders/ShadersInclude/instancesVertex.js";

// index.html is fetching the big files for its progress bar: once they are in, the game's own requests hit the cache.
await (window as { loading?: Promise<void> }).loading;
const game = await createGame(document.querySelector("canvas")!, FEATURES);
// The dev server only: Babylon's Inspector, a free camera and Spector (src/features/debug/tools.ts). The production
// bundle drops this branch and all it imports, because import.meta.hot is undefined there.
if (import.meta.hot) void import("./features/debug/tools.ts").then((tools) => tools.attach(game));
