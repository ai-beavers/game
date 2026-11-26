// The stamina bar (GLOSSARY.md): a thin bar just above the hotbar (style.ts layout.stamina) with how much running the
// player's beaver has left (player.stamina, src/player/stamina.ts). Hidden while stamina is full; it fades in as soon
// as it drops and out again once it is full. Tired (player.tired) it turns a dull bark colour and its edge pulses
// slowly, so it is clear why the beaver walks. It has no name and no number.
//
// Babylon GUI on stage.hud through Overlay; not interactive. Its native counterpart tells screen readers the stamina
// in tenths. For the tour: window.staminaBar.shown (fading in or in view).
import type { Rectangle } from "@babylonjs/gui/2D/controls/rectangle.js";
import type { CreateFeature } from "../../game.ts";
import { box, hudLayout, onViewport, Overlay } from "../hud/overlay.ts";
import { PANEL, STAMINA, TIRED, TRACK, type Box } from "../hud/style.ts";

const FULL = 0.999; // stamina at which the bar counts as full
const IN = 6, OUT = 1.5; // 1/s: how fast it fades in, and out once full
const PULSE = 1.6; // s for one slow pulse of the edge while tired
const EDGE = [1, 3, 5].map((i) => parseInt(TIRED.slice(i, i + 2), 16)).join(","); // TIRED as r,g,b, for the pulsing edge

export const create: CreateFeature = ({ stage, player }) => {
  const overlay = new Overlay(stage, "stamina-bar", false, 3);
  let back: Rectangle, fill: Rectangle, track: Box = box(0, 0, 0, 0);
  let alpha = 0, shownLevel = 1, drawnW = -1, tired: boolean | undefined, said = -1, time = 0;
  onViewport(stage, () => {
    overlay.clear();
    const at = hudLayout(stage).stamina, inset = Math.max(1, Math.round(at.h * 0.2));
    back = overlay.rect("stamina-back", at, PANEL, at.h / 2);
    back.thickness = 1;
    track = box(at.x + inset, at.y + inset, at.w - 2 * inset, at.h - 2 * inset);
    overlay.rect("stamina-track", track, TRACK, track.h / 2);
    fill = overlay.rect("stamina-fill", track, STAMINA, track.h / 2);
    drawnW = -1; tired = undefined;
  });
  overlay.show(false);
  const hudShown = () => !!stage.hud.getControlByName("beaver-hud")?.isVisible && !document.body.classList.contains("photo");
  const bar = { get shown() { return overlay.group.isVisible && alpha > 0.05; } };
  Object.assign(window, { staminaBar: bar });

  return {
    update(dt) {
      if (stage.paused) dt = 0;
      const level = player.stamina, want = level < FULL ? 1 : 0;
      alpha += (want - alpha) * Math.min(1, dt * (want ? IN : OUT));
      if (!want && alpha < 0.01) alpha = 0;
      overlay.show(alpha > 0 && hudShown());
      if (!overlay.group.isVisible) return;
      shownLevel += (level - shownLevel) * Math.min(1, dt * 10);
      const w = Math.round(track.w * shownLevel);
      if (w !== drawnW) { drawnW = w; fill.isVisible = w >= 1; if (w >= 1) overlay.move(fill, { ...track, w: Math.max(Math.min(track.h, track.w), w) }); }
      if (player.tired !== tired) {
        tired = player.tired;
        fill.background = tired ? TIRED : STAMINA;
        if (!tired) back.color = "transparent";
      }
      time = tired ? time + dt : 0;
      if (tired) back.color = `rgba(${EDGE},${(0.45 + 0.45 * Math.sin(time * 2 * Math.PI / PULSE)).toFixed(2)})`;
      overlay.group.alpha = alpha;
      const tenths = Math.round(level * 10);
      if (tenths !== said) { said = tenths; overlay.dom.setAttribute("aria-label", `stamina ${tenths * 10}%${player.tired ? ", tired" : ""}`); }
    },
  };
};
