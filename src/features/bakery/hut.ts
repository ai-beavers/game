// The bakery as the world shows it: a small timber hut open to the front under a shingled gable roof, a BAKERY board
// over its opening, and inside against the back wall a stone oven (a dome on a plinth) with a chimney rising through
// the roof. The fire bed in the oven's mouth glows as much as glow(level) says; a plank ledge before the mouth is
// where a baked loaf slides out to. Static parts are merged per material (a handful of draw calls); colliders for the
// walls, the posts and the oven. place.ts says where it stands.
//
//   const hut = createHut(stage, world);
//   hut.fire · hut.chimney · hut.inside · hut.ledge     world points: the fire bed, the chimney's top, a loaf in the
//                                                       oven, a loaf slid out onto the ledge
//   hut.glow(level)                                     0 … 1.5: the fire bed's glow (0 dark, 1 a full oven, above: a flare)
//   hut.meshes                                          what the oven's light may reach
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { World } from "../../contracts.ts";
import type { Stage } from "../../engine.ts";
import { box } from "../../physics.ts";
import { material } from "../../world/models.ts";
import { FRONT, HUT, OVEN } from "./place.ts";

const PLINTH = 0.3; // m: the oven's stone plinth, the floor of its fire
const ROOF = 0.55; // m the ridge stands above the walls
const EMBER = new Color3(1, 0.42, 0.12);

