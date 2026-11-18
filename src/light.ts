import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Stage } from "./engine.ts";

export const SUN_DIRECTION = new Vector3(-0.45, -0.62, -0.5).normalize();
export const EXPOSURE = 0.5, SUN_INTENSITY = 4.2, SUN_COLOR = 0xfff1d6, ENVIRONMENT = 0.35;

const lights = new WeakMap<Scene, ReturnType<typeof daylight>>();
export const daylightOf = (scene: Scene) => lights.get(scene);

export function daylight({ scene }: Stage) {
  const sky = new HemisphericLight("skylight", Vector3.Up(), scene);
  sky.groundColor.set(0.28, 0.31, 0.18);
  const sun = new DirectionalLight("sun", SUN_DIRECTION.clone(), scene);
  sun.shadowMinZ = 0.1;
  sun.shadowMaxZ = 55;
  sun.shadowFrustumSize = 30;
  const shadows = new ShadowGenerator(1024, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.bias = 0.001;
  shadows.normalBias = 0.02;
  shadows.getShadowMap()!.renderList = null;
  shadows.getShadowMap()!.renderListPredicate = mesh => mesh.receiveShadows && mesh.name !== "ground";
  const light = {
    sky, sun, towards: sun.direction,
    follow(focus: Vector3) { sun.position.copyFrom(focus.subtract(sun.direction.scale(25))); },
  };
  lights.set(scene, light);
  return light;
}
