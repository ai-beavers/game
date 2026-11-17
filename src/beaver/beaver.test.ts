// src/beaver relies on these parts of assets/beaver.glb; tools/blender/build.py must keep exporting them.
// Run: bun test src/beaver
import { expect, test } from "bun:test";
import { BONES } from "../contracts.ts";

test("beaver.glb holds what src/beaver reads", async () => {
  const glb = await Bun.file(`${import.meta.dir}/../../assets/beaver.glb`).arrayBuffer();
  const view = new DataView(glb);
  expect(view.getUint32(0, true)).toBe(0x46546c67); // "glTF"
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, view.getUint32(12, true))));

  // The lab samples these clips into poses until the animator exists.
  expect(gltf.animations.map((a: { name: string }) => a.name).sort()).toEqual(
    ["build", "flex_crab", "flex_double", "flex_lats", "flex_side", "fly", "jump", "pickup", "rage", "stand", "walk"]);
  // Body and shirt both swell with the "muscle" morph target; the body also carries the fur masks as vertex colour.
  const mesh = (name: string) => gltf.meshes[gltf.nodes.find((n: { name: string }) => n.name === name).mesh];
  for (const name of ["body", "shirt"]) {
    expect(mesh(name).extras.targetNames).toEqual(["muscle"]);
    expect(Object.keys(mesh(name).primitives[0].attributes)).toEqual(expect.arrayContaining(["JOINTS_0", "WEIGHTS_0", "NORMAL"]));
  }
  expect(Object.keys(mesh("body").primitives[0].attributes)).toContain("COLOR_0");
  expect(Object.keys(mesh("shirt").primitives[0].attributes)).toContain("TEXCOORD_0");
  expect(gltf.materials.map((m: { name: string }) => m.name)).toEqual(expect.arrayContaining(["fur", "skin", "eye", "tail", "shirt"]));

  // Every bone a Pose can name is in the rig, and nothing else is.
  const bones = gltf.skins[0].joints.map((j: number) => gltf.nodes[j].name);
  expect([...bones].sort()).toEqual([...BONES].sort());
});
