import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { Props } from "../contracts.ts";
import { seeded } from "./noise.ts";
import { material } from "./models.ts";

const given = new WeakMap<Scene, TransformNode[]>();
/** src/props hands over the bushes of assets/props.glb; with stand-in props they are drawn here. */
export const giveBushes = (scene: Scene, nodes: TransformNode[]) => given.set(scene, nodes);

export function bushes(scene: Scene) {
  return given.get(scene) ?? standInBushes(scene);
}

function standInBushes(scene: Scene) {
  const green = material(scene, "leaves", 0x526e34);
  green.backFaceCulling = false;
  return [9, 15, 22].map(seed => {
    const random = seeded(seed), root = new TransformNode("bush", scene);
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    for (let i = 0; i < 220; i++) {
      const angle = random() * Math.PI * 2, height = random();
      const radius = (0.25 + 0.8 * Math.sqrt(random())) * Math.sqrt(1 - height * height);
      const base = new Vector3(Math.cos(angle) * radius, height * 1.28, Math.sin(angle) * radius);
      const width = 0.05 + random() * 0.07;
      const side = new Vector3(-Math.sin(angle) * width, 0, Math.cos(angle) * width);
      const stem = new Vector3(Math.cos(angle) * width, 0.055, Math.sin(angle) * width);
      const mid = base.add(stem), tip = mid.add(stem.scale(1.6));
      tip.y -= 0.04 + random() * 0.13;
      const shade = 0.62 + height * 0.18 + random() * 0.32, k = positions.length / 3;
      for (const point of [base, mid.subtract(side), tip, mid.add(side)]) {
        positions.push(point.x, point.y, point.z);
        colors.push(shade, shade, shade * 0.9, 1);
      }
      indices.push(k, k+2, k+1, k, k+3, k+2);
    }
    const foliage = new Mesh("foliage", scene), data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.colors = colors;
    data.normals = [];
    VertexData.ComputeNormals(positions, indices, data.normals);
    data.applyToMesh(foliage);
    foliage.material = green;
    foliage.parent = root;
    root.setEnabled(false);
    return root;
  });
}

export function standInProps(scene: Scene): Props {
  const wood = material(scene, "wood", 0x795036);
  function cylinder(name: string, radius: number, height: number, horizontal = false) {
    const root = new TransformNode(name, scene);
    const part = MeshBuilder.CreateCylinder(name, { diameter: radius * 2, height, tessellation: 10 }, scene);
    part.material = wood;
    part.parent = root;
    part.rotation.x = horizontal ? Math.PI / 2 : 0;
    part.position.y = horizontal ? radius : height / 2;
    root.setEnabled(false);
    return root;
  }
  const tree = cylinder("tree", 0.32, 4);
  const crown = standInBushes(scene)[0]!;
  crown.parent = tree;
  crown.setEnabled(true);
  crown.scaling.setAll(2);
  crown.position.y = 2.9;
  const box = MeshBuilder.CreateBox("crate", { size: 0.5 }, scene);
  box.material = wood;
  box.setEnabled(false);
  const rock = MeshBuilder.CreateIcoSphere("rock", { radius: 0.5, subdivisions: 1 }, scene);
  rock.material = material(scene, "stone", 0x76786f);
  rock.setEnabled(false);
  const reed = cylinder("reed", 0.025, 0.8);
  reed.getChildMeshes()[0]!.material = material(scene, "reed", 0x83904e);
  return { tree: [tree], stump: [cylinder("stump", 0.24, 0.42)], log: [cylinder("log", 0.18, 2.2, true)],
    stick: [cylinder("stick", 0.025, 0.65, true)], rock: [rock], crate: [box], reed: [reed] };
}
