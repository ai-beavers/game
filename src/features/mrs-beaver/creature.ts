// What Mrs. Beaver looks like, and the pen she is shut in.
//
//   const her = await mrsBeaver(stage);   her.beaver.root (move it) · her.update(dt, speed) once a picture, while seen
//   const pen = buildPen(stage);          pen.root (place it) · pen.dispose()
//   const dropped = buildDropped(stage);  her flower lying in the grass: dropped.root (place it) · dropped.dispose()
//   const brush = buildBrush(stage);      the brush pile, built once: brush.place(x, y, z, turn) a pile there (dispose it)
//   const tracks = buildTracks(stage, at, facing, heightAt)   her paw prints on the ground there · tracks.dispose()
//
// She is a real beaver (loadBeaver), as the Shopkeeper is, but in a coat of her own (a dusky grey-brown, darker and
// cooler than any player's or the Shopkeeper's), with no shirt, no hat, no apron or bow: a flower behind her left ear
// (her.flower = false hides it while she is missing: it lies dropped on the way to her).
// Standing, she has only her breath and small idle moves (the animator); walking, the animator's stride.
// The pen is a ring of upright sticks with two lashed across, one mesh and one draw call. A brush pile, a heap of
// leafy branches, stands over it and at every other hiding place: one mesh and its instances, all alike from outside.
// Her tracks are a trail of webbed hind prints and small front prints with the furrow of her dragged tail between,
// pointing where she went.
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { createAnimator } from "../../anim/index.ts";
import { loadBeaver } from "../../beaver/index.ts";
import type { Stage } from "../../engine.ts";
import { newMotion } from "../../player/state.ts";
import { seeded } from "../../world/noise.ts";
import { TRAIL } from "./rules.ts";

/** Her coat, linear RGB: a dusky grey-brown. */
export const COAT: [number, number, number] = [0.13, 0.085, 0.065];
/** The pen: radius of its ring of sticks, how many stand in it, how tall they are, m. */
export const PEN = { radius: 0.58, posts: 9, height: 0.62 };
/** A brush pile: radius at the ground and height, m, over the pen and her standing in it; and the radius of its
 *  collider (the pen's own, so the player stands as close to it as to the pen). */
