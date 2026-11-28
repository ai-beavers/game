// The Dance floor as the world shows it: a square of coloured tiles on a dark plate with a rim, lying on the meadow and
// following the ground under it, a few centimetres high, so a beaver walks onto it without a step and no collider is
// needed. All of it is one mesh with one material: each tile's colour is in its vertices, dim when dark and full
// when lit, and the material's emissive colour (fed by the feature each frame) makes the lit ones glow. No Babylon
// light, no shadow. place.ts says where it lies.
//
//   const floor = createFloor(stage, world);
//   floor.show(lit)          which tiles are lit (rules.ts lit), row by row; the vertices change only when it does
//   floor.material           its emissiveColor is the glow
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { World } from "../../contracts.ts";
import type { Stage } from "../../engine.ts";
import { hex } from "../../world/color.ts";
import { FLOOR, TILE } from "./place.ts";

/** The tiles' colours, in turn along the rows: not the Shop's purple and gold. */
const COLOURS = [0xff3d8b, 0x2fd4ff, 0xffd23a, 0x5cff6a, 0xff7a2a, 0xb06bff].map((c) => hex(c));
/** How much of its colour a dark tile keeps. */
const DIM = 0.2;
/** The plate under the tiles and its rim: nearly black, so it never glows much. */
const PLATE = new Color3(0.05, 0.05, 0.06);
/** m: the tiles' top over the ground, the plate's, the gap between tiles, how far the plate reaches past them. */
const TOP = 0.035, PLATE_TOP = 0.02, GAP = 0.05, RIM = 0.12, DOWN = 0.04;

export function createFloor(stage: Stage, world: World) {
  const { scene } = stage;
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
  const ground = (x: number, z: number) => world.heightAt(x, z);
  /** A box from x0, z0 to x1, z1 on the ground: a top `top` m over it and sides down into it, all in one colour. */
  const slab = (x0: number, z0: number, x1: number, z1: number, top: number, color: Color3) => {
    const first = positions.length / 3;
    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as const;
    const up = corners.map(([x, z]) => ground(x, z) + top), low = corners.map(([x, z]) => ground(x, z) - DOWN);
    const vertex = (x: number, y: number, z: number, n: [number, number, number]) => {
      positions.push(x, y, z); normals.push(...n); colors.push(color.r, color.g, color.b, 1);
    };
    for (let i = 0; i < 4; i++) vertex(corners[i]![0], up[i]!, corners[i]![1], [0, 1, 0]);
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    // the four sides, each its own quad facing out
    const outs: [number, number, number][] = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, at = positions.length / 3, n = outs[i]!;
      vertex(corners[i]![0], up[i]!, corners[i]![1], n); vertex(corners[j]![0], up[j]!, corners[j]![1], n);
      vertex(corners[j]![0], low[j]!, corners[j]![1], n); vertex(corners[i]![0], low[i]!, corners[i]![1], n);
      indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
    }
    return { first, count: positions.length / 3 - first };
  };
  const { x, z, half, tiles } = FLOOR;
  slab(x - half - RIM, z - half - RIM, x + half + RIM, z + half + RIM, PLATE_TOP, PLATE);
  const spans: { first: number; count: number; color: Color3 }[] = [];
  for (let row = 0; row < tiles; row++) for (let col = 0; col < tiles; col++) {
    const x0 = x - half + col * TILE + GAP / 2, z0 = z - half + row * TILE + GAP / 2, color = COLOURS[(row * 2 + col) % COLOURS.length]!;
    spans.push({ ...slab(x0, z0, x0 + TILE - GAP, z0 + TILE - GAP, TOP, color.scale(DIM)), color });
  }
  const mesh = new Mesh("dance floor", scene), data = new VertexData();
  Object.assign(data, { positions, normals, colors, indices });
  data.applyToMesh(mesh, true);
  const material = new StandardMaterial("dance floor", scene);
  material.diffuseColor.setAll(0.5);
  material.specularColor.setAll(0.25);
  material.specularPower = 40;
  material.emissiveColor = Color3.Black();
  mesh.material = material;
  mesh.hasVertexAlpha = false;
  mesh.receiveShadows = false; // throws none (light.ts): no new shadow caster
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();

  const shown = new Float32Array(colors);
  let last = "";
  return {
    mesh, material,
    show(lit: boolean[]) {
      const key = lit.map((on) => (on ? 1 : 0)).join("");
      if (key === last) return;
      last = key;
      spans.forEach((s, i) => {
        const k = lit[i] ? 1 : DIM;
        for (let v = s.first; v < s.first + s.count; v++) shown.set([s.color.r * k, s.color.g * k, s.color.b * k, 1], v * 4);
      });
      mesh.updateVerticesData(VertexBuffer.ColorKind, shown);
    },
  };
}
