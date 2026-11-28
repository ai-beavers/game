// The Top-ten board as the world shows it: a board on two posts at the edge of the building site (place.ts), its face
// a dynamic texture drawn as real text: "TOP TEN BEAVERS" over the rows, each its place, the name and the sticks, or one
// line saying nobody has built yet. Lit by the scene like the Calendar board (src/features/shop/calendar.ts), with a
// touch of its own light by day; a collider over its width keeps the beaver out of it. The posts and frame are one
// mesh; the face is redrawn only when the rows change.
//
//   const board = createBoard(stage, world)    board.show(rows) redraws · board.light(dark) each picture
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { World } from "../../contracts.ts";
import type { Stage } from "../../engine.ts";
import { box } from "../../physics.ts";
import { material } from "../../world/models.ts";
import { faceLight } from "../shop/calendar.ts";
import { BOARD, DEPTH } from "./place.ts";
import { ROWS, type TopRow } from "./rules.ts";

const { width: WIDTH, height: HEIGHT, lift: LIFT } = BOARD;
const PX = 1024, PY = Math.round(PX * HEIGHT / WIDTH); // texture, the board's proportions
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
export const TITLE = "TOP TEN BEAVERS", NOBODY = "Nobody has built a stick in yet.";
const NIGHT_DULL = 0.55; // how much less light the face takes at full dark
const INK = "#3b2a1a", PAPER = "#f7f0e0", MEDALS = ["#b8860b", "#7d7d86", "#a0522d"]; // gold, silver, bronze places

/** The text, cut with an ellipsis where it is wider than `width`. */
function fit(g: CanvasRenderingContext2D, text: string, width: number) {
  if (g.measureText(text).width <= width) return text;
  const chars = [...text];
  while (chars.length && g.measureText(`${chars.join("").trimEnd()}…`).width > width) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}

function draw(texture: DynamicTexture, rows: readonly TopRow[]) {
  const g = texture.getContext() as CanvasRenderingContext2D;
  g.setTransform(-1, 0, 0, 1, PX, 0); // a plane turned to face out shows it mirrored (as the Calendar board's)
  g.fillStyle = PAPER; g.fillRect(0, 0, PX, PY);
  const pad = 44, top = 150, row = (PY - top - 24) / ROWS; // px on the texture
  g.textBaseline = "middle";
  g.fillStyle = INK; g.textAlign = "center"; g.font = `800 86px ${FONT}`;
  g.fillText(fit(g, TITLE, PX - 2 * pad), PX / 2, 74);
  g.strokeStyle = "#c9b48e"; g.lineWidth = 4;
  g.beginPath(); g.moveTo(pad, top - 14); g.lineTo(PX - pad, top - 14); g.stroke();
  if (!rows.length) {
    g.fillStyle = "#7a6650"; g.font = `600 54px ${FONT}`;
    g.fillText(fit(g, NOBODY, PX - 2 * pad), PX / 2, top + (PY - top) / 2 - 20);
  }
  const placeAt = pad + 92, nameAt = placeAt + 26;
  rows.slice(0, ROWS).forEach((r, i) => {
    const y = top + row * (i + 0.5);
    if (i % 2) { g.fillStyle = "#efe5cf"; g.fillRect(pad - 12, y - row / 2, PX - 2 * pad + 24, row); }
    g.font = `800 54px ${FONT}`; g.textAlign = "right"; g.fillStyle = MEDALS[i] ?? INK;
    g.fillText(`${r.place}.`, placeAt, y);
    const sticks = String(r.sticks), sticksWidth = g.measureText(sticks).width;
    g.fillStyle = INK; g.fillText(sticks, PX - pad, y);
    g.font = `600 54px ${FONT}`; g.textAlign = "left";
    g.fillText(fit(g, r.name, PX - pad - sticksWidth - 36 - nameAt), nameAt, y);
  });
  g.setTransform(1, 0, 0, 1, 0, 0);
  texture.update(true);
}

export function createBoard(stage: Stage, world: World) {
  const { scene } = stage, ground = world.heightAt(BOARD.x, BOARD.z);
  const node = new TransformNode("top-ten", scene);
  node.position.set(BOARD.x, ground - 0.02, BOARD.z);
  node.rotation.y = BOARD.yaw; // local +z: out of its face
  node.computeWorldMatrix(true);

  const parts: Mesh[] = [];
  for (const side of [-1, 1]) {
    const post = MeshBuilder.CreateCylinder("top-ten-post", { height: LIFT + HEIGHT + 0.15, diameter: 0.08, tessellation: 8 }, scene);
    post.position.set(side * (WIDTH / 2 - 0.12), (LIFT + HEIGHT + 0.15) / 2, -0.06);
    parts.push(post);
  }
  const frame = MeshBuilder.CreateBox("top-ten-frame", { width: WIDTH + 0.08, height: HEIGHT + 0.08, depth: 0.05 }, scene);
  frame.position.y = LIFT + HEIGHT / 2;
  parts.push(frame);
  const wooden = Mesh.MergeMeshes(parts, true)!;
  wooden.name = "top-ten-wood"; wooden.material = material(scene, "top-ten-wood", 0x5a3a22); wooden.parent = node;
  wooden.isPickable = false; wooden.receiveShadows = true;

  const face = MeshBuilder.CreatePlane("top-ten-face", { width: WIDTH, height: HEIGHT }, scene);
  const texture = new DynamicTexture("top-ten", { width: PX, height: PY }, scene, true);
  texture.anisotropicFilteringLevel = 8; // read at a slant from the path
  const faceMat = new StandardMaterial("top-ten-face", scene);
  faceMat.diffuseTexture = texture;
  // No emissive texture: Babylon adds it whole, whatever emissiveColor says, and the light face glows white at night.
  faceMat.specularColor.setAll(0.04);
  face.material = faceMat; face.parent = node;
  face.position.set(0, LIFT + HEIGHT / 2, 0.03);
  face.rotation.y = Math.PI; // its face to local +z (the texture is drawn mirrored for this)
  face.isPickable = false; face.receiveShadows = true;

  // Solid from the ground to over the beaver's head, the whole width of the board.
  stage.physics.fixed(box(scene, WIDTH / 2 + 0.04, (LIFT + HEIGHT) / 2, DEPTH / 2, { x: BOARD.x, y: ground + (LIFT + HEIGHT) / 2, z: BOARD.z },
    node.absoluteRotationQuaternion.clone()), undefined, 0.9);

  return {
    show: (rows: readonly TopRow[]) => draw(texture, rows),
    /** By the sky's dark (0 … 1): its own light as the Calendar board's face; and at night a duller face, so the
     *  beaver's lantern a step away, under the night's brightened exposure, leaves the text readable. */
    light(dark: number) {
      faceMat.emissiveColor.setAll(faceLight(dark));
      faceMat.diffuseColor.setAll(1 - NIGHT_DULL * Math.min(1, Math.max(0, dark)));
    },
  };
}
