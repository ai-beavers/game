// The workbench as the world shows it: a broad old tree stump in the open, sawn off flat, bark round its sides, roots
// spreading into the grass, and a cut top of pale wood with its growth rings, where the beaver lays out its goods. A
// coil of string lies on the far side of the top, a hint at what is done there. Merged per material (a few draw
// calls); one collider, a cylinder. place.ts says where it stands.
//
//   const bench = createBench(stage, world);
//   bench.spot(side)    a world point on the top: -1 left, 0 middle, 1 right (of a beaver facing it)
//   bench.yaw           the way the bench is turned, radians about y
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { World } from "../../contracts.ts";
import type { Stage } from "../../engine.ts";
import { cylinder } from "../../physics.ts";
import { material } from "../../world/models.ts";
import { ALONG, BENCH, FRONT } from "./place.ts";

export function createBench(stage: Stage, world: World) {
  const { scene, physics } = stage;
  const ground = world.heightAt(BENCH.x, BENCH.z);
  const root = new TransformNode("workbench", scene);
  root.position.set(BENCH.x, ground - 0.03, BENCH.z);
  root.rotation.y = Math.atan2(FRONT.x, FRONT.z); // local +z to the working side, +x to the right of a beaver at it
  const groups = new Map<StandardMaterial, Mesh[]>();
  const part = (mat: StandardMaterial, mesh: Mesh, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    groups.set(mat, [...(groups.get(mat) ?? []), mesh]);
    return mesh;
  };
  const bark = material(scene, "workbench bark", 0x5e3d24), barkDark = material(scene, "workbench bark dark", 0x46301e);
  const cut = material(scene, "workbench top", 0xd2a874), ring = material(scene, "workbench ring", 0xa77a4a);
  const string = material(scene, "workbench string", 0x9b6b3c);
  const R = BENCH.radius, H = BENCH.top + 0.03;

  // ---- the stump: a little wider at its foot, ridged bark, roots out into the grass --------------------------------
  part(bark, MeshBuilder.CreateCylinder("stump", { diameterTop: 2 * R, diameterBottom: 2 * R + 0.12, height: H, tessellation: 18 }, scene), 0, H / 2, 0);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.3;
    part(barkDark, MeshBuilder.CreateBox("bark ridge", { width: 0.05, height: H * (0.75 + (k % 3) * 0.1), depth: 0.03 }, scene),
      Math.sin(a) * (R + 0.02), H * 0.42, Math.cos(a) * (R + 0.02), 0, a, 0);
  }
  for (const [a, long] of [[0.5, 0.36], [1.9, 0.3], [3.1, 0.4], [4.4, 0.28], [5.5, 0.34]] as const) {
    const spur = part(bark, MeshBuilder.CreateCylinder("root", { diameterTop: 0.05, diameterBottom: 0.15, height: long, tessellation: 7 }, scene),
      Math.sin(a) * (R + long * 0.32), 0.05, Math.cos(a) * (R + long * 0.32), 0, a, 0);
    spur.rotation.set(Math.PI / 2 - 0.35, a, 0); // lying out from the stump, sinking into the ground
  }
  // ---- the sawn top: pale wood, its rings, a split from the edge ------------------------------------------------------
  part(cut, MeshBuilder.CreateCylinder("top", { diameter: 2 * R - 0.02, height: 0.012, tessellation: 24 }, scene), 0, H + 0.006, 0);
  for (const r of [0.08, 0.16, 0.24, 0.3])
    part(ring, MeshBuilder.CreateTorus("ring", { diameter: 2 * r, thickness: 0.007, tessellation: 28 }, scene), 0.01, H + 0.011, -0.01);
  part(ring, MeshBuilder.CreateBox("split", { width: 0.012, height: 0.004, depth: 0.14 }, scene), -0.18, H + 0.013, -0.2, 0, 0.5, 0);
  // ---- a coil of string at the back of the top ------------------------------------------------------------------------
  for (const [k, r] of [[0, 0.045], [1, 0.037]] as const)
    part(string, MeshBuilder.CreateTorus("coil", { diameter: 2 * r, thickness: 0.012, tessellation: 16 }, scene), 0.16, H + 0.018 + k * 0.012, -0.16);

  for (const [mat, list] of groups) {
    const merged = Mesh.MergeMeshes(list, true, true)!;
    merged.name = `workbench ${mat.name}`;
    merged.material = mat;
    merged.parent = root;
    merged.receiveShadows = true; // and so throws them (light.ts)
    merged.isPickable = false;
  }
  physics.fixed(cylinder(scene, H / 2, R + 0.04, { x: BENCH.x, y: ground + H / 2 - 0.03, z: BENCH.z }), undefined, 0.9);

  const top = ground - 0.03 + H + 0.012;
  return {
    root,
    /** A point on the top, to the left (-1), the middle (0) or the right (1) of a beaver at its working side. */
    spot(side: number) {
      return new Vector3(BENCH.x + ALONG.x * side * 0.14 + FRONT.x * 0.1, top, BENCH.z + ALONG.z * side * 0.14 + FRONT.z * 0.1);
    },
    yaw: root.rotation.y,
  };
}
export type Bench = ReturnType<typeof createBench>;
