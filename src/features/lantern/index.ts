// A lantern in the beaver's left hand, hanging by its handle (a viewer's wish): it glows warm as it gets dark and lights the ground, the
// trees and the pond's edge around the beaver, and goes out at dawn. Nothing to press. Only the local beaver has one.
// It is not parented to the hand bone (that turns with the wrist and grows into a fist): each picture it is put below
// where the paw is, upright, turned the way the beaver faces, so it swings with the arm and its light sways along.
//
// One PointLight, made once and always enabled, its intensity 0 by day: the standard and PBR materials keep the same
// lights all day, so nothing recompiles at dusk. The shaders that light themselves (grass, leaves, the larger animals)
// take it through daylight().lantern (src/light.ts). On low quality there is no light, only the glowing glass.
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { PointLight } from "@babylonjs/core/Lights/pointLight.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Node } from "@babylonjs/core/node.js";
import type { CreateFeature } from "../../game.ts";
import { daylightOf, LANTERN_REACH } from "../../light.ts";
import { smoothstep } from "../../world/noise.ts";

const WARM = new Color3(1, 0.5, 0.17); // deeper than candlelight: the night's grade takes colour out of the midtones
const HANG = 0.03 + 0.081; // m from the paw down to the glass's middle: a gap, then the handle's top above the glass
const LIGHT = 2.4, GLOW = 1.0, SHADERS = 1.8; // at full dark: the PointLight, the glass, the self-lit shaders

export const create: CreateFeature = ({ stage: { scene }, beaver, player, settings, sky }) => {
  const daylight = daylightOf(scene);
  if (!daylight || !sky) return {};
  const glassMat = new StandardMaterial("lantern-glass", scene);
  glassMat.diffuseColor.set(0.5, 0.42, 0.3);
  glassMat.specularColor.setAll(0.3);
  const frameMat = new StandardMaterial("lantern-frame", scene);
  frameMat.diffuseColor.set(0.09, 0.08, 0.07);
  frameMat.specularColor.setAll(0.15);
  const glass = MeshBuilder.CreateCylinder("lantern", { height: 0.08, diameter: 0.06, tessellation: 8 }, scene);
  glass.material = glassMat;
  const at = (mesh: Mesh, y: number, turn = 0) => { mesh.position.y = y; mesh.rotation.x = turn; return mesh; };
  const frame = Mesh.MergeMeshes([ // one draw call
    at(MeshBuilder.CreateCylinder("cap", { height: 0.025, diameterTop: 0.025, diameterBottom: 0.08, tessellation: 8 }, scene), 0.052),
    at(MeshBuilder.CreateCylinder("base", { height: 0.014, diameter: 0.075, tessellation: 8 }, scene), -0.047),
    at(MeshBuilder.CreateTorus("handle", { diameter: 0.045, thickness: 0.006, tessellation: 12 }, scene), 0.075, Math.PI / 2),
  ], true)!;
  frame.name = "lantern-frame";
  frame.material = frameMat;
  frame.parent = glass;
  glass.rotationQuaternion = null;
  const paw = beaver.leftHand, chain: TransformNode[] = [];
  for (let n: Node | null = paw; n; n = n.parent) if (n instanceof TransformNode) chain.unshift(n);
  const ahead = new Vector3();
  /** Below the left paw as it is in this picture (the bones were just posed), upright, facing the beaver's way. */
  const hang = () => {
    for (const node of chain) node.computeWorldMatrix(true);
    glass.position.copyFrom(paw.getAbsolutePosition()).y -= HANG;
    Vector3.TransformNormalToRef(Vector3.Forward(), beaver.root.getWorldMatrix(), ahead);
    glass.rotation.y = Math.atan2(ahead.x, ahead.z);
    glass.computeWorldMatrix(true);
  };
  for (const mesh of [glass, frame]) mesh.isPickable = false;
  const light = new PointLight("lantern-light", Vector3.Zero(), scene);
  light.parent = glass;
  light.diffuse.copyFrom(WARM);
  light.specular.copyFrom(WARM).scaleInPlace(0.3);
  light.range = LANTERN_REACH;
  light.falloffType = PointLight.FALLOFF_STANDARD; // linear to its range in PBR too: no white fur right beside it
  light.intensity = 0;
  // Low quality: no light in the materials (a recompile once, when the setting changes), the glass glows alone.
  let lit = true;
  scene.onDisposeObservable.add(settings.on(({ quality }) => { lit = quality !== "low"; light.setEnabled(lit); }));
  return {
    update() {
      const on = smoothstep(0.08, 0.5, sky.dark), shown = !player.diving;
      glass.setEnabled(shown);
      if (shown) hang();
      glassMat.emissiveColor.copyFrom(WARM).scaleInPlace(GLOW * on);
      light.intensity = shown ? LIGHT * on : 0;
      daylight.lantern.at.copyFrom(glass.getAbsolutePosition());
      WARM.scaleToRef(shown && lit ? SHADERS * on : 0, daylight.lantern.glow);
    },
  };
};
