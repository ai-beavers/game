import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture.js";
import { PhysicsViewer } from "@babylonjs/core/Debug/physicsViewer.js";
import { createPhysics, loadHavok, type PhysicsBody } from "./physics.ts";
import { sendChanges } from "./hud-upload.ts";

export const STEP = 1 / 60;

export async function start(canvas: HTMLCanvasElement) {
  const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true });
  engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, 2));
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.metadata = {};
  const camera = new FreeCamera("follow", new Vector3(3, 2, 5), scene);
  camera.inputs.clear();
  camera.minZ = 0.05;
  camera.maxZ = 400;
  camera.fov = Math.PI / 4;
  camera.setTarget(new Vector3(0, 0.5, 0));
  const physics = createPhysics(scene, await loadHavok());
  const hud = AdvancedDynamicTexture.CreateFullscreenUI("hud", true, scene);
  sendChanges(hud, engine);
  // The loose things (sticks, logs, crates), each a dynamic body on its node, while it lies in the world.
  const bound = new Map<TransformNode, PhysicsBody>();
  const observer = new ResizeObserver(() => engine.resize());
  observer.observe(canvas);
  scene.onDisposeObservable.add(() => observer.disconnect());
  return {
    engine, canvas, scene, camera, physics, bound, hud, paused: false, timeScale: 1,
    draw: () => scene.render(),
    bind(object: TransformNode, body: PhysicsBody) { bound.set(object, body); },
    unbind(object: TransformNode) { bound.delete(object); },
  };
}

export type Stage = Awaited<ReturnType<typeof start>>;

export function run(stage: Stage, fixed: (dt: number) => void, frame: (dt: number, alpha: number) => void) {
  // ?debug: every body's colliders, drawn by Babylon's physics viewer (bodies made later are added as they come).
  const viewer = new URLSearchParams(location.search).has("debug") ? new PhysicsViewer(stage.scene) : undefined;
  const shown = new Set<PhysicsBody>();
  let last = performance.now(), owed = 0, frames = 0;
  stage.engine.runRenderLoop(() => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000) * stage.timeScale;
    last = now;
    if (stage.paused) owed = 0;
    else for (owed += dt; owed >= STEP; owed -= STEP) { fixed(STEP); stage.physics.step(STEP); }
    if (viewer) for (const body of stage.physics.bodies()) if (!shown.has(body)) { shown.add(body); viewer.showBody(body); }
    frame(dt, owed / STEP);
    stage.draw();
    if (++frames === 5) document.title = "ready";
  });
}
