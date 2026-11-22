// The River kit's mesh and clips (assets/kit.glb, tools/blender/kit.py), played by the game's clock: walk and run
// advance by the ground covered, so the feet do not slide; what it does standing runs by time; the shake and the
// waking are played once through. A change of clip blends from the pose it was in. On top of the clip its head
// turns to where the rules have it look. Its coat is the beaver's fur (src/beaver/fur.ts) over the model's own
// colour map.
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo.js";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Scene } from "@babylonjs/core/scene.js";
import kitGlb from "../../../assets/kit.glb" with { type: "file" };
import { createCoat } from "../../beaver/fur.ts";
import { RISE, STIRS, WALK, type Kit } from "./rules.ts";

/** Times the model's own size (0.52 m long): a child beside the metre-tall beaver, not a mouse. */
export const SIZE = 1.35;
// m of ground one loop of the clip covers at the model's own size (kit.py WALK, RUN).
const STRIDE = { walk: 0.277, run: 0.443 };
// s a change of pose takes: down and up again is slow, as long as the rules give it to get up.
const SLOW: Record<string, number> = { forage: 0.6, look: 0.6, ...RISE };
// The clips played once through, from the pose before them to standing (or, the stirs, from sleep back to sleep):
// they carry their own way in and out.
const ONCE = new Set(["shake", "wake", ...Object.keys(STIRS)]);
// Hairs to the grown beaver's one, along and across: the model is drawn SIZE times its size, and a young coat is down.
const FINE = 4;
// Where the fur's copies of the skin lie along the hair: ten, for long guard hairs that do not show the steps between.
const LAYERS = [0, 0.5, 0.25, 0.75, 1, 0.12, 0.37, 0.62, 0.87, 0.44];
const TREAD = 0.7; // strokes a second it treads water with
// rad its jaw drops as it calls, and s its mouth is open for each call (src/features/audio/sounds.ts: squeak, chirp).
const SAY = { open: 0.3, left: 0.45, caught: 0.35 };
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
  // Its glossy eyeballs, hidden while it sleeps: its eyes are shut.
  const eyes = root.getChildMeshes().filter((mesh) => mesh.name.startsWith("eye_"));
  if (eyes.length !== 2) throw new Error("kit.glb is missing its eyes");
  const clips = new Map(asset.animationGroups.map((group) => [group.name, group]));
  // The rules end a stir when its clip has played: they must be as long.
  for (const [name, seconds] of Object.entries(STIRS)) {
    const clip = clips.get(name), fps = clip?.targetedAnimations[0]?.animation.framePerSecond ?? 30;
    if (!clip || Math.abs((clip.to - clip.from) / fps - seconds) > 0.05) throw new Error(`kit.glb's ${name} clip is not the ${seconds} s that rules.ts STIRS says`);
  }
  for (const clip of clips.values()) clip.stop();
  const joints = asset.skeletons[0]!.bones.map((bone) => {
    const node = bone.getTransformNode()!;
    return { node, from: node.rotationQuaternion!.clone(), at: node.position.clone() };
  });
  // Its head, the joints from the kit down to its neck (whose turns the head's own is taken in), and the head as
  // the clip alone has it.
  const skull = joints.find((joint) => joint.node.name === "skull")!.node, neck: TransformNode[] = [];
  for (let node = skull.parent; node && node !== root; node = node.parent) neck.unshift(node as TransformNode);
  const bare = skull.rotationQuaternion!.clone(), carried = new Quaternion(), turn = new Quaternion();
  // Its jaw, opened on top of the clip while it calls, and the joints it is carried on: down to the skull.
  const jaw = joints.find((joint) => joint.node.name === "jaw")!.node, head = [...neck, skull], own = new Quaternion();
  let saying = 0, says = 1;
  let active: AnimationGroup | undefined;
  let phase = 0, elapsed = 0, blend = 1, ease = 0.3, was = "stand", lastX = 0, lastZ = 0;
  return {
    root,
    update(k: Kit, dt: number, x: number, z: number) {
      fur.update();
      fur.coat.wet = k.wet;
      // Shaking itself dry and waking from its sleep come before all else. Afloat it paddles: the walk, its legs
      // under the water, on the spot too.
      const name = k.shaking > 0 ? "shake" : k.waking && k.rising > 0 && k.doing === "stand" ? "wake"
        : k.afloat ? "walk" : k.speed > WALK ? "run" : k.speed > 0 ? "walk" : k.doing === "sleep" && k.stir ? k.stir : k.doing;
      const clip = clips.get(name)!;
      const distance = active ? Math.hypot(x - lastX, z - lastZ) : 0;
      lastX = x; lastZ = z;
      if (active !== clip) {
        skull.rotationQuaternion!.copyFrom(bare); // the pose it was in, without the head's turn: that goes on top again
        for (const joint of joints) {
          joint.from.copyFrom(joint.node.rotationQuaternion!);
          joint.at.copyFrom(joint.node.position);
        }
        blend = active ? 0 : 1;
        ease = ONCE.has(name) ? 0.3 : Math.max(0.3, SLOW[name] ?? 0, SLOW[was] ?? 0);
        was = name;
        active?.stop();
        active = clip;
        clip.start(false);
        clip.pause();
        elapsed = 0;
        for (const eye of eyes) eye.isVisible = name !== "sleep" && !(name in STIRS);
      }
      elapsed += dt;
      const stride = name === "run" ? STRIDE.run : STRIDE.walk;
      phase = (phase + distance / (stride * SIZE) + (k.afloat ? dt * TREAD : 0)) % 1;
      const played = elapsed * clip.targetedAnimations[0]!.animation.framePerSecond / (clip.to - clip.from);
      const time = name === "walk" || name === "run" ? phase : ONCE.has(name) ? Math.min(1, played) : played % 1;
      clip.goToFrame(clip.from + time * (clip.to - clip.from));
      blend = Math.min(1, blend + dt / ease);
      if (blend < 1) {
        const t = blend * blend * (3 - 2 * blend);
        for (const { node, from, at } of joints) {
          Quaternion.SlerpToRef(from, node.rotationQuaternion!, t, node.rotationQuaternion!);
          Vector3.LerpToRef(at, node.position, t, node.position);
        }
      }
      // Its head turned to the beaver, on top of the clip: about the kit's own upright and its own side, whatever
      // way its back and neck are turned in the clip.
      bare.copyFrom(skull.rotationQuaternion!);
      if (Math.abs(k.gaze.yaw) + Math.abs(k.gaze.pitch) > 1e-3) {
        carried.copyFromFloats(0, 0, 0, 1);
        for (const node of neck) carried.multiplyInPlace(node.rotationQuaternion!);
        Quaternion.RotationYawPitchRollToRef(k.gaze.yaw, -k.gaze.pitch, 0, turn);
        carried.conjugateToRef(skull.rotationQuaternion!).multiplyInPlace(turn).multiplyInPlace(carried).multiplyInPlace(bare);
      }
      // Calling, its mouth opens and shuts again, about the kit's own side as the head's turn.
      if (saying > 0) {
        saying = Math.max(0, saying - dt);
        carried.copyFromFloats(0, 0, 0, 1);
        for (const node of head) carried.multiplyInPlace(node.rotationQuaternion!);
        Quaternion.RotationAxisToRef(Vector3.RightReadOnly, SAY.open * Math.sin(Math.PI * (1 - saying / says)), turn);
        own.copyFrom(jaw.rotationQuaternion!);
        carried.conjugateToRef(jaw.rotationQuaternion!).multiplyInPlace(turn).multiplyInPlace(carried).multiplyInPlace(own);
      }
    },
    /** It calls: its mouth opens for as long as the call lasts. */
    say(call: "left" | "caught") { saying = says = SAY[call]; },
  };
}
