// Register the GLB skeleton animation dependencies before Bun loads the model.
import "@babylonjs/core/Animations/animatable.js";
import "@babylonjs/core/Animations/animationGroup.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import "@babylonjs/loaders/glTF/2.0/glTFLoader.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp.js"; // the textures of both glb files (tools/blender)
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization.js"; // their normals, uvs, weights as integers
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.js";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder.js";
import { ExtrudeShape } from "@babylonjs/core/Meshes/Builders/shapeBuilder.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { createCoat } from "./fur.ts";
import beaverGlb from "../../assets/beaver.glb" with { type: "file" };
import logoPng from "../../assets/logo.png" with { type: "file" };
import { BONES, DEFAULT_LOOK, SHIRT_CREAM, type LoadBeaver, type Look, type RGB } from "../contracts.ts";

async function shirtTexture(scene: Scene) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  const paint = canvas.getContext("2d")!;
  paint.fillStyle = SHIRT_CREAM; // not glaring white
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
const FELT = Color3.FromArray(DEFAULT_LOOK.hat), BAND = new Color3(0.8, 0.7, 0.52); // charcoal felt, a warm cream band to go with the shirt and the chestnut coat
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
  // The felt's vertices (not the band's), to colour them for an Outfit.
  const colours = Float32Array.from(hat.getVerticesData(VertexBuffer.ColorKind)!);
  hat.setVerticesData(VertexBuffer.ColorKind, colours, true); // updatable from here on
  const isFelt = (i: number) => Math.abs(colours[i * 4]! - FELT.r) < 1e-3 && Math.abs(colours[i * 4 + 1]! - FELT.g) < 1e-3;
  const feltAt = Array.from({ length: colours.length / 4 }, (_, i) => i).filter(isFelt);
  const colourFelt = (c: RGB) => {
    for (const i of feltAt) colours.set(c, i * 4);
    hat.updateVerticesData(VertexBuffer.ColorKind, colours);
  };
  return { hat, colourFelt };
}

/** Gives every vertex of a part one colour, so parts merged into one mesh keep theirs. */
function paint(mesh: Mesh, c: Color3) {
  const n = mesh.getTotalVertices(), colours = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) colours.set([c.r, c.g, c.b, 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colours);
  return mesh;
}

// The Shark's hood, worn in the hat's place: a rounded shell over the top and back of the head down to the ears, open
// in front for the eyes, muzzle and whiskers, a dorsal fin standing up from its top and a ring of small teeth round
// the opening. One mesh with its colours in the vertices, like the hat; the shell takes the look's hat colour, the fin
// and the teeth keep their own. In the head bone's space (measured from the coat: the crown 0.19 m up, the ears 0.14 m
// out to each side, the back of the head 0.11 m behind, the eyes at y 0.15, z 0.085), with room for the fur.
const FIN_GREY = new Color3(0.22, 0.25, 0.29), TOOTH = new Color3(0.93, 0.91, 0.86);
const HOOD_AT = new Vector3(0, 0.065, -0.02), HOOD_SIZE = new Vector3(0.17, 0.15, 0.17); // centre and radii of the shell, m
const HOOD_KEEP = 0.6; // of the shell's depth, from the back: the rest is the face's opening
const HOOD_TIP = 0.5; // rad the opening is turned down from straight ahead: over the brow, behind the chin
// The fin's side, [m ahead, m up] from where it stands on the crown: a curved leading edge up to a tip swept back over
// the back of the head, and a hooked trailing edge down from it. Extruded FIN_THICK across.
const FIN_SIDE: [number, number][] = [[0.075, -0.02], [0.06, 0.04], [0.03, 0.1], [-0.01, 0.15], [-0.075, 0.19], [-0.06, 0.13], [-0.05, 0.08], [-0.055, 0.03], [-0.07, -0.02]];
const FIN_THICK = 0.03; // m
const TEETH = 18;
const TOOTH_SIZE = 0.026; // m, each tooth's length and nearly its width

