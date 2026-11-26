// Mrs. Beaver's quest in the HUD: the side quest's row at the foot of the quest tracker, a pink flower, "Find Mrs.
// Beaver" and under it the step at hand with how far along ("Find her flower · 1 of 4"); once she is freed only the
// one gold line "Mrs. Beaver found".
//
//   const list = questList(stage, ["Find her flower", …]);   list.set(done) (steps done, 0 … 4) · list.update() once a picture
//
// Babylon GUI on stage.hud through Overlay, joined to the bottom of the goals panel (src/features/hud), following its
// height as it changes. Deliberately not one of the build rules' goals: those steer the HUD's marker, and her hiding
// place must not be marked. The row says nothing of where the flower or she is.
//
// Names, for the tour: "mrs-beaver" is the title (or the one line once she is freed), "mrs-beaver-step-0" … "-3" the
// steps, each its step's text with "✓ " (done), "› " (at hand) or "· " (to come) before it: the whole checklist in
// words for screen readers, unseen on screen (the row shows the step at hand), hidden once she is freed.
import type { Image } from "@babylonjs/gui/2D/controls/image.js";
import type { Rectangle } from "@babylonjs/gui/2D/controls/rectangle.js";
import type { TextBlock } from "@babylonjs/gui/2D/controls/textBlock.js";
import type { Stage } from "../../engine.ts";
import { box, goalsPanel, hudLayout, onViewport, Overlay, underGoals } from "../hud/overlay.ts";
import { FLOWER, GOLD, PAPER, QUIET, RADIUS, TRACK } from "../hud/style.ts";

export const TITLE = "Find Mrs. Beaver", FOUND = "Mrs. Beaver found";

export function questList(stage: Stage, steps: readonly string[]) {
  const overlay = new Overlay(stage, "mrs-beaver-list", false, 4);
  let back: Rectangle, line: Rectangle, flower: Image, chevron: Image, title: TextBlock, at: TextBlock, lines: TextBlock[] = [];
  let done = -1, x = 0, y = 0, w = 0, h = 0, size = 12, atSize = 11, pad = 0, gap = 6;
  const draw = () => {
    overlay.clear();
    shownAt = NaN; // placed under the goals anew on the next update
    const l = hudLayout(stage);
    size = Math.round(l.u * 0.95); pad = l.pad; gap = l.gap;
    x = l.goals.x; y = l.goals.y; w = l.goals.w;
    back = overlay.rect("mrs-beaver-back", box(x, y, w, 1));
    back.cornerRadiusX = back.cornerRadiusY = 0; back.cornerRadiusZ = back.cornerRadiusW = RADIUS;
    line = overlay.rect("mrs-beaver-line", box(x + pad, y, w - 2 * pad, 1), TRACK, 0);
    flower = overlay.icon("mrs-beaver-flower", "flower", box(x, y, size * 1.3, size * 1.3), FLOWER);
    chevron = overlay.icon("mrs-beaver-more", "chevron", box(x, y, size, size), QUIET);
    title = overlay.label("mrs-beaver", "", box(x, y, w, size * 1.3), size);
    title.fontWeight = "800";
    atSize = Math.round(l.small * 0.9);
    at = overlay.text("mrs-beaver-at", "", box(x, y, w, size * 1.3), atSize, "left", false);
    at.color = QUIET;
    lines = steps.map((_, i) => {
      const step = overlay.text(`mrs-beaver-step-${i}`, "", box(x, y, w, 1), size);
      step.alpha = 0;
      return step;
    });
    const now = done;
    done = -1;
    set(now < 0 ? 0 : now);
  };
  /** Puts the row with its top at top: the flower, the title and the step at hand beside it, the chevron right. */
  const place = (top: number) => {
    y = Math.round(top);
    const freed = done >= steps.length, lineH = Math.round(size * 1.3), subH = freed ? 0 : Math.round(atSize * 1.35);
    h = Math.round(pad * 1.6) + lineH + subH;
    const icon = Math.round(size * 1.3), textX = x + pad + icon + gap;
    overlay.move(back, box(x, y, w, h));
    overlay.move(line, box(x + pad, y, w - 2 * pad, 1));
    overlay.move(flower, box(x + pad, y + (h - icon) / 2, icon, icon));
    overlay.move(chevron, box(x + w - pad - size, y + (h - size) / 2, size, size));
    overlay.move(title, box(textX, y + Math.round(pad * 0.8), x + w - pad - size - textX, lineH));
    overlay.move(at, box(textX, y + Math.round(pad * 0.8) + lineH, x + w - pad - size - textX, subH));
    at.isVisible = chevron.isVisible = !freed;
  };
  const set = (value: number) => {
    if (value === done) return;
    done = value;
    const freed = done >= steps.length;
    title.text = freed ? FOUND : TITLE;
    title.color = freed ? GOLD : PAPER;
    at.text = freed ? "" : `${steps[done]} · ${done + 1} of ${steps.length}`;
    lines.forEach((step, i) => {
      step.text = (i < done ? "✓ " : i === done ? "› " : "· ") + steps[i];
      step.isVisible = !freed;
    });
    place(y);
  };
  let shownAt = NaN;
  onViewport(stage, draw);
  const hudShown = () => !!stage.hud.getControlByName("beaver-hud")?.isVisible && !document.body.classList.contains("photo");
  return {
    /** How many steps are done, 0 … steps.length (freed). */
    set,
    update() {
      overlay.show(hudShown());
      // Joined to the goals panel as tall as it is now; at the goals' place when the panel is hidden (the large map).
      const goals = goalsPanel.box, top = goals ? goals.y + goals.h : hudLayout(stage).goals.y;
      if (top !== shownAt && Number.isFinite(top)) {
        shownAt = top; place(top);
        // Alone (no panel above it) it is a card of its own: all four corners round, no line on top.
        back.cornerRadiusX = back.cornerRadiusY = goals ? 0 : RADIUS; line.isVisible = !!goals;
      }
      underGoals.box = overlay.group.isVisible ? { x, y, w, h } : undefined;
    },
  };
}
