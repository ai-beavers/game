// The finish of the picture and photo mode.
//
//   createGame(canvas, [post])       replaces stage.draw: through the effect chain (chain.ts) while
//                                    settings.effects is on, the engine's plain draw while it is off
//   P                                photo mode (photo.ts): free camera, depth of field, Enter saves a PNG
//
// Plain draw and chain show the same brightness and colours: both use the renderer's tone mapping and exposure
// (src/light.ts); the chain applies them in its OutputPass instead of in every material.
import type { CreateFeature } from "../../game.ts";
import { createChain } from "./chain.ts";
import { photoMode } from "./photo.ts";

export const create: CreateFeature = (game) => {
  const { stage, settings } = game;
  const plain = stage.draw, chain = createChain(stage), photo = photoMode(game, chain);
  settings.on(({ quality, effects }) => chain.configure(quality, effects));
  // In photo mode the chain draws even with effects off: then it only adds the depth of field.
  stage.draw = () => (settings.values.effects || photo.on ? chain.render() : plain());
  return { update: (dt) => photo.update(dt) };
};
