// The Reading's speech line in the HUD: one line at a time, over the head of the beaver reading it (Mrs. Beaver, or
// the player's own beaver), in a pill sized to the line. Her lines in her flower's pink, the player's in cream. Kept
// within the HUD's middle (style.ts middle) and between its side columns, so it never runs into the live tour's
// caption above, the hints below, or the quest tracker and the map card beside it.
// Where there is no head to hang it over (the player's own line in the first-person view, a head behind the camera)
// it sits low and central, at the bottom of the middle. Hidden while nothing is read.
//
//   const speech = readingLine(stage);   speech.say(line, head) once a picture: head a place in the world, or
//                                        undefined for low and central; speech.say(undefined) hides it
//
// Babylon GUI on stage.hud through Overlay. Name, for the tour: "mrs-beaver-reading".
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Stage } from "../../engine.ts";
import { box, hudLayout, onViewport, Overlay } from "../hud/overlay.ts";
import { FLOWER, PAPER } from "../hud/style.ts";
import type { Line } from "./reading.ts";

export function readingLine(stage: Stage) {
  const overlay = new Overlay(stage, "mrs-beaver-reading-line", false, 5);
  let pill: ReturnType<Overlay["pill"]>, top = 0, bottom = 0, pad = 8, left = 0, right = 0, said: Line | undefined;
  const identity = Matrix.Identity(), screen = new Vector3();
  const draw = () => {
    overlay.clear();
    const l = hudLayout(stage), w = stage.canvas.clientWidth;
    top = l.middle.top; bottom = l.middle.bottom; pad = l.pad;
    // Between the side columns (the player card and quest tracker on the left, the map card on the right).
    left = Math.max(l.player.x + l.player.w, l.goals.x + l.goals.w) + l.gap; right = l.card.x - l.gap;
    const column = right - left >= l.u * 12 ? right - left : w - 2 * pad; // too narrow a column: the whole width
    pill = overlay.pill("mrs-beaver-reading", box(pad, top, Math.min(column, Math.round(l.u * 22)), Math.max(0, bottom - top)), l.u);
    pill.text.color = said?.reader === "her" ? FLOWER : PAPER;
    pill.set(said?.text ?? "");
  };
  onViewport(stage, draw);
  const hudShown = () => !!stage.hud.getControlByName("beaver-hud")?.isVisible && !document.body.classList.contains("photo");
  return {
    say(line: Line | undefined, head?: Vector3) {
      overlay.show(hudShown());
      if (line?.text !== said?.text || line?.reader !== said?.reader) {
        said = line;
        pill.text.color = line?.reader === "her" ? FLOWER : PAPER;
        pill.set(line?.text ?? "");
      }
      if (!line) return;
      const W = stage.canvas.clientWidth, H = stage.canvas.clientHeight, { w, h } = pill.measure(line.text);
      const lo = right - left >= w ? left : pad, hi = right - left >= w ? right : W - pad;
      let x = Math.max(lo, Math.min(hi - w, (W - w) / 2)), y = bottom - h;
      if (head) {
        Vector3.ProjectToRef(head, identity, stage.scene.getTransformMatrix(), stage.camera.viewport.toGlobal(W, H), screen);
        if (screen.z > 0 && screen.z < 1) {
          x = Math.max(lo, Math.min(hi - w, screen.x - w / 2));
          y = Math.max(top, Math.min(bottom - h, screen.y - h));
        }
      }
      pill.at(x, y);
    },
  };
}
