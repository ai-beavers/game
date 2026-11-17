// Photo mode: P stops the world and frees the camera to orbit, pan and dolly around the beaver; depth of field
// focuses on the beaver; Enter saves the picture as a PNG; P or Escape goes back to the game, the camera where the
// player left it.
//
//   const photo = photoMode(game, chain);
//   photo.update(dt);     once per picture, after the player has placed the camera
//   photo.on              true while it runs; document.body has the class "photo" then
//
// It does not take the follow camera (src/player/camera.ts) apart: that one keeps running and places stage.camera
// first; photo mode then puts its own camera's place over it, and on leaving puts the follow camera's yaw, pitch and
// distance back as they were (its drag and wheel listeners still see the mouse while the photo is framed).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Game } from "../../game.ts";
import type { Chain } from "./chain.ts";

const FOCUS_HEIGHT = 0.6; // m above the feet: the beaver's chest and face
const BLUR_STEP = 0.1; // how much [ and ] change the depth of field

export function photoMode({ stage, player, beaver }: Game, chain: Chain) {
  const canvas = stage.renderer.domElement;
  const eye = new THREE.PerspectiveCamera();
  const controls = new OrbitControls(eye);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.12, screenSpacePanning: true, minDistance: 0.4, maxDistance: 14, maxPolarAngle: Math.PI * 0.62 });
  const point = new THREE.Vector3();
  let held = { yaw: 0, pitch: 0, distance: 0 }, strength = 0.35;

  const strip = document.createElement("div");
  strip.className = "photo-strip";
  strip.innerHTML = `<style>
      .photo-strip { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); display: none; gap: 14px;
        align-items: center; padding: 7px 14px; border-radius: 8px; background: rgba(16, 20, 26, 0.72); color: #eee;
        font: 13px/1.3 system-ui, sans-serif; user-select: none; z-index: 10; }
      body.photo .photo-strip { display: flex; }
      .photo-strip b { font-weight: 600; letter-spacing: 0.04em; }
      .photo-strip label { display: flex; gap: 6px; align-items: center; }
      .photo-strip input { width: 110px; accent-color: #d9a066; }
      .photo-strip button { font: inherit; color: inherit; background: rgba(255, 255, 255, 0.12); border: 0; border-radius: 5px; padding: 3px 9px; cursor: pointer; }
      .photo-strip span { opacity: 0.65; white-space: nowrap; }
    </style>
    <b>PHOTO</b>
    <label>Blur <input type="range" min="0" max="1" step="0.05" aria-label="Depth of field strength"></label>
    <span>drag orbit · right-drag pan · wheel closer · [ ] blur</span>
    <button data-do="save">Save ⏎</button><button data-do="back">Back P</button>`;
  document.body.append(strip);
  const slider = strip.querySelector("input")!;
  const setStrength = (value: number) => { strength = Math.max(0, Math.min(1, value)); slider.value = String(strength); };
  setStrength(strength);
  slider.addEventListener("input", () => setStrength(Number(slider.value)));
  strip.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).dataset.do;
    if (action === "save") save();
    if (action === "back") leave();
  });

  const photo = { on: false, update };

  function enter() {
    const { yaw, pitch, distance } = player.camera;
    held = { yaw, pitch, distance };
    stage.paused = true;
    photo.on = true;
    document.body.classList.add("photo");
    eye.copy(stage.camera);
    controls.target.copy(beaver.root.getWorldPosition(point)).y += FOCUS_HEIGHT;
    controls.connect(canvas);
    controls.update();
  }

  function leave() {
    if (!photo.on) return;
    controls.disconnect();
    Object.assign(player.camera, held);
    photo.on = false;
    chain.blur = 0;
    stage.paused = false;
    document.body.classList.remove("photo");
    (document.activeElement as HTMLElement | null)?.blur?.(); // the slider or a button keeps no keys from the game
  }

  function update(dt: number) {
    if (!photo.on) return;
    eye.aspect = stage.camera.aspect;
    eye.updateProjectionMatrix();
    controls.update(dt);
    stage.camera.position.copy(eye.position);
    stage.camera.quaternion.copy(eye.quaternion);
    stage.camera.updateMatrixWorld();
    // Sharp on the beaver wherever the orbit's centre was panned to.
    beaver.root.getWorldPosition(point).y += FOCUS_HEIGHT;
    chain.focus = -point.applyMatrix4(stage.camera.matrixWorldInverse).z;
    chain.blur = strength;
  }

  /** A canvas without preserveDrawingBuffer holds its picture only right after a draw: draw, then take it. */
  function save() {
    stage.draw();
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `beaver-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }, "image/png");
  }

  // Capture phase on window: these keys reach no other part (pause menu, player) while a photo is framed.
  window.addEventListener("keydown", (e) => {
    // A key typed into a text field (chat, name) is text, not a command.
    if (e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
    if (e.repeat && e.code !== "BracketLeft" && e.code !== "BracketRight") return;
    if (!photo.on) {
      if (e.code === "KeyP" && !stage.paused) { enter(); e.preventDefault(); }
      return;
    }
    if (e.code === "KeyP" || e.code === "Escape") leave();
    else if (e.code === "Enter") save();
    else if (e.code === "BracketLeft") setStrength(strength - BLUR_STEP);
    else if (e.code === "BracketRight") setStrength(strength + BLUR_STEP);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true });

  return photo;
}
