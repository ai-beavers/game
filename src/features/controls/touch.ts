// Touch controls: a stick that appears under the left thumb, dragging on the right half turns the camera, two
// fingers there pinch to zoom, and buttons under the right thumb (jump, use, run) plus a small pause button.
//
//   const pad = touchControls(game, pause);   builds the overlay and listens on the canvas; pause() opens the menu
//   game.player.keys.add(pad);                pad.read(input) fills the player's Input once per step
//   pad.show(visible);                        once per frame: hidden for the photo mode and the pause menu
//
// Touches on the canvas are taken here (camera.ts leaves them alone); mouse and pen still go to the camera.
import type { Game } from "../../game.ts";
import type { Input, Source } from "../../player/input.ts";
import { deadZone, stickSpeed } from "./pad.ts";

const REACH = 56; // px the knob can go from the stick's centre
const TURN_X = 0.006, TURN_Y = 0.005; // rad per px of drag, as the mouse

const CSS = `
html, body { touch-action: none; overscroll-behavior: none; -webkit-user-select: none; user-select: none;
  -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
.touch-controls { position: fixed; inset: 0; pointer-events: none; z-index: 10; font: 600 14px/1 system-ui, sans-serif; }
.touch-controls[hidden] { display: none; }
.touch-controls .stick { position: absolute; width: 128px; height: 128px; margin: -64px 0 0 -64px; border-radius: 50%;
  background: rgb(255 255 255 / 0.12); border: 2px solid rgb(255 255 255 / 0.35); opacity: 0.5; }
.touch-controls .stick.active { opacity: 1; }
.touch-controls .knob { position: absolute; left: 34px; top: 34px; width: 56px; height: 56px; border-radius: 50%;
  background: rgb(255 255 255 / 0.6); }
.touch-controls button { position: absolute; pointer-events: auto; touch-action: none; border-radius: 50%;
  border: 2px solid rgb(255 255 255 / 0.5); background: rgb(20 24 30 / 0.45); color: #fff; padding: 0;
  text-shadow: 0 1px 2px #000; -webkit-user-select: none; user-select: none; }
.touch-controls button.down, .touch-controls button[aria-pressed="true"] { background: rgb(255 255 255 / 0.45); }
.touch-controls .jump { width: 84px; height: 84px; right: calc(env(safe-area-inset-right) + 24px); bottom: calc(env(safe-area-inset-bottom) + 28px); }
.touch-controls .act  { width: 66px; height: 66px; right: calc(env(safe-area-inset-right) + 122px); bottom: calc(env(safe-area-inset-bottom) + 20px); }
.touch-controls .run  { width: 60px; height: 60px; right: calc(env(safe-area-inset-right) + 36px); bottom: calc(env(safe-area-inset-bottom) + 126px); }
.touch-controls .pause { width: 44px; height: 44px; right: calc(env(safe-area-inset-right) + 12px); top: calc(env(safe-area-inset-top) + 12px); font-size: 16px; }
`;

export function touchControls(game: Game, pause: () => void) {
  const canvas = game.stage.renderer.domElement, camera = game.player.camera;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  const root = document.createElement("div");
  root.className = "touch-controls";
  root.innerHTML = `<div class="stick"><div class="knob"></div></div>
    <button class="jump" aria-label="Jump">Jump</button><button class="act" aria-label="Use">Use</button>
    <button class="run" aria-label="Run" aria-pressed="false">Run</button><button class="pause" aria-label="Pause">II</button>`;
  document.body.append(root);
  const base = root.querySelector<HTMLDivElement>(".stick")!, knob = root.querySelector<HTMLDivElement>(".knob")!;
  const button = (name: string) => root.querySelector<HTMLButtonElement>(`.${name}`)!;

  // Buttons: held while a finger is on them; a tap shorter than a step still counts once (kept until read).
  const held = { jump: false, act: false }, tapped = { jump: false, act: false };
  for (const name of ["jump", "act"] as const) {
    const element = button(name);
    element.addEventListener("pointerdown", (e) => { e.preventDefault(); held[name] = tapped[name] = true; element.classList.add("down"); });
    const lift = () => { held[name] = false; element.classList.remove("down"); };
    element.addEventListener("pointerup", lift);
    element.addEventListener("pointercancel", lift);
  }
  let running = false; // run is a toggle, off again when the stick is let go
  const setRun = (on: boolean) => { running = on; button("run").setAttribute("aria-pressed", String(on)); };
  button("run").addEventListener("pointerdown", (e) => { e.preventDefault(); setRun(!running); });
  button("pause").addEventListener("pointerdown", (e) => { e.preventDefault(); pause(); });
  root.addEventListener("contextmenu", (e) => e.preventDefault());

  // The stick: rests faintly at the lower left, jumps under the thumb where it touches down.
  let stickId = -1, ox = 0, oy = 0, move = { x: 0, y: 0, run: 0 };
  const place = (x: number, y: number, kx = 0, ky = 0) => {
    base.style.left = `${x}px`; base.style.top = `${y}px`;
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
  };
  const rest = () => place(Math.max(90, innerWidth * 0.14), innerHeight - Math.max(100, innerHeight * 0.14));
  rest();
  window.addEventListener("resize", () => { if (stickId < 0) rest(); });

  // Looking: one finger turns, two pinch.
  const looks = new Map<number, { x: number; y: number }>();
  const spread = () => { const [a, b] = [...looks.values()]; return Math.hypot(a!.x - b!.x, a!.y - b!.y); };
  let visible = true;

  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" || game.stage.paused) return;
    e.preventDefault();
    if (visible && stickId < 0 && e.clientX < innerWidth / 2) {
      stickId = e.pointerId; ox = e.clientX; oy = e.clientY;
      base.classList.add("active");
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
    base.classList.remove("active");
    setRun(false);
    rest();
  };
  // No page zoom by pinch or double tap on Safari, whatever the viewport says.
  for (const type of ["gesturestart", "gesturechange", "dblclick"]) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });

  const source: Source & { show(on: boolean): void } = {
    read(into: Input): Input {
      into.move.x = move.x; into.move.y = move.y;
      into.run = running ? 1 : move.run;
      into.jump = held.jump || tapped.jump;
      into.act = held.act || tapped.act;
      tapped.jump = tapped.act = false;
      return into;
    },
    show(on: boolean) {
      if (on === visible) return;
      visible = on;
      root.hidden = !on;
      if (!on) { // nothing stays pressed behind a menu
        releaseStick();
        held.jump = held.act = false;
        for (const element of root.querySelectorAll("button")) element.classList.remove("down");
      }
    },
  };
  return source;
}
