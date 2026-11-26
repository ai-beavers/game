import type { CreateFeature } from "../../game.ts";
import { daylightOf } from "../../light.ts";
import { waterOf } from "../../world/water.ts";
import { createChain } from "./chain.ts";
import { photoMode } from "./photo.ts";
import { createUnderwater } from "./underwater.ts";

export const create: CreateFeature = game => {
  const chain = createChain(game.stage);
  const light = daylightOf(game.stage.scene);
  const unsubscribe = game.settings.on(({quality, effects}) => { chain.configure(quality, effects); light?.quality(quality); waterOf(game.stage.scene)?.reflect(quality === "high");
    game.stage.scene.getMeshByName("flowers")?.setEnabled(quality !== "low"); // the meadow's flowers (src/world/grass.ts)
  });
  game.stage.scene.onDisposeObservable.add(unsubscribe);
  const photo = photoMode(game, chain);
  const underwater = createUnderwater(game);
  game.stage.scene.metadata.underwater = underwater; // for the tour: underwater.on
  return { update(dt: number) { chain.glow(game.sky?.dark ?? 0, game.sky?.golden ?? 0); photo.update(dt); underwater.update(dt); } };
};
