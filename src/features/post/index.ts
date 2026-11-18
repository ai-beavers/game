import type { CreateFeature } from "../../game.ts";
import { createChain } from "./chain.ts";
import { photoMode } from "./photo.ts";

export const create: CreateFeature = game => {
  const chain = createChain(game.stage);
  const unsubscribe = game.settings.on(({quality, effects}) => chain.configure(quality, effects));
  game.stage.scene.onDisposeObservable.add(unsubscribe);
  return photoMode(game, chain);
};
