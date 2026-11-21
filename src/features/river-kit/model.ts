// The River kit's mesh and clips (assets/kit.glb, tools/blender/kit.py), played by the game's clock: walk and run
// advance by the ground covered, so the feet do not slide; what it does standing runs by time. A change of clip
// blends from the pose it was in.
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo.js";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Scene } from "@babylonjs/core/scene.js";
import kitGlb from "../../../assets/kit.glb" with { type: "file" };
import { WALK, type Kit } from "./rules.ts";

/** Times the model's own size (0.58 m long): a child beside the metre-tall beaver, not a mouse. */
export const SIZE = 1.6;
// m of ground one loop of the clip covers at the model's own size (kit.py WALK, RUN).
const STRIDE = { walk: 0.253, run: 0.404 };
// s a change of pose takes: down onto its haunches and up again is slow.
const SLOW: Record<string, number> = { sit: 0.8, forage: 0.6, look: 0.6 };

export async function loadKit(scene: Scene) {
  const asset = await ImportMeshAsync(kitGlb, scene, { pluginExtension: ".glb" });
  const root = asset.meshes[0]!;
  root.name = "river-kit";
  root.rotationQuaternion = null; // the glTF and the right-handed game both face +Z
  root.scaling.setAll(SIZE);
  for (const part of root.getChildMeshes()) {
    part.receiveShadows = true;
    part.isPickable = false;
    part.setBoundingInfo(new BoundingInfo(new Vector3(-0.15, -0.02, -0.35), new Vector3(0.15, 0.35, 0.35))); // sitting up, it is taller than at rest
  }
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
    update(k: Kit, dt: number, x: number, z: number) {
      const name = k.speed > WALK ? "run" : k.speed > 0 ? "walk" : k.doing;
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
      phase = (phase + distance / (stride * SIZE)) % 1;
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
