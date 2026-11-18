// Babylon draws the controls. Transparent native counterparts share their bounds and handle
// keyboard focus, screen readers, pointer capture and the phone's text keyboard.
import { Container } from "@babylonjs/gui/2D/controls/container.js";
import { Control } from "@babylonjs/gui/2D/controls/control.js";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle.js";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock.js";
import type { Stage } from "../../engine.ts";

type Box = { x: number; y: number; w: number; h: number };
export const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });
const PAPER = "#f6f2e7", INK = "#182825", EDGE = "#88958a";
export const GOLD = "#f7ca77";
export const PANEL = "rgba(18,32,31,0.92)";
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

  rect(name: string, r: Box, background = PANEL, radius = 8) {
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
    const panel = this.rect(name, r, primary ? GOLD : "#324540", Math.min(9, r.h / 2));
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