export const BRUSH = { radius: 0.9, height: 1.2, solid: PEN.radius + 0.06 };

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
    get flower() { return !!flower?.isEnabled(false); },
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
function buildFlower(stage: Stage) {
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

/** The brush pile, built once: branches leaning together from the rim to the top, leafy twigs thatched over them, the
 *  same heap every time (a fixed seed), so no pile looks different from the others. place() puts an instance. */
export function buildBrush(stage: Stage) {
  const { scene } = stage, random = seeded(74), parts: Mesh[] = [];
  const bark = [new Color3(0.33, 0.23, 0.14), new Color3(0.27, 0.19, 0.12), new Color3(0.4, 0.29, 0.18)];
  const leaf = [new Color3(0.2, 0.33, 0.1), new Color3(0.26, 0.4, 0.12), new Color3(0.32, 0.36, 0.13), new Color3(0.4, 0.34, 0.14), new Color3(0.17, 0.28, 0.09)];
  const { radius: R, height: H } = BRUSH;
  // The dome the heap rounds over: height at r m from the middle.
  const dome = (r: number) => H * Math.sqrt(Math.max(0, 1 - (r / R) ** 2));
  // Branches: from the ground at the rim, leaning in over the top, a few sticking out past it.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + random() * 0.3, foot = R * (0.95 + random() * 0.2), length = H * (1.15 + random() * 0.45);
    const lean = 0.55 + random() * 0.25; // radians from upright, towards the middle
    const b = MeshBuilder.CreateCylinder("brush-branch", { height: length, diameterTop: 0.02, diameterBottom: 0.05, tessellation: 5 }, scene);
    const dx = -Math.cos(a), dz = -Math.sin(a), up = Math.cos(lean), out = Math.sin(lean);
    b.position.set(Math.cos(a) * foot + dx * out * length / 2, up * length / 2 - 0.05, Math.sin(a) * foot + dz * out * length / 2);
    // Tip it from upright towards the middle: about the horizontal axis across the lean.
    b.rotationQuaternion = Quaternion.RotationAxis(new Vector3(-dz, 0, dx), -lean);
    parts.push(paint(b, bark[i % bark.length]!));
  }
  // Leafy twigs: flattened clumps over the dome, thicker low down, a few hanging loose at the foot.
  for (let i = 0; i < 46; i++) {
    const a = random() * Math.PI * 2, r = R * Math.sqrt(random()) * 0.98, y = dome(r) * (0.78 + random() * 0.24);
    const size = 0.34 + random() * 0.22;
    const c = MeshBuilder.CreateIcoSphere("brush-leaves", { radius: size / 2, subdivisions: 1, flat: true }, scene);
    c.scaling.set(1.2 + random() * 0.5, 0.45 + random() * 0.3, 0.8 + random() * 0.4);
    c.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    c.rotation.set((random() - 0.5) * 0.8, random() * Math.PI, (random() - 0.5) * 0.8);
    parts.push(paint(c, leaf[Math.floor(random() * leaf.length)]!));
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + random() * 0.4, r = R * (0.92 + random() * 0.15);
    const c = MeshBuilder.CreateIcoSphere("brush-skirt", { radius: 0.2 + random() * 0.08, subdivisions: 1, flat: true }, scene);
    c.scaling.set(1.4, 0.5 + random() * 0.4, 1);
    c.position.set(Math.cos(a) * r, 0.1 + random() * 0.15, Math.sin(a) * r);
    c.rotation.y = -a;
    parts.push(paint(c, leaf[Math.floor(random() * leaf.length)]!));
  }
  const mesh = Mesh.MergeMeshes(parts, true)!;
  mesh.name = "mrs-beaver-brush";
  const mat = new StandardMaterial("mrs-beaver-brush", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor.setAll(0.02);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  mesh.setEnabled(false); // the source: only its instances are seen
  let count = 0;
  return {
    /** A pile at x, y, z (y the ground), turned by turn radians. */
    place(x: number, y: number, z: number, turn: number): InstancedMesh {
      const pile = mesh.createInstance(`mrs-beaver-brush-${count++}`);
      pile.position.set(x, y, z);
      pile.rotation.y = turn;
      pile.isPickable = false;
      return pile;
    },
  };
}

/** Her tracks: a trail TRAIL m long with its middle at `at`, pointing along facing (radians, 0 is +z), pressed into
 *  the ground (heightAt) print by print. One mesh. */
export function buildTracks(stage: Stage, at: { x: number; z: number }, facing: number, heightAt: (x: number, z: number) => number) {
  const { scene } = stage, parts: Mesh[] = [];
  const mud = new Color3(0.1, 0.065, 0.04), furrow = new Color3(0.2, 0.15, 0.09);
  const fx = Math.sin(facing), fz = Math.cos(facing), rx = Math.cos(facing), rz = -Math.sin(facing);
  /** A flat oval on the ground, a m along the trail and s m to its right of the start, w wide and l long. */
  const oval = (a: number, s: number, w: number, l: number, c: Color3, turn = 0) => {
    const d = MeshBuilder.CreateDisc("track", { radius: 0.5, tessellation: 10 }, scene);
    d.rotation.set(Math.PI / 2, facing + turn, 0);
    d.scaling.set(w, l, 1);
    const along = a - TRAIL / 2;
    d.position.set(at.x + fx * along + rx * s, 0, at.z + fz * along + rz * s);
    parts.push(paint(d, c));
  };
  // The furrow her tail left, faint, down the middle: a dash every 0.24 m. All lengths here are m.
  for (let a = 0.1; a < TRAIL - 0.1; a += 0.24) oval(a, Math.sin(a * 2.2) * 0.025, 0.035, 0.17, furrow);
  // Paired steps: a broad webbed hind print with five toes, the small front print just ahead of it, left then right.
  for (let k = 0, a = 0.15; a < TRAIL - 0.2; k++, a += 0.36) {
    const side = (k % 2 ? 1 : -1) * 0.13, splay = (k % 2 ? 1 : -1) * 0.12;
    oval(a, side, 0.1, 0.16, mud, splay); // the sole
    for (let t = 0; t < 5; t++) {
      const spread = (t - 2) * 0.03;
      oval(a + 0.1 - Math.abs(t - 2) * 0.012, side + spread, 0.028, 0.045, mud, splay + (t - 2) * 0.15);
    }
    oval(a + 0.2, side * 0.8, 0.055, 0.06, mud, splay); // the front paw
  }
  const mesh = Mesh.MergeMeshes(parts, true)!;
  // Each vertex onto the ground beneath it, a hair above, so the prints follow a slope.
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < positions.length; i += 3) positions[i + 1] = heightAt(positions[i]!, positions[i + 2]!) + 0.03; // m
  mesh.setVerticesData(VertexBuffer.PositionKind, positions);
  mesh.refreshBoundingInfo();
  mesh.name = "mrs-beaver-tracks";
  const mat = new StandardMaterial("mrs-beaver-tracks", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor.setAll(0);
  mat.zOffset = -2;
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  return { mesh, dispose() { mesh.dispose(false, true); } };
}
