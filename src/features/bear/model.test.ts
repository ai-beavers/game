import { expect, test } from "bun:test";
import { parseGlb } from "../../anim/glb.ts";

test("bear.glb carries the bear's actions, joints, painted skin and metre scale", async () => {
  const bytes = await Bun.file(new URL("../../../assets/bear.glb", import.meta.url)).bytes();
  const { json } = parseGlb(bytes);
  expect(bytes.length).toBeLessThan(1_000_000);
  expect(json.animations.map((a: { name: string }) => a.name).sort()).toEqual(
    ["flinch", "forage", "gallop", "look", "raise", "sit", "stand", "strike", "walk", "warn"]);
  expect(json.extensionsRequired).toEqual(expect.arrayContaining(["EXT_texture_webp", "KHR_mesh_quantization"]));
  const joints = json.skins[0].joints.map((i: number) => json.nodes[i].name);
  expect(joints.sort()).toEqual(["haunch", "back", "skull", "jaw",
    ...["L", "R"].flatMap(side => ["arm", "forearm", "paw", "thigh", "shin", "foot"].map(bone => bone + "_" + side))].sort());
  const { attributes } = json.meshes[0].primitives[0];
  expect(Object.keys(attributes)).toEqual(expect.arrayContaining(["COLOR_0", "NORMAL", "TEXCOORD_0", "WEIGHTS_0", "JOINTS_0"]));
  const { min, max } = json.accessors[attributes.POSITION];
  expect(max[0] - min[0]).toBeCloseTo(1, 1); // 0.5 m capsule radius
  expect(min[1]).toBeCloseTo(0, 2);
  expect(max[1]).toBeGreaterThan(1.3);
  expect(max[1]).toBeLessThan(1.5);
  expect(max[2] - min[2]).toBeLessThan(2.8);
});
