// The Stare (GLOSSARY.md; a viewer's wish): when the player has touched nothing for a minute of game time, the beaver
// slowly turns round on the spot to face the player's camera, raises its head and looks straight into the lens,
// unblinking, its head cocked a little, its eyes on the camera as it moves. The first touch of any control eases it
// back within a fraction of a second, and that touch does what it always does. Only on land, in the third-person view,
// with no menu, page or photo open; only this player sees it (Motion.stare never travels, src/features/net).
//
// Once it faces the lens it creeps up to it: the camera holds still (player.camera.hold) and sinks to the eyes, and
// the beaver walks slowly straight at it until its face nearly touches the lens, or something stops it; there it
// stares on. Others see only that walk, through the usual movement sync.
//
// stare.ts counts and eases; this file tells it whether anything was touched (player.touched: keys, mouse, touch, pad,
// camera turns and zooms) and whether a stare is allowed, turns and walks the beaver (player.turnTo), holds the
// camera and aims the head (Motion.stare, drawn by the animator). The game runs without it.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { CreateFeature } from "../../game.ts";
import { modalOpen } from "../hud/overlay.ts";
import { approaching, creepSpeed, newStare, stepApproach, stepStare } from "./stare.ts";

/** rad/s the body turns at most while it comes round to the camera, and 1/s: slower as it gets there, so it arrives
 *  softly. About three seconds for a whole half turn. */
const TURN_RATE = 1.3, SETTLE = 2;

export const create: CreateFeature = (game) => {
  const { stage, player, beaver } = game, motion = player.motion, stare = newStare();
  let seen = player.touched;
  const covered = () => stage.paused || document.body.classList.contains("photo") || modalOpen();
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
      // Round to face the camera, slowly, then up to it; once let go the heading stays where the stare left it, and
      // the beaver where the approach left it.
      const camera = stage.camera.position, feet = player.feet;
      eyes.copyFrom(beaver.eyes.getAbsolutePosition());
      const heading = Math.atan2(camera.x - feet.x, camera.z - feet.z), off = Math.atan2(Math.sin(heading - player.facing), Math.cos(heading - player.facing));
      const distance = Math.hypot(camera.x - eyes.x, camera.z - eyes.z), walk = stepApproach(stare, dt, off, distance);
      if (stare.staring) {
        const speed = walk ? creepSpeed(distance) : undefined;
        player.turnTo = { heading, rate: Math.min(TURN_RATE * Math.min(1, stare.on * 4), SETTLE * Math.abs(off) + 0.05), speed };
      } else player.turnTo = undefined;
      player.camera.hold = approaching(stare) ? eyes : undefined;
      if (weight <= 0) { delete motion.stare; return; }
      // The head's aim, relative to the body as this picture shows it: from the eyes to the lens, every picture.
      camera.subtractToRef(eyes, to);
      const f = player.node.rotation.y, x = to.x * Math.cos(f) - to.z * Math.sin(f), z = to.x * Math.sin(f) + to.z * Math.cos(f);
      motion.stare = { weight, yaw: Math.atan2(x, z), pitch: Math.atan2(to.y, Math.hypot(x, z)) };
    },
  };
};
