// Loads assets/props.glb (built by tools/blender/props.py) and hands out the models as templates to clone:
//
//   const props = await loadProps();
//   const tree = props.tree[0]!.clone();   tree.position.set(4, heightAt(4, -3), -3);   scene.add(tree);
//
// Every template already throws and takes shadows; leaves and reeds are alpha-tested on both sides and their holes
// show in the shadows. Clones share geometry and materials with the template, so do not dispose them one by one.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import glb from "../../assets/props.glb" with { type: "file" };
import { PROP_NAMES, type LoadProps, type Props } from "../contracts.ts";

export const loadProps: LoadProps = async () => {
  const gltf = await new GLTFLoader().loadAsync(glb);
  gltf.scene.traverse(fix);
  const props = {} as Props;
  for (const name of PROP_NAMES) {
    props[name] = [];
    for (let n = 1, node; (node = gltf.scene.getObjectByName(`${name}_${n}`)); n++) props[name].push(node.removeFromParent());
    if (!props[name].length) throw new Error(`props.glb has no ${name}_1`);
  }
  return props;
};

const fixed = new WeakSet<THREE.Material>();

function fix(object: THREE.Object3D) {
  if (!(object instanceof THREE.Mesh)) return;
  object.castShadow = object.receiveShadow = true;
  for (const material of [object.material].flat() as THREE.MeshStandardMaterial[]) {
    if (fixed.has(material)) continue;
    fixed.add(material);
    if (material.map) { material.map.colorSpace = THREE.SRGBColorSpace; material.map.anisotropy = 8; }
    if (material.normalMap) { material.normalMap.colorSpace = THREE.NoColorSpace; material.normalMap.anisotropy = 8; }
    if (material.name === "leaves") foliage(material);
  }
}

/** Leaf cards and reed blades: cut out by the texture's alpha, seen from both sides, and lit by the normals the
 *  model carries (out of the crown) on both sides, instead of flipped on the back. The shadow map picks up map and
 *  alphaTest by itself, so the shadow has the leaves' holes. */
function foliage(material: THREE.MeshStandardMaterial) {
  Object.assign(material, { transparent: false, depthWrite: true, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>",
      THREE.ShaderChunk.normal_fragment_begin.replace("normal *= faceDirection;", ""));
  };
  material.customProgramCacheKey = () => "props-foliage";
}
