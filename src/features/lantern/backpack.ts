// The backpack the beaver always wears: the lantern rides in it by day (src/features/lantern/stow.ts says when it
// comes out). Muted canvas with a leather flap, straps and a bedroll on top; built in code like the hat, a few shapes
// merged into one mesh with its colours in the vertices: one draw call. On the chest bone, so it follows the trunk in
// every pose, on the back over the shirt or the fur. It throws and takes shadows like every part of the beaver.
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { BACKPACK } from "../../contracts.ts";

// linear, as the vertex colours are taken: a muted olive canvas, dark leather, a rust bedroll
const CANVAS = new Color3(0.13, 0.12, 0.065), LEATHER = new Color3(0.07, 0.03, 0.012), ROLL = new Color3(0.2, 0.05, 0.025);
const W = 0.17, H = BACKPACK.height, D = 0.085; // m: the bag

export function makeBackpack(scene: Scene, chest: TransformNode) {
  const tint = (mesh: Mesh, colour: Color3) => {
    const n = mesh.getTotalVertices(), colours = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) colours.set([colour.r, colour.g, colour.b, 1], i * 4);
    mesh.setVerticesData(VertexBuffer.ColorKind, colours);
    return mesh;
  };
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, colour: Color3, tilt = 0) => {
    const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z);
    mesh.rotation.x = tilt;
    return tint(mesh, colour);
  };
  const roll = MeshBuilder.CreateCylinder("roll", { height: W * 1.05, diameter: 0.06, tessellation: 12 }, scene);
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, H / 2 + 0.028, -0.005);
  const pocket = box("pocket", W * 0.62, H * 0.38, 0.03, 0, -H * 0.2, -D / 2 - 0.012, CANVAS);
  const pack = Mesh.MergeMeshes([
    box("bag", W, H, D, 0, 0, 0, CANVAS),
    box("flap", W * 1.04, 0.012, D * 1.08, 0, H / 2 + 0.002, 0, LEATHER),
    box("flap-front", W * 1.04, H * 0.42, 0.012, 0, H * 0.3, -D / 2 - 0.006, LEATHER),
    pocket,
    box("buckle", 0.026, 0.03, 0.016, 0, H * 0.1, -D / 2 - 0.012, new Color3(0.4, 0.3, 0.12)),
    ...[-1, 1].map((s) => box("strap", 0.024, H * 1.05, 0.012, s * W * 0.32, 0.005, D / 2 + 0.004, LEATHER)),
    ...[-1, 1].map((s) => box("shoulder", 0.026, 0.012, 0.13, s * W * 0.32, H / 2 + 0.006, D / 2 + 0.06, LEATHER, -0.3)),
    tint(roll, ROLL),
  ], true)!;
  pack.name = "backpack";
  const material = new PBRMaterial("backpack canvas", scene);
  material.albedoColor = Color3.White(); // times the vertex colours
  material.metallic = 0;
  material.roughness = 0.9;
  pack.material = material;
  pack.parent = chest;
  pack.position.set(0, BACKPACK.y, BACKPACK.z); // on the back
  pack.rotation.x = 0.08; // the top leaning back a little onto the shoulders
  pack.isPickable = false;
  pack.receiveShadows = true; // and so it throws them (src/light.ts)
  pack.onDisposeObservable.addOnce(() => material.dispose());
  return pack;
}
