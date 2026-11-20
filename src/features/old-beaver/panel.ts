// The Old Beaver's words in the HUD: a speech box with his name, "Old Beaver", in gold over the line he murmurs now,
// at the bottom centre over the hints, in the home it shares with the breath (style.ts speech: he speaks only to a
// beaver on land, the breath shows only in the water). Sized to the line, wrapped to the box's width; a line too long
// for the room there is set smaller until it fits. Hidden while nothing is said. And over his head, while he talks,
// a small speaker: it shows who is talking, for a player who hears him.
//
//   const box = speechBox(stage);   box.say(line) · box.say("") clears it · box.update() once a picture
//   box.speaker(on, head)           once a picture: the speaker over `head` (a place in the world) while on
//
// Babylon GUI on stage.hud through Overlay; the line's native counterpart is a description, not a control: it carries
// the line for screen readers. Names, for the tour: "old-beaver-name", "old-beaver-line", "old-beaver-speaker".
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Image } from "@babylonjs/gui/2D/controls/image.js";
import type { Rectangle } from "@babylonjs/gui/2D/controls/rectangle.js";
import type { TextBlock } from "@babylonjs/gui/2D/controls/textBlock.js";
import type { Stage } from "../../engine.ts";
import { box, hudLayout, measure, onViewport, Overlay } from "../hud/overlay.ts";
import { GOLD, RADIUS, type Box } from "../hud/style.ts";

export const NAME = "Old Beaver";

export function speechBox(stage: Stage) {
  const overlay = new Overlay(stage, "old-beaver-speech", false, 4);
  let back: Rectangle, name: TextBlock, line: TextBlock, slot: Box = box(0, 0, 0, 0), size = 13, small = 11, pad = 8, said = "";
  let disc: Rectangle, speaker: Image;
  const identity = Matrix.Identity(), screen = new Vector3();
  /** Rows the text takes at a size, wrapped to a width. */
  const rows = (text: string, at: number, room: number) => Math.max(1, Math.ceil(measure(text, at) / Math.max(1, room - 4)));
  const place = () => {
    if (!said) { back.isVisible = name.isVisible = line.isVisible = false; return; }
    const room = slot.w - 2 * pad, nameH = Math.round(small * 1.3);
    // The size that lets the line fit the room above the hints: the box's own, or smaller (never under 10 px).
    let at = size;
    while (at > 10 && nameH + rows(said, at, room) * Math.round(at * 1.3) + Math.round(pad * 1.2) > slot.h) at--;
    const lineH = Math.round(at * 1.3), n = rows(said, at, room);
    const w = Math.min(slot.w, Math.ceil(Math.max(measure(NAME, small, "600"), n > 1 ? room : measure(said, at))) + 2 * pad + 4);
    const h = nameH + n * lineH + Math.round(pad * 1.2), x = Math.round(slot.x + (slot.w - w) / 2), y = slot.y + slot.h - h;
    line.fontSize = at;
    overlay.move(back, box(x, y, w, h));
    back.cornerRadius = Math.min(RADIUS * 1.2, h / 3);
    overlay.move(name, box(x + pad, y + Math.round(pad * 0.5), w - 2 * pad, nameH));
    overlay.move(line, box(x + pad - 2, y + Math.round(pad * 0.5) + nameH, w - 2 * pad + 4, n * lineH));
    back.isVisible = name.isVisible = line.isVisible = true;
  };
  const draw = () => {
    overlay.clear();
    const l = hudLayout(stage);
    slot = l.speech; size = l.u; small = l.small; pad = l.pad;
    back = overlay.rect("old-beaver-back", slot);
    name = overlay.label("old-beaver-name", NAME, slot, small, "center");
    name.fontWeight = "600";
    name.color = GOLD;
    line = overlay.label("old-beaver-line", said, slot, size, "center");
    disc = overlay.rect("old-beaver-speaker-back", box(0, 0, 0, 0));
    speaker = overlay.icon("old-beaver-speaker", "speaker", box(0, 0, 0, 0), GOLD);
    disc.isVisible = speaker.isVisible = false;
    place();
  };
  onViewport(stage, draw);
  const hudShown = () => !!stage.hud.getControlByName("beaver-hud")?.isVisible && !document.body.classList.contains("photo");
  return {
    /** Shows a line under his name; "" clears the box. */
    say(text: string) {
      if (text === said) return;
      said = text;
      line.text = text;
      place();
    },
    get said() { return said; },
    /** The speaker over `head` while `on`: a gold speaker on a dark disc, a constant size on the screen. Hidden when
     *  the head is behind the camera or off the screen. */
    speaker(on: boolean, head: Vector3) {
      const w = stage.canvas.clientWidth, h = stage.canvas.clientHeight, s = Math.round(size * 1.8);
      if (on) Vector3.ProjectToRef(head, identity, stage.scene.getTransformMatrix(), stage.camera.viewport.toGlobal(w, h), screen);
      on &&= screen.z > 0 && screen.z < 1 && screen.x > 0 && screen.x < w && screen.y > s && screen.y < h;
      disc.isVisible = speaker.isVisible = on;
      if (!on) return;
      const x = Math.round(screen.x - s / 2), y = Math.round(screen.y - s), inset = Math.round(s * 0.2);
      overlay.move(disc, box(x, y, s, s));
      disc.cornerRadius = s / 2;
      overlay.move(speaker, box(x + inset, y + inset, s - 2 * inset, s - 2 * inset));
    },
    update() { overlay.show(hudShown()); },
  };
}
