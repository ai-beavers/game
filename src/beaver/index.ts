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
import { createCoat } from "./fur.ts";
import beaverGlb from "../../assets/beaver.glb" with { type: "file" };
import logoPng from "../../assets/logo.png" with { type: "file" };
import { BONES, type LoadBeaver } from "../contracts.ts";

async function shirtTexture(scene: Scene) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  const paint = canvas.getContext("2d")!;
  paint.fillStyle = "#ecece8";
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
  const calm = new Color3(0.16, 0.072, 0.035), red = new Color3(0.48, 0.035, 0.018);
  const shirtMat = asset.meshes.find(m => m.name === "shirt")!.material as PBRMaterial;
  shirtMat.albedoTexture = print;
  for (const part of asset.meshes) part.receiveShadows = true;
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
  return {
    root, hand: nodes.get("hand_R")!,
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
    update: fur.update,
  };
};
