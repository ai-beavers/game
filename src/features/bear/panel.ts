// The Bear's Health bar in the HUD: its name, "Bear", in gold, a bar that empties with every tail slap that lands, and
// the number, in one row at the top centre under the caption (style.ts health). Shown only while the feature says so.
//
//   const bar = healthBar(stage);   bar.set(80) · bar.update(shown) once a picture
//
// Babylon GUI on stage.hud through Overlay; the number's native counterpart carries it for screen readers. Names, for
// the tour: "bear-name", "bear-health" (the number), "bear-health-fill".
import type { Rectangle } from "@babylonjs/gui/2D/controls/rectangle.js";
import type { TextBlock } from "@babylonjs/gui/2D/controls/textBlock.js";
import type { Stage } from "../../engine.ts";
import { box, hudLayout, measure, onViewport, Overlay } from "../hud/overlay.ts";
import { GOLD, HEALTH as FILL, TRACK, type Box } from "../hud/style.ts";
import { HEALTH } from "./rules.ts";

export const NAME = "Bear";

export function healthBar(stage: Stage) {
  const overlay = new Overlay(stage, "bear-health-bar", false, 4);
  let fill: Rectangle, number: TextBlock, track: Box = box(0, 0, 0, 0), health = HEALTH, flash = 0;
  const place = () => {
    number.text = String(health);
    fill.isVisible = health > 0;
    overlay.move(fill, { ...track, w: Math.max(track.h, track.w * health / HEALTH) });
  };
  onViewport(stage, () => {
    overlay.clear();
    const { health: slot, small, pad } = hudLayout(stage);
    const nameW = Math.ceil(measure(NAME, small, "600")) + 4, numberW = Math.ceil(measure(String(HEALTH), small, "600")) + 4, h = Math.max(6, Math.round(slot.h * 0.3));
    overlay.rect("bear-health-back", slot).cornerRadius = slot.h / 2;
    const name = overlay.label("bear-name", NAME, box(slot.x + pad, slot.y, nameW, slot.h), small, "center");
    name.color = GOLD;
    number = overlay.label("bear-health", "", box(slot.x + slot.w - pad - numberW, slot.y, numberW, slot.h), small, "center");
    name.fontWeight = number.fontWeight = "600";
    track = box(slot.x + pad + nameW + pad / 2, slot.y + (slot.h - h) / 2, slot.w - 3 * pad - nameW - numberW, h);
    overlay.rect("bear-health-track", track, TRACK, h / 2);
    fill = overlay.rect("bear-health-fill", track, FILL, h / 2);
    place();
  });
  const hudShown = () => !!stage.hud.getControlByName("beaver-hud")?.isVisible && !document.body.classList.contains("photo");
  return {
    /** The Health the bar shows, 0 … HEALTH; when it falls, what is left flashes white for a moment. */
    set(value: number) {
      if (value === health) return;
      if (value < health) flash = performance.now() + 160;
      health = value; place();
    },
    update(shown: boolean) {
      overlay.show(shown && hudShown());
      const colour = performance.now() < flash ? "#ffffff" : FILL;
      if (fill.background !== colour) fill.background = colour;
    },
  };
}
