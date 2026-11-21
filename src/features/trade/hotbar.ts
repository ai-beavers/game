// The hotbar on the HUD: five square slots in a dark bar at the bottom centre (style.ts layout.hotbar). Slot 1 shows
// what the beaver carries (a stick) or nothing, slots 2 … 5 the goods in the backpack with their counts; the slot
// selected is lit orange. A tap or click on a slot selects it (Overlay's native buttons); live, nothing is pressed.
//
//   const bar = createHotbar(stage, (n) => select(n));
//   bar.show([{ icon: "stick" }, { icon: "pinecone", count: 2 }, {}, {}, {}], 2);    each frame; redrawn on a change
//
// The count of slot n is the HUD text "hotbar-count-<n>" ("×2"), for the tour.
import { Image } from "@babylonjs/gui/2D/controls/image.js";
import { Control } from "@babylonjs/gui/2D/controls/control.js";
import type { Rectangle } from "@babylonjs/gui/2D/controls/rectangle.js";
import type { TextBlock } from "@babylonjs/gui/2D/controls/textBlock.js";
import type { Stage } from "../../engine.ts";
import { box, hudLayout, onViewport, Overlay } from "../hud/overlay.ts";
import { FAINT, FONT, PANEL, PAPER, SLOT } from "../hud/style.ts";
import { label } from "./ledger.ts";
import { SLOTS } from "./hold.ts";

// The HUD's palette (style.ts); the slot selected is the gold at a fifth, as the design (design.pen, node Gu6b3).
const PICKED = "rgba(242,165,58,0.2)";
/** The design's sizes at a 64 px slot: corners, the icon, the number and the count. */
const SIZE = { bar: 18, slot: 12, icon: 28, number: 11, count: 12 };

/** What a slot shows: an icon ("stick" or a good's id) and a count; empty: nothing. */
export interface SlotView { icon?: string; count?: number }

// Line icons on a 24 px grid, drawn in cream.
const PATHS: Record<string, string> = {
  stick: "M4 20 20 4M11 13l-1-5M14 10l5 1M7 17l-3-2",
  pinecone: "M12 2v3M12 5c-3.5 0-6 4-6 8.5S9 21 12 21s6-3 6-7.5S15.5 5 12 5zM7 11l5 3 5-3M6.5 15.5 12 19l5.5-3.5M9 7.5l3 2 3-2",
  feather: "M12.67 19a2 2 0 0 0 1.42-.59l6.15-6.17a6 6 0 0 0-8.49-8.49L5.59 9.91A2 2 0 0 0 5 11.33V18a1 1 0 0 0 1 1zM16 8 2 22M17.5 15H9",
  loaf: "M4 17c-1.5-1-2-3-2-5 0-4 4.5-7 10-7s10 3 10 7c0 2-.5 4-2 5zM4 17v2h16v-2M8 8.5l1.5 3M12 7.5v3.5M16 8.5l-1.5 3",
  shell: "M3 15c0-5 4-10 9-10s9 5 9 10c-2 2-5 3-9 3s-7-1-9-3zM12 5v13M8 6.5 7 17M16 6.5l1 10.5M5 9.5l-.5 7M19 9.5l.5 7",
};
const iconUrl = (path: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="${PAPER}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`);
const ICONS = Object.fromEntries(Object.entries(PATHS).map(([id, path]) => [id, iconUrl(path)]));

/** What a screen reader says of a slot. */
const describe = (n: number, v: SlotView) =>
  `Slot ${n}: ${!v.icon ? "empty" : v.icon === "stick" ? "stick" : label(v.icon, v.count ?? 1)}`;

export function createHotbar(stage: Stage, select: (n: number) => void) {
  const overlay = new Overlay(stage, "hotbar");
  const live = new URLSearchParams(location.search).get("tour") === "live";
  let slots: { back: Rectangle; icon: Image; count: TextBlock; element?: HTMLButtonElement }[] = [];
  let views: SlotView[] = [], picked = 1, drawn = "";

  const draw = () => {
    slots.forEach((s, i) => {
      const v = views[i] ?? {}, on = i + 1 === picked;
      s.back.background = on ? PICKED : SLOT.back;
      s.back.color = on ? SLOT.chosen : SLOT.edge;
      s.icon.isVisible = !!v.icon;
      if (v.icon) s.icon.source = ICONS[v.icon] ?? null;
      s.count.text = v.count ? `×${v.count}` : "";
      s.element?.setAttribute("aria-label", describe(i + 1, v));
      s.element?.setAttribute("aria-pressed", String(on));
    });
  };

  onViewport(stage, () => {
    overlay.clear();
    const l = hudLayout(stage), at = l.hotbar, side = l.slot, k = side / 64;
    const pad = Math.round((at.h - side) / 2), gap = (at.w - 2 * pad - SLOTS * side) / (SLOTS - 1);
    overlay.rect("hotbar-bar", at, PANEL, Math.round(SIZE.bar * k));
    slots = Array.from({ length: SLOTS }, (_, i) => {
      const r = box(Math.round(at.x + pad + i * (side + gap)), at.y + pad, side, side), n = i + 1;
      const back = overlay.rect(`hotbar-slot-${n}`, r, SLOT.back, Math.round(SIZE.slot * k));
      back.thickness = Math.max(1, Math.round(1.5 * k));
      const inset = Math.round(6 * k), type = (px: number) => Math.max(9, Math.round(px * k));
      const number = overlay.text(`hotbar-number-${n}`, String(n), box(r.x + inset, r.y + inset - 2, side, type(SIZE.number) + 4), type(SIZE.number), "left", false);
      number.fontFamily = FONT; number.fontWeight = "800"; number.color = FAINT; number.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      const iconSize = Math.round(SIZE.icon * k), icon = overlay.put(new Image(`hotbar-icon-${n}`), box(r.x + (side - iconSize) / 2, r.y + (side - iconSize) / 2, iconSize, iconSize));
      icon.stretch = Image.STRETCH_UNIFORM;
      const count = overlay.text(`hotbar-count-${n}`, "", box(r.x, r.y + side - inset - type(SIZE.count) - 2, side - inset, type(SIZE.count) + 4), type(SIZE.count), "left", false);
      count.fontFamily = FONT; count.fontWeight = "900"; count.color = PAPER; count.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
      if (live) return { back, icon, count };
      // The native button carries the tap, keyboard focus and the screen reader; Babylon draws the slot under it.
      const button = overlay.button(`hotbar-button-${n}`, describe(n, {}), r, () => { select(n); button.element.blur(); });
      button.panel.alpha = 0; button.caption.isVisible = false;
      return { back, icon, count, element: button.element };
    });
    draw();
  });

  return {
    /** The slots' contents and the slot selected (1 … SLOTS); drawn only when something changed. */
    show(now: SlotView[], selected: number) {
      overlay.show(!stage.paused && !document.body.classList.contains("photo")); // as the touch controls: not over a menu
      const key = JSON.stringify([now, selected]);
      if (key === drawn) return;
      drawn = key; views = now; picked = selected;
      draw();
    },
  };
}
