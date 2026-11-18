import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Scene } from "@babylonjs/core/scene.js";
import "@babylonjs/loaders/glTF/2.0/glTFLoader.js";
import glb from "../../assets/props.glb" with { type: "file" };
import { PROP_NAMES, type Props } from "../contracts.ts";
import { meshes } from "../world/models.ts";

export async function loadProps(scene: Scene) {
  const asset = await ImportMeshAsync(glb, scene, { pluginExtension: ".glb" });
  const props = {} as Props;
  for (const name of PROP_NAMES) {
    const variants = asset.transformNodes.filter(node => new RegExp(`^${name}_[0-9]+$`).test(node.name))
      .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    if (!variants.length) throw new Error(`Missing prop: ${name}`);
    for (const node of variants) {
      node.parent = null;
      node.setEnabled(false);
      for (const part of meshes(node)) {
        part.receiveShadows = true;
        const mat = part.material;
        if (mat instanceof PBRMaterial && mat.name === "leaves") {
          mat.backFaceCulling = false;
          mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
          mat.useAlphaFromAlbedoTexture = true;
        }
      }
    }
    props[name] = variants;
  }
  asset.meshes[0]?.dispose();
  return props;
}
