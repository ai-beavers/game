// What the mushrooms look like: per spot a small cluster of three red caps with pale spots on pale stems, built
// from simple shapes, one mesh with vertex colours under a plain daylight-lit material, drawn as one instance per
// spot (one draw call for all).
//
//   const look = buildMushrooms(stage, places);   look.show(i, on): spot i's cluster shown or hidden (eaten)
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import "@babylonjs/core/Meshes/instancedMesh.js";
import type { Stage } from "../../engine.ts";

const CAP = new Color3(0.78, 0.07, 0.04), DOT = new Color3(0.96, 0.92, 0.82), STEM = new Color3(0.9, 0.85, 0.74);
/** Each mushroom of a cluster: where it stands (m from the spot), its cap's diameter and stem's height, m. A little
 *  larger than life, so the caps show over the grass. */
const CLUSTER = [
  { x: 0, z: 0, cap: 0.2, stem: 0.15, tilt: 0.05 },
  { x: 0.13, z: 0.07, cap: 0.14, stem: 0.11, tilt: -0.22 },
  { x: -0.06, z: 0.14, cap: 0.1, stem: 0.08, tilt: 0.3 },
];

const paint = (mesh: Mesh, c: Color3) => {
  const n = mesh.getTotalVertices(), colours = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) colours.set([c.r, c.g, c.b, 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colours);
  return mesh;
};

function buildCluster(stage: Stage) {
  const { scene } = stage, parts: Mesh[] = [];
  CLUSTER.forEach(({ x, z, cap, stem, tilt }, k) => {
    const s = paint(MeshBuilder.CreateCylinder("mushroom-stem", { height: stem, diameterTop: cap * 0.28, diameterBottom: cap * 0.36, tessellation: 7 }, scene), STEM);
    s.position.set(x, stem / 2, z);
    s.rotation.z = tilt;
    parts.push(s);
    // The cap: a flattened half ball on the stem's top, leaning with it.
    const top = { x: x - Math.sin(tilt) * stem, y: Math.cos(tilt) * stem - 0.01 };
    const c = paint(MeshBuilder.CreateSphere("mushroom-cap", { diameter: cap, segments: 8, slice: 0.5 }, scene), CAP);
    c.scaling.y = 0.75;
    c.position.set(top.x, top.y, z);
    c.rotation.z = tilt;
    parts.push(c);
    // Pale spots on the cap: a ring of small flat dots round its shoulder and one near the top.
    const dots = k === 0 ? 6 : 4;
    for (let d = 0; d <= dots; d++) {
      const a = (d / dots) * Math.PI * 2 + k, up = d === dots ? 1.35 : 0.75, r = cap / 2;
      const dot = paint(MeshBuilder.CreateSphere("mushroom-dot", { diameter: cap * 0.2, segments: 3 }, scene), DOT);
      dot.scaling.y = 0.35;
      const lx = d === dots ? 0 : Math.cos(a) * Math.cos(up) * r, lz = d === dots ? 0 : Math.sin(a) * Math.cos(up) * r, ly = Math.sin(up) * r * 0.75;
      // Turned with the cap's lean about z.
      dot.position.set(top.x + lx * Math.cos(tilt) - ly * Math.sin(tilt), top.y + lx * Math.sin(tilt) + ly * Math.cos(tilt), z + lz);
      dot.rotation.set(-Math.atan2(lz, ly) * 0.8, 0, tilt + Math.atan2(lx, ly) * -0.8);
      parts.push(dot);
    }
  });
  const mesh = Mesh.MergeMeshes(parts, true)!;
  mesh.name = "mushrooms";
  const mat = new StandardMaterial("mushrooms", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor.setAll(0.08);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  return mesh;
}

/** One cluster per place, on the ground (y), turned any which way. */
export function buildMushrooms(stage: Stage, places: readonly { x: number; y: number; z: number }[]) {
  const cluster = buildCluster(stage);
  cluster.isVisible = false; // only its instances are drawn
  const shown = places.map((p, i) => {
    const one = cluster.createInstance(`mushrooms-${i}`);
    one.position.set(p.x, p.y - 0.01, p.z);
    one.rotation.y = p.x * 5.1 + p.z * 2.7;
    one.scaling.setAll(0.9 + ((i * 7) % 4) * 0.07);
    one.isPickable = false;
    return one;
  });
  return {
    show(i: number, on: boolean) { shown[i]?.setEnabled(on); },
    shown: (i: number) => !!shown[i]?.isEnabled(),
  };
}
