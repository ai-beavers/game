// The race card on the HUD, top centre under the caption (style.ts layout.race): "Lap 2/3" and the running time on
// top, the best time of the visit under them; at the finish the final time and "New best!" for SHOWN s. Hidden while
// no race runs. Not interactive.
//
//   const card = raceCard(stage);   card.show(race, best)   each frame; the texts change only when what they say does
//
// The texts are the HUD's "race-lap", "race-time" and "race-best", for the tour.
import { Control } from "@babylonjs/gui/2D/controls/control.js";
import type { Rectangle } from "@babylonjs/gui/2D/controls/rectangle.js";
import type { TextBlock } from "@babylonjs/gui/2D/controls/textBlock.js";
import type { Stage } from "../../engine.ts";
import { box, hudLayout, onViewport, Overlay } from "../hud/overlay.ts";
import { GLOW, GOLD, PANEL, PAPER, QUIET } from "../hud/style.ts";
import { cardShown, clock, LAPS, type Race } from "./rules.ts";

export function raceCard(stage: Stage) {
  const overlay = new Overlay(stage, "race-card", false, 4);
  let said = "", parts: { back: Rectangle; lap: TextBlock; time: TextBlock; best: TextBlock } | undefined;
  const hudShown = () => !!stage.hud.getControlByName("beaver-hud")?.isVisible && !document.body.classList.contains("photo");

  const draw = () => {
    overlay.clear();
    const at = hudLayout(stage), { x, y, w, h } = at.race, { u, small } = at;
    const back = overlay.rect("race-back", at.race, PANEL, Math.round(h * 0.3));
    const pad = Math.round(u * 0.8), top = Math.round(u * 1.5), inner = w - 2 * pad, rowY = y + Math.round(h * 0.12);
    const lap = overlay.text("race-lap", "", box(x + pad, rowY, inner, top), Math.round(u * 0.95));
    lap.color = GOLD; lap.fontWeight = "800"; lap.textWrapping = false;
    const time = overlay.text("race-time", "", box(x + pad, rowY, inner, top), Math.round(u * 1.25));
    time.fontWeight = "900"; time.textWrapping = false; time.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    const best = overlay.text("race-best", "", box(x + pad, rowY + top, inner, Math.round(small * 1.3)), small, "center");
    best.color = QUIET; best.textWrapping = false;
    parts = { back, lap, time, best };
    said = "";
  };
  onViewport(stage, draw);
  overlay.show(false);

  return {
    show(race: Race, best: number | undefined) {
      const on = cardShown(race) && hudShown();
      overlay.show(on);
      if (!on || !parts) return;
      const lap = race.kind === "racing" ? `Lap ${Math.min(race.lap, LAPS)}/${LAPS}` : "Finish!";
      const time = race.kind === "racing" || race.kind === "finished" ? clock(race.time) : "";
      const fresh = race.kind === "finished" && race.newBest;
      const line = fresh ? "New best!" : best === undefined ? "Best: none yet" : `Best ${clock(best)}`;
      const say = `${lap}|${time}|${line}`;
      if (say === said) return;
      said = say;
      parts.lap.text = lap; parts.time.text = time; parts.best.text = line;
      parts.best.color = fresh ? GOLD : QUIET;
      parts.best.fontWeight = fresh ? "900" : "600";
      parts.back.background = fresh ? GLOW : PANEL;
      parts.time.color = PAPER;
    },
  };
}
