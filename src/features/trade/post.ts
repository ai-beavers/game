// The trading post as the world shows it: a low wooden counter under a striped awning, a sign, and three spots on the
// counter, each with its good (made of primitives: a pinecone, a duck feather, a river shell) on a mat, its price as
// that many little sticks on the counter's front, and the pile of sticks paid towards it. One collider for the
// counter. place.ts says where it stands.
//
//   const post = createPost(stage, world);
//   post.good(i)                       the good's model on spot i (its world position: where it is taken from)
//   post.copy(i)                       a new model of good i, in the world where the one on the spot is (to carry off)
//   post.pileSlot(i, k)                where the k-th stick of spot i's pile lies, in the world
//   post.lay(i, mesh) · post.empty(i)  a stick onto spot i's pile (where pileSlot says) · the pile cleared away
//   post.fill(i, n)                    the pile shown with n sticks (a saved game put back)
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { World } from "../../contracts.ts";
import type { Stage } from "../../engine.ts";
import { box } from "../../physics.ts";
import { bounds, instance, material, mergeStatic } from "../../world/models.ts";
import { seeded } from "../../world/noise.ts";
import { POST_GOODS as GOODS } from "./ledger.ts";
import { FRONT, POST, SPOT_GAP } from "./place.ts";

const TOP = POST.top + 0.04; // m: the counter's top surface, plank included
export const GOOD_SIZE = 1.6; // the goods are drawn this much larger than life, so a viewer reads them at the camera's distance
const PILE_LENGTH = 0.5; // m: a stick laid on a pile, shortened to fit its spot

