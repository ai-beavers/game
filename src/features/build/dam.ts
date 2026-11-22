import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { instance, material } from "../../world/models.ts";
// The dam at the building site, and the lodge that appears in the pond when it is finished. Sticks are laid by the
// plan in rules.ts (damPlan) and share the prop meshes. A mud mound grows under them, and one convex collider over it makes the dam
// solid to walk on.
//
//   const dam = createDam(stage, world);
//   dam.slot(i)                 where slot i is in the world (position, turn, size); dam.fit(mesh, i) puts a stick there
//                               (slots from SLOTS on lie on the lodge, and rise with it; from SLOTS + LODGE on they
//                               are the food cache's, on the pond's bed at dam.cacheAt)
//   dam.freeze(mesh)            draws a stick mesh (already fitted to its slot) as part of the dam or lodge
//   dam.shape(placed)           mud and collider for this many sticks
//   dam.frame                   the dam's own frame: origin on the ground, x across (towards the water), z along
//   dam.at(x, z) · dam.top(at)  a point of the frame in the world · the height of the dam's top there (its mud or a
//                               stick on it), or undefined off the dam
//   dam.lodge(grow)             the lodge in the pond, grow 0 … 1 (rising out of the water)
//   dam.hint(i, time)           a glowing stick where slot i is, so the player sees where the next one goes; -1 hides it
//                               (over the cache its beam reaches up out of the water, seen from the surface)
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Ray } from "@babylonjs/core/Culling/ray.js";
import type { World } from "../../contracts.ts";
import type { Stage } from "../../engine.ts";
import { hull as hullOf, place, SOLID, type PhysicsBody } from "../../physics.ts";
import { fbm, seeded } from "../../world/noise.ts";
import { CACHE_AT, cachePlan, DAM, damPlan, LODGE, moundHeight, crestHeight, profile, SLOTS, STICKS } from "./rules.ts";

