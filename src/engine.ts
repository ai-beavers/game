import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { LinesMesh } from "@babylonjs/core/Meshes/linesMesh.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture.js";
import RAPIER from "@dimforge/rapier3d-compat";

export { RAPIER };
export const STEP = 1 / 60;

export async function start(canvas: HTMLCanvasElement) {
  await RAPIER.init();
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
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  physics.timestep = STEP;
  const hud = AdvancedDynamicTexture.CreateFullscreenUI("hud", true, scene);
  const bound = new Map<TransformNode, RAPIER.RigidBody>();
  const observer = new ResizeObserver(() => engine.resize());
  observer.observe(canvas);
  scene.onDisposeObservable.add(() => { observer.disconnect(); physics.free(); });
  return {
    engine, canvas, scene, camera, physics, bound, hud, paused: false, timeScale: 1,
    draw: () => scene.render(),
    bind(object: TransformNode, body: RAPIER.RigidBody) {
      object.rotationQuaternion ??= Quaternion.Identity();
      bound.set(object, body);
    },
    unbind(object: TransformNode) { bound.delete(object); },
  };
}

export type Stage = Awaited<ReturnType<typeof start>>;

export function run(stage: Stage, fixed: (dt: number) => void, frame: (dt: number, alpha: number) => void) {
  const lines = new URLSearchParams(location.search).has("debug")
    ? new LinesMesh("colliders", stage.scene, null, null, false, true, true) : undefined;
  if (lines) {
    lines.isUnIndexed = true;
    lines.isPickable = false;
    lines.alwaysSelectAsActiveMesh = true;
    lines.renderingGroupId = 2;
    lines.material!.depthFunction = Constants.ALWAYS;
    lines.material!.disableDepthWrite = true;
  }
  let last = performance.now(), owed = 0, frames = 0;
  stage.engine.runRenderLoop(() => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000) * stage.timeScale;
    last = now;
    if (stage.paused) owed = 0;
    else for (owed += dt; owed >= STEP; owed -= STEP) { fixed(STEP); stage.physics.step(); }
    for (const [object, body] of stage.bound) {
      const p = body.translation(), q = body.rotation();
      object.position.set(p.x, p.y, p.z);
      object.rotationQuaternion!.set(q.x, q.y, q.z, q.w);
    }
    if (lines) {
      const { vertices, colors } = stage.physics.debugRender(), count = vertices.length / 3;
      lines.setEnabled(count > 0);
      if (count > lines.getTotalVertices()) {
        const capacity = 2 ** Math.ceil(Math.log2(count));
        lines.setVerticesData("position", new Float32Array(capacity * 3), true, 3);
        lines.setVerticesData("color", new Float32Array(capacity * 4), true, 4);
        lines.setIndices([]);
      }
      if (count) {
        lines.geometry!.updateVerticesDataDirectly("position", vertices, 0);
        lines.geometry!.updateVerticesDataDirectly("color", colors, 0);
        lines.subMeshes[0]!.verticesCount = count;
      }
    }
    frame(dt, owed / STEP);
    stage.draw();
    if (++frames === 5) document.title = "ready";
  });
}
