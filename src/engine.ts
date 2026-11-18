// Starts three.js and Rapier for one canvas. Every page of the game (index.html, lab/*.html) begins here.
//
//   const stage = await start(canvas);          renderer, scene, camera, physics
//   ...build the scene, add Rapier bodies to stage.physics...
//   stage.bind(mesh, body);                     the mesh follows its body from now on
//   run(stage, (dt) => { ...once per physics step, before it; dt is always STEP... },
//              (dt, alpha) => { ...once per frame, before it is drawn... });
//
// World conventions, the same everywhere: right-handed, y up, 1 unit = 1 m, the beaver's forward is +z.
//   stage.paused = true;                        the world stands still, pictures go on
//   stage.draw = () => composer.render();       draw through an effect chain
//   stage.hud.scene.add(mesh);                  on-screen UI, drawn over the picture in CSS pixels (Stage.hud)
// ?debug in the address draws Rapier's colliders as lines.
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

export { RAPIER };
export const STEP = 1 / 60; // the physics step, fixed, so a jump is as high at 30 frames per second as at 120

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** The one camera the picture is drawn through; whoever steers it moves this object. */
  camera: THREE.PerspectiveCamera;
  physics: RAPIER.World;
  /** From now on the object takes its place and turn from the body, every frame. */
  bind(object: THREE.Object3D, body: RAPIER.RigidBody): void;
  unbind(object: THREE.Object3D): void;
  /** True: the world stands still (pause menu). No physics steps and no `fixed` calls; pictures go on. */
  paused: boolean;
  /** How many times faster than real time the world runs: more fixed steps per picture, a longer dt for `frame`
   *  (the tour's test mode). 1: real time. */
  timeScale: number;
  /** Draws one picture. Replace it to draw through an effect chain instead of straight to the screen. */
  draw(): void;
  /** The game's on-screen UI, drawn by the same renderer after every picture, over it, without tone mapping or
   *  effects. The camera counts CSS pixels from the canvas's top left: x to the right, y = -(pixels down), so a
   *  point at CSS (left, top) of the canvas sits at (left, -top). Use materials with toneMapped: false and
   *  depthTest: false; renderOrder decides what lies on top. */
  hud: { scene: THREE.Scene; camera: THREE.OrthographicCamera };
}

export async function start(canvas: HTMLCanvasElement): Promise<Stage> {
  await RAPIER.init();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 400);
  camera.position.set(3, 2, 5);
  camera.lookAt(0, 0.5, 0);
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  physics.timestep = STEP;
  const bound = new Map<THREE.Object3D, RAPIER.RigidBody>();
  const hud = { scene: new THREE.Scene(), camera: new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10) };
  const stage: Stage & { bound: typeof bound } = {
    renderer, scene, camera, physics, bound, hud, paused: false, timeScale: 1,
    draw: () => renderer.render(scene, camera),
    bind: (object, body) => void bound.set(object, body),
    unbind: (object) => void bound.delete(object),
  };
  return stage;
}

/** Steps the physics in fixed steps, then draws. `fixed` runs before each physics step, `frame` before each
 *  picture; alpha is how far the picture is between the last physics step (0) and the next (1).
 *  Marks the page ready for tools/shot.ts after the first frames. */
export function run(stage: Stage, fixed: (dt: number) => void = () => {}, frame: (dt: number, alpha: number) => void = () => {}) {
  const { renderer, scene, camera, physics, hud } = stage, bound = (stage as Stage & { bound: Map<THREE.Object3D, RAPIER.RigidBody> }).bound;
  const lines = new URLSearchParams(location.search).has("debug")
    ? new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false })) : undefined;
  if (lines) { lines.frustumCulled = false; lines.renderOrder = 999; scene.add(lines); }
  let last = performance.now(), owed = 0, frames = 0;
  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000) * stage.timeScale; // a tab that slept does not jump ahead
    last = now;
    const canvas = renderer.domElement, width = canvas.clientWidth, height = canvas.clientHeight;
    if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      Object.assign(hud.camera, { right: width, bottom: -height }).updateProjectionMatrix();
    }
    if (stage.paused) owed = 0;
    else for (owed += dt; owed >= STEP; owed -= STEP) { fixed(STEP); physics.step(); }
    for (const [object, body] of bound) {
      const at = body.translation(), turn = body.rotation();
      object.position.set(at.x, at.y, at.z);
      object.quaternion.set(turn.x, turn.y, turn.z, turn.w);
    }
    if (lines) {
      const { vertices, colors } = physics.debugRender();
      lines.geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
      lines.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    }
    frame(dt, owed / STEP);
    stage.draw();
    if (hud.scene.children.length) { // over the picture, wherever stage.draw drew it from
      renderer.setRenderTarget(null);
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(hud.scene, hud.camera);
      renderer.autoClear = true;
    }
    if (++frames === 5) document.title = "ready";
  });
}
