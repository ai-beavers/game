// Mushrooms: small red-capped clusters at the foot of some trees in the Clearing (rules.ts SPOTS), not on the map.
// With free paws on land, within reach of one the Use key (E / X / the Use button) offers "Eat the mushroom": the
// beaver bends down and munches it (the munch event; the audio feature bites softly), and it is gone until the
// Clearing's next dawn. One or two do nothing to see; three within two minutes make the view dizzy (dizzy.ts): the
// colours drift through the rainbow, the picture waves and the camera sways, slowly, for about twenty seconds, then
// the view clears. Steering and the HUD stay as they are.
//
//   import { create as mushrooms } from "./features/mushrooms/index.ts";   after mrsBeaver in FEATURES (it shares the Use key)
//
// Nothing is kept or sent: the mushrooms and the dizziness live in this browser's memory for one visit; other players,
// bots and remotes know nothing of them.
//
// Debug, for bun shot --eval and the tour (window.mushrooms): .spots (where they grow) · .eaten (per spot) ·
// .appetite (mushrooms eaten in the last two minutes) · .dizzy (0 … 1) · .on (the dizzy pass on the camera) ·
// .shown(i) (spot i's mushrooms drawn) · .stand(i, d?) (where to stand d m from spot i on the meadow's side) ·
// .at(i) stands there, facing it · .dawn() grows all back.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { CreateFeature } from "../../game.ts";
import type { Actor, Offer } from "../../player/index.ts";
import { createDizzy } from "./dizzy.ts";
import { buildMushrooms } from "./look.ts";
import { appetite, dawn, dizzy, eat, fresh, offered, passedDawn, SPOTS, step } from "./rules.ts";

/** s the beaver is bent down munching. */
const MUNCH = 1.1;
/** m from a spot, on the side away from its tree (towards the meadow's middle), where .at() stands. */
const STAND = 0.6;

const towards = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.atan2(b.x - a.x, b.z - a.z);
/** Where to stand d m from spot i, on its side away from the tree (towards the meadow's middle). */
const stand = (i: number, d = STAND) => {
  const s = SPOTS[i]!, r = Math.hypot(s.x, s.z) || 1;
  return { x: s.x - (s.x / r) * d, z: s.z - (s.z / r) * d };
};

export const create: CreateFeature = (game) => {
  const { stage, world, player, events } = game;
  const state = fresh();
  const look = buildMushrooms(stage, SPOTS.map((s) => ({ x: s.x, y: world.heightAt(s.x, s.z), z: s.z })));
  const view = createDizzy(stage);
  const show = () => SPOTS.forEach((_, i) => look.show(i, !state.eaten[i]));

  const distances = () => SPOTS.map((s) => Math.hypot(player.feet.x - s.x, player.feet.z - s.z));
  const offers = (carrying: boolean) => offered(state, { distances: distances(), carrying, afloat: player.afloat || player.riding || player.diving });

  // The Use key: eat the mushroom in reach with free paws; anywhere else whatever the actor before had.
  const before = player.actor;
  const EAT: Offer = { action: "use", text: "Eat the mushroom" };
  let munching: { spot: number; t: number } | undefined;
  const actor: Actor = {
    begin(carrying) {
      const spot = offers(carrying);
      if (spot === undefined) return before?.begin(carrying);
      eat(state, spot);
      munching = { spot, t: 0 };
      const s = SPOTS[spot]!;
      events.emit("munch", { place: new Vector3(s.x, world.heightAt(s.x, s.z), s.z) });
      return { action: "build", face: towards(player.feet, s) }; // bent down over it
    },
    offer(carrying) {
      return offers(carrying) !== undefined ? EAT : before?.offer?.(carrying);
    },
    step(dt, held) {
      if (!munching) return before?.step(dt, held);
      munching.t += dt;
      if (munching.t < MUNCH) return munching.t / MUNCH;
      munching = undefined;
      show(); // gone once munched
      return undefined;
    },
  };
  player.actor = actor;

  let hour = game.sky?.hour;
  Object.assign(window, {
    mushrooms: {
      spots: SPOTS.map((s) => ({ x: s.x, z: s.z })),
      get eaten() { return [...state.eaten]; },
      get appetite() { return appetite(state); },
      get dizzy() { return dizzy(state); },
      get on() { return view.on; },
      shown: (i: number) => look.shown(i),
      /** Where to stand d m (default: where .at() stands) from spot i, on the meadow's side. */
      stand,
      /** Stands beside spot i on the meadow's side, facing it. */
      at(i: number) {
        const s = SPOTS[i]!, p = stand(i), face = towards(p, s);
        player.teleport(p.x, world.heightAt(p.x, p.z), p.z, face);
        player.camera.yaw = face + Math.PI;
      },
      dawn() { dawn(state); show(); },
    },
  });

  return {
    step(dt) { step(state, dt); },
    update(dt) {
      // The Clearing's dawn: eaten mushrooms have grown back.
      const now = game.sky?.hour;
      if (now !== undefined && hour !== undefined && passedDawn(hour, now)) { dawn(state); if (!munching) show(); }
      hour = now;
      view.update(stage.paused ? 0 : dt, dizzy(state));
    },
  };
};
