// The game: all parts and all features (src/game.ts puts them together).
import { FEATURES } from "./features/index.ts";
import { createGame } from "./game.ts";

// index.html is fetching the big files for its progress bar: once they are in, the game's own requests hit the cache.
await (window as { loading?: Promise<void> }).loading;
await createGame(document.querySelector("canvas")!, FEATURES);
