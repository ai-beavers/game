import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js";
import { type Camera } from "@babylonjs/core/Cameras/camera.js";
import type { Stage } from "../../engine.ts";
import type { Settings } from "../../settings.ts";

export function createChain({ scene, camera, engine }: Stage) {
  const pipeline = new DefaultRenderingPipeline("picture", true, scene, [camera], false);
  pipeline.bloomWeight = 0.13;
  pipeline.bloomThreshold = 0.92;
  pipeline.bloomKernel = 32;
  pipeline.depthOfField.focalLength = 50;
  pipeline.depthOfField.lensSize = 50;
  let active: Camera = camera, effects: boolean | undefined, quality: Settings["quality"] | undefined;
  return {
    configure(nextQuality: Settings["quality"], enabled: boolean) {
      if (nextQuality === quality && enabled === effects) return;
      quality = nextQuality;
      effects = enabled;
      pipeline.samples = Math.min(engine.getCaps().maxMSAASamples, quality === "high" ? 4 : quality === "medium" ? 2 : 1);
      pipeline.bloomEnabled = enabled && quality !== "low";
      pipeline.fxaaEnabled = enabled && pipeline.samples === 1;
      scene.imageProcessingConfiguration.contrast = enabled ? 1.06 : 1;
      scene.imageProcessingConfiguration.vignetteEnabled = enabled;
      scene.imageProcessingConfiguration.vignetteWeight = 0.8;
      pipeline.prepare();
    },
    camera(next: Camera) {
      if (active === next) return;
      pipeline.removeCamera(active);
      pipeline.addCamera(next);
      active = next;
      pipeline.prepare();
    },
    focus(metres: number, strength: number) {
      pipeline.depthOfField.focusDistance = Math.max(0.1, metres) * 1000;
      pipeline.depthOfField.fStop = 0.65 / Math.max(0.05, strength);
      if (pipeline.depthOfFieldEnabled === (strength > 0)) return;
      pipeline.depthOfFieldEnabled = strength > 0;
      pipeline.prepare();
    },
  };
}
export type Chain = ReturnType<typeof createChain>;
