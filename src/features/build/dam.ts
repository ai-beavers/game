import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { instance, material } from "../../world/models.ts";
// The dam at the building site, and the lodge that appears in the pond when it is finished. Sticks are laid by the
// plan in rules.ts (damPlan) and share the prop meshes. A mud mound grows under them, and one convex collider over it makes the dam
// solid to walk on.
//
//   const dam = createDam(stage, world);
//   dam.slot(i)                 where slot i is in the world (position, turn); dam.fit(mesh, i) puts a stick there
//   dam.freeze(mesh)            draws a stick mesh (already at its slot) as part of the dam, and takes it away
//   dam.shape(placed)           mud and collider for this many sticks
//   dam.frame                   the dam's own frame: origin on the ground, x across (towards the water), z along
//   dam.lodge(grow)             the lodge in the pond, grow 0 … 1 (rising out of the water)
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { World } from "../../contracts.ts";
import { RAPIER, type Stage } from "../../engine.ts";
import { fbm, seeded } from "../../world/noise.ts";
import { DAM, damPlan, moundHeight, crestHeight, profile, SLOTS } from "./rules.ts";

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
  const slot = (i: number) => {
    const s = plan[Math.min(i, SLOTS - 1)]!, at = toWorld(s.x, s.z);
    at.y = world.heightAt(at.x, at.z) + s.y;
    const q = turn.clone().multiply(Quaternion.RotationYawPitchRoll(s.yaw, -s.pitch, 0));
    return { position: at, quaternion: q };
  };
  const freeze = (thing: TransformNode) => { thing.setParent(group); };
  const mud = MeshBuilder.CreateGround("dam mud", { width: 2 * DAM.base, height: DAM.length, subdivisions: 28, updatable: true }, scene);
  mud.parent = group;
  mud.receiveShadows = true;
  mud.material = material(scene, "silt", 0x68533c);
  const local = mud.getVerticesData("position")!.slice(), positions = local.slice();
  let collider: RAPIER.Collider | undefined;
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
    if (collider) physics.removeCollider(collider, true);
    collider = undefined;
    const crest = crestHeight(placed);
    if (crest < 0.02) return;
    const hull: number[] = [], crestScale = DAM.top / DAM.base;
    for (const [k, y] of [[1, -0.03], [crestScale, crest]] as const)
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const at = toWorld(Math.cos(a) * DAM.base * k, Math.sin(a) * (DAM.length / 2) * k);
        hull.push(at.x, world.heightAt(at.x, at.z) + y, at.z);
      }
    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(hull));
    if (desc) collider = physics.createCollider(desc.setFriction(1));
  };

  // ---- the lodge --------------------------------------------------------------------------------------------------
  const lodgeAt = new Vector3(pond.x, 0, pond.z).add(across.scale(0.6));
  let lodge: ReturnType<typeof buildLodge> | undefined;
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
    const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(mound.getVerticesData("position")!));
    const collider = hull ? physics.createCollider(hull.setFriction(0.9)) : undefined;
    return { root, collider };
  }
  /** Laid sticks are drawn a little thicker than carried ones, so 30 of them read as a dam and not as twigs. */
  const LAID = new Vector3(2, 2, 1.05);
  /** Puts a stick mesh at its slot, as thick as it is drawn in the dam. */
  const fit = (mesh: TransformNode, i: number) => {
    const to = slot(i);
    mesh.position.copyFrom(to.position);
    mesh.rotationQuaternion = to.quaternion;
    mesh.scaling.copyFrom(LAID);
  };

  return {
    frame: { origin, turn, across },
    slot,
    fit,
    laid: LAID,
    freeze,
    shape,
    /** Where the next stick goes, for facing it. */
    plan,
    /** The lodge in the pond, grown this far (0 … 1): it rises out of the water, sticks and all. */
    lodge(grow: number) {
      lodge ??= buildLodge();
      const e = 1 - (1 - Math.min(1, grow)) ** 3;
      lodge.root.position.y = world.waterLevel - 1.3 - (1 - e) * 2.15;
      lodge.collider?.setTranslation(lodge.root.position);
    },
    lodgeAt,
  };
}
export type Dam = ReturnType<typeof createDam>;
