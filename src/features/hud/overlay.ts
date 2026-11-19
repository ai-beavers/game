// Babylon draws the controls. Transparent native counterparts share their bounds and handle
// keyboard focus, screen readers, pointer capture and the phone's text keyboard.
import { Container } from "@babylonjs/gui/2D/controls/container.js";
import { Control } from "@babylonjs/gui/2D/controls/control.js";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle.js";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock.js";
import type { Stage } from "../../engine.ts";
import { GOLD, INK, layout, PANEL, PAPER, RADIUS, SHADOW, type Box } from "./style.ts";

export const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });
export { GOLD, PANEL };
const EDGE = "#88958a";
const left = Control.HORIZONTAL_ALIGNMENT_LEFT, top = Control.VERTICAL_ALIGNMENT_TOP;
type Action = HTMLButtonElement | HTMLInputElement;

export class Overlay {
  readonly group: Container;
  readonly dom: HTMLElement;
  private previousFocus: HTMLElement | null = null;

  constructor(readonly stage: Stage, name: string, readonly modal = false, zIndex = 0) {
    this.group = new Container(name);
    this.group.isHitTestVisible = false;
    this.group.zIndex = zIndex;
    stage.hud.addControl(this.group);
    this.dom = document.createElement(modal ? "dialog" : "div");
    this.dom.id = name;
    this.dom.setAttribute("aria-label", name.replace(/-/g, " "));
    this.dom.style.cssText = "position:fixed;inset:0;margin:0;border:0;padding:0;width:100%;height:100%;max-width:none;max-height:none;opacity:0;pointer-events:none;overflow:hidden";
    document.body.append(this.dom);
    if (modal) {
      this.group.isVisible = false;
      this.dom.className = "game-dialog";
      this.dom.addEventListener("cancel", e => e.preventDefault());
    }
    if (!document.getElementById("game-semantic-style")) {
      const style = document.createElement("style");
      style.id = "game-semantic-style";
      style.textContent = ".game-dialog::backdrop { background: transparent }";
      document.head.append(style);
    }
    this.group.onDisposeObservable.addOnce(() => this.dom.remove());
  }

  clear() {
    for (const control of [...this.group.children]) control.dispose();
    this.dom.replaceChildren();
  }

  show(on: boolean) {
    if (this.group.isVisible === on) return;
    this.group.isVisible = on;
    if (this.dom instanceof HTMLDialogElement) {
      if (on) {
        this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.dom.showModal();
      } else {
        this.dom.close();
        this.previousFocus?.focus({ preventScroll: true });
      }
    } else this.dom.hidden = !on;
  }

  put<T extends Control>(control: T, r: Box) {
    this.group.addControl(control);
    control.horizontalAlignment = left;
    control.verticalAlignment = top;
    return this.move(control, r);
  }

  move<T extends Control>(control: T, r: Box) {
    control.left = r.x + "px"; control.top = r.y + "px";
    control.width = r.w + "px"; control.height = r.h + "px";
    return control;
  }

  rect(name: string, r: Box, background = PANEL, radius = RADIUS) {
    const panel = this.put(new Rectangle(name), r);
    panel.cornerRadius = radius;
    panel.background = background;
    panel.thickness = 0;
    return panel;
  }

  text(name: string, value: string, r: Box, size = 14, align: "left" | "center" = "left", describe = true) {
    const text = this.put(new TextBlock(name, value), r);
    text.fontFamily = "system-ui, sans-serif";
    text.fontSize = size;
    text.color = PAPER;
    text.textWrapping = true;
    text.textHorizontalAlignment = align === "left" ? left : Control.HORIZONTAL_ALIGNMENT_CENTER;
    if (describe) {
      const description = document.createElement("span");
      description.style.cssText = "position:absolute;white-space:pre-line;pointer-events:none";
      description.textContent = value;
      this.dom.append(description);
      text.onTextChangedObservable.add(() => { description.textContent = text.text; });
      text.onIsVisibleChangedObservable.add(on => { description.hidden = !on; });
      text.onDisposeObservable.addOnce(() => description.remove());
    }
    return text;
  }

