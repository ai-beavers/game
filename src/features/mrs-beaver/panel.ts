// Mrs. Beaver's quest in the HUD: a small checklist titled "Find Mrs. Beaver" with its three steps, the done ones
// ticked in gold, the one at hand in full colour, the ones still to come dimmed; once she is freed only the one gold
// line "Mrs. Beaver found".
//
//   const list = questList(stage, ["Find her flower", …]);   list.set(done) (steps done, 0 … 3) · list.update() once a picture
//
// Babylon GUI on stage.hud through Overlay, with the goals: hung under the goals panel (src/features/hud), following
// its height as the goals wrap. Deliberately not one of the build rules' goals: those steer the HUD's marker, and her
// hiding place must not be marked. The list says nothing of where the flower or she is.
//
// Names, for the tour: "mrs-beaver" is the title (or the one line once she is freed), "mrs-beaver-step-0" … "-2" the
// step lines, each its step's text with "✓ " (done), "› " (at hand) or "· " (to come) before it.
import type { Rectangle } from "@babylonjs/gui/2D/controls/rectangle.js";
import type { TextBlock } from "@babylonjs/gui/2D/controls/textBlock.js";
import type { Stage } from "../../engine.ts";
import { box, hudLayout, measure, onViewport, Overlay, underGoals } from "../hud/overlay.ts";
import { GOLD, PAPER, QUIET } from "../hud/style.ts";

export const TITLE = "Find Mrs. Beaver", FOUND = "Mrs. Beaver found";

export function questList(stage: Stage, steps: readonly string[]) {
  const overlay = new Overlay(stage, "mrs-beaver-list", false, 4);
  let back: Rectangle, title: TextBlock, lines: TextBlock[] = [], done = -1, x = 0, y = 0, w = 0, lineH = 0, pad = 0, gap = 6, size = 12, limit = Infinity;
  const draw = () => {
    overlay.clear();
    shownAt = NaN; // placed under the goals anew on the next update
    const at = hudLayout(stage);
    size = Math.round(at.u * 0.9);
    gap = at.gap; limit = at.chatRow.y - at.gap; pad = Math.round(size * 0.6); lineH = Math.round(size * 1.3);
    // As wide as its longest line needs, at most as wide as the goals.
    const widest = Math.max(measure(TITLE, size, "600"), ...steps.map((s) => measure("✓ " + s, size)));
    w = Math.min(at.goals.w, Math.ceil(widest) + 2 * pad + 4);
    x = at.goals.x; y = at.goals.y;
    back = overlay.rect("mrs-beaver-back", box(x, y, w, 1));
    title = overlay.label("mrs-beaver", "", box(x + pad, y, w - 2 * pad, lineH), size);
    title.fontWeight = "600";
    lines = steps.map((_, i) => overlay.label(`mrs-beaver-step-${i}`, "", box(x + pad, y, w - 2 * pad, lineH), size));
    const now = done;
    done = -1;
    set(now < 0 ? 0 : now);
  };
  /** Puts the list with its top at top. Where all its lines would reach down to the chat row (a small, wide screen),
   *  only the title and the step at hand. */
  const place = (top: number) => {
    y = Math.round(top);
    const freed = done >= steps.length, inset = Math.round(pad * 0.6), full = (1 + steps.length) * lineH + Math.round(pad * 1.2);
    const rows = freed ? [] : y + full > limit ? [Math.min(done, steps.length - 1)] : steps.map((_, i) => i);
    const h = (1 + rows.length) * lineH + Math.round(pad * 1.2);
    overlay.move(back, box(x, y, freed ? Math.min(w, Math.ceil(measure(FOUND, size, "600")) + 2 * pad + 4) : w, h));
    overlay.move(title, box(x + pad, y + inset, w - 2 * pad, lineH));
    lines.forEach((line, i) => {
      const row = rows.indexOf(i);
      line.isVisible = row >= 0;
      if (row >= 0) overlay.move(line, box(x + pad, y + inset + (row + 1) * lineH, w - 2 * pad, lineH));
    });
  };
  const set = (value: number) => {
    if (value === done) return;
    done = value;
    const freed = done >= steps.length;
    title.text = freed ? FOUND : TITLE;
    title.color = freed ? GOLD : PAPER;
    lines.forEach((line, i) => {
      line.text = (i < done ? "✓ " : i === done ? "› " : "· ") + steps[i];
      line.color = i < done ? GOLD : i === done ? PAPER : QUIET;
      line.alpha = i > done ? 0.6 : 1;
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
      // Under the goals panel as tall as it is now; at the goals' place when the panel is hidden (the large map).
      const goals = stage.hud.getControlByName("goals-panel") as Rectangle | null;
      const top = goals?.isVisible ? parseFloat(goals.top as string) + parseFloat(goals.height as string) + gap : hudLayout(stage).goals.y;
      if (top !== shownAt && Number.isFinite(top)) { shownAt = top; place(top); }
      underGoals.box = overlay.group.isVisible ? { x, y, w: parseFloat(back.width as string), h: parseFloat(back.height as string) } : undefined;
    },
  };
}
