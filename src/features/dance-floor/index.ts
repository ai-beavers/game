// The Dance floor (a viewer's wish): an open square of coloured tiles out in the far meadow, just short of the bank and
// far from the Pond and the Shop (place.ts, floor.ts). Its tiles light up in turn to the beat (rules.ts lit), and
// glow brighter from dusk to dawn (rules.ts brightness, by the sky's dark). A beaver that stands still on it with empty
// paws, on land and not riding, sitting or crawling, starts to Dance after a moment: this feature writes low "dance"
// into the player's Motion each step (the player itself leaves low to sit and crawl), the animator draws it (src/anim)
// and it travels to other players with the Motion (src/features/net), so a group can dance together. Moving stops it.
// The first-person view holds steady while it dances (camera.steady). The beat itself is the audio feature's: it
// reads rules.ts loudness for where the beaver is.
//
//   import { create as danceFloor } from "./features/dance-floor/index.ts";   after the sky, before the lantern: the
//                                                                              lantern waits while the beaver dances
//
// The floor is the same for everyone and in the same place; nothing about it is sent or saved.
//
// Debug, for bun shot --eval (window.danceFloor): danceFloor.place (its middle) · danceFloor.state { on, dancing,
// loudness } · danceFloor.at() stands on the middle of the floor.
import { DANCE_BPM } from "../../contracts.ts";
import type { CreateFeature } from "../../game.ts";
import { createFloor } from "./floor.ts";
import { FLOOR } from "./place.ts";
import { brightness, dances, lit, loudness, onFloor, stepStill } from "./rules.ts";

/** The good in the paw from the hotbar (window.trade, src/features/trade): the trade feature comes later. */
const held = () => (window as { trade?: { held?: string } }).trade?.held;
/** The lit tiles' glow over a beat: a little brighter on it, fading to the next. */
const PULSE = 0.25;

export const create: CreateFeature = (game) => {
  const { stage, world, player } = game, motion = player.motion;
  const floor = createFloor(stage, world);
  let still = 0, dancing = false;

  Object.assign(window, {
    danceFloor: {
      place: { x: FLOOR.x, z: FLOOR.z },
      get state() {
        const { x, z } = player.feet;
        return { on: onFloor(x, z), dancing, loudness: loudness(x, z) };
      },
      /** Stands on the middle of the floor, facing north, the camera behind. */
      at() {
        player.teleport(FLOOR.x, world.heightAt(FLOOR.x, FLOOR.z), FLOOR.z, 0);
        player.camera.yaw = Math.PI;
        return { at: [FLOOR.x, FLOOR.z] };
      },
      floor,
    },
  });

  return {
    step(dt) {
      const { x, z } = player.feet, { move } = player.input;
      const low = motion.low === "sit" || motion.low === "crawl" ? motion.low : undefined;
      still = stepStill(still, dt, {
        x, z, grounded: motion.grounded, afloat: player.afloat || player.diving, riding: player.riding, low,
        moving: motion.speed > 0.05 || Math.hypot(move.x, move.y) > 0.1, acting: motion.action !== "none" || motion.actionProgress > 0,
        holding: motion.carrying || held() !== undefined,
      });
      dancing = dances(still);
      if (dancing) motion.low = "dance";
      player.camera.steady = dancing;
    },
    update() {
      const beats = motion.time * DANCE_BPM / 60;
      floor.show(lit(beats));
      const glow = brightness(game.sky?.dark ?? 0) * (1 - PULSE + PULSE * Math.exp(-4 * (beats % 1)));
      floor.material.emissiveColor.setAll(glow);
    },
  };
};
