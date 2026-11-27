// The Lightbulb (a viewer's wish): one bare bulb hanging on a cord from a crooked wooden post beside the workbench
// (post.ts, place.ts). At the post E offers "Pull the cord", whatever the paws hold: the beaver tugs the pull string
// with its paw (the lantern's reach, Motion.reachBack, a short way up) and the bulb switches on; the next pull switches
// it off. Lit, the glass glows softly by day and brightly at night (state.ts glow, by the sky's dark), and the bloom
// makes it shine. It lights nothing around it: no Babylon light, nothing in the self-lit shaders.
//
//   import { create as lightbulb } from "./features/lightbulb/index.ts";   after the workbench: it shares E (firstOf)
//
// Each player's own (docs/adr/0003): never sent, never saved, switched off on every page load. Remotes have no bulb:
// everyone sees their own.
//
// Debug, for bun shot --eval (window.lightbulb): lightbulb.state { on, pulling, glow } · lightbulb.place (where the
// post stands) · lightbulb.at() stands at the cord facing it.
import type { CreateFeature } from "../../game.ts";
import { firstOf } from "../../player/actors.ts";
import type { Actor, Offer } from "../../player/index.ts";
import { tradeOf } from "../trade/index.ts";
import { createPost, WARM_WHITE } from "./post.ts";
import { atCord, FACING, POST, STAND } from "./place.ts";
import { glow, pull, PULL_SECONDS, stepBulb, switchedOff, type Bulb } from "./state.ts";

const PULL: Offer = { action: "use", text: "Pull the cord" };
/** How far up the paw goes on its way to the backpack for the tug (Motion.reachBack): to the cord at head height. */
const TUG = 0.7;

export const create: CreateFeature = (game) => {
  const { stage, world, player } = game, { scene } = stage;
  const post = createPost(stage, world), trade = tradeOf(scene);
  let bulb: Bulb = switchedOff(), wants = false;

  // ---- E at the cord, whatever the paws hold ------------------------------------------------------------------------
  // Empty-pawed nothing starts (no pose of the player's). With a stick, an action must start or E drops it: a "build"
  // over at its first step, too short to show, keeps the stick in the paw.
  const here = () => !player.afloat && !player.diving && !player.riding && atCord(player.feet.x, player.feet.z);
  const actor: Actor = {
    begin(carrying) {
      if (!here()) return undefined;
      wants = true;
      return carrying ? { action: "build", face: FACING } : undefined;
    },
    offer() { return here() ? PULL : undefined; },
    step() { return undefined; },
  };
  player.actor = player.actor ? firstOf(player.actor, actor) : actor;

  Object.assign(window, {
    lightbulb: {
      place: { x: POST.x, z: POST.z },
      get state() { return { on: bulb.on, pulling: bulb.pulling > 0, glow: glow(bulb.on, game.sky?.dark ?? 0) }; },
      at() {
        player.teleport(STAND.x, world.heightAt(STAND.x, STAND.z), STAND.z, FACING);
        player.camera.yaw = FACING + Math.PI - 0.5;
        return { at: [+STAND.x.toFixed(2), +STAND.z.toFixed(2)] };
      },
      post,
    },
  });

  let reached = 0;
  return {
    step(dt) {
      if (wants) bulb = pull(bulb);
      wants = false;
      bulb = stepBulb(bulb, dt);
    },
    update() {
      const g = glow(bulb.on, game.sky?.dark ?? 0);
      post.glass.emissiveColor.copyFrom(WARM_WHITE).scaleInPlace(g);
      // The tug: the paw up to the cord and down again, the string giving with it.
      const k = bulb.pulling > 0 ? Math.sin(Math.PI * (1 - bulb.pulling / PULL_SECONDS)) : 0;
      post.tug(k);
      const reach = k * TUG;
      // The trade feature's hotbar reach waits while this one is under way; the larger of the others' and this one shows.
      if (trade) { if (reach > 0) trade.reaching = true; else if (reached) trade.reaching = false; }
      if (reach > 0) player.motion.reachBack = reached = Math.max(player.motion.reachBack ?? 0, reach);
      else if (reached) { if (player.motion.reachBack === reached) player.motion.reachBack = 0; reached = 0; }
    },
  };
};
