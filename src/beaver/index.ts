// The beaver: loads assets/beaver.glb (built by tools/blender/build.py), lays fur over its body (fur.ts), prints its
// shirt and takes poses. It has no clock of its own: an animator hands it a Pose every frame.
//
//   const beaver = await loadBeaver();   scene.add(beaver.root);
//   beaver.pose(animator.pose(motion, dt));
//   beaver.update(dt);                   once per frame, after pose()
//   beaver.anger = 0.7;                  0 calm … 1 furious: redder, a bodybuilder's muscles, glowing eyes
//   beaver.shirt = false;                without the T-shirt: fur all over
//   beaver.hand                          the right hand's bone, to put a stick into
//
// The root is 1 m tall, stands on y = 0 and faces +z. It throws one shadow: the fur's shells are dropped to one (the
// skin) while the shadow map is drawn, so the shadow pass costs one ordinary draw of the body.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import beaverGlb from "../../assets/beaver.glb" with { type: "file" };
import logoPng from "../../assets/logo.png" with { type: "file" };
import { BONES, type Beaver, type LoadBeaver, type Pose } from "../contracts.ts";
import { furMaterial, furUniforms, SHEEN, SHEEN_RED } from "./fur.ts";

export const SHELLS = [24, 128] as const; // fewest and most fur shells
const SKIN_RED = new THREE.Color(0.16, 0.01, 0.008);

// The shirt's print: the logo on the chest of a white T-shirt with ribbed collar and hem.
async function shirtTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  const paint = canvas.getContext("2d")!;
  paint.fillStyle = "#ecece8";
  paint.fillRect(0, 0, 1024, 1024);
  paint.fillStyle = "rgba(0, 0, 0, 0.035)"; // the weave
  for (let y = 0; y < 1024; y += 4) paint.fillRect(0, y, 1024, 2);
  paint.fillStyle = "rgba(0, 0, 0, 0.1)";
  for (let x = 0; x < 1024; x += 10) { paint.fillRect(x, 0, 4, 60); paint.fillRect(x, 990, 4, 34); } // ribbing
  const logo = new Image();
  logo.src = logoPng;
  await logo.decode().then(() => {
    const width = 520, height = width * logo.height / logo.width;
    paint.filter = "invert(1)"; // the logo file is white
    paint.drawImage(logo, 512 - width / 2, 275 - height / 2, width, height);
  }, () => {
    paint.fillStyle = "#101114";
    paint.font = '800 120px "Helvetica Neue", Arial, sans-serif';
    paint.textAlign = "center";
    paint.fillText("BEAVER", 512, 310);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false; // glTF texture coordinates start at the top
  texture.anisotropy = 4;
  return texture;
}

export const loadBeaver: LoadBeaver = async () => {
  const [gltf, print] = await Promise.all([new GLTFLoader().loadAsync(beaverGlb), shirtTexture()]);
  const root = gltf.scene, uniforms = furUniforms();
  const body = root.getObjectByName("body") as THREE.SkinnedMesh, shirt = root.getObjectByName("shirt") as THREE.SkinnedMesh;
  root.traverse((part) => { part.castShadow = part.receiveShadow = true; });

  const shells = new THREE.InstancedBufferGeometry().copy(body.geometry as unknown as THREE.InstancedBufferGeometry);
  shells.setAttribute("furMask", shells.getAttribute("color"));
  shells.deleteAttribute("color");
  body.geometry = shells;
  const fur = body.material = furMaterial(uniforms);
  body.frustumCulled = shirt.frustumCulled = false; // the shells and the poses leave the rest pose's bounds
  // A strand is about 2.6 pixels wide at any size on screen: finer than that it shimmers and shows moiré rings.
  // As many shells as it takes to put them half a pixel apart, so no layers show close up.
  const here = new THREE.Vector3(), eyeAt = new THREE.Vector3();
  body.onBeforeRender = (renderer, _scene, camera) => {
    const height = renderer.getRenderTarget()?.height ?? renderer.domElement.height;
    const span = (camera as THREE.OrthographicCamera).isOrthographicCamera
      ? (camera as THREE.OrthographicCamera).top - (camera as THREE.OrthographicCamera).bottom
      : 2 * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov) / 2) * camera.getWorldPosition(eyeAt).distanceTo(root.getWorldPosition(here));
    const pixelsPerUnit = height * (camera as THREE.PerspectiveCamera).zoom / span * root.matrixWorld.getMaxScaleOnAxis();
    uniforms.furDensity.value = Math.min(700, pixelsPerUnit / 2.6);
    shells.instanceCount = uniforms.furShells.value = THREE.MathUtils.clamp(Math.ceil(uniforms.furLength.value * pixelsPerUnit / 0.5), ...SHELLS);
  };
  // The shadow map gets the skin alone; the next onBeforeRender sets the shells back.
  body.onBeforeShadow = () => { shells.instanceCount = 1; };
  body.onAfterShadow = () => { shells.instanceCount = uniforms.furShells.value; };

  const shirtMaterial = shirt.material as THREE.MeshStandardMaterial;
  shirtMaterial.map = print;
  shirtMaterial.color.setScalar(0.8); // white cotton in full sun reads white, not a blown-out patch
  shirtMaterial.roughness = 0.85;
  const material = (name: string) => {
    let found: THREE.MeshStandardMaterial | undefined;
    root.traverse((part) => { const m = (part as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.name === name) found = m; });
    if (!found) throw new Error(`beaver.glb has no material "${name}"`);
    return found;
  };
  const skin = material("skin"), eye = material("eye"), skinCalm = skin.color.clone();
  eye.emissive.set(1, 0.03, 0);

  // Rest values of every bone, as loaded: what a bone left out of a pose returns to.
  const bones = BONES.map((name) => {
    const bone = root.getObjectByName(name);
    if (!bone) throw new Error(`beaver.glb has no bone "${name}"`);
    return { name, bone, position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() };
  });

  let anger = 0;
  function look() {
    body.morphTargetInfluences![0] = shirt.morphTargetInfluences![0] = anger;
    uniforms.anger.value = anger;
    skin.color.copy(skinCalm).lerp(SKIN_RED, anger);
    fur.sheenColor.copy(SHEEN).lerp(SHEEN_RED, anger);
    eye.emissiveIntensity = 3 * Math.max(0, anger - 0.5) ** 2;
  }
  look();

  const beaver: Beaver = {
    root,
    hand: root.getObjectByName("hand_R")!,
    get anger() { return anger; },
    set anger(value) { anger = THREE.MathUtils.clamp(value, 0, 1); look(); },
    get shirt() { return shirt.visible; },
    set shirt(on) { shirt.visible = on; uniforms.dressed.value = on ? 1 : 0; }, // off: the animal as it is, fur all over
    pose(pose: Pose) {
      for (const { name, bone, position, quaternion, scale } of bones) {
        const given = pose[name];
        if (given) bone.quaternion.fromArray(given.rotation);
        else bone.quaternion.copy(quaternion);
        if (given?.translation) bone.position.fromArray(given.translation);
        else bone.position.copy(position);
        if (given?.scale !== undefined) bone.scale.setScalar(given.scale);
        else bone.scale.copy(scale);
      }
    },
    // Fur density and shell count follow the size on screen by themselves (body.onBeforeRender); nothing else moves.
    update() {},
  };
  return beaver;
};
