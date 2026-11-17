// The dam at the building site, and the lodge that appears in the pond when it is finished. Sticks are laid by the
// plan in rules.ts (damPlan), not stacked by physics: each one is frozen into an InstancedMesh at its slot, so the
// whole dam costs a few draw calls. A mud mound grows under them, and one convex collider over it makes the dam
// solid to walk on.
//
//   const dam = createDam(stage, world);
//   dam.slot(i)                 where slot i is in the world (position, turn); dam.fit(mesh, i) puts a stick there
//   dam.freeze(mesh)            draws a stick mesh (already at its slot) as part of the dam, and takes it away
//   dam.shape(placed)           mud and collider for this many sticks
//   dam.frame                   the dam's own frame: origin on the ground, x across (towards the water), z along
//   dam.lodge(grow)             the lodge in the pond, grow 0 … 1 (rising out of the water)
import * as THREE from "three";
import type { World } from "../../contracts.ts";
import { RAPIER, type Stage } from "../../engine.ts";
import { fbm, noise, seeded } from "../../world/noise.ts";
import { DAM, damPlan, moundHeight, crestHeight, profile, SLOTS } from "./rules.ts";

const MUD = new THREE.Color().setRGB(0.25, 0.19, 0.13, THREE.SRGBColorSpace), DRIED = new THREE.Color().setRGB(0.42, 0.34, 0.25, THREE.SRGBColorSpace);

