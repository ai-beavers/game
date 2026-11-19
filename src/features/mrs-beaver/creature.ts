// What Mrs. Beaver looks like, and the pen she is shut in.
//
//   const her = await mrsBeaver(stage);   her.beaver.root (move it) · her.update(dt, speed) once a picture, while seen
//   const pen = buildPen(stage);          pen.root (place it) · pen.dispose()
//   const dropped = buildDropped(stage);  her flower lying in the grass: dropped.root (place it) · dropped.dispose()
//
// She is a real beaver (loadBeaver), as the Shopkeeper is, but in a coat of her own (a dusky grey-brown, darker and
// cooler than any player's or the Shopkeeper's), with no shirt, no hat, no apron or bow: a flower behind her left ear
// (her.flower = false hides it while she is missing: it lies dropped on the way to her).
// Standing, she has only her breath and small idle moves (the animator); walking, the animator's stride.
// The pen is a ring of upright sticks with two lashed across, one mesh and one draw call.
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { createAnimator } from "../../anim/index.ts";
import { loadBeaver } from "../../beaver/index.ts";
import type { Stage } from "../../engine.ts";
import { newMotion } from "../../player/state.ts";

/** Her coat, linear RGB: a dusky grey-brown. */
export const COAT: [number, number, number] = [0.13, 0.085, 0.065];
/** The pen: radius of its ring of sticks, how many stand in it, how tall they are, m. */
export const PEN = { radius: 0.58, posts: 9, height: 0.62 };

const paint = (mesh: Mesh, c: Color3) => {
  const n = mesh.getTotalVertices(), colours = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) colours.set([c.r, c.g, c.b, 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colours);
  return mesh;
};

export async function mrsBeaver(stage: Stage) {
  const { scene } = stage, beaver = await loadBeaver(scene);
  beaver.root.name = "mrs-beaver";
  beaver.coat = COAT;
  beaver.shirt = false;
  beaver.hat = false;
  const head = beaver.root.getDescendants(false, (n) => n.name === "head")[0] as TransformNode | undefined;
  // Her flower behind her left ear: hidden while she is missing (it lies dropped on the way to her), shown once freed.
  const flower = head ? buildFlower(stage) : undefined;
  if (flower) {
    flower.parent = head!;
    flower.position.set(0.085, 0.15, -0.035); // behind her left ear
    flower.rotation.z = -0.5;
  }
  for (const mesh of beaver.root.getChildMeshes(false)) mesh.isPickable = false;
  const animator = createAnimator(), motion = { ...newMotion(), grounded: true };
  return {
    beaver,
    /** Whether she wears her flower behind her ear. */
    set flower(on: boolean) { flower?.setEnabled(on); },
    /** speed: m/s over the ground, 0 standing; she always faces where she goes. */
    update(dt: number, speed: number) {
      motion.time += dt;
      motion.speed = speed;
      motion.distance += speed * dt;
      beaver.pose(animator.pose(motion, dt));
      beaver.update(dt);
    },
  };
}

/** Her flower: five round petals, pale pink, round a yellow middle, facing +x. One mesh, about 7 cm across. */
export function buildFlower(stage: Stage) {
  const { scene } = stage, petal = new Color3(0.98, 0.72, 0.82), middle = new Color3(1, 0.78, 0.15), parts: Mesh[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2, p = MeshBuilder.CreateSphere("petal", { diameter: 0.045, segments: 5 }, scene);
    p.scaling.set(0.35, 1, 0.7);
    p.position.set(0, Math.sin(a) * 0.026, Math.cos(a) * 0.026);
    parts.push(paint(p, petal));
  }
  const heart = MeshBuilder.CreateSphere("heart", { diameter: 0.026, segments: 5 }, scene);
  heart.position.x = 0.008;
  parts.push(paint(heart, middle));
  const flower = Mesh.MergeMeshes(parts, true)!;
  flower.name = "mrs-beaver-flower";
  const mat = new StandardMaterial("mrs-beaver-flower", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor.setAll(0.05);
  flower.material = mat;
  flower.isPickable = false;
  return flower;
}

/** Her flower dropped in the grass: on its green stalk, caught leaning in the grass with its face to the sky, larger
 *  than life so it shows over the blades. */
export function buildDropped(stage: Stage) {
  const { scene } = stage, root = new TransformNode("mrs-beaver-dropped-flower", scene), lean = 0.35;
  const stalk = paint(MeshBuilder.CreateCylinder("stalk", { height: 0.26, diameter: 0.014, tessellation: 4 }, scene), new Color3(0.2, 0.42, 0.12));
  stalk.parent = root;
  stalk.rotation.z = lean;
  stalk.position.set(-Math.sin(lean) * 0.13, 0.12, 0);
  stalk.isPickable = false;
  const head = buildFlower(stage);
  stalk.material = head.material;
  head.parent = root;
  head.rotation.z = Math.PI / 2 - 0.4; // face up, a little to the side
  head.position.set(-Math.sin(lean) * 0.26, 0.25, 0);
  head.scaling.setAll(2.4);
  return { root, dispose() { root.dispose(false, true); } };
}

export function buildPen(stage: Stage) {
  const { scene } = stage, root = new TransformNode("mrs-beaver-pen", scene), parts: Mesh[] = [];
  const bark = [new Color3(0.36, 0.25, 0.16), new Color3(0.3, 0.21, 0.13), new Color3(0.42, 0.3, 0.19)];
  for (let i = 0; i < PEN.posts; i++) {
    const a = (i / PEN.posts) * Math.PI * 2, h = PEN.height * (0.85 + ((i * 7) % 5) * 0.06);
    const post = MeshBuilder.CreateCylinder("pen-post", { height: h, diameterTop: 0.035, diameterBottom: 0.05, tessellation: 6 }, scene);
    post.position.set(Math.cos(a) * PEN.radius, h / 2 - 0.04, Math.sin(a) * PEN.radius);
    post.rotation.set(Math.sin(i * 2.3) * 0.08, 0, Math.cos(i * 1.7) * 0.08); // pushed in by paw, not quite straight
    parts.push(paint(post, bark[i % bark.length]!));
  }
  // Two sticks lashed across the ring at different heights, between every other post.
  for (let i = 0; i < PEN.posts; i++) for (const [y, step] of [[0.22, 1], [0.45, 1]] as const) {
    const a = (i / PEN.posts) * Math.PI * 2, b = ((i + step) / PEN.posts) * Math.PI * 2;
    const ax = Math.cos(a) * PEN.radius, az = Math.sin(a) * PEN.radius, bx = Math.cos(b) * PEN.radius, bz = Math.sin(b) * PEN.radius;
    const length = Math.hypot(bx - ax, bz - az) + 0.08;
    const rail = MeshBuilder.CreateCylinder("pen-rail", { height: length, diameter: 0.03, tessellation: 5 }, scene);
    rail.position.set((ax + bx) / 2, y + (i % 2) * 0.05, (az + bz) / 2);
    rail.rotation.set(Math.PI / 2, Math.atan2(bx - ax, bz - az), 0);
    parts.push(paint(rail, bark[(i + 1) % bark.length]!));
  }
  const mesh = Mesh.MergeMeshes(parts, true)!;
  mesh.name = "mrs-beaver-pen";
  const mat = new StandardMaterial("mrs-beaver-pen", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor.setAll(0.03);
  mesh.material = mat;
  mesh.parent = root;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  return { root, mesh, dispose() { root.dispose(false, true); } };
}
