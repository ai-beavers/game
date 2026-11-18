import type { CreateFeature } from "../../game.ts";
import { daylightOf } from "../../light.ts";
import { createChain } from "./chain.ts";
import { photoMode } from "./photo.ts";

export const create: CreateFeature = game => {
  const chain = createChain(game.stage);
  const light = daylightOf(game.stage.scene);
  const unsubscribe = game.settings.on(({quality, effects}) => { chain.configure(quality, effects); light?.quality(quality); });
  game.stage.scene.onDisposeObservable.add(unsubscribe);
  const photo = photoMode(game, chain);
  return { update(dt: number) { chain.night(game.sky?.dark ?? 0); photo.update(dt); } };
};
