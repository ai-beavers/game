// The Clear view (GLOSSARY.md): the leaves that hide the beaver from the player's camera, or that the camera stands in,
// go see-through, eased, for as long as they are in the way, and come back after. Leaves only: tree crowns, bushes and
// reeds (the "leaves" material), each mesh (or thin instance) as a turned box, crowns and bushes as the ellipsoid in it
// (volumes.ts). Trunks, rocks, crates, logs, the lodge have colliders: the camera's cast brings it in for those.
//
//   const near = occluders(scene, player.node);   at the start, before the first picture: the thin instances are all there
//   near(feet, dt)                                the volumes within RANGE m of the feet, looked at anew every REFRESH s
//   const look = watch(); look(dt, eye, points, volumes, solid)   what to fade now
//   const fade = fader(scene); fade.want(volumes); fade.update(dt)
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { inside, KEEP_OUT, sight, volume, type Volume, type XYZ } from "./volumes.ts";

const RANGE = 14, REFRESH = 0.5; // m round the beaver, s

function volumeOf(mesh: AbstractMesh, local: { min: Vector3; max: Vector3 }, world: Matrix): Volume | undefined {
  const h = local.max.subtract(local.min).scaleInPlace(0.5);
  const axes = [new Vector3(h.x, 0, 0), new Vector3(0, h.y, 0), new Vector3(0, 0, h.z)].map((a) => Vector3.TransformNormal(a, world));
  const sizes = axes.map((a) => a.length()).sort((a, b) => a - b);
  if (sizes[0]! < 0.02 || sizes[1]! < 0.08) return; // a stick, a stem: hides no beaver
  return volume(Vector3.TransformCoordinates(local.min.add(local.max).scaleInPlace(0.5), world), axes as [Vector3, Vector3, Vector3],
    mesh.material?.name === "leaves" && !mesh.name.startsWith("reed"), mesh); // crowns and bushes round; reeds a box the camera may stand in
}
/** Leaves that may hide the beaver: not the player's own (a hat, a load). */
const hides = (mesh: AbstractMesh, mine: TransformNode) => mesh.material?.name === "leaves" && !mesh.isDescendantOf(mine);

/** The volume of one plain leaf mesh as it stands now (a crown, bush or reed), tagged with it. */
export function leafVolume(mesh: AbstractMesh) {
  const box = mesh.getBoundingInfo().boundingBox;
  return volumeOf(mesh, { min: box.minimum, max: box.maximum }, mesh.computeWorldMatrix());
}

/** faded: whether the fader hides a mesh now (its stand-in drawn instead), so it stays among the volumes. */
export function occluders(scene: Scene, mine: TransformNode, faded: (mesh: AbstractMesh) => boolean = () => false) {
  // Bushes, reeds and far trees are thin instances that never move (src/world: scatterBackdrop); taken once, whole,
  // before the backdrop is first culled to the picture.
  const still: Volume[] = [];
  for (const mesh of scene.meshes) {
    if (!(mesh instanceof Mesh) || !mesh.thinInstanceCount || !hides(mesh, mine)) continue;
    const p = mesh.getVerticesData("position");
    if (!p) continue;
    const min = new Vector3(Infinity, Infinity, Infinity), max = min.negate();
    for (let i = 0; i < p.length; i += 3) { min.minimizeInPlaceFromFloats(p[i]!, p[i + 1]!, p[i + 2]!); max.maximizeInPlaceFromFloats(p[i]!, p[i + 1]!, p[i + 2]!); }
    // shortcut: a thin instance cannot be faded alone (the backdrop's cull rewrites its matrices), so its tag stays empty;
    // the camera keeps out of it (room) but it may hide the beaver. A per-instance alpha in src/world if that falls short.
    for (const m of mesh.thinInstanceGetWorldMatrices()) { const v = volumeOf(mesh, { min, max }, m); if (v) still.push({ ...v, tag: undefined }); }
  }
  let near: Volume[] = [], age = Infinity;
  const reach = (v: Volume, at: Vector3) => Math.hypot(v.at.x - at.x, v.at.z - at.z) - v.lengths[0]! - v.lengths[1]! - v.lengths[2]! < RANGE;
  return (feet: Vector3, dt: number) => {
    if ((age += dt) < REFRESH) return near;
    age = 0;
    near = still.filter((v) => reach(v, feet));
    for (const mesh of scene.meshes) {
      if ((mesh instanceof Mesh && mesh.thinInstanceCount) || !mesh.isEnabled() || (!mesh.isVisible && !faded(mesh)) || !mesh.getTotalVertices() || !hides(mesh, mine)) continue;
      const v = leafVolume(mesh);
      if (v && reach(v, feet)) near.push(v);
    }
    return near;
  };
}

