// Menus without a mouse: arrow keys, a gamepad's stick and d-pad move the real DOM focus through the open menu's
// controls (the transparent counterparts overlay.ts makes, so screen readers follow and the Babylon focus ring with
// them); A confirms like Enter, B goes back like Escape. The order is focus.ts.
//
//   const nav = menuNav();   nav.update()   once per picture: reads the pad
//
// Where: the topmost open dialog (pause menu and its pages, start screen, name entry), the photo strip for the keys
// (photo.ts steers it on a pad), and A / B in the chat's text field. Left and right change a slider or a toggle marked
// data-adjust instead of moving. A and B act when let go, so the game never sees them held after a menu closes.
import { BUTTON, down, firstPad } from "../controls/pad.ts";
import { newRepeat, nextFocus, padDirection, repeatStep, type Direction } from "./focus.ts";

const ARROWS: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
const textField = (el: Element | null): el is HTMLInputElement => el instanceof HTMLInputElement && el.type !== "range";

function menu(): HTMLElement | null {
  const modal = [...document.querySelectorAll<HTMLElement>("dialog:modal")].at(-1);
  return modal ?? (document.body.classList.contains("photo") ? document.getElementById("photo-strip") : null);
}

function controls(scope: HTMLElement) {
  return [...scope.querySelectorAll<HTMLElement>("button,input")].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !(el as HTMLButtonElement).disabled;
  });
}

function move(scope: HTMLElement, dir: Direction) {
  const list = controls(scope), at = list.indexOf(document.activeElement as HTMLElement);
  const rects = list.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  list[nextFocus(rects, at, dir)]?.focus({ preventScroll: true });
}

/** Left / right on a slider or a toggle: change it. False when the focused control has no value to change. */
function adjust(el: Element | null, dir: Direction) {
  if (dir !== "left" && dir !== "right") return false;
  if (el instanceof HTMLInputElement && el.type === "range") {
    if (dir === "left") el.stepDown(); else el.stepUp();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  if (el instanceof HTMLButtonElement && el.dataset.adjust !== undefined) { el.click(); return true; }
  return false;
}

const key = (target: EventTarget, code: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: code, code, bubbles: true, cancelable: true }));

export function menuNav() {
  window.addEventListener("keydown", e => {
    const dir = ARROWS[e.code], scope = menu();
    if (!dir || !scope || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = document.activeElement, inside = !!el && scope.contains(el);
    // Sideways in a text field moves its caret, on a slider the browser moves the slider.
    if ((dir === "left" || dir === "right") && inside && el instanceof HTMLInputElement) return;
    e.preventDefault(); e.stopPropagation();
    if (!inside || !adjust(el, dir)) move(scope, dir);
  }, true);

  let was: boolean[] = [], aimed = false;
  const armed = new Set<number>();
  const held = newRepeat();
  return {
    update() {
      const pad = firstPad(navigator.getGamepads?.());
      const modal = [...document.querySelectorAll<HTMLElement>("dialog:modal")].at(-1);
      const el = document.activeElement, chat = !modal && textField(el) ? el : undefined;
      if (!pad || (!modal && !chat)) { was = pad ? pad.buttons.map((_, i) => down(pad, i)) : []; armed.clear(); aimed = false; return; }
      const now = pad.buttons.map((_, i) => down(pad, i));
      const dir = padDirection(pad.axes[0] ?? 0, pad.axes[1] ?? 0, {
        up: !!now[BUTTON.up], down: !!now[BUTTON.down], left: !!now[BUTTON.left], right: !!now[BUTTON.right],
      });
      // A stick already pushed when the menu opens (walking) does not move the focus until it is let go.
      if (!aimed) { aimed = true; held.dir = dir; held.next = Infinity; }
      for (const b of [BUTTON.a, BUTTON.b]) {
        if (now[b] && !was[b]) armed.add(b);
        if (now[b] || !was[b] || !armed.delete(b)) continue;
        const target = el instanceof HTMLElement && (chat || modal!.contains(el)) ? el : modal ?? document.body;
        if (b === BUTTON.b) key(target, "Escape");
        else if (el instanceof HTMLButtonElement && target === el) el.click();
        else if (textField(el) && target === el) key(el, "Enter");
        else if (modal) move(modal, "down");
      }
      was = now;
      const step = modal && repeatStep(held, dir, performance.now());
      if (step && !(modal.contains(el) && adjust(el, step))) move(modal, step);
    },
  };
}
