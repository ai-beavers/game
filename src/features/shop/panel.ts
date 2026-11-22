// The Shop's HUD: the player card over the goals (name, level and class, and the Experience into the level, from all
// Experience ever earned), and the Shopkeeper's panel of Outfits with the Experience there is to spend, and under them
// a row of the Classes to choose from for free.
//
//   const hud = shopHud(stage, actions, () => name);   hud.show(state)   hud.open(state) · hud.close() · hud.isOpen · hud.update()
//
// Babylon GUI on stage.hud through Overlay, so every button has a native counterpart: keyboard focus (Tab, arrows),
// a gamepad (hud/nav.ts: A presses, B is Escape) and touch work as for every menu. The panel is a modal dialog: the
// pause menu leaves it alone, Escape closes it; keys that walk still reach the game, so walking away closes it too.
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { SHIRT_CREAM, type RGB } from "../../contracts.ts";
import type { Stage } from "../../engine.ts";
import { box, GOLD, hudLayout, measure, onViewport, Overlay, PANEL } from "../hud/overlay.ts";
import { BROWN, GLOW, INK, PAPER, QUIET, TRACK } from "../hud/style.ts";
import { beaverClass, CLASSES, levelOf, NO_CLASS, OUTFITS, type ClassId, type Outfit, type OutfitId, type ShopState } from "./rules.ts";

const PRINT = Color3.FromHexString(SHIRT_CREAM); // which the Outfit's colour tints
const swatch = (c: RGB, base = Color3.White()) => new Color3(c[0] * base.r, c[1] * base.g, c[2] * base.b).toHexString();
export const experienceText = (n: number) => `✦ ${n} Experience`;