export function createDam(stage: Stage, world: World) {
  const { scene, physics } = stage, site = world.site!, pond = world.pond!;
  // The frame: from the site's middle towards the pond is across (+x); the dam lies along the shore.
  const across = new Vector3(pond.x - site.x, 0, pond.z - site.z).normalize();
  const origin = new Vector3(site.x, 0, site.z).add(across.scale(1.1)); // its water side on the shore
  origin.y = world.heightAt(origin.x, origin.z);
  const turn = Quaternion.RotationAxis(new Vector3(0, 1, 0), Math.atan2(-across.z, across.x));
  const toWorld = (x: number, z: number) => new Vector3(x, 0, z).applyRotationQuaternion(turn).add(origin);
  const plan = damPlan();

  const group = new TransformNode("dam", scene);
  /** Laid sticks are drawn a little thicker than carried ones, so 30 of them read as a dam and not as twigs. */
  const LAID = new Vector3(2, 2, 1.05);
  /** The cache's sticks are drawn longer, as branches, so the pile reads as a heap of them. */
  const BRANCH = new Vector3(2, 2, 1.6);
  const cache = cachePlan(), cacheAt = new Vector3(CACHE_AT.x, world.heightAt(CACHE_AT.x, CACHE_AT.z), CACHE_AT.z);
  const slot = (i: number): { position: Vector3; quaternion: Quaternion; scaling: Vector3 } => {
    if (i >= SLOTS + LODGE) { // in the food cache, on the bed
      const c = cache[i - SLOTS - LODGE]!, at = cacheAt.add(new Vector3(c.x, 0, c.z));
      at.y = (world.heightAt(at.x, at.z) + cacheAt.y) / 2 + c.y; // half into the slope it leans on: a heap, not a scatter
      return { position: at, quaternion: Quaternion.RotationYawPitchRoll(c.yaw, -c.pitch, 0), scaling: BRANCH };
    }
    if (i >= SLOTS) { // on the lodge, where it stands now
      const l = lodgeSlot(i - SLOTS), root = lodgeRoot();
      return { position: l.position.add(root.position), quaternion: l.quaternion.clone(), scaling: LAID };
    }
    const s = plan[i]!, at = toWorld(s.x, s.z);
    at.y = world.heightAt(at.x, at.z) + s.y;
    const q = turn.clone().multiply(Quaternion.RotationYawPitchRoll(s.yaw, -s.pitch, 0));
    return { position: at, quaternion: q, scaling: LAID };
  };
  /** Keeps a stick where it is, as part of the dam; one fitted onto the lodge stays the lodge's, rising with it. */
  const freeze = (thing: TransformNode) => { if (!lodge || thing.parent !== lodge.root) thing.setParent(group); };
  const mud = MeshBuilder.CreateGround("dam mud", { width: 2 * DAM.base, height: DAM.length, subdivisions: 28, updatable: true }, scene);
  mud.parent = group;
  mud.receiveShadows = true;
  mud.material = material(scene, "silt", 0x68533c);
  const local = mud.getVerticesData("position")!.slice(), positions = local.slice();
  let collider: PhysicsBody | undefined;
  const shape = (placed: number) => {
    const height = moundHeight(placed);
    mud.setEnabled(height > 0.005);
    for (let i = 0; i < local.length; i += 3) {
      const x = local[i]!, z = local[i + 2]!, at = toWorld(x,z), p = profile(x,z);
      positions[i] = at.x;
      positions[i + 1] = world.heightAt(at.x, at.z) - 0.04 + height * p * p * (3 - 2 * p) * (1 + 0.3 * fbm(at.x * 4, at.z * 4, 3));
      positions[i + 2] = at.z;
    }
    mud.updateVerticesData("position", positions, true);
    mud.createNormals(true);
    // The collider: the mound's foot and crest as one convex hull, as high as the sticks.
    if (collider) physics.remove(collider);
    collider = undefined;
    const crest = crestHeight(placed);
    if (crest < 0.02) return;
    const hull: number[] = [], crestScale = DAM.top / DAM.base;
    for (const [k, y] of [[1, -0.03], [crestScale, crest]] as const)
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const at = toWorld(Math.cos(a) * DAM.base * k, Math.sin(a) * (DAM.length / 2) * k);
        hull.push(at.x, world.heightAt(at.x, at.z) + y, at.z);
      }
    const solid = hullOf(scene, hull);
    if (solid) collider = physics.fixed(solid, SOLID, 1);
  };

  // ---- the lodge --------------------------------------------------------------------------------------------------
  const lodgeAt = new Vector3(pond.x, 0, pond.z).add(across.scale(0.6));
  let lodge: ReturnType<typeof buildLodge> | undefined;
  const lodgeRoot = () => (lodge ??= buildLodge()).root;
  /** Where the k-th stick the beaver brings goes on the lodge, around it from the roof down, so each lands just above
   *  the water as it is then; in the lodge's frame (it only moves up and down). */
  const lodgeSlot = (k: number) => {
    const a = k * 2.4 + 0.5, h = 0.95 - 0.27 * Math.min(1, k / (LODGE - 1)), r = Math.sqrt(1 - h * h);
    return {
      position: new Vector3(Math.cos(a) * r * 1.3, h * 2, Math.sin(a) * r * 1.3),
      quaternion: Quaternion.FromEulerAngles(0.35 + 0.3 * (k % 2), -a + Math.PI / 2 + (k % 3 - 1) * 0.5, 0),
    };
  };
  function buildLodge() {
    const root = new TransformNode("lodge", scene);
    root.position.copyFrom(lodgeAt);
    const mound = MeshBuilder.CreateSphere("lodge mound", { diameterX: 2.5, diameterY: 3.9, diameterZ: 2.5, segments: 16 }, scene);
    mound.parent = root;
    mound.material = mud.material;
    const random = seeded(5);
    for (let i = 0; i < 65; i++) {
      const a = random() * 2 * Math.PI, h = 0.65 + random() * 0.34, r = Math.sqrt(1 - h*h);
      const stick = instance(world.props!.stick[0]!, "lodge stick", root);
      stick.position.set(Math.cos(a)*r*1.25, h*1.95, Math.sin(a)*r*1.25);
      stick.rotation.set(random()*0.5, -a, 0);
      stick.scaling.set(1.4, 1.4, 1.05);
    }
    const hull = hullOf(scene, mound.getVerticesData("position")!);
    const collider = hull ? physics.fixed(hull, SOLID, 0.9, root.position) : undefined;
    return { root, collider };
  }
  /** Puts a stick mesh at its slot, as thick as it is drawn there. */
  const fit = (mesh: TransformNode, i: number) => {
    const to = slot(i);
    mesh.position.copyFrom(to.position);
    mesh.rotationQuaternion = to.quaternion;
    mesh.scaling.copyFrom(to.scaling);
    if (i >= SLOTS && i < SLOTS + LODGE) mesh.setParent(lodgeRoot()); // keeps where it is now, and rises with the lodge from here on
  };

  // The hint: a stick of light where the next one goes, breathing, and a faint beam above it, so the place is seen
  // from across the clearing.
  const hintRoot = new TransformNode("next stick", scene), glow = new StandardMaterial("next stick", scene), haze = new StandardMaterial("next stick beam", scene);
  const rod = MeshBuilder.CreateCylinder("next stick", { height: 0.66, diameter: 0.08, tessellation: 8 }, scene);
  const beam = MeshBuilder.CreateCylinder("next stick beam", { height: 1.6, diameterTop: 0.02, diameterBottom: 0.16, tessellation: 8 }, scene);
  rod.parent = beam.parent = hintRoot;
  beam.position.y = 0.8;
  rod.rotationQuaternion = new Quaternion();
  for (const [mesh, mat] of [[rod, glow], [beam, haze]] as const) {
    mesh.isPickable = false;
    mat.disableLighting = true;
    mat.emissiveColor = new Color3(1, 0.85, 0.4);
    mesh.material = mat;
  }
  hintRoot.setEnabled(false);
  const ALONG_Z = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI / 2); // a cylinder stands on y; sticks lie along z
  const hint = (i: number, time: number) => {
    hintRoot.setEnabled(i >= 0 && i < STICKS);
    if (i < 0 || i >= STICKS) return;
    const to = slot(i), breath = 0.5 + 0.5 * Math.sin(time * 4);
    hintRoot.position.copyFrom(to.position).y += 0.06 + 0.04 * breath;
    // On the bed the beam reaches 0.6 m out of the water, so the place shows from the surface.
    const tall = Math.max(1, (world.waterLevel + 0.6 - hintRoot.position.y) / 1.6);
    beam.scaling.y = tall;
    beam.position.y = 0.8 * tall;
    to.quaternion.multiplyToRef(ALONG_Z, rod.rotationQuaternion!);
    glow.alpha = 0.45 + 0.45 * breath;
    haze.alpha = 0.3 + 0.2 * breath;
  };

  const down = new Vector3(0, -1, 0);
  /** The height of the dam's top at a point of the world: the mud, or a laid stick on it, whichever is higher. */
  const top = (at: Vector3) => {
    const from = new Vector3(at.x, world.heightAt(at.x, at.z) + 1, at.z);
    const hit = scene.pickWithRay(new Ray(from, down, 1.2), (mesh) => mesh.isEnabled() && mesh.isDescendantOf(group));
    return hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : undefined;
  };

  return {
    frame: { origin, turn, across },
    at: toWorld,
    top,
    slot,
    fit,
    freeze,
    shape,
    /** Where the next stick goes, for facing it. */
    plan,
    /** The lodge in the pond, grown this far (0 … 1): it rises out of the water, sticks and all. */
    lodge(grow: number) {
      lodge ??= buildLodge();
      const e = 1 - (1 - Math.min(1, grow)) ** 3;
      lodge.root.position.y = world.waterLevel - 1.3 - (1 - e) * 2.15;
      if (lodge.collider) place(lodge.collider, lodge.root.position);
    },
    lodgeAt,
    /** The middle of the food cache, on the bed. */
    cacheAt,
    hint,
  };
}
export type Dam = ReturnType<typeof createDam>;
