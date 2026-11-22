// The River kit's mesh and clips (assets/kit.glb, tools/blender/kit.py), played by the game's clock: walk and run
// advance by the ground covered, so the feet do not slide; what it does standing runs by time. A change of clip
// blends from the pose it was in. Its coat is the beaver's fur (src/beaver/fur.ts) over the model's own colour map.
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo.js";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Scene } from "@babylonjs/core/scene.js";
import kitGlb from "../../../assets/kit.glb" with { type: "file" };
import { createCoat } from "../../beaver/fur.ts";
import { RISE, WALK, type Kit } from "./rules.ts";

/** Times the model's own size (0.52 m long): a child beside the metre-tall beaver, not a mouse. */
export const SIZE = 1.35;
// m of ground one loop of the clip covers at the model's own size (kit.py WALK, RUN).
const STRIDE = { walk: 0.277, run: 0.443 };
// s a change of pose takes: down and up again is slow, as long as the rules give it to get up.
const SLOW: Record<string, number> = { forage: 0.6, look: 0.6, ...RISE };
// Hairs to the grown beaver's one, along and across: the model is drawn SIZE times its size, and a young coat is down.
const FINE = 4;
// Where the fur's copies of the skin lie along the hair: ten, for long guard hairs that do not show the steps between.
const LAYERS = [0, 0.5, 0.25, 0.75, 1, 0.12, 0.37, 0.62, 0.87, 0.44];
const TREAD = 0.7; // strokes a second it treads water with
const DRY = 12; // s from dripping to dry once out of the water (as the beaver's coat)
// Times the coat's colour on the long hair: guard hairs are paler than the fur under them.
const LIGHT = 1.08;
// Times the colour map, so that the flank in the sun measures as the reference's (tools/comfyui/river-kit/target.png): 146, 114, 96.
const COAT = new Color3(1.45, 1.27, 1.52);

/** The picture of single hairs for the cards of long hair: fine strokes from the root (the picture's foot) up, each
 *  its own length and lean, thinning out to the tip. A card shows half the picture's width. */
function hairs(scene: Scene) {
  const size = 512, texture = new DynamicTexture("kit hairs", size, scene, true), paint = texture.getContext() as CanvasRenderingContext2D;
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // the same hairs on every machine
  paint.clearRect(0, 0, size, size);
  paint.strokeStyle = "white";
  paint.lineCap = "round";
  for (let i = 0; i < 120; i++) {
    const x = random() * size, long = size * (0.55 + 0.45 * random()), lean = (random() - 0.5) * 52;
    for (let step = 0; step < 8; step++) { // a stroke in pieces, each thinner than the last
      paint.lineWidth = 2.6 - 1.9 * step / 8;
      paint.beginPath();
      paint.moveTo(x + lean * (step / 8) ** 2, size - long * step / 8);
      paint.lineTo(x + lean * ((step + 1) / 8) ** 2, size - long * (step + 1) / 8);
      paint.stroke();
    }
  }
  texture.hasAlpha = true;
  texture.update(false);
  return texture;
}

export async function loadKit(scene: Scene) {
  const asset = await ImportMeshAsync(kitGlb, scene, { pluginExtension: ".glb" });
  const root = asset.meshes[0]!;
  root.name = "river-kit";
  root.rotationQuaternion = null; // the glTF and the right-handed game both face +Z
  root.scaling.setAll(SIZE);
  const named = (name: string) => root.getChildMeshes().find((mesh) => mesh.name === name && mesh instanceof Mesh && mesh.material instanceof PBRMaterial) as Mesh | undefined;
  const body = named("Kit hide"), strands = named("strands");
  if (!body || !strands) throw new Error("kit.glb is missing its coat mesh or its long hair");
  // The long hair: cards with the skin's colour at their roots, cut out to single hairs by a picture drawn here.
  const hair = strands.material as PBRMaterial, single = hairs(scene);
  single.coordinatesIndex = 1;
  hair.albedoColor = COAT.scale(LIGHT);
  hair.bumpTexture = null; // the skin's relief at the root means nothing along a hair
  hair.opacityTexture = single;
  hair.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
  hair.alphaCutOff = 0.3;
  hair.backFaceCulling = false;
  hair.twoSidedLighting = true;
  strands.receiveShadows = true;
  strands.isPickable = false;
  strands.setBoundingInfo(new BoundingInfo(new Vector3(-0.32, -0.02, -0.42), new Vector3(0.32, 0.5, 0.42)));
  root.onDisposeObservable.addOnce(() => single.dispose());
  (body.material as PBRMaterial).albedoColor = COAT;
  const fur = createCoat(body, body.material as PBRMaterial, LAYERS);
  fur.coat.dressed = false; // no shirt to keep the fur under
  fur.coat.fine = FINE;
  fur.coat.guard = 0.35; // of the paling to the tips: the coat is the reference picture, which is not pale
  body.receiveShadows = true; // and so it throws them (src/light.ts)
  body.isPickable = false;
  body.setBoundingInfo(new BoundingInfo(new Vector3(-0.32, -0.02, -0.42), new Vector3(0.32, 0.5, 0.42))); // sitting up, it is taller than at rest
  const clips = new Map(asset.animationGroups.map((group) => [group.name, group]));
  for (const clip of clips.values()) clip.stop();
  const joints = asset.skeletons[0]!.bones.map((bone) => {
    const node = bone.getTransformNode()!;
    return { node, from: node.rotationQuaternion!.clone(), at: node.position.clone() };
  });
  let active: AnimationGroup | undefined;
  let phase = 0, elapsed = 0, blend = 1, ease = 0.3, was = "stand", lastX = 0, lastZ = 0;
  return {
    root,
    /** wet: 0 dry … 1 as deep in the water as it swims. */
    update(k: Kit, dt: number, x: number, z: number, wet: number) {
      fur.update();
      fur.coat.wet = Math.max(wet, fur.coat.wet - dt / DRY); // dripping, then dry again in a while
      // Afloat it paddles: the walk, its legs under the water, on the spot too.
      const name = k.afloat ? "walk" : k.speed > WALK ? "run" : k.speed > 0 ? "walk" : k.doing;
      const clip = clips.get(name)!;
      const distance = active ? Math.hypot(x - lastX, z - lastZ) : 0;
      lastX = x; lastZ = z;
      if (active !== clip) {
        for (const joint of joints) {
          joint.from.copyFrom(joint.node.rotationQuaternion!);
          joint.at.copyFrom(joint.node.position);
        }
        blend = active ? 0 : 1;
        ease = Math.max(0.3, SLOW[name] ?? 0, SLOW[was] ?? 0);
        was = name;
        active?.stop();
        active = clip;
        clip.start(false);
        clip.pause();
        elapsed = 0;
      }
      elapsed += dt;
      const stride = name === "run" ? STRIDE.run : STRIDE.walk;
      phase = (phase + distance / (stride * SIZE) + (k.afloat ? dt * TREAD : 0)) % 1;
      const time = name === "walk" || name === "run" ? phase
        : (elapsed * clip.targetedAnimations[0]!.animation.framePerSecond / (clip.to - clip.from)) % 1;
      clip.goToFrame(clip.from + time * (clip.to - clip.from));
      blend = Math.min(1, blend + dt / ease);
      if (blend < 1) {
        const t = blend * blend * (3 - 2 * blend);
        for (const { node, from, at } of joints) {
          Quaternion.SlerpToRef(from, node.rotationQuaternion!, t, node.rotationQuaternion!);
          Vector3.LerpToRef(at, node.position, t, node.position);
        }
      }
    },
  };
}
