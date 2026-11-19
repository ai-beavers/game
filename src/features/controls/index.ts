// The "controls" feature: play with a gamepad or on a touch screen, beside keyboard and mouse.
//
//   createGame(canvas, [create])      the feature alone (lab/controls.html); in the game it is in FEATURES
//
// Gamepad (standard mapping): left stick or d-pad moves, as fast as it is pushed (half way walks, all the way runs;
// LB, the right trigger or a click on the stick runs too; LT opens the map), right stick turns the camera (settings.invertY
// flips up and down, for the mouse as well),
// A jumps (rises under water), X uses, B held dives, RB slaps the tail, Y flashes the lantern, a click on the right stick zooms out a step (from the farthest back in),
// Back sends P for the photo mode, Start sends Escape to open the pause menu. Plugging in or pulling out works any time.
// Touch: shown on a device with a touch screen, or with ?touch in the address; see touch.ts.
// Each device fills its own Input, added to the player's keyboard (player.keys.add); the last one used steers.
import type { CreateFeature } from "../../game.ts";
import { BUTTON, deadZone, down, firstPad, padInput } from "./pad.ts";
import { touchControls } from "./touch.ts";

const TURN_YAW = 2.6, TURN_PITCH = 1.6; // rad/s with the right stick fully pushed
const PIXELS = { low: 1, medium: 1.5, high: 2 }; // most canvas pixels per CSS pixel on a touch screen, per settings.quality

/** The pause menu listens for Escape, the photo mode for P (features/post); buttons send them. */
const press = (key: string, code: string) => {
  for (const type of ["keydown", "keyup"]) document.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true }));
};
const pause = () => press("Escape", "Escape"), photo = () => press("p", "KeyP");

export const create: CreateFeature = (game) => {
  const { player, stage, settings } = game;
  const pads = () => firstPad(navigator.getGamepads?.());
  player.keys.add({
    read(into) {
      const pad = pads();
      if (pad) return padInput(pad, into);
      into.move.x = into.move.y = 0;
      into.run = 0;
      into.jump = into.act = into.slap = into.dive = into.flash = false;
      return into;
    },
  });

  const touchScreen = navigator.maxTouchPoints > 0 || "ontouchstart" in window || new URLSearchParams(location.search).has("touch");
  const touch = touchScreen ? touchControls(game, pause, photo) : undefined;
  if (touch) player.keys.add(touch);
  // A phone screen is 3 px per CSS px; engine.ts draws at most 2 (2.25× fewer pixels than 3, hardly visible at arm's
  // length). Lower picture quality draws fewer still: 1.5 costs 0.56× of 2, and 1 a quarter, for a softer picture.
  if (touchScreen) settings.on(({quality}) => stage.engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, PIXELS[quality])));

  // The mouse turns the camera in player/camera.ts, which does not know the settings: tell it.
  settings.on((values) => { player.camera.invertY = values.invertY; });

  let held: boolean[] = [];
  return {
    update(dt) {
      touch?.show(!stage.paused && !document.body.classList.contains("photo"));
      touch?.light(!!game.lantern?.out); // the Light button only while the lantern is out
      const pad = pads();
      const was = held, pressed = (b: number) => !!held[b] && !was[b];
      held = pad ? pad.buttons.map((_, i) => down(pad, i)) : [];
      if (pressed(BUTTON.start)) pause();
      if (pressed(BUTTON.back)) photo();
      if (!pad || stage.paused) return;
      if (pressed(BUTTON.r3)) player.camera.zoom(player.camera.distance > 7.9 ? 0.25 : 2);
      const look = deadZone(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
      // Squared, so a small push turns slowly enough to aim.
      const yaw = look.x * Math.abs(look.x), pitch = look.y * Math.abs(look.y);
      player.camera.turn(-yaw * TURN_YAW * dt, pitch * TURN_PITCH * dt * (settings.values.invertY ? -1 : 1));
    },
  };
};
