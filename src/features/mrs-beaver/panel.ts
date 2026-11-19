// Mrs. Beaver's line in the HUD: "Find Mrs. Beaver" while she is missing, "Mrs. Beaver found" once she is freed.
//
//   const line = rescueLine(stage);   line.set(text) · line.update() once a picture
//
// Babylon GUI on stage.hud through Overlay, with the goals: hung under the goals panel (src/features/hud), following
// its height as the goals wrap. Deliberately not one of the build rules' goals: those steer the HUD's marker, and her
// hiding place must not be marked. The line says nothing of where she is.
import type { Rectangle } from "@babylonjs/gui/2D/controls/rectangle.js";
import type { Stage } from "../../engine.ts";
import { hudLayout, onViewport, Overlay } from "../hud/overlay.ts";
import { GOLD } from "../hud/style.ts";

export function rescueLine(stage: Stage) {
  const overlay = new Overlay(stage, "mrs-beaver-line", false, 4);
  let pill: ReturnType<Overlay["pill"]>, text = "", gap = 6, done = false;
  const draw = () => {
    overlay.clear();
    const at = hudLayout(stage);
    gap = at.gap;
    pill = overlay.pill("mrs-beaver", { ...at.goals, h: at.u * 2 }, Math.round(at.u * 0.9), "top");
    pill.text.fontWeight = "600";
    const now = text;
    text = "";
    set(now);
  };
  const set = (value: string) => {
    if (value === text) return;
    text = value;
    pill.set(value);
    pill.text.color = done ? GOLD : "#f6f2e7";
    shownAt = NaN;
  };
  let shownAt = NaN;
  onViewport(stage, draw);
  const hudShown = () => !!stage.hud.getControlByName("beaver-hud")?.isVisible && !document.body.classList.contains("photo");
  return {
    set(value: string, found: boolean) { done = found; set(value); },
    update() {
      overlay.show(hudShown() && !!text);
      // Under the goals panel as tall as it is now; at the goals' place when the panel is hidden (the large map).
      const goals = stage.hud.getControlByName("goals-panel") as Rectangle | null;
      const y = goals?.isVisible ? parseFloat(goals.top as string) + parseFloat(goals.height as string) + gap : pill.slot.y;
      if (y !== shownAt && Number.isFinite(y)) { shownAt = y; pill.at(pill.slot.x, y); }
    },
  };
}