function makeHood(scene: Scene, head: TransformNode) {
  // The shell from a unit sphere cut across: its kept back turned to face behind and up, then stretched to the head.
  const shell = CreateSphere("hood shell", { diameter: 2, segments: 16, slice: HOOD_KEEP, sideOrientation: Mesh.DOUBLESIDE }, scene);
  const shape = Matrix.RotationX(-Math.PI / 2 + HOOD_TIP).multiply(Matrix.Scaling(HOOD_SIZE.x, HOOD_SIZE.y, HOOD_SIZE.z)).multiply(Matrix.Translation(HOOD_AT.x, HOOD_AT.y, HOOD_AT.z));
  shell.bakeTransformIntoVertices(shape);
  paint(shell, Color3.White()); // until a look gives it its colour: the Shark's grey is owned by the shop's rules
  // The fin, standing on the shell's crown.
  const fin = ExtrudeShape("hood fin", {
    shape: FIN_SIDE.map(([ahead, up]) => new Vector3(ahead, up, 0)),
    path: [new Vector3(0, 0, -FIN_THICK / 2), new Vector3(0, 0, FIN_THICK / 2)], cap: Mesh.CAP_ALL, closeShape: true,
  }, scene);
  fin.bakeTransformIntoVertices(Matrix.RotationY(Math.PI / 2).multiply(Matrix.Translation(0, HOOD_AT.y + HOOD_SIZE.y * 0.97, HOOD_AT.z))); // a little into the crown, so no gap shows
  paint(fin, FIN_GREY);
  // The teeth round the rim of the opening, each a small cone pointing in towards the face.
  const ring = 2 * HOOD_KEEP - 1, across = Math.sqrt(1 - ring * ring), mid = Vector3.TransformCoordinates(new Vector3(0, -ring, 0), shape);
  const teeth = Array.from({ length: TEETH }, (_, i) => {
    const a = (i / TEETH) * Math.PI * 2;
    const rim = Vector3.TransformCoordinates(new Vector3(Math.cos(a) * across, -ring, Math.sin(a) * across), shape);
    const inward = mid.subtract(rim).normalize(), size = TOOTH_SIZE;
    const tooth = CreateCylinder("hood tooth", { height: size, diameterTop: 0, diameterBottom: size * 0.7, tessellation: 5 }, scene);
    const turn = Quaternion.Identity();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), inward, turn);
    const at = rim.add(inward.scale(size * 0.4));
    tooth.bakeTransformIntoVertices(Matrix.Compose(Vector3.One(), turn, at));
    return paint(tooth, TOOTH);
  });
  const shellVertices = shell.getTotalVertices();
  const hood = Mesh.MergeMeshes([shell, fin, ...teeth], true)!;
  hood.name = "hood";
  const cloth = new PBRMaterial("hood cloth", scene);
  cloth.albedoColor = Color3.White(); // times the vertex colours
  cloth.metallic = 0;
  cloth.roughness = 0.85;
  cloth.backFaceCulling = false;
  hood.material = cloth;
  hood.parent = head;
  hood.isPickable = false;
  hood.receiveShadows = true; // and so it throws them, as every part of the beaver does (src/light.ts)
  hood.onDisposeObservable.addOnce(() => cloth.dispose());
  // The shell's vertices come first in the merged mesh: those take the look's colour.
  const colours = Float32Array.from(hood.getVerticesData(VertexBuffer.ColorKind)!);
  hood.setVerticesData(VertexBuffer.ColorKind, colours, true); // updatable from here on
  const colourShell = (c: RGB) => {
    for (let i = 0; i < shellVertices; i++) colours.set(c, i * 4);
    hood.updateVerticesData(VertexBuffer.ColorKind, colours);
  };
  hood.setEnabled(false); // every beaver starts in its hat
  return { hood, colourShell };
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
  // Each part takes shadows and so throws them (src/light.ts), but the small dark ones: an eye, a claw or a whisker
  // shows neither, and each would be one more draw in the shadow map for every beaver.
  for (const part of asset.meshes) part.receiveShadows = !/^(eye|glint|nose|nostril|whisker|brow|claw)$/.test(part.material?.name ?? "");
  const { hat, colourFelt } = makeHat(scene, nodes.get("head")!);
  const { hood, colourShell } = makeHood(scene, nodes.get("head")!);
  const printed = shirtMat.albedoColor.clone();
  const copy = (l: Look): Look => ({ shirt: [...l.shirt], hat: [...l.hat], hood: !!l.hood });
  let look = copy(DEFAULT_LOOK), headwear = true;
  // The headwear switch (beaver.hat) and the look together: the hood or the felt hat, never both; neither with it off.
  const wearHeadwear = () => { hat.setEnabled(headwear && !look.hood); hood.setEnabled(headwear && !!look.hood); };
  // Where the beaver sees from: the file's mark between its eyes, turned as the head bone is.
  const eyes = nodes.get("eyes")!;
  eyes.rotationQuaternion = Quaternion.Identity();
  // The small parts (face, hands, feet, claws) are skinned, one mesh per material: seen wherever the body is.
  for (const part of asset.meshes) if (part.name.startsWith("details")) part.setBoundingInfo(body.getBoundingInfo());
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
    root, eyes, hand: nodes.get("hand_R")!, leftHand: nodes.get("hand_L")!, chest: nodes.get("chest")!,
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
    get hat() { return headwear; },
    set hat(on) { headwear = on; wearHeadwear(); },
    get look() { return copy(look); },
    set look(next) {
      look = copy(next);
      shirtMat.albedoColor.set(printed.r * look.shirt[0], printed.g * look.shirt[1], printed.b * look.shirt[2]);
      if (look.hood) colourShell(look.hat);
      else colourFelt(look.hat);
      wearHeadwear();
    },
    get coat(): RGB { return [calm.r, calm.g, calm.b]; },
    set coat(c) {
      calm.set(...c);
      Color3.LerpToRef(calm, red, anger, material.albedoColor);
    },
    get grey() { return fur.coat.grey; },
    set grey(value) { fur.coat.grey = Math.min(1, Math.max(0, value)); },
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
