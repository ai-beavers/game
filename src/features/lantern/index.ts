// A lantern in the beaver's left hand, hanging by its handle (a viewer's wish): it glows warm as it gets dark and lights the ground, the
// trees and the pond's edge around the beaver, and goes out at dawn. Other players see one in every beaver's paw (remote.ts).
// By day it rides in the backpack (backpack.ts): at dusk the beaver reaches over its left shoulder and takes it out, at
// dawn it puts it back (stow.ts says when; the reach is Motion.reachBack, drawn by the animator). Under water it is
// hidden and back in the paw on surfacing, without the backpack.
// A flash (L, the pad's Y, the touch screen's Light; a viewer's wish): while it is out, a press switches it off, the next
// one on again, at once: the glass, the PointLight and the self-lit shaders' glow together. It travels to the others as
// Motion.lanternOff. It stays off through a dive, and goes back on in the backpack at dawn (stow.ts flash).
// It hangs below the paw each picture (look.ts hanger), so it swings with the arm and its light sways along.
//
// One PointLight, made once and always enabled, its intensity 0 by day: the standard and PBR materials keep the same
// lights all day, so nothing recompiles at dusk. The shaders that light themselves (grass, leaves, the larger animals)
// take it through daylight().lantern (src/light.ts). On low quality there is no light, only the glowing glass.
import { PointLight } from "@babylonjs/core/Lights/pointLight.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { CreateFeature } from "../../game.ts";
import { daylightOf, LANTERN_REACH } from "../../light.ts";
import { OWN_LAYER } from "../../player/camera.ts";
import { makeBackpack } from "./backpack.ts";
import { GLOW, glowOf, hanger, lanternMaterials, makeLantern, WARM } from "./look.ts";
import { busy, flash, newStow, stepStow } from "./stow.ts";

const LIGHT = 2.4, SHADERS = 1.8; // at full dark: the PointLight, the self-lit shaders

export const create: CreateFeature = (game) => {
  const { stage, beaver, player, settings, sky } = game, { scene } = stage, daylight = daylightOf(scene);
  if (!daylight || !sky) return {};
  const materials = lanternMaterials(scene, "lantern"), glassMat = materials.glass;
  const glass = makeLantern(scene, "lantern", materials), hang = hanger(glass, beaver);
  const pack = makeBackpack(scene, beaver.chest);
  const stow = newStow(sky.dark), motion = player.motion;
  game.lantern = { get out() { return stow.drawn; }, get off() { return stow.off; } };
  // Worn by the player's own beaver: out of the first-person view's picture, the light shines on.
  for (const mesh of [glass, ...glass.getChildMeshes(), pack]) mesh.layerMask = OWN_LAYER;
  const light = new PointLight("lantern-light", Vector3.Zero(), scene);
  light.parent = glass;
  light.diffuse.copyFrom(WARM);
  light.specular.copyFrom(WARM).scaleInPlace(0.3);
  light.range = LANTERN_REACH;
  light.falloffType = PointLight.FALLOFF_STANDARD; // linear to its range in PBR too: no white fur right beside it
  light.intensity = 0;
  // Low quality: no light in the materials (a recompile once, when the setting changes), the glass glows alone.
  let lit = true, held = false;
  scene.onDisposeObservable.add(settings.on(({ quality }) => { lit = quality !== "low"; light.setEnabled(lit); }));
  return {
    step() {
      // The moment the flash button goes down, once per press; read per step, so a tap shorter than a picture counts.
      const down = !!player.input.flash;
      if (down && !held) flash(stow);
      held = down;
    },
    update(dt) {
      if (!stage.paused) stepStow(stow, dt, sky.dark, busy(motion, player.diving));
      motion.reachBack = stow.reach;
      if (stow.off) motion.lanternOff = true; else delete motion.lanternOff;
      const on = stow.off ? 0 : glowOf(sky.dark), shown = stow.drawn && !player.diving;
      glass.setEnabled(shown);
      if (shown) hang();
      glassMat.emissiveColor.copyFrom(WARM).scaleInPlace(GLOW * on);
      light.intensity = shown ? LIGHT * on : 0;
      daylight.lantern.at.copyFrom(glass.getAbsolutePosition());
      WARM.scaleToRef(shown && lit ? SHADERS * on : 0, daylight.lantern.glow);
    },
  };
};