export function createPost(stage: Stage, world: World) {
  const { scene, physics } = stage;
  const ground = world.heightAt(POST.x, POST.z);
  const root = new TransformNode("trading post", scene);
  root.position.set(POST.x, ground, POST.z);
  root.rotation.y = Math.atan2(FRONT.x, FRONT.z); // local +z to the front, +x along the counter
  const still: Mesh[] = []; // the stall, the mats and the prices: never changed once built, merged below
  const part = <T extends Mesh>(mesh: T, x: number, y: number, z: number, parent: TransformNode = root) => {
    still.push(mesh);
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    mesh.receiveShadows = true; // and so throws them (light.ts)
    mesh.isPickable = false;
    return mesh;
  };
  const wood = material(scene, "post wood", 0x8a5a33), plank = material(scene, "post plank", 0xb07a48), dark = material(scene, "post dark", 0x4a2f1a);
  const price = material(scene, "post price", 0xf1dfb4); // pale against the dark wood of the front
  const cloth = [material(scene, "awning red", 0xb8452f), material(scene, "awning cream", 0xefe3c4)];

  // ---- the stall -----------------------------------------------------------------------------------------------------
  const half = POST.length / 2;
  part(MeshBuilder.CreateBox("post counter", { width: POST.length, height: POST.top, depth: POST.depth }, scene), 0, POST.top / 2, 0).material = wood;
  part(MeshBuilder.CreateBox("post top", { width: POST.length + 0.08, height: 0.04, depth: POST.depth + 0.06 }, scene), 0, POST.top + 0.02, 0).material = plank;
  for (const x of [-half + 0.03, half - 0.03]) for (const z of [-POST.depth / 2 + 0.03, POST.depth / 2 - 0.03]) {
    const tall = z < 0 ? 1.62 : 1.48; // the awning slopes down to the front
    part(MeshBuilder.CreateBox("post pole", { width: 0.06, height: tall, depth: 0.06 }, scene), x, tall / 2, z).material = dark;
  }
  // The awning: stripes across, sloping from the back poles to the front ones and a little over.
  const awning = new TransformNode("post awning", scene);
  awning.parent = root;
  awning.position.set(0, 1.56, 0.02);
  awning.rotation.x = Math.atan2(0.14, POST.depth); // its front lower
  const STRIPES = 9, stripe = (POST.length + 0.3) / STRIPES;
  for (let k = 0; k < STRIPES; k++)
    part(MeshBuilder.CreateBox("post stripe", { width: stripe, height: 0.03, depth: POST.depth + 0.35 }, scene), -(POST.length + 0.3) / 2 + stripe * (k + 0.5), 0, 0, awning).material = cloth[k % 2]!;
  // A board hung under the awning's front edge, with the post's name: it reads from where a beaver comes.
  const sign = part(MeshBuilder.CreatePlane("post sign", { width: 1.1, height: 0.22, sideOrientation: Mesh.DOUBLESIDE }, scene), 0, 1.3, POST.depth / 2 + 0.06);
  const signTexture = new DynamicTexture("post sign", { width: 512, height: 104 }, scene, true);
  const ctx = signTexture.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#5b3a21"; ctx.fillRect(0, 0, 512, 104);
  ctx.strokeStyle = "#3a2414"; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 504, 96);
  ctx.fillStyle = "#f6e7c4"; ctx.font = "bold 58px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("TRADING POST", 256, 56);
  signTexture.update();
  const signMat = new StandardMaterial("post sign", scene);
  signMat.diffuseTexture = signTexture;
  signMat.specularColor.setAll(0.05);
  sign.material = signMat;
  for (const x of [-0.45, 0.45]) part(MeshBuilder.CreateBox("post string", { width: 0.012, height: 0.12, depth: 0.012 }, scene), x, 1.47, POST.depth / 2 + 0.06).material = dark;

  physics.fixed(box(scene, half + 0.04, TOP / 2, POST.depth / 2 + 0.03, { x: POST.x, y: ground + TOP / 2, z: POST.z },
    Quaternion.RotationAxis(Vector3.Up(), root.rotation.y)), undefined, 0.9);

  // ---- the spots: a mat, the good on it, its price on the front, its pile ------------------------------------------------
  const mats = [0x5d7a3a, 0x8d6e4a, 0x4f7f86].map((hex, i) => material(scene, `post mat ${i}`, hex));
  const spotX = (i: number) => (i - 1) * SPOT_GAP;
  const models = GOODS.map((good, i) => {
    part(MeshBuilder.CreateCylinder("post mat", { diameter: 0.42, height: 0.012, tessellation: 20 }, scene), spotX(i), TOP + 0.006, -0.09).material = mats[i]!;
    // The price: one little stick on the counter's front for each stick it costs, in a row under the spot.
    for (let k = 0; k < good.price; k++) {
      const tally = part(MeshBuilder.CreateBox("post price", { width: 0.045, height: 0.22, depth: 0.02 }, scene), spotX(i) + (k - (good.price - 1) / 2) * 0.08, POST.top * 0.5, POST.depth / 2 + 0.012);
      tally.material = price;
    }
    const model = makeGood(good.id, scene);
    model.parent = root;
    model.position.set(spotX(i), TOP + 0.012, -0.09);
    model.scaling.setAll(GOOD_SIZE);
    return model;
  });
  // One mesh per material. The goods stay apart (post.copy clones them to carry off), as do the piles' sticks.
  mergeStatic(still, root);

  const piles: TransformNode[][] = GOODS.map(() => []);
  const random = seeded(5);
  const jitter = Array.from({ length: 8 }, () => [(random() - 0.5) * 0.3, (random() - 0.5) * 0.05]);
  /** Spot i's k-th pile stick, in the post's frame: in front of the good, crossing the one under it. */
  const pileLocal = (i: number, k: number) => ({
    position: new Vector3(spotX(i) + jitter[k % 8]![1]!, TOP + 0.022 + k * 0.034, 0.14 + jitter[k % 8]![1]!),
    quaternion: Quaternion.RotationYawPitchRoll(Math.PI / 2 + (k % 2 ? 0.45 : -0.2) + jitter[k % 8]![0]!, 0, 0),
  });
  const stickTemplate = world.props?.stick[0];
  const freshStick = () => {
    const holder = new TransformNode("pile stick", scene);
    if (stickTemplate) {
      const { center, size } = bounds(stickTemplate), copy = instance(stickTemplate, "pile stick", holder);
      copy.scaling.set(0.045 / size.x, 0.045 / size.y, PILE_LENGTH / size.z);
      copy.position = center.multiply(copy.scaling).negate();
    }
    holder.rotationQuaternion = new Quaternion();
    return holder;
  };

  return {
    root,
    good: (i: number) => models[i]!,
    copy(i: number) {
      const copy = models[i]!.clone(`${GOODS[i]!.id} taken`, null)!;
      copy.parent = null; // a clone keeps the post as its parent: in the world, where the position below says
      models[i]!.computeWorldMatrix(true).decompose(copy.scaling, undefined, copy.position);
      copy.rotationQuaternion = null;
      copy.rotation.set(0, root.rotation.y, 0);
      return copy;
    },
    pileSlot(i: number, k: number) {
      const local = pileLocal(i, k), world = root.computeWorldMatrix(true);
      return { position: Vector3.TransformCoordinates(local.position, world), quaternion: Quaternion.RotationAxis(Vector3.Up(), root.rotation.y).multiply(local.quaternion) };
    },
    lay(i: number, mesh: TransformNode) {
      const k = piles[i]!.length, local = pileLocal(i, k);
      mesh.parent = root;
      mesh.position.copyFrom(local.position);
      mesh.rotationQuaternion = local.quaternion;
      piles[i]!.push(mesh);
    },
    empty(i: number) { for (const mesh of piles[i]!.splice(0)) mesh.dispose(); },
    fill(i: number, n: number) {
      while (piles[i]!.length > n) piles[i]!.pop()!.dispose();
      while (piles[i]!.length < n) this.lay(i, freshStick());
    },
    pileSize: (i: number) => piles[i]!.length,
    /** How much a carried stick is shortened on a pile: its length along z there. */
    PILE_LENGTH,
  };
}
export type Post = ReturnType<typeof createPost>;