  /** A HUD text over the world: the one shadow under it, backed or not. */
  label(name: string, value: string, r: Box, size: number, align: "left" | "center" = "left", describe = true) {
    const text = this.text(name, value, r, size, align, describe);
    text.shadowColor = SHADOW.color; text.shadowBlur = SHADOW.blur;
    return text;
  }

  /** A backing sized to its text, which may change every frame: in `slot` against its top or bottom edge, centred
   *  across it, or anywhere with at(). Hidden while the text is empty. */
  pill(name: string, slot: Box, size: number, anchor: "top" | "bottom" = "bottom", describe = true) {
    const back = this.rect(name + "-back", slot, PANEL, 0);
    const text = this.label(name, "", slot, size, "center", describe);
    const pad = Math.round(size * 0.6), lineH = Math.round(size * 1.3);
    back.isVisible = false;
    let w = 0, h = 0;
    const pill = {
      back, text, slot,
      /** Width and height for a text, wrapped to the slot's width. */
      measure(value: string) {
        const room = pill.slot.w - 2 * pad, widths = value.split("\n").map(line => measure(line, size, String(text.fontWeight || "normal")));
        const lines = widths.reduce((n, lw) => n + Math.max(1, Math.ceil(lw / room)), 0);
        return { w: Math.min(pill.slot.w, Math.ceil(Math.max(...widths)) + 2 * pad + 4), h: lines * lineH + Math.round(pad * 1.2) };
      },
      set(value: string) {
        if (value === text.text && back.isVisible === !!value) return;
        text.text = value; back.isVisible = !!value;
        if (!value) return;
        ({ w, h } = pill.measure(value));
        pill.at(pill.slot.x + (pill.slot.w - w) / 2, anchor === "top" ? pill.slot.y : pill.slot.y + pill.slot.h - h);
      },
      at: (x: number, y: number) => {
        x = Math.round(x); y = Math.round(y);
        this.move(back, box(x, y, w, h)); this.move(text, box(x + pad - 2, y, w - 2 * pad + 4, h));
        back.cornerRadius = Math.min(RADIUS * 1.6, h / 2);
      },
    };
    return pill;
  }

  /** An announcement: a pill in gold, hung from the top of its slot. */
  toast(name: string, slot: Box, size: number) {
    const toast = this.pill(name, slot, size, "top");
    toast.text.color = GOLD; toast.text.fontWeight = "600";
    return toast;
  }

  private native<T extends Action>(element: T, r: Box, label: string, panel: Rectangle) {
    element.setAttribute("aria-label", label);
    element.style.cssText = "position:absolute;pointer-events:auto;opacity:0;touch-action:none;box-sizing:border-box;margin:0;font-size:16px";
    this.placeElement(element, r);
    // The focus ring: drawn where the DOM focus is, a gap outside the control, so it shows on a gold button too.
    const ring = this.rect(panel.name + "-focus", box(r.x-4,r.y-4,r.w+8,r.h+8), "transparent", panel.cornerRadius + 4);
    ring.thickness = 3; ring.color = GOLD; ring.isVisible = false;
    element.addEventListener("focus", () => { panel.color = GOLD; panel.thickness = 2; ring.isVisible = panel.isVisible; });
    element.addEventListener("blur", () => { panel.color = EDGE; panel.thickness = 1; ring.isVisible = false; });
    this.dom.append(element);
    return element;
  }

