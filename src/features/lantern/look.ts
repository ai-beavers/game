// What a lantern looks like and how it hangs under a paw, shared by the player's own (index.ts) and by other
// players' beavers (remote.ts): a glass that glows, and its frame (cap, base and the handle's ring) merged into one mesh.
//
//   const lantern = makeLantern(scene, "lantern", lanternMaterials(scene, "lantern"));   the glass, the frame its child
//   const hang = hanger(lantern, beaver);     each picture after the bones are posed: below the left paw, upright
//   glowOf(dark)                              0 … 1, how bright it glows at this dark (the sky's)
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Node } from "@babylonjs/core/node.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { Beaver } from "../../contracts.ts";
import { smoothstep } from "../../world/noise.ts";

export const WARM = new Color3(1, 0.5, 0.17); // deeper than candlelight: the night's grade takes colour out of the midtones
export const GLOW = 1.0; // the glass at full dark
const HANDLE = { y: 0.075, diameter: 0.045, thickness: 0.006 }; // m: the ring on top of the glass that the paw holds
const HANDLE_TOP = HANDLE.y + HANDLE.diameter / 2 + HANDLE.thickness / 2; // m above the glass's middle
const HANG = 0.01 + HANDLE_TOP; // m from the hand bone (the wrist) down to the glass's middle: the handle sits in the paw

/** 0 … 1: how bright a lit lantern glows at this dark. */
export const glowOf = (dark: number) => smoothstep(0.08, 0.5, dark);

export function lanternMaterials(scene: Scene, name: string) {
  const glass = new StandardMaterial(`${name}-glass`, scene);
  glass.diffuseColor.set(0.5, 0.42, 0.3);
  glass.specularColor.setAll(0.3);
  const frame = new StandardMaterial(`${name}-frame`, scene);
  frame.diffuseColor.set(0.09, 0.08, 0.07);
  frame.specularColor.setAll(0.15);
  return { glass, frame };
}

/** The glass (named `name`), with the frame as its child: two draw calls. */
export function makeLantern(scene: Scene, name: string, materials: { glass: StandardMaterial; frame: StandardMaterial }) {
  const glass = MeshBuilder.CreateCylinder(name, { height: 0.08, diameter: 0.06, tessellation: 8 }, scene);
  glass.material = materials.glass;
  const at = (mesh: Mesh, y: number, turn = 0) => { mesh.position.y = y; mesh.rotation.x = turn; return mesh; };
  const frame = Mesh.MergeMeshes([ // one draw call
    at(MeshBuilder.CreateCylinder("cap", { height: 0.025, diameterTop: 0.025, diameterBottom: 0.08, tessellation: 8 }, scene), 0.052),
    at(MeshBuilder.CreateCylinder("base", { height: 0.014, diameter: 0.075, tessellation: 8 }, scene), -0.047),
    at(MeshBuilder.CreateTorus("handle", { diameter: HANDLE.diameter, thickness: HANDLE.thickness, tessellation: 12 }, scene), HANDLE.y, Math.PI / 2),
  ], true)!;
  frame.name = `${name}-frame`;
  frame.material = materials.frame;
  frame.parent = glass;
  glass.rotationQuaternion = null;
  for (const mesh of [glass, frame]) mesh.isPickable = false;
  return glass;
}

/** Puts `glass` below the beaver's left paw as it is in this picture (the bones were just posed), upright, facing the
 *  beaver's way. It is not parented to the hand bone (that turns with the wrist and grows into a fist), so it swings
 *  with the arm. Cost per call: the world matrices from the beaver's root down to the left hand (under ten nodes). */
export function hanger(glass: Mesh, beaver: Beaver) {
  const paw = beaver.leftHand, chain: TransformNode[] = [], ahead = new Vector3();
  for (let n: Node | null = paw; n; n = n.parent) if (n instanceof TransformNode) chain.unshift(n);
  return () => {
    for (const node of chain) node.computeWorldMatrix(true);
    glass.position.copyFrom(paw.getAbsolutePosition()).y -= HANG;
    Vector3.TransformNormalToRef(Vector3.Forward(), beaver.root.getWorldMatrix(), ahead);
    glass.rotation.y = Math.atan2(ahead.x, ahead.z);
    glass.computeWorldMatrix(true);
  };
}