export function createHut(stage: Stage, world: World) {
  const { scene, physics } = stage;
  const ground = world.heightAt(HUT.x, HUT.z);
  const root = new TransformNode("bakery", scene);
  root.position.set(HUT.x, ground - 0.02, HUT.z);
  root.rotation.y = Math.atan2(FRONT.x, FRONT.z); // local +z to the front, +x across it to the right of a beaver facing it
  const turn = Quaternion.RotationAxis(Vector3.Up(), root.rotation.y);
  const groups = new Map<StandardMaterial, Mesh[]>();
  const part = (mat: StandardMaterial, mesh: Mesh, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    groups.set(mat, [...(groups.get(mat) ?? []), mesh]);
    return mesh;
  };
  const solid = (hx: number, hy: number, hz: number, x: number, y: number, z: number) => {
    const at = Vector3.TransformCoordinates(new Vector3(x, y, z), root.computeWorldMatrix(true));
    physics.fixed(box(scene, hx, hy, hz, at, turn), undefined, 0.9);
  };
  const wood = material(scene, "bakery wood", 0x8a5a33), dark = material(scene, "bakery beam", 0x4a2f1a);
  const shingle = material(scene, "bakery roof", 0x7b3b2a), stone = material(scene, "bakery stone", 0x9a948c);
  const stoneDark = material(scene, "bakery stone dark", 0x6e6962), soot = material(scene, "bakery soot", 0x1c1612);
  const plank = material(scene, "bakery plank", 0xb07a48);
  const W = HUT.width / 2, D = HUT.depth / 2, T = 0.07; // half width, half depth, wall thickness

  // ---- the hut: three walls, posts and a beam framing the open front, a gable roof ----------------------------------
  part(wood, MeshBuilder.CreateBox("back wall", { width: HUT.width, height: HUT.wall, depth: T }, scene), 0, HUT.wall / 2, -D + T / 2);
  solid(W, HUT.wall / 2, T / 2, 0, HUT.wall / 2, -D + T / 2);
  for (const s of [-1, 1]) {
    part(wood, MeshBuilder.CreateBox("side wall", { width: T, height: HUT.wall, depth: HUT.depth }, scene), s * (W - T / 2), HUT.wall / 2, 0);
    solid(T / 2, HUT.wall / 2, D, s * (W - T / 2), HUT.wall / 2, 0);
    // A short stretch of front wall each side, so the opening frames the oven.
    part(wood, MeshBuilder.CreateBox("front wall", { width: 0.28, height: HUT.wall, depth: T }, scene), s * (W - 0.14), HUT.wall / 2, D - T / 2);
    solid(0.14, HUT.wall / 2, T / 2, s * (W - 0.14), HUT.wall / 2, D - T / 2);
    for (const z of [-D, D]) part(dark, MeshBuilder.CreateBox("post", { width: 0.1, height: HUT.wall + 0.02, depth: 0.1 }, scene), s * W, HUT.wall / 2, z);
    // Planks: dark seams across the walls.
    for (let y = 0.3; y < HUT.wall; y += 0.3) part(dark, MeshBuilder.CreateBox("seam", { width: 0.012, height: 0.02, depth: HUT.depth }, scene), s * (W + 0.002), y, 0);
  }
  part(dark, MeshBuilder.CreateBox("lintel", { width: HUT.width + 0.04, height: 0.12, depth: 0.1 }, scene), 0, HUT.wall - 0.06, D);
  part(dark, MeshBuilder.CreateBox("eave", { width: HUT.width + 0.04, height: 0.08, depth: 0.1 }, scene), 0, HUT.wall - 0.04, -D);
  // The gables: a triangle of wood at each side under the roof, facing out both ways.
  const gables = new Mesh("gables", scene), positions: number[] = [], normals: number[] = [];
  for (const s of [-1, 1]) for (const out of [-1, 1]) {
    const x = s * (W - 0.01), tri = [[x, HUT.wall, -D], [x, HUT.wall, D], [x, HUT.wall + ROOF, 0]];
    for (const p of out > 0 ? tri : [...tri].reverse()) { positions.push(...p); normals.push(0, 0, 0); }
  }
  const data = new VertexData();
  data.positions = positions; data.normals = normals; data.uvs = positions.flatMap((_, i) => i % 3 ? [] : [0, 0]); data.indices = Array.from({ length: positions.length / 3 }, (_, i) => i);
  data.applyToMesh(gables);
  VertexData.ComputeNormals(positions, data.indices, normals);
  gables.setVerticesData("normal", normals);
  part(wood, gables, 0, 0, 0);
  const slope = Math.atan2(ROOF, D), slab = Math.hypot(ROOF, D) + 0.22;
  for (const s of [-1, 1]) {
    const mid = { y: HUT.wall + ROOF / 2 + 0.03, z: s * D / 2 };
    part(shingle, MeshBuilder.CreateBox("roof", { width: HUT.width + 0.3, height: 0.07, depth: slab }, scene), 0, mid.y, mid.z, s * slope);
    // Rows of shingles: thin dark lines across the slab, down from the ridge.
    for (const t of [-0.25, 0, 0.25]) part(dark, MeshBuilder.CreateBox("shingle row", { width: HUT.width + 0.3, height: 0.02, depth: 0.03 }, scene),
      0, mid.y - t * slab * Math.sin(slope) + 0.035 * Math.cos(slope), mid.z + s * (t * slab * Math.cos(slope) + 0.035 * Math.sin(slope)), s * slope);
  }
  part(dark, MeshBuilder.CreateBox("ridge", { width: HUT.width + 0.32, height: 0.07, depth: 0.09 }, scene), 0, HUT.wall + ROOF + 0.05, 0);

  // ---- the oven: a stone dome on a plinth, a dark arched mouth to the front, a chimney through the roof ------------
  const oz = OVEN.back, r = OVEN.radius;
  part(stone, MeshBuilder.CreateBox("plinth", { width: 2 * r + 0.2, height: PLINTH, depth: 2 * r + 0.1 }, scene), 0, PLINTH / 2, oz);
  part(stone, MeshBuilder.CreateSphere("dome", { diameter: 2 * r, segments: 14, slice: 0.5 }, scene), 0, PLINTH, oz).scaling.y = 0.9;
  solid(r + 0.1, (PLINTH + r) / 2, r + 0.05, 0, (PLINTH + r) / 2, oz);
  // Stones round the mouth, an arch of darker blocks.
  const mouthZ = oz + r * 0.93, arch = 0.26;
  for (let k = 0; k <= 6; k++) {
    const a = Math.PI * (k / 6);
    part(stoneDark, MeshBuilder.CreateBox("arch stone", { width: 0.11, height: 0.08, depth: 0.1 }, scene),
      Math.cos(a) * (arch + 0.04), PLINTH + Math.sin(a) * (arch + 0.04), mouthZ, 0, 0, a - Math.PI / 2);
  }
  // The mouth: a dark half-disc, the opening into the fire.
  part(soot, MeshBuilder.CreateDisc("mouth", { radius: arch, arc: 0.5, tessellation: 16, sideOrientation: Mesh.DOUBLESIDE }, scene), 0, PLINTH + 0.002, mouthZ + 0.012, 0, Math.PI);
  // Stones scattered over the dome, a little proud of it.
  for (let k = 0; k < 9; k++) {
    const a = 0.4 + k * 0.78, up = 0.35 + (k % 3) * 0.32, sx = Math.cos(a) * Math.cos(up), sy = Math.sin(up), sz = Math.sin(a) * Math.cos(up);
    if (sz > 0.6 && sy < 0.6) continue; // not over the mouth
    const s = part(stoneDark, MeshBuilder.CreateSphere("dome stone", { diameter: 0.14, segments: 4 }, scene), sx * r * 0.97, PLINTH + sy * r * 0.9 * 0.97, oz + sz * r * 0.97);
    s.scaling.set(1, 0.45, 0.8);
    s.lookAt(new Vector3(0, PLINTH, oz).scale(1)); // flat against the dome
  }
  // The ledge before the mouth: a plank a loaf slides out onto.
  part(plank, MeshBuilder.CreateBox("ledge", { width: 0.42, height: 0.04, depth: 0.26 }, scene), 0, PLINTH - 0.02, oz + r + 0.12);
  // The chimney: stone, from the dome's back up through the back slab of the roof, with a cap.
  const cz = oz - 0.2, top = HUT.wall + ROOF + 0.55;
  part(stone, MeshBuilder.CreateBox("chimney", { width: 0.24, height: top - PLINTH - r * 0.5, depth: 0.24 }, scene), 0, (top + PLINTH + r * 0.5) / 2, cz);
  part(stoneDark, MeshBuilder.CreateBox("chimney cap", { width: 0.3, height: 0.06, depth: 0.3 }, scene), 0, top + 0.03, cz);
  // A few logs stacked beside the oven, the wood for the next loaf.
  for (const [x, y, z] of [[0.7, 0.07, -0.25], [0.7, 0.07, 0.0], [0.7, 0.19, -0.12]] as const)
    part(wood, MeshBuilder.CreateCylinder("log", { diameter: 0.13, height: 0.4, tessellation: 8 }, scene), x, y, z, Math.PI / 2, 0, 0);

  // ---- the board over the opening -----------------------------------------------------------------------------------
  const sign = MeshBuilder.CreatePlane("bakery sign", { width: 0.9, height: 0.2, sideOrientation: Mesh.DOUBLESIDE }, scene);
  sign.parent = root;
  sign.position.set(0, HUT.wall + 0.16, D + 0.07);
  const texture = new DynamicTexture("bakery sign", { width: 512, height: 112 }, scene, true);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#5b3a21"; ctx.fillRect(0, 0, 512, 112);
  ctx.strokeStyle = "#3a2414"; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 504, 104);
  ctx.fillStyle = "#f6e7c4"; ctx.font = "bold 64px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("BAKERY", 256, 60);
  texture.update();
  const signMat = new StandardMaterial("bakery sign", scene);
  signMat.diffuseTexture = texture;
  signMat.specularColor.setAll(0.05);
  sign.material = signMat;
  sign.isPickable = false;
  sign.receiveShadows = true;

  // ---- the fire bed: embers in the mouth, glowing as glow() says ---------------------------------------------------
  const embersMat = new StandardMaterial("bakery embers", scene);
  embersMat.diffuseColor = new Color3(0.08, 0.05, 0.04);
  embersMat.specularColor.setAll(0);
  const embers = MeshBuilder.CreateSphere("bakery embers", { diameter: 1, segments: 6, slice: 0.5 }, scene);
  embers.parent = root;
  embers.position.set(0, PLINTH, mouthZ + 0.03);
  embers.scaling.set(0.34, 0.07, 0.1);
  embers.material = embersMat;
  embers.isPickable = false;

  const meshes: Mesh[] = [sign, embers];
  for (const [mat, list] of groups) {
    const merged = Mesh.MergeMeshes(list, true, true)!;
    merged.name = `bakery ${mat.name}`;
    merged.material = mat;
    merged.parent = root;
    merged.receiveShadows = true; // and so throws them (light.ts)
    merged.isPickable = false;
    meshes.push(merged);
  }
  const local = (x: number, y: number, z: number) => Vector3.TransformCoordinates(new Vector3(x, y, z), root.computeWorldMatrix(true));
  return {
    root,
    meshes,
    /** The fire bed, where flames rise from. */
    fire: local(0, PLINTH + 0.01, mouthZ + 0.05),
    /** The chimney's top, where smoke rises from. */
    chimney: local(0, top + 0.06, cz),
    /** A loaf in the oven, and slid out onto the ledge. */
    inside: local(0, PLINTH, oz + 0.15),
    ledge: local(0, PLINTH, oz + r + 0.12),
    /** The way the hut is turned, radians about y. */
    yaw: root.rotation.y,
    glow(level: number) {
      embersMat.emissiveColor.copyFrom(EMBER).scaleInPlace(Math.min(1.5, level) * 0.9);
    },
  };
}
export type Hut = ReturnType<typeof createHut>;