export function shopHud(stage: Stage, actions: { buy(id: OutfitId): void; wear(id: OutfitId): void; choose(id: ClassId | null): void; close(): void }, name: () => string) {
  const readout = new Overlay(stage, "player-card", false, 4);
  const panel = new Overlay(stage, "shop-panel", true, 18);
  let card: ReturnType<typeof drawCard> | undefined, state: ShopState | undefined, open = false, flash = 0;
  const hudShown = () => !!stage.hud.getControlByName("beaver-hud")?.isVisible && !document.body.classList.contains("photo");

  // The player card: the avatar (a paw in an orange ring), the name with the level (and the class) beside it, the bar and the
  // Experience into the level under it. Named for the tour: "player-name", "player-level", "player-xp".
  function drawCard() {
    readout.clear();
    const at = hudLayout(stage), { x, y, w, h } = at.player, { u, small, gap } = at;
    const back = readout.rect("player-back", at.player, PANEL, h / 2);
    const inset = Math.round(h * 0.1), d = h - 2 * inset;
    const ring = readout.rect("player-avatar", box(x + inset, y + inset, d, d), BROWN, d / 2);
    ring.thickness = Math.max(2, Math.round(d * 0.06)); ring.color = GOLD;
    readout.icon("player-paw", "paw", box(x + inset + d * 0.25, y + inset + d * 0.25, d * 0.5, d * 0.5), PAPER);
    const left = x + inset + d + gap, inner = x + w - Math.round(h * 0.35) - left;
    const nameSize = Math.round(u * (at.compact ? 1 : 1.2)), xpSize = Math.round(small * 0.85), barH = Math.max(4, Math.round(u * 0.3));
    const rows = nameSize * 1.25 + barH + xpSize * 1.25 + gap * 0.8, top = y + (h - rows) / 2;
    const name = readout.text("player-name", "", box(left, top, inner, nameSize * 1.25), nameSize);
    name.fontWeight = "800"; name.textWrapping = 2; // TextWrapping.Ellipsis (a const enum): a long name ends in "…" before the badge
    const badgeSize = Math.round(small * 0.8), badgeH = Math.round(badgeSize * 1.5);
    const badge = readout.rect("player-level-back", box(left, top, 1, badgeH), GOLD, 4);
    const level = readout.text("player-level", "", box(left, top, 1, badgeH), badgeSize, "center");
    level.color = INK; level.fontWeight = "900";
    const barY = top + nameSize * 1.25 + gap * 0.4;
    readout.rect("player-track", box(left, barY, inner, barH), TRACK, barH / 2);
    const fill = readout.rect("player-bar", box(left, barY, 1, barH), GOLD, barH / 2);
    const xp = readout.text("player-xp", "", box(left, barY + barH + gap * 0.4, inner, xpSize * 1.25), xpSize);
    xp.color = QUIET;
    let said = "";
    return {
      back, xp,
      set(s: ShopState, who: string) {
        const l = levelOf(s.earned), kind = beaverClass(s.class)?.name, say = `${who}|${l.level}|${l.into}|${kind}`;
        if (say === said) return;
        said = say;
        name.text = who; level.text = `LV ${l.level}${kind ? ` · ${kind}` : ""}`; xp.text = `${l.into} / ${l.need} XP`;
        // The badge right after the name, the name cut short where both would not fit.
        const badgeW = Math.ceil(measure(level.text, badgeSize, "900")) + Math.round(badgeSize * 1.1);
        const nameW = Math.min(Math.ceil(measure(who, nameSize, "800")) + 2, inner - badgeW - gap);
        readout.move(name, box(left, top, nameW, nameSize * 1.25));
        const by = Math.round(top + (nameSize * 1.25 - badgeH) / 2);
        readout.move(badge, box(left + nameW + gap * 0.8, by, badgeW, badgeH));
        readout.move(level, box(left + nameW + gap * 0.8, by, badgeW, badgeH));
        fill.isVisible = l.into > 0;
        readout.move(fill, box(left, barY, Math.max(barH, Math.round(inner * l.into / l.need)), barH));
      },
    };
  }

  const drawPanel = () => {
    const focus = document.activeElement instanceof HTMLElement && panel.dom.contains(document.activeElement) ? document.activeElement.getAttribute("aria-label")?.split(" ")[1] : undefined;
    panel.clear();
    if (!state) return;
    const s = state, w = stage.canvas.clientWidth, h = stage.canvas.clientHeight;
    const width = Math.min(w - 20, 440), row = Math.min(48, Math.max(30, (h - 40) / (OUTFITS.length + 5.6)));
    const height = row * (OUTFITS.length + 5.2) + 16, x = (w - width) / 2, y = Math.max(8, (h - height) / 2), inset = width < 340 ? 12 : 20;
    const left = x + inset, inner = width - 2 * inset, size = Math.max(12, Math.min(16, row * 0.38));
    panel.rect("shop-card", box(x, y, width, height));
    const title = panel.text("shop-title", "The Shopkeeper", box(left, y + 6, inner * 0.6, row), Math.min(24, row * 0.6, inner / 13));
    title.fontFamily = "Georgia, serif"; title.fontWeight = "bold"; title.textWrapping = false;
    const shown = panel.text("shop-experience", experienceText(s.experience), box(left + inner * 0.5, y + 6, inner * 0.5, row), size);
    shown.color = GOLD; shown.fontWeight = "600"; shown.textHorizontalAlignment = 1; // right
    panel.text("shop-line", "Outfits for your beaver, paid in Experience. Yours to keep.", box(left, y + row, inner, row * 0.8), Math.max(11, size - 2)).color = QUIET;
    let cy = y + row * 1.9;
    for (const o of OUTFITS) {
      rowFor(o, box(left, cy, inner, row - 6), size);
      cy += row;
    }
    // The Classes, side by side: no class first, each with its line of what it does; the current one marked.
    panel.text("shop-class-line", "Or choose a class, for free. Change it whenever you like.", box(left, cy, inner, row * 0.8), Math.max(11, size - 2)).color = QUIET;
    cy += row * 0.85;
    const choices = [{ id: NO_CLASS, name: "No class", line: "As every beaver" }, ...CLASSES], gapX = 8;
    const bw = (inner - gapX * (choices.length - 1)) / choices.length, bh = row * 1.25;
    choices.forEach((c, i) => {
      const current = s.class === c.id, r = box(left + i * (bw + gapX), cy, bw, bh - 6);
      const b = panel.button(`shop-class-${c.id ?? "none"}`, current ? `✓ ${c.name}` : c.name, r, () => actions.choose(c.id), false);
      const back = b.panel;
      panel.move(b.caption, box(r.x, r.y + 2, r.w, r.h * 0.58));
      b.caption.fontSize = size; b.caption.fontWeight = "800";
      const note = panel.text(`shop-class-${c.id ?? "none"}-line`, c.line, box(r.x, r.y + r.h * 0.55, r.w, r.h * 0.4), Math.max(10, size - 4), "center", false);
      note.color = QUIET;
      b.element.setAttribute("aria-label", `${current ? "Current:" : "Choose"} ${c.name}: ${c.line}`);
      if (current) { b.element.disabled = true; back.background = GLOW; back.color = GOLD; note.color = PAPER; }
    });
    cy += bh;
    panel.button("shop-close", "Close", box(left + inner - 110, cy + 2, 110, row - 8), actions.close);
    panel.dom.setAttribute("aria-label", "The Shopkeeper: Outfits and Classes");
    const again = !focus ? undefined : [...panel.dom.querySelectorAll<HTMLButtonElement>("button")].find((b) => !b.disabled && b.getAttribute("aria-label")?.split(" ")[1] === focus);
    (again ?? [...panel.dom.querySelectorAll<HTMLButtonElement>("button")].find((b) => !b.disabled))?.focus({ preventScroll: true });
  };
  const rowFor = (o: Outfit, r: { x: number; y: number; w: number; h: number }, size: number) => {
    const s = state!, owned = s.owned.includes(o.id), wearing = s.wearing === o.id, dear = !owned && o.price > s.experience;
    const sw = Math.round(r.h * 0.7), dim = dear ? 0.4 : 1;
    const shirt = panel.rect(`shop-${o.id}-shirt`, box(r.x, r.y + (r.h - sw) / 2, sw, sw), swatch(o.shirt, PRINT), 4);
    const hat = panel.rect(`shop-${o.id}-hat`, box(r.x + sw * 0.55, r.y + (r.h - sw) / 2 - 2, sw * 0.55, sw * 0.4), swatch(o.hat), 3);
    hat.thickness = 1; hat.color = PAPER;
    shirt.alpha = hat.alpha = dim;
    const name = panel.text(`shop-${o.id}-name`, o.name, box(r.x + sw + 10, r.y, r.w * 0.35, r.h), size);
    name.fontWeight = "600"; name.alpha = dim;
    const price = panel.text(`shop-${o.id}-price`, owned ? "Owned" : o.price ? `✦ ${o.price}` : "Free", box(r.x + sw + 10 + r.w * 0.33, r.y, r.w * 0.3, r.h), Math.max(11, size - 2));
    price.color = owned || dear ? QUIET : GOLD; price.alpha = dear ? 0.7 : 1;
    const bw = Math.min(118, r.w * 0.3), bx = r.x + r.w - bw;
    const label = wearing ? `Wearing ${o.name}` : owned ? `Wear ${o.name}` : `Buy ${o.name} for ${o.price} Experience`;
    const button = panel.button(`shop-${o.id}-button`, wearing ? "Wearing" : owned ? "Wear" : "Buy", box(bx, r.y + 2, bw, r.h - 4),
      () => owned ? actions.wear(o.id) : actions.buy(o.id), !owned && !dear);
    button.element.setAttribute("aria-label", label);
    if (wearing || dear) { button.element.disabled = true; button.panel.alpha = button.caption.alpha = 0.45; }
  };

  onViewport(stage, () => { card = drawCard(); if (open) drawPanel(); });
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
      if (open) drawPanel();
    },
    open() { open = true; drawPanel(); panel.show(true); drawPanel(); },
    close() { open = false; panel.show(false); panel.clear(); },
    update(dt: number) {
      readout.show(hudShown());
      if (state) card?.set(state, name());
      // A stick just built in: the card lights up a moment, so the player sees what earned it.
      flash = Math.max(0, flash - dt * 1.5);
      if (card) { card.back.background = flash > 0 ? GLOW : PANEL; card.xp.color = flash > 0 ? GOLD : QUIET; }
    },
  };
}
