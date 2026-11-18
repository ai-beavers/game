// Register the GLB skeleton animation dependencies before Bun loads the model.
import "@babylonjs/core/Animations/animatable.js";
import "@babylonjs/core/Animations/animationGroup.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import "@babylonjs/loaders/glTF/2.0/glTFLoader.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp.js"; // the textures of both glb files (tools/blender)
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization.js"; // their normals, uvs, weights as integers
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { createCoat } from "./fur.ts";
import beaverGlb from "../../assets/beaver.glb" with { type: "file" };
import logoPng from "../../assets/logo.png" with { type: "file" };
import { BONES, type LoadBeaver } from "../contracts.ts";

async function shirtTexture(scene: Scene) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  const paint = canvas.getContext("2d")!;
  paint.fillStyle = "#f1e8d6"; // warm cream: sits with the chestnut coat, not glaring white
  paint.fillRect(0, 0, 1024, 1024);
  paint.fillStyle = "rgba(0, 0, 0, 0.035)"; // the weave
  for (let y = 0; y < 1024; y += 4) paint.fillRect(0, y, 1024, 2);
  paint.fillStyle = "rgba(0, 0, 0, 0.1)";
  for (let x = 0; x < 1024; x += 10) { paint.fillRect(x, 0, 4, 60); paint.fillRect(x, 990, 4, 34); } // ribbing
  const logo = new Image();
  logo.src = logoPng;
  await logo.decode().then(() => {
    const width = 520, height = width * logo.height / logo.width;
    paint.filter = "invert(1)"; // the logo file is white
    paint.drawImage(logo, 512 - width / 2, 275 - height / 2, width, height);
  }, () => {
    paint.fillStyle = "#101114";
    paint.font = '800 120px "Helvetica Neue", Arial, sans-serif';
    paint.textAlign = "center";
    paint.fillText("BEAVER", 512, 310);
  });
  const texture = new DynamicTexture("shirt print", canvas, scene, true);
  texture.update(false);
  return texture;
}

// The felt hat: a short crown on a thin brim, a band round the crown's foot. One mesh with its colours in the
// vertices: one draw call a beaver. In the head bone's space (y up the head and a little forward, z ahead): on top of
// the head between the ears, tipped back a little and cocked to one side. The brim is narrower than the head.
const FELT = new Color3(0.075, 0.062, 0.058), BAND = new Color3(0.8, 0.7, 0.52); // charcoal felt, a warm cream band to go with the shirt and the chestnut coat
const HAT_AT = new Vector3(0, 0.18, 0.005), HAT_TILT = new Vector3(-0.1, 0, 0.18);

function makeHat(scene: Scene, head: TransformNode) {
  const part = (name: string, height: number, top: number, bottom: number, y: number, colour: Color3) => {
    const mesh = CreateCylinder(name, { height, diameterTop: top, diameterBottom: bottom, tessellation: 16 }, scene);
    mesh.position.y = y;
    const n = mesh.getTotalVertices(), colours = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) colours.set([colour.r, colour.g, colour.b, 1], i * 4);
    mesh.setVerticesData(VertexBuffer.ColorKind, colours);
    return mesh;
  };
  const hat = Mesh.MergeMeshes([
    part("brim", 0.01, 0.165, 0.165, 0.005, FELT),
    part("crown", 0.075, 0.088, 0.104, 0.047, FELT),
    part("band", 0.022, 0.103, 0.108, 0.024, BAND),
  ], true)!;
  hat.name = "hat";
  const felt = new PBRMaterial("hat felt", scene);
  felt.albedoColor = Color3.White(); // times the vertex colours
  felt.metallic = 0;
  felt.roughness = 0.95;
  hat.material = felt;
  hat.parent = head;
  hat.position.copyFrom(HAT_AT);
  hat.rotation.copyFrom(HAT_TILT);
  hat.isPickable = false;
  hat.receiveShadows = true; // and so it throws them, as every part of the beaver does (src/light.ts)
  hat.onDisposeObservable.addOnce(() => felt.dispose());
  return hat;
}

