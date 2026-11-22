import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js";
import { type Camera } from "@babylonjs/core/Cameras/camera.js";
import type { Stage } from "../../engine.ts";
import type { Settings } from "../../settings.ts";

export function createChain({ scene, camera, engine, hud }: Stage) {
  const pipeline = new DefaultRenderingPipeline("picture", true, scene, [camera], false);
  if (hud.layer) hud.layer.applyPostProcess = false; // the HUD stays as drawn: no night exposure, bloom or vignette on it
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
    /** dark, 0 by day … 1 at night: the moon and the fireflies glow more, the way points of light do in the dark.
     *  golden, 0 … 1: the low sun's glare spills over what stands in front of it. */
    glow(dark: number, golden: number) {
      pipeline.bloomWeight = 0.13 + 0.4 * dark + 0.125 * golden;
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
