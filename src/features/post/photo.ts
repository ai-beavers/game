import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Game } from "../../game.ts";
import { BUTTON, deadZone, down, firstPad } from "../controls/pad.ts";
import type { Device } from "../hud/devices.ts";
import { createPhotoStrip } from "../hud/photo-strip.ts";
import type { Chain } from "./chain.ts";

const ORBIT = 1.8, ZOOM = 1.4; // rad/s, and e-folds of distance per s, with a stick fully pushed
const UPPER_BETA = Math.PI * 0.62; // rad from straight up: how far below its look point the photo camera may go

export function photoMode({ stage, player, beaver }: Game, chain: Chain) {
  const { scene, canvas, camera, hud } = stage;
  const eye = new ArcRotateCamera("photo", 0, Math.PI / 3, 4, Vector3.Zero(), scene);
  eye.fov = camera.fov;
  eye.minZ = camera.minZ;
  eye.maxZ = camera.maxZ;
  eye.lowerRadiusLimit = 0.4;
  eye.upperRadiusLimit = 14;
  eye.upperBetaLimit = UPPER_BETA;
  eye.wheelDeltaPercentage = 0.02;
  eye.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
  let on = false, strength = 0.35;
  let held = { yaw: 0, pitch: 0, distance: 0 };
  const strip = createPhotoStrip(stage, { save, leave, setStrength });
  strip.value(strength);
  // The help names the inputs of the device last used: pointer, keys, or the pad (in update).
  let device: Device = document.getElementById("touch-controls") ? "touch" : "keys", padWas: boolean[] = [];
  const armed = new Set<number>();
  const use = (d: Device) => { device = d; strip.device(d); };
  window.addEventListener("pointerdown", e => use(e.pointerType === "touch" ? "touch" : "keys"), true);
  function setStrength(value: number) {
    strength = Math.max(0, Math.min(1, value));
    strip.value(strength);
  }

  function enter() {
    const { yaw, pitch, distance } = player.camera;
    held = { yaw, pitch, distance };
    on = stage.paused = true;
    document.body.classList.add("photo");
    // From the camera as it is: round the beaver behind it, or, in the first-person view (the camera at the eyes,
    // the beaver left out), round the point a metre ahead of the eyes, which never coincides with them.
    const first = player.camera.view === "first-person";
    eye.layerMask = camera.layerMask;
    const target = first ? camera.getTarget().clone() : beaver.root.getAbsolutePosition().add(new Vector3(0, 0.6, 0));
    // Looking up from the eyes stands the camera below that point: let it start there rather than be clamped.
    const from = camera.position.subtract(target), below = Math.acos(Math.max(-1, Math.min(1, from.y / (from.length() || 1))));
    eye.upperBetaLimit = Math.max(UPPER_BETA, below);
    eye.setTarget(target);
    eye.setPosition(camera.position.clone());
    scene.activeCamera = eye;
    chain.camera(eye);
    eye.attachControl(false, false, 2);
    // The pad's Back sends P (features/controls): still held as photo mode opens.
    const pad = firstPad(navigator.getGamepads?.());
    use(pad?.buttons.some((_, i) => down(pad, i)) ? "pad" : device);
    strip.show(true);
  }
  function leave() {
    eye.detachControl();
    Object.assign(player.camera, held);
    scene.activeCamera = camera;
    chain.focus(1, 0);
    chain.camera(camera);
    on = stage.paused = false;
    document.body.classList.remove("photo");
    strip.show(false);
    canvas.focus();
  }
  function save() {
    if (!on) return;
    const layer = hud.layer;
    if (layer) layer.isEnabled = false;
    try {
      scene.render();
      canvas.toBlob(blob => {
        if (!blob) return;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `beaver-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }, "image/png");
    } finally { if (layer) layer.isEnabled = true; }
  }

  const key = (event: KeyboardEvent) => {
    const target = event.target;
    if (on && event.isTrusted) use("keys");
    if (target instanceof HTMLElement) {
      if (on && target.closest("#photo-strip") && event.code === "Enter" && target instanceof HTMLButtonElement) return;
      if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement ||
          (target instanceof HTMLInputElement && target.type !== "range")) return;
    }
    if (event.repeat && !event.code.startsWith("Bracket")) return;
    if (!on && event.code === "KeyP" && !stage.paused) enter();
    else if (!on) return;
    else if (event.code === "KeyP" || event.code === "Escape") leave();
    else if (event.code === "Enter") save();
    else if (event.code === "BracketLeft") setStrength(strength - 0.1);
    else if (event.code === "BracketRight") setStrength(strength + 0.1);
    else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener("keydown", key, true);
  scene.onDisposeObservable.add(() => window.removeEventListener("keydown", key, true));
  return {
    update(dt: number) {
      const pad = firstPad(navigator.getGamepads?.()), now = pad ? pad.buttons.map((_, i) => down(pad, i)) : [];
      const was = padWas;
      padWas = now;
      if (!on) { armed.clear(); return; }
      if (pad) {
        // A saves and B leaves when let go, so the game does not find them held afterwards.
        for (const b of [BUTTON.a, BUTTON.b]) {
          if (now[b] && !was[b]) armed.add(b);
          else if (!now[b] && armed.delete(b)) { if (b === BUTTON.a) save(); else leave(); }
        }
        if (now[BUTTON.left] && !was[BUTTON.left]) setStrength(strength - 0.1);
        if (now[BUTTON.right] && !was[BUTTON.right]) setStrength(strength + 0.1);
        const orbit = deadZone(pad.axes[0] ?? 0, pad.axes[1] ?? 0), zoom = deadZone(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
        if (orbit.x || orbit.y || zoom.x || zoom.y || now.some((v, i) => v && !was[i])) use("pad");
        eye.alpha -= (orbit.x + zoom.x) * ORBIT * dt;
        eye.beta = Math.max(eye.lowerBetaLimit ?? 0.01, Math.min(eye.upperBetaLimit ?? Math.PI, eye.beta - orbit.y * ORBIT * dt));
        eye.radius = Math.max(eye.lowerRadiusLimit ?? 0, Math.min(eye.upperRadiusLimit ?? 14, eye.radius * Math.exp(zoom.y * ZOOM * dt)));
        if (!on) return; // B just left
      }
      const point = beaver.root.getAbsolutePosition().add(new Vector3(0, 0.6, 0));
      chain.focus(-Vector3.TransformCoordinates(point, eye.getViewMatrix()).z, strength);
    },
  };
}