export const loadBeaver: LoadBeaver = async (scene) => {
  const [asset, print] = await Promise.all([ImportMeshAsync(beaverGlb, scene, { pluginExtension: ".glb" }), shirtTexture(scene)]);
  for (const group of asset.animationGroups) { group.stop(); group.dispose(); }
  const root = asset.meshes[0]!;
  const nodes = new Map<string, TransformNode>([...asset.transformNodes, ...asset.meshes].map(node => [node.name, node]));
  const shirt = nodes.get("shirt")!;
  const body = nodes.get("body");
  if (!(body instanceof Mesh) || !(body.material instanceof PBRMaterial)) throw new Error("Missing beaver coat mesh");
  const material = body.material;
  const fur = createCoat(body, material);
  const calm = new Color3(0.2, 0.074, 0.03), red = new Color3(0.48, 0.035, 0.018);
  const shirtMat = asset.meshes.find(m => m.name === "shirt")!.material as PBRMaterial;
  shirtMat.albedoTexture = print;
  for (const part of asset.meshes) part.receiveShadows = true;
  const hat = makeHat(scene, nodes.get("head")!);
  const bones = BONES.map(name => {
    const node = nodes.get(name);
    if (!node) throw new Error(`Missing beaver bone: ${name}`);
    node.rotationQuaternion ??= Quaternion.Identity();
    return { name, node, rotation: node.rotationQuaternion.clone(), position: node.position.clone(), scale: node.scaling.clone() };
  });
  const morphs = asset.meshes.flatMap(mesh => mesh.morphTargetManager?.numTargets ? [mesh.morphTargetManager.getTarget(0)] : []);
  const eye = asset.meshes.map(mesh => mesh.material).find(m => m?.name === "eye") as PBRMaterial | undefined;
  const skin = asset.meshes.map(mesh => mesh.material).find(m => m?.name === "skin") as PBRMaterial | undefined;
  const skinAtRest = skin?.albedoColor.clone(), redSkin = new Color3(0.16, 0.01, 0.008);
  const managers = new Set(asset.meshes.map(mesh => mesh.morphTargetManager));
  root.onDisposeObservable.addOnce(() => {
    for (const manager of managers) manager?.dispose();
    for (const skeleton of asset.skeletons) skeleton.dispose();
  });
  material.albedoColor.copyFrom(calm);
  let anger = 0;
  const DRY = 12; // s from dripping to dry once out of the water
  for (const morph of morphs) morph.influence = 0; // the file stores the furious body at 1: a calm beaver starts calm
  return {
    root, hand: nodes.get("hand_R")!, leftHand: nodes.get("hand_L")!, chest: nodes.get("chest")!,
    get anger() { return anger; },
    set anger(value) {
      if (anger === value) return;
      anger = Math.min(1, Math.max(0, value));
      Color3.LerpToRef(calm, red, anger, material.albedoColor);
      if (skin && skinAtRest) Color3.LerpToRef(skinAtRest, redSkin, anger, skin.albedoColor);
      fur.coat.anger = anger;
      for (const morph of morphs) morph.influence = anger;
      eye?.emissiveColor.set(Math.max(0, anger - 0.5) * 2, 0, 0);
    },
    get shirt() { return shirt.isEnabled(false); },
    set shirt(on) { shirt.setEnabled(on); fur.coat.dressed = on; },
    get hat() { return hat.isEnabled(false); },
    set hat(on) { hat.setEnabled(on); },
    pose(pose) {
      for (const { name, node, rotation, position, scale } of bones) {
        const p = pose[name];
        if (p) Quaternion.FromArrayToRef(p.rotation, 0, node.rotationQuaternion!);
        else node.rotationQuaternion!.copyFrom(rotation);
        if (p?.translation) Vector3.FromArrayToRef(p.translation, 0, node.position);
        else node.position.copyFrom(position);
        if (p?.scale !== undefined) node.scaling.setAll(p.scale);
        else node.scaling.copyFrom(scale);
      }
    },
    update(dt) {
      fur.update();
      // Wet as deep as the feet are in the pond (src/world/water.ts keeps its live level in scene.metadata): this
      // beaver and every other player's alike, without being told that they swim.
      const level = (scene.metadata?.water as { level: number } | undefined)?.level;
      const soaked = level === undefined ? 0 : Math.min(1, Math.max(0, (level - root.getAbsolutePosition().y) / 0.25));
      fur.coat.wet = Math.max(soaked, fur.coat.wet - dt / DRY);
    },
  };
};
