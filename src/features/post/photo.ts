import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Game } from "../../game.ts";
import { createPhotoStrip } from "../hud/photo-strip.ts";
import type { Chain } from "./chain.ts";

export function photoMode({ stage, player, beaver }: Game, chain: Chain) {
  const { scene, canvas, camera, hud } = stage;
  const eye = new ArcRotateCamera("photo", 0, Math.PI / 3, 4, Vector3.Zero(), scene);
  eye.fov = camera.fov;
  eye.minZ = camera.minZ;
  eye.maxZ = camera.maxZ;
  eye.lowerRadiusLimit = 0.4;
  eye.upperRadiusLimit = 14;
  eye.upperBetaLimit = Math.PI * 0.62;
  eye.wheelDeltaPercentage = 0.02;
  eye.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
  let on = false, strength = 0.35;
  let held = { yaw: 0, pitch: 0, distance: 0 };
  const strip = createPhotoStrip(stage, { save, leave, setStrength });
  strip.value(strength);
  function setStrength(value: number) {
    strength = Math.max(0, Math.min(1, value));
    strip.value(strength);
  }

  function enter() {
    const { yaw, pitch, distance } = player.camera;
    held = { yaw, pitch, distance };
    on = stage.paused = true;
    document.body.classList.add("photo");
    eye.setTarget(beaver.root.getAbsolutePosition().add(new Vector3(0, 0.6, 0)));
    eye.setPosition(camera.position);
    scene.activeCamera = eye;
    chain.camera(eye);
    eye.attachControl(false, false, 2);
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
    update() {
      if (!on) return;
      const point = beaver.root.getAbsolutePosition().add(new Vector3(0, 0.6, 0));
      chain.focus(-Vector3.TransformCoordinates(point, eye.getViewMatrix()).z, strength);
    },
  };
}
