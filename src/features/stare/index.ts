// The Stare (GLOSSARY.md; a viewer's wish): when the player has touched nothing for a minute of game time, the beaver
// slowly turns round on the spot to face the player's camera, raises its head and looks straight into the lens,
// unblinking, its head cocked a little, its eyes on the camera as it moves. The first touch of any control eases it
// back within a fraction of a second, and that touch does what it always does. Only on land, in the third-person view,
// with no menu, page or photo open; only this player sees it (Motion.stare never travels, src/features/net).
//
// stare.ts counts and eases; this file tells it whether anything was touched (player.touched: keys, mouse, touch, pad,
// camera turns and zooms) and whether a stare is allowed, turns the beaver (player.turnTo) and aims the head
// (Motion.stare, drawn by the animator). The game runs without it.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { CreateFeature } from "../../game.ts";
import { newStare, stepStare } from "./stare.ts";

/** rad/s the body turns at most while it comes round to the camera, and 1/s: slower as it gets there, so it arrives
 *  softly. About three seconds for a whole half turn. */
const TURN_RATE = 1.3, SETTLE = 2;

export const create: CreateFeature = (game) => {
  const { stage, player, beaver } = game, motion = player.motion, stare = newStare();
  let seen = player.touched;
  const covered = () => stage.paused || document.body.classList.contains("photo") || !!document.querySelector("dialog.game-dialog[open]");
  /** Whether a stare may happen now: standing on land, behind the beaver, nothing in hand to finish, nothing over the game. */
  const allowed = () => !covered() && player.camera.view === "third-person" && motion.grounded && !player.afloat && !player.diving
    && !player.riding && motion.swimming === 0 && motion.action === "none" && motion.actionProgress === 0;
  const eyes = new Vector3(), to = new Vector3();
  Object.assign(window, { stare });

  return {
    update(dt) {
      const touched = player.touched !== seen;
      seen = player.touched;
      const weight = stepStare(stare, dt, touched, allowed());
      // Round to face the camera, slowly; once let go the heading stays where the stare left it.
      const camera = stage.camera.position, feet = player.feet;
      if (stare.staring) {
        const heading = Math.atan2(camera.x - feet.x, camera.z - feet.z), left = Math.abs(Math.atan2(Math.sin(heading - player.facing), Math.cos(heading - player.facing)));
        player.turnTo = { heading, rate: Math.min(TURN_RATE * Math.min(1, stare.on * 4), SETTLE * left + 0.05) };
      } else player.turnTo = undefined;
      if (weight <= 0) { delete motion.stare; return; }
      // The head's aim, relative to the body as this picture shows it: from the eyes to the lens, every picture.
      eyes.copyFrom(beaver.eyes.getAbsolutePosition());
      camera.subtractToRef(eyes, to);
      const f = player.node.rotation.y, x = to.x * Math.cos(f) - to.z * Math.sin(f), z = to.x * Math.sin(f) + to.z * Math.cos(f);
      motion.stare = { weight, yaw: Math.atan2(x, z), pitch: Math.atan2(to.y, Math.hypot(x, z)) };
    },
  };
};
