import { hex as colorFromHex } from "./color.ts";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Scene } from "@babylonjs/core/scene.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";

export function material(scene: Scene, name: string, hex: number) {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = colorFromHex(hex);
  mat.specularColor.setAll(0.08);
  return mat;
}

export function meshes(root: TransformNode): Mesh[] {
  return [root, ...root.getChildMeshes()].filter((part): part is Mesh => part instanceof Mesh && part.getTotalVertices() > 0);
}

export function instance(template: TransformNode, name: string, parent: TransformNode | null = null) {
  const root = new TransformNode(name, template.getScene());
  root.parent = parent;
  for (const part of meshes(template)) {
    const copy = part.createInstance(part.name);
    copy.parent = root;
    copy.rotationQuaternion = Quaternion.Identity();
    part.computeWorldMatrix(true).decompose(copy.scaling, copy.rotationQuaternion, copy.position);
    part.receiveShadows = true;
  }
  return root;
}

export function vertices(template: TransformNode, leaves?: boolean) {
  const result: Vector3[] = [];
  for (const part of meshes(template)) {
    if (leaves !== undefined && (part.material?.name === "leaves") !== leaves) continue;
    const local = part.computeWorldMatrix(true), positions = part.getVerticesData("position")!;
    for (let i = 0; i < positions.length; i += 3) result.push(Vector3.TransformCoordinates(Vector3.FromArray(positions, i), local));
  }
  return result;
}

export function bounds(template: TransformNode, transform = Matrix.Identity()) {
  const min = new Vector3(Infinity, Infinity, Infinity), max = min.negate();
  for (const p of vertices(template)) {
    const at = Vector3.TransformCoordinates(p, transform);
    min.minimizeInPlace(at);
    max.maximizeInPlace(at);
  }
  return { min, max, size: max.subtract(min), center: min.add(max).scale(0.5) };
}
