// A physics world for tests, on a scene with no canvas (Babylon's NullEngine): Havok runs in bun as in the browser.
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createPhysics, loadHavok } from "./physics.ts";

export async function headless() {
  const scene = new Scene(new NullEngine());
  return { scene, physics: createPhysics(scene, await loadHavok()) };
}
