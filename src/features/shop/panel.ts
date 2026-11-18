// The Shop's HUD: the player's Experience next to the goals, and the Shopkeeper's panel of Outfits.
//
//   const hud = shopHud(stage, actions);   hud.show(state)   hud.open(state) · hud.close() · hud.isOpen · hud.update()
//
// Babylon GUI on stage.hud through Overlay, so every button has a native counterpart: keyboard focus (Tab, arrows),
// a gamepad (hud/nav.ts: A presses, B is Escape) and touch work as for every menu. The panel is a modal dialog: the
// pause menu leaves it alone, Escape closes it; keys that walk still reach the game, so walking away closes it too.
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import type { Stage } from "../../engine.ts";
import { box, GOLD, hudLayout, onViewport, Overlay, PANEL } from "../hud/overlay.ts";
import { QUIET } from "../hud/style.ts";
import { OUTFITS, type Outfit, type OutfitId, type ShopState } from "./rules.ts";

const PRINT = new Color3(0.945, 0.91, 0.84); // the shirt's cream (src/beaver), which the Outfit's colour tints
const swatch = (c: [number, number, number], base = Color3.White()) => new Color3(c[0] * base.r, c[1] * base.g, c[2] * base.b).toHexString();
export const experienceText = (n: number) => `✦ ${n} Experience`;

