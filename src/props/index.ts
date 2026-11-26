import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Scene } from "@babylonjs/core/scene.js";
import "@babylonjs/loaders/glTF/2.0/glTFLoader.js";
import glb from "../../assets/props.glb" with { type: "file" };
import { PROP_NAMES, type Props } from "../contracts.ts";
import { meshes } from "../world/models.ts";
import { foliageMaterial } from "../world/foliage.ts";
import { giveBushes } from "../world/props.ts";

export async function loadProps(scene: Scene) {
  const asset = await ImportMeshAsync(glb, scene, { pluginExtension: ".glb" });
  const props = {} as Props;
  const take = (name: string, needed = true) => {
    const variants = asset.transformNodes.filter(node => new RegExp(`^${name}_[0-9]+$`).test(node.name))
      .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    if (!variants.length && needed) throw new Error(`Missing prop: ${name}`);
    for (const node of variants) {
      node.parent = null;
      node.setEnabled(false);
      for (const part of meshes(node)) {
        part.receiveShadows = true;
        const mat = part.material;
        if (mat instanceof PBRMaterial && mat.name === "leaves") part.material = foliageMaterial(scene, mat.albedoTexture!); // trees', bushes', reeds'
      }
    }
    return variants;
  };
  for (const name of PROP_NAMES) props[name] = take(name);
  const bushes = take("bush", false); // not a prop of the contract: the world scatters them on the bank
  if (bushes.length) giveBushes(scene, bushes);
  asset.meshes[0]?.dispose();
  return props;
}
