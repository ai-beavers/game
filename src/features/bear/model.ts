// The action clock belongs to the game. A gait advances by ground distance and a strike lands on the rules' hit frame.
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo.js";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Scene } from "@babylonjs/core/scene.js";
import bearGlb from "../../../assets/bear.glb" with { type: "file" };
import { FLINCH, REAR, type Bear } from "./rules.ts";

const DOWNSWING = 0.20; // first 40% of the half-second strike clip
// s a change of pose takes into and out of what it does between two ambles: down onto its haunches and up again is slow.
const SLOW: Record<string, number> = { sit: 1, forage: 0.7, look: 0.7 };

export async function loadBear(scene: Scene) {
  const asset = await ImportMeshAsync(bearGlb, scene, { pluginExtension: ".glb" });
  const root = asset.meshes[0]!;
  root.name = "bear";
  root.rotationQuaternion = null; // the glTF and the right-handed game both face +Z
  root.setEnabled(false);
  for (const part of root.getChildMeshes()) {
    part.receiveShadows = true;
    part.isPickable = false;
    // The rest bounds on all fours omit the raised paw and the reach of the downswing.
    part.setBoundingInfo(new BoundingInfo(new Vector3(-0.55, -0.05, -1.25), new Vector3(0.55, 3.25, 2.15)));
  }
  const clips = new Map(asset.animationGroups.map(group => [group.name, group]));
  for (const clip of clips.values()) clip.stop();
  const joints = asset.skeletons[0]!.bones.map(bone => {
    const node = bone.getTransformNode()!;
    return { node, from: node.rotationQuaternion!.clone(), at: node.position.clone() };
  });
  const stand = clips.get("stand")!;
  let active: AnimationGroup | undefined;
  let phase = 0, elapsed = 0, blend = 1, ease = 0.34, was = "stand", lastX = 0, lastZ = 0;
  return {
    root,
    hide() { active?.stop(); active = undefined; phase = 0; },
    update(b: Bear, dt: number, x: number, z: number) {
      const strike = b.state === "recover" || (b.state === "rear" && b.time >= REAR - DOWNSWING);
      const name = strike ? "strike" : b.state === "rear" ? "raise" : b.state === "warn" ? "warn"
        : b.state === "flinch" ? "flinch" : b.speed > 1.5 ? "gallop" : b.speed > 0 ? "walk" : b.state === "roam" && b.doing !== "amble" ? b.doing : "stand";
      const clip = clips.get(name)!;
      const distance = active ? Math.hypot(x - lastX, z - lastZ) : 0;
      lastX = x; lastZ = z;
      if (!active) {
        stand.start(false);
        stand.goToFrame(stand.from);
        stand.stop();
      }
      if (active !== clip) {
        for (const joint of joints) {
          joint.from.copyFrom(joint.node.rotationQuaternion!);
          joint.at.copyFrom(joint.node.position);
        }
        blend = 0;
        ease = strike || name === "flinch" ? 0.10 : Math.max(0.34, SLOW[name] ?? 0, SLOW[was] ?? 0);
        was = name;
        active?.stop();
        active = clip;
        clip.start(false);
        clip.pause();
        elapsed = 0;
      }
      elapsed += dt;
      phase = (phase + distance / (name === "gallop" ? 2.4 : 1.5)) % 1;
      let time;
      if (name === "walk" || name === "gallop") time = phase;
      else if (strike) {
        const sinceWindup = b.state === "rear" ? b.time - REAR + DOWNSWING : b.time + DOWNSWING;
        time = Math.min(1, sinceWindup / 0.5);
      } else if (name === "flinch") time = Math.min(1, b.time / FLINCH);
      else time = (elapsed * clip.targetedAnimations[0]!.animation.framePerSecond / (clip.to - clip.from)) % 1;
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