export function shopHud(stage: Stage, actions: { buy(id: OutfitId): void; wear(id: OutfitId): void; close(): void }) {
  const readout = new Overlay(stage, "shop-experience", false, 4);
  const panel = new Overlay(stage, "shop-panel", true, 18);
  let pill: ReturnType<Overlay["pill"]>, state: ShopState | undefined, open = false, flash = 0;
  const hudShown = () => !!stage.hud.getControlByName("beaver-hud")?.isVisible && !document.body.classList.contains("photo");

  const drawReadout = () => {
    readout.clear();
    const at = hudLayout(stage);
    pill = readout.pill("experience", at.experience, Math.round(at.u * 0.9), "top");
    pill.text.color = GOLD; pill.text.fontWeight = "600";
    shownText = "";
  };
  let shownText = "";
  const setReadout = () => {
    const text = state ? experienceText(state.experience) : "";
    if (text === shownText) return;
    shownText = text;
    pill.set(text);
    pill.at(pill.slot.x, pill.slot.y); // against the left, under the pause button, over the goals
  };

  const drawPanel = () => {
    const focus = document.activeElement instanceof HTMLElement && panel.dom.contains(document.activeElement) ? document.activeElement.getAttribute("aria-label")?.split(" ")[1] : undefined;
    panel.clear();
    if (!state) return;
    const s = state, w = stage.canvas.clientWidth, h = stage.canvas.clientHeight;
    const width = Math.min(w - 20, 440), row = Math.min(48, Math.max(30, (h - 40) / (OUTFITS.length + 3.4)));
    const height = row * (OUTFITS.length + 3) + 16, x = (w - width) / 2, y = Math.max(8, (h - height) / 2), inset = width < 340 ? 12 : 20;
    const left = x + inset, inner = width - 2 * inset, size = Math.max(12, Math.min(16, row * 0.38));
    panel.rect("shop-card", box(x, y, width, height));
    const title = panel.text("shop-title", "The Shopkeeper", box(left, y + 6, inner * 0.6, row), Math.min(24, row * 0.6, inner / 13));
    title.fontFamily = "Georgia, serif"; title.fontWeight = "bold"; title.textWrapping = false;
    const xp = panel.text("shop-experience", experienceText(s.experience), box(left + inner * 0.5, y + 6, inner * 0.5, row), size);
    xp.color = GOLD; xp.fontWeight = "600"; xp.textHorizontalAlignment = 1; // right
    panel.text("shop-line", "Outfits for your beaver, paid in Experience. Yours to keep.", box(left, y + row, inner, row * 0.8), Math.max(11, size - 2)).color = QUIET;
    let cy = y + row * 1.9;
    for (const o of OUTFITS) {
      rowFor(o, box(left, cy, inner, row - 6), size);
      cy += row;
    }
    panel.button("shop-close", "Close", box(left + inner - 110, cy + 2, 110, row - 8), actions.close);
    panel.dom.setAttribute("aria-label", "The Shopkeeper: Outfits");
    const again = !focus ? undefined : [...panel.dom.querySelectorAll<HTMLButtonElement>("button")].find((b) => !b.disabled && b.getAttribute("aria-label")?.split(" ")[1] === focus);
    (again ?? [...panel.dom.querySelectorAll<HTMLButtonElement>("button")].find((b) => !b.disabled))?.focus({ preventScroll: true });
  };
  const rowFor = (o: Outfit, r: { x: number; y: number; w: number; h: number }, size: number) => {
    const s = state!, owned = s.owned.includes(o.id), wearing = s.wearing === o.id, dear = !owned && o.price > s.experience;
    const sw = Math.round(r.h * 0.7), dim = dear ? 0.4 : 1;
    const shirt = panel.rect(`shop-${o.id}-shirt`, box(r.x, r.y + (r.h - sw) / 2, sw, sw), swatch(o.shirt, PRINT), 4);
    const hat = panel.rect(`shop-${o.id}-hat`, box(r.x + sw * 0.55, r.y + (r.h - sw) / 2 - 2, sw * 0.55, sw * 0.4), swatch(o.hat), 3);
    hat.thickness = 1; hat.color = "#f6f2e7";
    shirt.alpha = hat.alpha = dim;
    const name = panel.text(`shop-${o.id}-name`, o.name, box(r.x + sw + 10, r.y, r.w * 0.35, r.h), size);
    name.fontWeight = "600"; name.alpha = dim;
    const price = panel.text(`shop-${o.id}-price`, owned ? "Owned" : o.price ? `✦ ${o.price}` : "Free", box(r.x + sw + 10 + r.w * 0.33, r.y, r.w * 0.3, r.h), Math.max(11, size - 2));
    price.color = owned ? QUIET : dear ? "#c98e8e" : GOLD; price.alpha = dear ? 0.7 : 1;
    const bw = Math.min(118, r.w * 0.3), bx = r.x + r.w - bw;
    const label = wearing ? `Wearing ${o.name}` : owned ? `Wear ${o.name}` : `Buy ${o.name} for ${o.price} Experience`;
    const button = panel.button(`shop-${o.id}-button`, wearing ? "Wearing" : owned ? "Wear" : "Buy", box(bx, r.y + 2, bw, r.h - 4),
      () => owned ? actions.wear(o.id) : actions.buy(o.id), !owned && !dear);
    button.element.setAttribute("aria-label", label);
    if (wearing || dear) { button.element.disabled = true; button.panel.alpha = button.caption.alpha = 0.45; }
  };

  onViewport(stage, () => { drawReadout(); setReadout(); if (open) drawPanel(); });
  // Escape closes the panel (the dialog's own cancel is held back by Overlay); Enter and Space press its buttons and
  // stay out of the game (Space would jump).
  window.addEventListener("keydown", (e) => {
    if (open && e.code === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); actions.close(); } // not the pause menu too
  }, true);
  panel.dom.addEventListener("keydown", (e) => { if (e.code === "Enter" || e.code === "Space") e.stopPropagation(); });

  return {
    get isOpen() { return open; },
    /** The state to show, after every change. */
    show(next: ShopState) {
      if (state && next.experience > state.experience) flash = 1;
      state = { ...next, owned: [...next.owned] };
      setReadout();
      if (open) drawPanel();
    },
    open() { open = true; drawPanel(); panel.show(true); drawPanel(); },
    close() { open = false; panel.show(false); panel.clear(); },
    update(dt: number) {
      readout.show(hudShown());
      // A stick just built in: the readout lights up a moment, so the player sees what earned it.
      flash = Math.max(0, flash - dt * 1.5);
      pill.back.background = flash > 0 ? "rgba(120,86,24,0.85)" : PANEL;
      pill.text.scaleX = pill.text.scaleY = 1 + 0.15 * flash;
    },
  };
}
