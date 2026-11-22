// Babylon's own debug tools, only in the dev server (`bun dev`): src/main.ts loads this file behind import.meta.hot,
// which the production bundle (tools/build.ts) leaves out together with everything imported here.
//
//   F4 / ?inspect   the Inspector: scene tree, show and hide, edit materials and lights, bounding boxes, skeletons,
//                   stats, gizmos, and the node, GUI and particle editors it opens.
//   ?inspectable    the scene answers the Inspector CLI (`bunx babylon-inspector --help`), for agents, without the
//                   panels. Only on asking: while no bridge runs, the page logs a failed connection on every retry.
//   F6 / ?fly       a free camera: WASD or arrows move, E up, Q down, drag to look, wheel forward. The beaver stands still.
//   F8              Spector.js: the first press shows its menu, each one after captures a frame: every WebGL call in it.
//
// Its panels are HTML, not Babylon GUI (AGENTS.md): they are tools for us, never shown to players or on the stream.
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import type { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js";
import { ShowInspector, StartInspectable, type InspectorToken } from "@babylonjs/inspector";
import { Spector } from "spectorjs";
import type { Game } from "../../game.ts";

export function attach({ stage, player }: Game) {
  const { scene, camera, canvas } = stage;
  const params = new URLSearchParams(location.search);

  let inspector: InspectorToken | undefined;
  const inspect = () => {
    if (inspector && !inspector.isDisposed) void inspector.dispose();
    else inspector = ShowInspector(scene);
  };

  const fly = new UniversalCamera("fly", camera.position.clone(), scene);
  fly.minZ = camera.minZ;
  fly.maxZ = camera.maxZ;
  fly.fov = camera.fov;
  fly.speed = 0.4;
  fly.keysUp.push(87); // W
  fly.keysDown.push(83); // S
  fly.keysLeft.push(65); // A
  fly.keysRight.push(68); // D
  fly.keysUpward.push(69); // E
  fly.keysDownward.push(81); // Q
  // The game's bloom, colour and vignette (src/features/post/chain.ts) on this camera too; unused while it is inactive.
  (scene.postProcessRenderPipelineManager.supportedPipelines.find((p) => p.name === "picture") as DefaultRenderingPipeline | undefined)?.addCamera(fly);
  const flying = () => scene.activeCamera === fly;
  const toggleFly = () => {
    if (flying()) {
      fly.detachControl();
      scene.activeCamera = camera;
      player.keys.hold([]);
      return;
    }
    fly.position.copyFrom(camera.position);
    fly.setTarget(camera.getTarget());
    scene.activeCamera = fly;
    fly.attachControl(true);
    player.keys.hold(["Flying"]); // a held key the beaver knows nothing of: none of its own count
    canvas.focus();
  };

  let spector: Spector | undefined;
  const capture = () => spector ? spector.captureCanvas(canvas) : (spector = new Spector()).displayUI();

  const keys: Record<string, () => void> = { F4: inspect, F6: toggleFly, F8: capture };
  window.addEventListener("keydown", (e) => {
    const run = keys[e.code];
    if (!run || e.repeat || e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    run();
  });
  if (params.has("inspect")) inspect();
  if (params.has("inspectable")) StartInspectable(scene);
  if (params.has("fly")) scene.onAfterRenderObservable.addOnce(toggleFly); // once the follow camera stands behind the beaver
  Object.assign(window, { devTools: { inspect, fly: toggleFly, capture } });
}
