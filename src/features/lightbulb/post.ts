// The Lightbulb as the world shows it: a crooked wooden post beside the workbench, an arm at its top, and from the arm
// one bare glass bulb hanging on a cord in a dark socket, a pull string with a wooden knob below it. The post, arm and
// cord are matte and merged; the glass keeps its own material, its emissive colour fed by the feature each frame; the
// pull string is apart so it can give when the cord is pulled. None of it throws a shadow. place.ts says where it stands.
//
//   const post = createPost(stage, world);
//   post.glass          the glass's material: its emissiveColor is the glow
//   post.tug(k)         the pull string drawn down, k 0 … 1
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { World } from "../../contracts.ts";
import type { Stage } from "../../engine.ts";
import { cylinder } from "../../physics.ts";
import { material } from "../../world/models.ts";
import { FRONT, POST } from "./place.ts";

/** The glass's warm white, unlit and lit. */
const GLASS = new Color3(0.58, 0.58, 0.56);
export const WARM_WHITE = new Color3(1, 0.9, 0.72);
/** m the pull string gives at the height of a tug. */
const GIVE = 0.07;

export function createPost(stage: Stage, world: World) {
  const { scene, physics } = stage;
  const ground = world.heightAt(POST.x, POST.z);
  const root = new TransformNode("lightbulb", scene);
  root.position.set(POST.x, ground - 0.02, POST.z);
  root.rotation.y = Math.atan2(FRONT.x, FRONT.z); // local +z: the way the arm reaches
  const wood = material(scene, "lightbulb post", 0x6f4a2c), dark = material(scene, "lightbulb socket", 0x2a2522);
  const cord = material(scene, "lightbulb cord", 0x3b3430);
  for (const m of [wood, dark, cord]) m.specularColor.setAll(0.03);
  const glass = new StandardMaterial("lightbulb glass", scene);
  glass.diffuseColor.copyFrom(GLASS);
  glass.specularColor.setAll(0.5);
  glass.specularPower = 90;

  const groups = new Map<StandardMaterial, Mesh[]>();
  const add = (mat: StandardMaterial, mesh: Mesh) => { groups.set(mat, [...(groups.get(mat) ?? []), mesh]); return mesh; };
  /** A round stick from a to b (local), d thick at a, d·taper at b. */
  const stick = (mat: StandardMaterial, a: Vector3, b: Vector3, d: number, taper = 0.85) => {
    const along = b.subtract(a), mesh = MeshBuilder.CreateCylinder("lightbulb stick", { height: along.length(), diameterBottom: d, diameterTop: d * taper, tessellation: 8 }, scene);
    mesh.position.copyFrom(a.add(b).scaleInPlace(0.5));
    // From its own up (y) to the way a → b.
    const up = Vector3.Up(), dir = along.normalize(), axis = Vector3.Cross(up, dir), angle = Math.acos(Math.min(1, Vector3.Dot(up, dir)));
    if (axis.lengthSquared() > 1e-8) mesh.rotate(axis.normalize(), angle);
    return add(mat, mesh);
  };
  const ball = (mat: StandardMaterial, at: Vector3, d: number, sy = 1) => {
    const mesh = MeshBuilder.CreateSphere("lightbulb ball", { diameter: d, segments: 10 }, scene);
    mesh.position.copyFrom(at);
    mesh.scaling.y = sy;
    return add(mat, mesh);
  };

  // ---- the crooked post: three lengths of branch, each a little off the last, a knot, and the arm at the top --------
  const H = POST.height, D = POST.radius * 2, A = POST.arm;
  const joints = [new Vector3(0, 0, 0), new Vector3(0.04, 0.5, -0.03), new Vector3(-0.03, 0.98, 0.02), new Vector3(0.01, H, 0)];
  for (let i = 0; i < 3; i++) stick(wood, joints[i]!, joints[i + 1]!, D * (1.1 - i * 0.12), 0.9);
  for (const i of [1, 2]) ball(wood, joints[i]!, D * (1.02 - i * 0.12)); // the bends rounded over
  ball(wood, joints[1]!.add(new Vector3(0.03, 0.06, 0.01)), D * 0.9, 0.8); // a knot above the first
  const tip = new Vector3(0, H + 0.02, A);
  stick(wood, joints[3]!.add(new Vector3(0, -0.03, 0)), tip, D * 0.8, 0.7);
  ball(wood, joints[3]!, D * 0.85);
  // ---- the cord down from the arm, the socket, the bulb's neck and the pull string's top ----------------------------
  const socketAt = H - 0.18;
  stick(cord, tip.add(new Vector3(0, -0.01, -0.01)), new Vector3(0, socketAt + 0.03, A), 0.012, 1);
  add(dark, MeshBuilder.CreateCylinder("lightbulb socket", { height: 0.055, diameterTop: 0.04, diameterBottom: 0.048, tessellation: 12 }, scene)).position.set(0, socketAt, A);
  for (const [mat, list] of groups) {
    const merged = Mesh.MergeMeshes(list, true, true)!;
    merged.name = `lightbulb ${mat.name}`;
    merged.material = mat;
    merged.parent = root;
    merged.receiveShadows = false; // throws none (light.ts): no new shadow caster
    merged.isPickable = false;
  }
  // ---- the glass: a pear of plain glass under the socket ------------------------------------------------------------
  const bulb = MeshBuilder.CreateSphere("lightbulb glass", { diameter: 0.1, segments: 14 }, scene);
  bulb.position.set(0, socketAt - 0.085, A);
  bulb.scaling.set(1, 1.12, 1);
  const neck = MeshBuilder.CreateCylinder("lightbulb neck", { height: 0.05, diameterTop: 0.04, diameterBottom: 0.07, tessellation: 14 }, scene);
  neck.position.set(0, socketAt - 0.045, A);
  const glassMesh = Mesh.MergeMeshes([bulb, neck], true, true)!;
  glassMesh.name = "lightbulb glass";
  glassMesh.material = glass;
  glassMesh.parent = root;
  // ---- the pull string beside the bulb, a wooden knob at its end (moves on a tug) -----------------------------------
  const pull = new TransformNode("lightbulb pull", scene);
  pull.parent = root;
  const top = socketAt - 0.015, end = 0.68;
  const string = MeshBuilder.CreateCylinder("lightbulb string", { height: top - end, diameter: 0.007, tessellation: 5 }, scene);
  string.position.set(0.035, (top + end) / 2, A);
  string.material = cord;
  const knob = MeshBuilder.CreateCylinder("lightbulb knob", { height: 0.05, diameterTop: 0.014, diameterBottom: 0.03, tessellation: 8 }, scene);
  knob.position.set(0.035, end - 0.02, A);
  knob.material = wood;
  // The string and the knob in one mesh, its material per part.
  const pullMesh = Mesh.MergeMeshes([string, knob], true, true, undefined, false, true)!;
  pullMesh.name = "lightbulb pull";
  pullMesh.parent = pull;
  for (const m of [glassMesh, pullMesh]) { m.receiveShadows = false; m.isPickable = false; }

  physics.fixed(cylinder(scene, H / 2, POST.radius + 0.03, { x: POST.x, y: ground + H / 2, z: POST.z }), undefined, 0.9);

  return {
    root,
    glass,
    /** The pull string drawn down by a paw, k 0 (at rest) … 1 (the lowest of the tug). */
    tug(k: number) { pull.position.y = -GIVE * k; },
  };
}
export type Post = ReturnType<typeof createPost>;
