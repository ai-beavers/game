// Touch controls: a stick that appears under the left thumb, dragging on the right half turns the camera, two
// fingers there pinch to zoom, and buttons under the right thumb (jump, use, run, slap the tail, dive while held: sit on land) plus small pause and
// photo buttons at the top right.
//
//   const pad = touchControls(game, pause, photo);   builds the overlay and listens on the canvas; pause() opens the
//                                                    menu, photo() the photo mode
//   game.player.keys.add(pad);                pad.read(input) fills the player's Input once per step
//   pad.show(visible);                        once per frame: hidden for the photo mode and the pause menu
//
// Touches on the canvas are taken here (camera.ts leaves them alone); mouse and pen still go to the camera.
import { Overlay, box, onViewport, safeArea } from "../hud/overlay.ts";
import type { Game } from "../../game.ts";
import type { Input, Source } from "../../player/input.ts";
import { deadZone, stickSpeed } from "./pad.ts";

const REACH = 56; // px the knob can go from the stick's centre
const TURN_X = 0.006, TURN_Y = 0.005; // rad per px of drag, as the mouse

export function touchControls(game: Game, pause: () => void, photo: () => void) {
  const canvas = game.stage.canvas, camera = game.player.camera;
  const overlay = new Overlay(game.stage,"touch-controls",false,8);
  const held = { jump: false, act: false, slap: false, dive: false }, tapped = { jump: false, act: false, slap: false, dive: false };
  const release = () => { for (const k of ["jump","act","slap","dive"] as const) held[k] = tapped[k] = false; };
  let stickId = -1, ox = 0, oy = 0, move = { x: 0, y: 0, run: 0 }, running = false;
  let base: ReturnType<Overlay["rect"]>, knob: typeof base, run: ReturnType<Overlay["button"]>;
  function place(x: number, y: number, kx = 0, ky = 0) {
    overlay.move(base,box(x-56,y-56,112,112));
    overlay.move(knob,box(x+kx-20,y+ky-20,40,40));
    base.alpha = stickId >= 0 ? 1 : 0.5;
  }
  let inset = safeArea();
  // At rest the stick waits in the bottom left corner, inside the safe area and below the chat row (net/ui.ts).
  const rest = () => place(inset.left+70,canvas.clientHeight-inset.bottom-56);
  const setRun = (on: boolean) => {
    running = on;
    run.element.setAttribute("aria-pressed",String(on));
    run.panel.background = on ? "#738756" : "#344b42";
  };
  onViewport(game.stage, (width,height) => {
    inset = safeArea();
    // Buttons under the right thumb, clear of the notch, the rounded corners and the home bar.
    const w = width-inset.right, h = height-inset.bottom;
    overlay.clear();
    release();
    base = overlay.rect("thumbstick",box(0,0,112,112),"rgba(20,42,35,.45)",56);
    base.color = "#d2d2b8"; base.thickness = 2;
    knob = overlay.rect("thumb",box(0,0,40,40),"rgba(235,235,210,.55)",20);
    rest();
    const jump = overlay.button("jump","Jump",box(w-86,h-87,70,70),() => {});
    const act = overlay.button("use","Use",box(w-150,h-71,56,56),() => {});
    // Up and left of Jump, past Use and Run, so a thumb resting on Jump reaches it without crossing them.
    const slap = overlay.button("slap","Slap",box(w-148,h-142,50,50),() => {});
    // Left of Use, where the thumb rolls off it: held as long as the beaver stays under.
    const dive = overlay.button("dive","Dive",box(w-208,h-63,50,50),() => {});
    for (const [key,button] of [["jump",jump],["act",act],["slap",slap],["dive",dive]] as const) {
      button.panel.cornerRadius = 40;
      button.element.onpointerdown = e => {
        e.preventDefault();
        button.element.setPointerCapture(e.pointerId);
        held[key] = tapped[key] = true; button.panel.background = "#738756";
      };
      const lift = () => { held[key] = false; button.panel.background = "#324540"; };
      button.element.onpointerup = button.element.onpointercancel = button.element.onlostpointercapture = lift;
      button.element.onclick = e => { if (!e.detail) tapped[key] = true; };
    }
    run = overlay.button("run","Run",box(w-71,h-149,54,54),() => setRun(!running));
    run.panel.cornerRadius = 27;
    setRun(false);
    overlay.button("pause","Pause",box(w-59,inset.top+10,50,44),pause);
    overlay.button("photo","Photo",box(w-59,inset.top+60,50,44),photo);
  });
  // Looking: one finger turns, two pinch.
  const looks = new Map<number, { x: number; y: number }>();
  const spread = () => { const [a, b] = [...looks.values()]; return Math.hypot(a!.x - b!.x, a!.y - b!.y); };
  let visible = true;

  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" || game.stage.paused) return;
    e.preventDefault();
    if (visible && stickId < 0 && e.clientX < innerWidth / 2) {
      stickId = e.pointerId; ox = e.clientX; oy = e.clientY;

      place(ox, oy);
    } else looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  window.addEventListener("pointermove", (e) => {
    if (e.pointerId === stickId) {
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const length = Math.hypot(dx, dy);
      if (length > REACH) { dx *= REACH / length; dy *= REACH / length; }
      const pushed = deadZone(dx / REACH, -dy / REACH, 0.12, 0.95);
      move = stickSpeed(pushed.x, pushed.y);
      place(ox, oy, dx, dy);
      return;
    }
    const at = looks.get(e.pointerId);
    if (!at) return;
    if (looks.size === 2) {
      const before = spread();
      at.x = e.clientX; at.y = e.clientY;
      const after = spread();
      if (before > 0 && after > 0) camera.zoom(before / after); // fingers apart: closer
    } else {
      const invert = game.settings.values.invertY ? -1 : 1;
      camera.turn(-(e.clientX - at.x) * TURN_X, (e.clientY - at.y) * TURN_Y * invert);
      at.x = e.clientX; at.y = e.clientY;
    }
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId === stickId) releaseStick();
    looks.delete(e.pointerId);
  };
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  const releaseStick = () => {
    stickId = -1; move = { x: 0, y: 0, run: 0 };

    setRun(false);
    rest();
  };
  // No page zoom by pinch or double tap on Safari, whatever the viewport says.
  // No menu on a long press either, except in a text field (paste).
  for (const type of ["gesturestart", "gesturechange", "dblclick", "contextmenu"]) document.addEventListener(type, (e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }, { passive: false });
  // The phone's keyboard pans the page to show the name or chat field; when it closes, back to the top.
  visualViewport?.addEventListener("resize", () => { if (!(document.activeElement instanceof HTMLInputElement)) scrollTo(0, 0); });

  const source: Source & { show(on: boolean): void } = {
    read(into: Input): Input {
      into.move.x = move.x; into.move.y = move.y;
      into.run = running ? 1 : move.run;
      into.jump = held.jump || tapped.jump;
      into.act = held.act || tapped.act;
      into.slap = held.slap || tapped.slap;
      into.dive = held.dive || tapped.dive;
      tapped.jump = tapped.act = tapped.slap = tapped.dive = false;
      return into;
    },
    show(on: boolean) {
      if (on === visible) return;
      visible = on;
      overlay.show(on);
      if (!on) { // nothing stays pressed behind a menu
        releaseStick();
        release(); looks.clear();
      }
    },
  };
  return source;
}
