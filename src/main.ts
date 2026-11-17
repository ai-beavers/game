// The game: all parts and all features (src/game.ts puts them together).
import { FEATURES } from "./features/index.ts";
import { createGame } from "./game.ts";

await createGame(document.querySelector("canvas")!, FEATURES);