export function createDam(stage: Stage, world: World) {
  const { scene, physics } = stage, site = world.site!, pond = world.pond!;
  // The frame: from the site's middle towards the pond is across (+x); the dam lies along the shore.
  const across = new THREE.Vector3(pond.x - site.x, 0, pond.z - site.z).normalize();
  const origin = new THREE.Vector3(site.x, 0, site.z).addScaledVector(across, 1.1); // its water side on the shore
  origin.y = world.heightAt(origin.x, origin.z);
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-across.z, across.x));
  const toWorld = (x: number, z: number) => new THREE.Vector3(x, 0, z).applyQuaternion(turn).add(origin).setY(0);
  const plan = damPlan();

  const group = new THREE.Group();
  group.name = "dam";
  scene.add(group);

  // ---- sticks -----------------------------------------------------------------------------------------------------
  const batches = new Map<string, THREE.InstancedMesh>();
  const slot = (i: number) => {
    const s = plan[Math.min(i, SLOTS - 1)]!, at = toWorld(s.x, s.z);
    at.y = world.heightAt(at.x, at.z) + s.y;
    const q = turn.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-s.pitch, s.yaw, 0, "YXZ")));
    return { position: at, quaternion: q };
  };
  const freeze = (thing: THREE.Object3D) => {
    thing.updateMatrixWorld(true);
    thing.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = [mesh.material].flat()[0]!, key = `${mesh.geometry.uuid}|${material.uuid}`;
      let many = batches.get(key);
      if (!many) {
        many = new THREE.InstancedMesh(mesh.geometry, material, SLOTS + 4);
        many.count = 0;
        many.castShadow = many.receiveShadow = true;
        batches.set(key, many);
        group.add(many);
      }
      many.setMatrixAt(many.count++, mesh.matrixWorld);
      many.instanceMatrix.needsUpdate = true;
      many.computeBoundingSphere();
    });
    thing.removeFromParent();
  };

  // ---- mud and collider -------------------------------------------------------------------------------------------
  const cols = 22, rows = 36, mudGeometry = new THREE.PlaneGeometry(2 * DAM.base, DAM.length, cols, rows).rotateX(-Math.PI / 2);
  const mudPos = mudGeometry.attributes.position as THREE.BufferAttribute, local = new Float32Array(mudPos.array);
  const colors = new Float32Array(mudPos.count * 3);
  mudGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mud = new THREE.Mesh(mudGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
  mud.castShadow = mud.receiveShadow = true;
  mud.visible = false;
  group.add(mud);
  let collider: RAPIER.Collider | undefined;
  const c = new THREE.Color();

  const shape = (placed: number) => {
    const height = moundHeight(placed);
    mud.visible = height > 0.005;
    for (let i = 0; i < mudPos.count; i++) {
      const x = local[i * 3]!, z = local[i * 3 + 2]!, at = toWorld(x, z), p = profile(x, z);
      const lump = 1 + 0.45 * fbm(at.x * 4.3, at.z * 4.3, 3) + 0.15 * noise(at.x * 13, at.z * 13);
      mudPos.setXYZ(i, at.x, world.heightAt(at.x, at.z) - 0.04 + height * p * p * (3 - 2 * p) * lump, at.z); // rounded
      c.copy(MUD).lerp(DRIED, THREE.MathUtils.smoothstep(p * lump, 0.5, 1.2) * (0.4 + 0.6 * noise(at.x * 6, at.z * 6)));
      c.toArray(colors, i * 3);
    }
    mudPos.needsUpdate = true;
    (mudGeometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    mudGeometry.computeVertexNormals();
    mudGeometry.computeBoundingSphere();
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
  let lodge: { group: THREE.Group; sticks: THREE.InstancedMesh[]; count: number } | undefined;
  const LODGE = { radius: 1.25, height: 1.95, floor: -1.3 };
  const lodgeAt = new THREE.Vector3(pond.x, 0, pond.z).addScaledVector(across, 0.6);

  const buildLodge = () => {
    const g = new THREE.Group();
    g.position.set(lodgeAt.x, world.waterLevel + LODGE.floor, lodgeAt.z);
    const dome = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    const pos = dome.attributes.position as THREE.BufferAttribute, colours = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), lump = 1 + 0.12 * fbm(x * 2.5 + 9, z * 2.5 + y * 2, 3);
      pos.setXYZ(i, x * LODGE.radius * lump, y * LODGE.height, z * LODGE.radius * lump);
      c.copy(MUD).lerp(DRIED, THREE.MathUtils.smoothstep(y, 0.7, 1) * 0.8).toArray(colours, i * 3);
    }
    dome.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    dome.computeVertexNormals();
    const mound = new THREE.Mesh(dome, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
    mound.castShadow = mound.receiveShadow = true;
    g.add(mound);
    // Sticks all over the part above the water, along the slope and across it.
    const template = world.props!.stick[0]!, random = seeded(5), count = 90, matrices: THREE.Matrix4[] = [];
    const size = new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3());
    for (let k = 0; k < count; k++) {
      const a = random() * Math.PI * 2, e = 0.12 + random() * 1.2, y = Math.sin(e), r = Math.cos(e);
      if (y * LODGE.height + LODGE.floor < -0.15) { k--; continue; }
      const at = new THREE.Vector3(Math.cos(a) * r * LODGE.radius * 1.02, y * LODGE.height + 0.02, Math.sin(a) * r * LODGE.radius * 1.02);
      const normal = new THREE.Vector3(Math.cos(a) * r / LODGE.radius, y / LODGE.height, Math.sin(a) * r / LODGE.radius).normalize();
      const tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).applyAxisAngle(normal, (random() - 0.5) * 2.6);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      const length = 0.55 + random() * 0.5, thick = 1.2 + random() * 0.8;
      matrices.push(new THREE.Matrix4().compose(at, q, new THREE.Vector3(thick, thick, length / size.z)));
    }
    const sticks: THREE.InstancedMesh[] = [];
    template.updateMatrixWorld(true);
    template.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const many = new THREE.InstancedMesh(mesh.geometry, mesh.material, count);
      matrices.forEach((m, k) => many.setMatrixAt(k, m.clone().multiply(mesh.matrixWorld)));
      many.castShadow = many.receiveShadow = true;
      many.computeBoundingSphere();
      many.count = 0;
      sticks.push(many);
      g.add(many);
    });
    scene.add(g);
    const hull = new Float32Array(Array.from({ length: pos.count }, (_, i) => [pos.getX(i), pos.getY(i) + g.position.y, pos.getZ(i)]).flatMap(([x, y, z]) => [x! + g.position.x, y!, z! + g.position.z]));
    const desc = RAPIER.ColliderDesc.convexHull(hull);
    if (desc) physics.createCollider(desc.setFriction(0.9));
    return { group: g, sticks, count };
  };

  /** Laid sticks are drawn a little thicker than carried ones, so 30 of them read as a dam and not as twigs. */
  const LAID = new THREE.Vector3(2, 2, 1.05);
  /** Puts a stick mesh at its slot, as thick as it is drawn in the dam. */
  const fit = (mesh: THREE.Object3D, i: number) => {
    const to = slot(i);
    mesh.position.copy(to.position); mesh.quaternion.copy(to.quaternion); mesh.scale.copy(LAID);
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
      lodge.group.position.y = world.waterLevel + LODGE.floor - (1 - e) * (LODGE.height + 0.2);
      for (const many of lodge.sticks) many.count = Math.round(lodge.count * Math.min(1, grow * 1.2));
    },
    lodgeAt,
  };
}
export type Dam = ReturnType<typeof createDam>;
