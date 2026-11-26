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

/** Merges finished meshes that never change into one mesh per material, under parent, where they stood in the world.
 *  Each keeps what its sources had: receiveShadows (and so whether it throws them, light.ts), isPickable, layerMask.
 *
 *    const [wood, glass] = mergeStatic([...walls, ...windows], root);   the sources are disposed */
export function mergeStatic(parts: Mesh[], parent: TransformNode): Mesh[] {
  const groups = new Map<string, Mesh[]>();
  for (const part of parts) {
    const key = `${part.material?.uniqueId}/${part.receiveShadows}/${part.isPickable}/${part.layerMask}`;
    groups.set(key, [...(groups.get(key) ?? []), part]);
  }
  return [...groups.values()].map((group) => {
    const { name, receiveShadows, isPickable, layerMask } = group[0]!;
    if (group.length === 1) return group[0]!;
    const mesh = Mesh.MergeMeshes(group, true, true)!; // baked in world space, without a parent
    mesh.name = name;
    mesh.receiveShadows = receiveShadows;
    mesh.isPickable = isPickable;
    mesh.layerMask = layerMask;
    mesh.setParent(parent);
    return mesh;
  });
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