const HIDDEN = 0.5, LOOK = 0.25; // s the beaver is hidden before what hides it fades (a crown brushing past is no reason); s between looks

/** Looks whether the beaver is seen, LOOK s apart: hidden for HIDDEN s, the leaves in the way are to fade; the leaves
 *  the camera stands in at once, every frame. Returns the volumes to fade now (fader.want). solid: whether a collider
 *  is in between (sight). */
export function watch() {
  let looked = 0, hidden = 0;
  return (dt: number, eye: XYZ, points: XYZ[], volumes: Volume[], solid?: (from: XYZ, to: XYZ) => boolean): Volume[] => {
    const wanted = volumes.filter((v) => inside(v, eye, v.round ? KEEP_OUT : 0));
    if ((looked += dt) < LOOK) return wanted;
    const now = sight(eye, points, volumes, solid);
    hidden = now.seen ? 0 : hidden + looked;
    looked = 0;
    if (hidden >= HIDDEN) for (const v of now.by) if (!wanted.includes(v)) wanted.push(v);
    return wanted;
  };
}

const SEE_THROUGH = 0.25, FADE = 1.5, LINGER = 1; // visibility while in the way; per s; s it stays faded after

/** Fades meshes in the way: a plain mesh by its visibility; an instance, or leaves (their shader knows no alpha),
 *  by a stand-in drawn see-through in its place while the instance hides. */
export function fader(scene: Scene) {
  const faded = new Map<AbstractMesh, { level: number; until: number; proxy?: Mesh }>();
  let clock = 0;
  return {
    /** Whether the mesh is faded now, or easing back. */
    has: (mesh: AbstractMesh) => faded.has(mesh),
    want(volumes: Iterable<Volume>) {
      for (const v of volumes) {
        const mesh = v.tag as AbstractMesh | undefined;
        if (!mesh) continue;
        const f = faded.get(mesh) ?? { level: 1, until: 0 };
        f.until = clock + LINGER;
        faded.set(mesh, f);
      }
    },
    update(dt: number) {
      clock += dt;
      for (const [mesh, f] of faded) {
        const goal = clock < f.until && !mesh.isDisposed() ? SEE_THROUGH : 1;
        f.level += Math.max(-FADE * dt, Math.min(FADE * dt, goal - f.level));
        const own = mesh instanceof Mesh && !(mesh.material instanceof ShaderMaterial);
        if (own) mesh.visibility = f.level;
        else if (f.level < 1) {
          f.proxy ??= proxyOf(scene, mesh);
          const world = mesh.computeWorldMatrix(true);
          world.decompose(f.proxy.scaling, f.proxy.rotationQuaternion!, f.proxy.position);
          f.proxy.visibility = f.level;
          mesh.isVisible = false;
        }
        if (f.level >= 1) {
          if (f.proxy) { f.proxy.dispose(); if (!mesh.isDisposed()) mesh.isVisible = true; }
          faded.delete(mesh);
        }
      }
    },
  };
}

function proxyOf(scene: Scene, mesh: AbstractMesh) {
  const source = mesh instanceof InstancedMesh ? mesh.sourceMesh : mesh as Mesh;
  const proxy = source.clone(mesh.name + " faded", null, true, false);
  proxy.parent = null;
  proxy.rotationQuaternion = new Quaternion();
  proxy.setEnabled(true);
  proxy.isVisible = true;
  if (source.material instanceof ShaderMaterial) { // leaves: their texture on a plain material that can be see-through
    const leaves = new StandardMaterial(mesh.name + " faded", scene);
    leaves.diffuseTexture = source.material.getActiveTextures()[0] ?? null;
    if (leaves.diffuseTexture) leaves.diffuseTexture.hasAlpha = true;
    leaves.useAlphaFromDiffuseTexture = true;
    leaves.backFaceCulling = false;
    leaves.specularColor.setAll(0);
    proxy.material = leaves;
    proxy.onDisposeObservable.add(() => leaves.dispose(false, false));
  }
  return proxy;
}