const colour = (scene: import("@babylonjs/core/scene.js").Scene, name: string, hex: number, shine = 0.08) => {
  const mat = material(scene, name, hex);
  mat.specularColor.setAll(shine);
  return mat;
};

const made = new WeakMap<import("@babylonjs/core/scene.js").Scene, Map<string, Mesh>>();
/** A new model of any good (the loaf too, which the post does not hold), life-sized, in the world at the origin:
 *  a copy of one made once per scene and kept hidden. */
export function goodModel(id: string, scene: import("@babylonjs/core/scene.js").Scene): Mesh {
  const mine = made.get(scene) ?? new Map<string, Mesh>();
  made.set(scene, mine);
  let template = mine.get(id);
  if (!template) { template = makeGood(id, scene); template.setEnabled(false); mine.set(id, template); }
  const copy = template.clone(`${id} copy`, null)!;
  copy.setEnabled(true);
  return copy;
}

/** A good's model at its natural size, standing on y = 0 of its own origin, one mesh (one draw call). */
function makeGood(id: string, scene: import("@babylonjs/core/scene.js").Scene): Mesh {
  const parts: Mesh[] = [], put = (mesh: Mesh, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    parts.push(mesh);
    return mesh;
  };
  if (id === "pinecone") {
    // A brown egg of a core, ringed with scales that stick out and up, smaller towards the tip.
    const core = put(MeshBuilder.CreateSphere("cone", { diameter: 0.07, segments: 8 }, scene), 0, 0.06, 0);
    core.scaling.y = 1.6;
    [[0.025, 0.036, 8], [0.05, 0.034, 8], [0.075, 0.028, 7], [0.098, 0.018, 6]].forEach(([y, r, n], ring) => {
      for (let k = 0; k < n!; k++) {
        const a = (k / n!) * Math.PI * 2 + ring * 0.4;
        put(MeshBuilder.CreateBox("scale", { width: 0.03 - ring * 0.004, height: 0.008, depth: 0.026 - ring * 0.003 }, scene),
          Math.sin(a) * r!, y!, Math.cos(a) * r!, -0.6, a, 0);
      }
    });
    const mesh = Mesh.MergeMeshes(parts, true)!;
    mesh.material = colour(scene, "pinecone", 0x7a4e2a);
    return named(mesh, id);
  }
  if (id === "feather") {
    // A duck's wing feather, leaning on its quill: grey-brown, with the blue band a mallard's wing shows.
    const vane = put(MeshBuilder.CreateSphere("vane", { diameter: 1, segments: 10 }, scene), 0, 0.055, 0.02, -0.35, 0, 0);
    vane.scaling.set(0.09, 0.014, 0.27);
    const band = put(MeshBuilder.CreateSphere("band", { diameter: 1, segments: 8 }, scene), 0, 0.062, 0.04, -0.35, 0, 0);
    band.scaling.set(0.078, 0.014, 0.06);
    put(MeshBuilder.CreateCylinder("quill", { diameter: 0.007, height: 0.3, tessellation: 6 }, scene), 0, 0.05, 0.0, Math.PI / 2 - 0.35, 0, 0);
    put(MeshBuilder.CreateCylinder("rest", { diameter: 0.03, height: 0.03, tessellation: 8 }, scene), 0, 0.015, -0.1);
    const mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
    const vaneMat = colour(scene, "feather", 0xcfc6b2), bandMat = colour(scene, "feather band", 0x2f5fb3, 0.4), quillMat = colour(scene, "quill", 0xe8e0cc);
    const multi = mesh.material as import("@babylonjs/core/Materials/multiMaterial.js").MultiMaterial;
    multi.subMaterials = [vaneMat, bandMat, quillMat, quillMat];
    return named(mesh, id);
  }
  if (id === "loaf") {
    // A round loaf of bread: a golden-brown dome, a little longer than wide, with three pale slashes across its top.
    const crust = put(MeshBuilder.CreateSphere("crust", { diameter: 1, segments: 12, slice: 0.55 }, scene), 0, -0.012, 0);
    crust.scaling.set(0.15, 0.1, 0.2);
    for (const z of [-0.045, 0, 0.045]) {
      const cut = put(MeshBuilder.CreateBox("cut", { width: 0.09, height: 0.008, depth: 0.012 }, scene), 0, 0.083 - Math.abs(z) * 0.5, z, z * 4, 0, 0);
      cut.scaling.x = 1 - Math.abs(z) * 3;
    }
    const mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
    const cutMat = colour(scene, "loaf cut", 0xe9c98c);
    (mesh.material as import("@babylonjs/core/Materials/multiMaterial.js").MultiMaterial).subMaterials = [colour(scene, "loaf", 0xa8662a, 0.15), cutMat, cutMat, cutMat];
    return named(mesh, id);
  }
  if (id === "charm") {
    // A river shell and a duck feather tied on a loop of string: the loop stands up, the shell hangs at its foot
    // facing out, the feather hangs beside it with its blue band, a knot where they are tied.
    put(MeshBuilder.CreateTorus("string", { diameter: 0.085, thickness: 0.008, tessellation: 18 }, scene), 0, 0.15, 0, Math.PI / 2, 0, 0);
    put(MeshBuilder.CreateSphere("knot", { diameter: 0.024, segments: 6 }, scene), 0, 0.105, 0.004);
    const dome = put(MeshBuilder.CreateSphere("charm shell", { diameter: 1, segments: 10, slice: 0.5 }, scene), -0.03, 0.055, 0.012, Math.PI / 2, 0, 0.25);
    dome.scaling.set(0.11, 0.045, 0.1);
    for (let k = 0; k < 5; k++) {
      const a = -0.9 + (k / 4) * 1.8;
      const rib = put(MeshBuilder.CreateSphere("charm rib", { diameter: 1, segments: 5 }, scene), -0.03 + Math.sin(a + 0.25) * 0.025, 0.055 + Math.cos(a + 0.25) * 0.016, 0.026, 0, 0, a + 0.25);
      rib.scaling.set(0.008, 0.06, 0.01);
    }
    const vane = put(MeshBuilder.CreateSphere("charm vane", { diameter: 1, segments: 8 }, scene), 0.04, 0.05, 0.004, 0, 0, -0.3);
    vane.scaling.set(0.055, 0.17, 0.012);
    const band = put(MeshBuilder.CreateSphere("charm band", { diameter: 1, segments: 6 }, scene), 0.035, 0.07, 0.008, 0, 0, -0.3);
    band.scaling.set(0.05, 0.04, 0.012);
    const mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
    const string = colour(scene, "charm string", 0x9b6b3c), shell = colour(scene, "shell", 0xe7c3ae, 0.35);
    (mesh.material as import("@babylonjs/core/Materials/multiMaterial.js").MultiMaterial).subMaterials =
      [string, string, shell, ...Array(5).fill(shell), colour(scene, "feather", 0xcfc6b2), colour(scene, "feather band", 0x2f5fb3, 0.4)];
    return named(mesh, id);
  }
  // A river shell: a low dome with ribs fanning out from its hinge.
  const dome = put(MeshBuilder.CreateSphere("shell", { diameter: 1, segments: 12, slice: 0.5 }, scene), 0, 0, 0);
  dome.scaling.set(0.15, 0.07, 0.12);
  for (let k = 0; k < 7; k++) {
    const a = -1.05 + (k / 6) * 2.1;
    const rib = put(MeshBuilder.CreateSphere("rib", { diameter: 1, segments: 6 }, scene), Math.sin(a) * 0.035, 0.03, -0.045 + Math.cos(a) * 0.035, -0.5 * Math.cos(a), a, 0);
    rib.scaling.set(0.01, 0.012, 0.09);
  }
  put(MeshBuilder.CreateBox("hinge", { width: 0.035, height: 0.02, depth: 0.02 }, scene), 0, 0.012, -0.058);
  const mesh = Mesh.MergeMeshes(parts, true)!;
  mesh.material = colour(scene, "shell", 0xe7c3ae, 0.35);
  return named(mesh, id);
}

const named = (mesh: Mesh, id: string) => {
  mesh.name = id;
  mesh.receiveShadows = true;
  mesh.isPickable = false;
  return mesh;
};
