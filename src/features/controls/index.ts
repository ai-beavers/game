// The "controls" feature: play with a gamepad or on a touch screen, beside keyboard and mouse.
//
//   createGame(canvas, [create])      the feature alone (lab/controls.html); in the game it is in FEATURES
//
// Gamepad (standard mapping): left stick or d-pad moves, as fast as it is pushed (half way walks, all the way runs;
// a shoulder button, a trigger or a click on the stick runs too), right stick turns the camera (settings.invertY
// flips up and down, for the mouse as well),
// A jumps, X or B uses, Start sends Escape to open the pause menu. Plugging in or pulling out works any time.
// Touch: shown on a device with a touch screen, or with ?touch in the address; see touch.ts.
// Each device fills its own Input, added to the player's keyboard (player.keys.add); the last one used steers.
import type { CreateFeature } from "../../game.ts";
import { BUTTON, deadZone, down, firstPad, padInput } from "./pad.ts";
import { touchControls } from "./touch.ts";

const TURN_YAW = 2.6, TURN_PITCH = 1.6; // rad/s with the right stick fully pushed

/** The pause menu listens for Escape; Start and the pause button send it. */
const pause = () => {
  for (const type of ["keydown", "keyup"]) document.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", bubbles: true }));
};

export const create: CreateFeature = (game) => {
  const { player, stage, settings } = game;
  const pads = () => firstPad(navigator.getGamepads?.());
  player.keys.add({
    read(into) {
      const pad = pads();
      if (pad) return padInput(pad, into);
      into.move.x = into.move.y = 0;
      into.run = 0;
      into.jump = into.act = false;
      return into;
    },
  });

  const touchScreen = navigator.maxTouchPoints > 0 || "ontouchstart" in window || new URLSearchParams(location.search).has("touch");
  const touch = touchScreen ? touchControls(game, pause) : undefined;
  if (touch) player.keys.add(touch);

  // The mouse turns the camera in player/camera.ts, which does not know the settings: tell it.
  settings.on((values) => { player.camera.invertY = values.invertY; });

  let startHeld = false;
  return {
    update(dt) {
      touch?.show(!stage.paused && !document.body.classList.contains("photo"));
      const pad = pads();
      const start = !!pad && down(pad, BUTTON.start);
      if (start && !startHeld) pause();
      startHeld = start;
      if (!pad || stage.paused) return;
      const look = deadZone(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
      // Squared, so a small push turns slowly enough to aim.
      const yaw = look.x * Math.abs(look.x), pitch = look.y * Math.abs(look.y);
      player.camera.turn(-yaw * TURN_YAW * dt, pitch * TURN_PITCH * dt * (settings.values.invertY ? -1 : 1));
    },
  };
};