  placeElement(el: HTMLElement, r: Box) {
    Object.assign(el.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
  }

  button(name: string, value: string, r: Box, click: () => void, primary = false) {
    const panel = this.rect(name, r, primary ? GOLD : "#324540", Math.min(RADIUS, r.h / 2));
    panel.thickness = 1;
    panel.color = EDGE;
    const caption = this.text(name + "-label", value, r, 14, "center",false);
    caption.fontWeight = "600";
    if (primary) caption.color = INK;
    const element = this.native(document.createElement("button"), r, value, panel);
    element.type = "button";
    element.textContent = value;
    element.addEventListener("click", click);
    return { panel, caption, element };
  }

  field(name: string, value: string, r: Box, placeholder: string, max: number) {
    const panel = this.rect(name, r, "#192724");
    panel.color = EDGE; panel.thickness = 1;
    const caption = this.text(name + "-value", value, box(r.x+10,r.y,r.w-20,r.h), 16,"left",false);
    const input = this.native(document.createElement("input"), r, placeholder, panel);
    input.id = name; input.maxLength = max; input.value = value; input.placeholder = placeholder;
    input.setAttribute("autocomplete", name.includes("name") ? "nickname" : "off");
    const refresh = () => {
      const focused = document.activeElement === input;
      const caret = input.selectionEnd ?? input.value.length;
      caption.text = focused ? input.value.slice(0,caret) + "│" + input.value.slice(caret) : (input.value || placeholder);
    };
    for (const e of ["input","focus","blur","click","keyup","select"]) input.addEventListener(e, refresh);
    refresh();
    return input;
  }

  range(name: string, r: Box, value: number, change: (n: number) => void) {
    const panel = this.rect(name, r, "#23352f");
    const track = box(r.x+8,r.y+r.h/2-2,r.w-16,4);
    this.rect(name + "-track", track, EDGE, 2);
    const knob = this.rect(name + "-thumb", box(0,0,12,16), GOLD, 5);
    const input = this.native(document.createElement("input"), r, name, panel);
    input.type = "range"; input.min = "0"; input.max = "1"; input.step = "0.05";
    const set = (n: number) => {
      input.value = String(n);
      this.move(knob, box(track.x+track.w*n-6,r.y+(r.h-16)/2,12,16));
    };
    input.addEventListener("input", () => { const n = Number(input.value); set(n); change(n); });
    set(value);
    return { set, input };
  }
}

/** The phone's safe area (notch, rounded corners, home bar) in CSS px from each edge; 0 on a desktop. The canvas
 *  fills the whole screen (viewport-fit=cover in index.html), so the HUD keeps its controls inside these. */
export function safeArea() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.append(probe);
  const s = getComputedStyle(probe), px = (v: string) => parseFloat(v) || 0;
  const inset = { top: px(s.paddingTop), right: px(s.paddingRight), bottom: px(s.paddingBottom), left: px(s.paddingLeft) };
  probe.remove();
  return inset;
}

/** Where everything goes on this screen now (style.ts layout): the phone's safe area, the touch controls, live or not. */
export function hudLayout(stage: Stage) {
  const live = new URLSearchParams(location.search).get("tour") === "live";
  return layout(stage.canvas.clientWidth, stage.canvas.clientHeight, safeArea(), { touch: !!document.getElementById("touch-controls"), live });
}

/** What floats over the world this frame, in screen px (net/ui.ts puts the name tags and bubbles here), so the HUD's
 *  marker keeps clear of it. */
export const floating: Box[] = [];
/** What hangs under the goals panel this picture (Mrs. Beaver's quest list), or undefined: the marker keeps below it. */
export const underGoals: { box: Box | undefined } = { box: undefined };

const context = document.createElement("canvas").getContext("2d")!, widths = new Map<string, number>();
/** Width of a text in px as the HUD draws it, kept per text and size. */
export function measure(text: string, size: number, weight = "normal") {
  const key = weight + size + "|" + text;
  let width = widths.get(key);
  if (width === undefined) {
    if (widths.size > 500) widths.clear();
    context.font = `${weight} ${size}px system-ui, sans-serif`;
    widths.set(key, width = context.measureText(text).width);
  }
  return width;
}

/** All HUD positions count CSS pixels regardless of the renderer's resolution. */
export function onViewport(stage: Stage, layout: (width: number, height: number) => void) {
  let width = -1, height = -1;
  const update = () => {
    if (width === stage.canvas.clientWidth && height === stage.canvas.clientHeight) return;
    width = stage.canvas.clientWidth;
    height = stage.canvas.clientHeight;
    stage.hud.idealWidth = width;
    layout(stage.canvas.clientWidth, stage.canvas.clientHeight);
  };
  const observer = new ResizeObserver(update);
  observer.observe(stage.canvas);
  const cleanup = stage.scene.onDisposeObservable.addOnce(() => observer.disconnect());
  update();
  return () => { observer.disconnect(); stage.scene.onDisposeObservable.remove(cleanup); };
}
