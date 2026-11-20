// The debug readout: where the beaver and the camera are, which way it faces, the ground under it, frames and
// meshes drawn. F3 shows and hides it; ?debug starts with it shown (and draws the colliders, src/engine.ts).
import type { CreateFeature } from "../../game.ts";
import { box, Overlay, onViewport } from "../hud/overlay.ts";

const W = 300, H = 92;

export const create: CreateFeature = ({ stage, player, world }) => {
  const layer = new Overlay(stage, "debug-readout", false, 50);
  const back = layer.rect("debug-back", box(0, 0, W, H));
  const text = layer.label("debug-text", "", box(0, 0, W, H), 13, "left", false);
  text.fontFamily = "ui-monospace, Menlo, monospace";
  text.paddingLeft = "10px";
  onViewport(stage, (w, h) => { layer.move(back, box(w - W - 16, h - H - 16, W, H)); layer.move(text, box(w - W - 16, h - H - 16, W, H)); });
  let on = new URLSearchParams(location.search).has("debug");
  layer.show(on);
  window.addEventListener("keydown", (e) => {
    if (e.code !== "F3" || e.repeat || e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    layer.show(on = !on);
  });
  const f = (n: number) => n.toFixed(2).padStart(7);
  return {
    update() {
      if (!on) return;
      const p = player.feet, c = stage.camera.position, deg = ((player.facing * 180 / Math.PI) % 360 + 360) % 360;
      text.text = `beaver ${f(p.x)} ${f(p.y)} ${f(p.z)}\ncamera ${f(c.x)} ${f(c.y)} ${f(c.z)}\n`
        + `facing ${deg.toFixed(0)}°  ground ${world.heightAt(p.x, p.z).toFixed(2)}\n`
        + `${Math.round(stage.engine.getFps())} fps  ${stage.scene.getActiveMeshes().length} meshes`;
    },
  };
};
