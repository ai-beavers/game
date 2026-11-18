// Several parts share the context key: the first that has something to do here gets it.
//
//   player.actor = firstOf(build, trade)      build first: at the dam it builds; elsewhere the trading post may take the stick
//
// The one whose begin() started an action is stepped until it says the action is over.
import type { Actor } from "./index.ts";

export function firstOf(...actors: Actor[]): Actor {
  let running: Actor | undefined;
  return {
    begin(carrying) {
      for (const actor of actors) {
        const started = actor.begin(carrying);
        if (started) { running = actor; return started; }
      }
      return undefined;
    },
    offer(carrying) {
      for (const actor of actors) {
        const offer = actor.offer?.(carrying);
        if (offer) return offer;
      }
      return undefined;
    },
    step(dt, held) {
      const progress = running?.step(dt, held);
      if (progress === undefined) running = undefined;
      return progress;
    },
  };
}
