// The game's physics on Havok (Babylon's physics v2): the collision groups every shape belongs to, the shapes the
// features build from, and the queries they ask (a ray, a shape swept along a line, a shape's overlap).
//
//   const physics = createPhysics(scene, await loadHavok())   once, in start() (src/engine.ts)
//   physics.fixed(box(half, at), SOLID)             a static collider, on its own node
//   physics.ray(from, dir, length, GROUND)          the nearest hit of the groups asked for, or undefined
//   physics.cast(shape, turn, from, dir, distance)  the nearest hit of a shape swept along dir
//
// Havok's queries filter by bitmask only (no filter function, unlike Rapier): every shape is in exactly one group
// (setGroup), and every query is a member of QUERY and names the groups it meets. Rays and casts that start inside a
// shape do not hit it.
import HavokPhysics from "@babylonjs/havok";
import havokWasm from "./havok-wasm.js";
import "@babylonjs/core/Physics/joinedPhysicsEngineComponent.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin.js";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody.js";
import { PhysicsMotionType, PhysicsPrestepType, PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js";
import {
  PhysicsShape, PhysicsShapeBox, PhysicsShapeCapsule, PhysicsShapeContainer, PhysicsShapeConvexHull, PhysicsShapeCylinder, PhysicsShapeSphere,
} from "@babylonjs/core/Physics/v2/physicsShape.js";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult.js";
import { ShapeCastResult } from "@babylonjs/core/Physics/shapeCastResult.js";
import { ProximityCastResult } from "@babylonjs/core/Physics/proximityCastResult.js";
import type { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine.js";

export { PhysicsBody, PhysicsMotionType, PhysicsShape, PhysicsShapeType };

/** The groups. GROUND: the terrain (src/world/terrain.ts). SOLID: anything else that never moves by itself (trees,
 *  rocks, the lodge, the canoe). LOOSE: light things that roll and get carried (sticks). HEAVY: what rolls and is
 *  too heavy for that (crates, logs, a felled tree while it falls). PLAYER: the beaver's own body. CREATURE: other
 *  bodies that walk (the Bear, other players' beavers): queries and the beaver's movement meet them, nothing else
 *  touches them. */
export const GROUND = 1, SOLID = 2, LOOSE = 4, HEAVY = 8, PLAYER = 16, CREATURE = 32;
const QUERY = 1 << 30; // every query's own group
/** What a query meets unless it names fewer groups: everything but the beaver itself. */
export const ALL = GROUND | SOLID | LOOSE | HEAVY | CREATURE;
const COLLIDES: Record<number, number> = {
  [GROUND]: ~0, [SOLID]: ~0, [LOOSE]: ~CREATURE, [HEAVY]: ~CREATURE, [PLAYER]: LOOSE | HEAVY | QUERY, [CREATURE]: QUERY,
};

const parts = new WeakMap<PhysicsShape, PhysicsShape[]>(); // a compound's shapes
/** Puts a shape in one group (0: in none, out of every contact and query, like a stick in the paws). A compound's
 *  shapes too: Havok filters by them, not by the compound. */
function setGroup(shape: PhysicsShape, group: number) {
  shape.filterMembershipMask = group;
  shape.filterCollideMask = group ? COLLIDES[group]! : 0;
  for (const part of parts.get(shape) ?? []) setGroup(part, group);
}

export interface XYZ { x: number; y: number; z: number }
export interface Hit {
  /** m along the ray or cast to the hit (for a cast: how far the shape moved before it touched). */
  distance: number;
  normal: Vector3;
  point: Vector3;
  body: PhysicsBody | undefined;
  shape: PhysicsShape | undefined;
}

const v = (p: XYZ) => new Vector3(p.x, p.y, p.z);

// ---- shapes: built where they stand in world space, so a static one goes on a node at the origin ----

/** A box of half extents (hx, hy, hz) centred at `at`, turned by `turn`. */
export const box = (scene: Scene, hx: number, hy: number, hz: number, at: XYZ = Vector3.ZeroReadOnly, turn = Quaternion.Identity()) =>
  new PhysicsShapeBox(v(at), turn, new Vector3(hx * 2, hy * 2, hz * 2), scene);
/** An upright cylinder of half height `half`, centred at `at`. */
export const cylinder = (scene: Scene, half: number, radius: number, at: XYZ = Vector3.ZeroReadOnly) =>
  new PhysicsShapeCylinder(new Vector3(at.x, at.y - half, at.z), new Vector3(at.x, at.y + half, at.z), radius, scene);
/** An upright capsule: `half` from the middle to each end's centre. */
export const capsule = (scene: Scene, half: number, radius: number, at: XYZ = Vector3.ZeroReadOnly) =>
  new PhysicsShapeCapsule(new Vector3(at.x, at.y - half, at.z), new Vector3(at.x, at.y + half, at.z), radius, scene);
export const ball = (scene: Scene, radius: number, at: XYZ = Vector3.ZeroReadOnly) => new PhysicsShapeSphere(v(at), radius, scene);

/** One shape of several, each built where it sits on the body and keeping its own density and friction. */
export function compound(scene: Scene, shapes: PhysicsShape[]) {
  const container = new PhysicsShapeContainer(scene);
  for (const shape of shapes) container.addChild(shape);
  parts.set(container, shapes);
  return container;
}

// Havok builds a hull from a Mesh's vertices; a throwaway one, never drawn.
const scratch = (scene: Scene, positions: Float32Array | number[]) => {
  const mesh = new Mesh("physics scratch", scene), data = new VertexData();
  data.positions = positions;
  data.applyToMesh(mesh);
  mesh.setEnabled(false);
  return mesh;
};
/** The convex hull of points (x, y, z, …), or undefined for too few. */
export function hull(scene: Scene, points: Float32Array | number[]) {
  if (points.length < 12) return undefined;
  const mesh = scratch(scene, points), shape = new PhysicsShapeConvexHull(mesh, scene);
  mesh.dispose();
  return shape;
}
/** A heightfield of n × n samples, `size` m square, centred on its node; heights[k + m * n] is the sample k along x
 *  and m along z. Square only: Babylon reorders the samples for Havok (z backwards) the right way only for a square
 *  one (checked with ray casts, see world.test.ts). */
export function heightfield(scene: Scene, n: number, size: number, heights: Float32Array) {
  const data = new Float32Array(n * n);
  for (let m = 0; m < n; m++) for (let k = 0; k < n; k++) data[(n - 1 - m) * n + k] = heights[k + m * n]!;
  return new PhysicsShape({ type: PhysicsShapeType.HEIGHTFIELD, parameters: {
    heightFieldSizeX: size, heightFieldSizeZ: size, numHeightFieldSamplesX: n, numHeightFieldSamplesZ: n, heightFieldData: data,
  } }, scene);
}

// ---- what the game does with a body that moves ----

const groups = new WeakMap<PhysicsBody, number>(); // the group each body's shape is in while it is enabled
export const dynamic = (body: PhysicsBody) => body.getMotionType() === PhysicsMotionType.DYNAMIC;
/** In the world: false while taken out by enable(body, false) (a stick in someone's paws). */
export const isEnabled = (body: PhysicsBody) => body.shape!.filterMembershipMask !== 0;
/** Takes a body out of every contact and query and holds it still (a stick in the paws, its node drawn elsewhere),
 *  or puts it back. */
export function enable(body: PhysicsBody, on: boolean) {
  setGroup(body.shape!, on ? groups.get(body)! : 0);
  body.setGravityFactor(on ? 1 : 0);
  body.setLinearVelocity(Vector3.ZeroReadOnly);
  body.setAngularVelocity(Vector3.ZeroReadOnly);
  body.disableSync = !on || !dynamic(body);
}
/** Lets a body fall and roll, or moves it only where it is put (a guest's copy of the host's world). */
export function simulate(body: PhysicsBody, on: boolean) {
  body.setMotionType(on ? PhysicsMotionType.DYNAMIC : PhysicsMotionType.ANIMATED);
  body.disableSync = !on || !isEnabled(body);
}
/** Puts a body and its node at `at` (and turned `turn`), at once, standing still. */
export function place(body: PhysicsBody, at: XYZ, turn?: { x: number; y: number; z: number; w: number }) {
  const node = body.transformNode;
  node.position.set(at.x, at.y, at.z);
  if (turn) node.rotationQuaternion!.set(turn.x, turn.y, turn.z, turn.w);
  node.computeWorldMatrix(true);
  ((node.getScene().getPhysicsEngine() as PhysicsEngine).getPhysicsPlugin() as HavokPlugin).setPhysicsBodyTransformation(body, node);
  body.setLinearVelocity(Vector3.ZeroReadOnly);
  body.setAngularVelocity(Vector3.ZeroReadOnly);
}
/** Moves the group a body is in (a felled tree is HEAVY while it falls, SOLID once it lies). */
export function regroup(body: PhysicsBody, group: number) {
  groups.set(body, group);
  if (isEnabled(body)) setGroup(body.shape!, group);
}

let loading: ReturnType<typeof HavokPhysics> | undefined;
/** Havok's WebAssembly, loaded once: give it to createPhysics. Its file is the bundle's own (Havok would look for it
 *  beside its module, where no bundle puts it); index.html's loading screen fetches it first. */
export const loadHavok = () => loading ??= HavokPhysics({
  // An address on the page's server; under bun test a path on disk (no page there).
  locateFile: () => new URL(havokWasm, globalThis.location?.href ?? import.meta.url).href,
});

export function createPhysics(scene: Scene, havok: Awaited<ReturnType<typeof HavokPhysics>>) {
  const plugin = new HavokPlugin(false, havok);
  scene.enablePhysics(new Vector3(0, -9.81, 0), plugin);
  scene.physicsEnabled = false; // stepped by run() at the game's fixed step, not by every picture
  const engine = scene.getPhysicsEngine() as PhysicsEngine;
  const ray = new PhysicsRaycastResult(), from = new Vector3(), to = new Vector3();
  const castIn = new ShapeCastResult(), castHit = new ShapeCastResult(), near = new ProximityCastResult(), nearHit = new ProximityCastResult();
  const hitOf = (r: PhysicsRaycastResult | ShapeCastResult, distance: number): Hit => ({
    distance, normal: r.hitNormal.clone(), point: r.hitPoint.clone(), body: r.body, shape: r.shape,
  });
  // A query shape is a member of QUERY and meets `mask`; a shape that belongs to a body is given its groups back.
  const asQuery = <T>(shape: PhysicsShape, mask: number, run: () => T) => {
    const member = shape.filterMembershipMask, collide = shape.filterCollideMask;
    shape.filterMembershipMask = QUERY; shape.filterCollideMask = mask;
    try { return run(); } finally { shape.filterMembershipMask = member; shape.filterCollideMask = collide; }
  };

  /** A body on `node` (its position and turn), in `group`; dynamic bodies move the node after each step. */
  const body = (node: TransformNode, type: PhysicsMotionType, shape: PhysicsShape, group: number, friction = 0.5) => {
    node.rotationQuaternion ??= Quaternion.FromEulerVector(node.rotation);
    const made = new PhysicsBody(node, type, false, scene);
    made.setPrestepType(PhysicsPrestepType.TELEPORT); // what place() does (the node is not copied each step)
    setGroup(shape, group);
    if (!parts.has(shape)) shape.material = { friction, restitution: 0 };
    made.shape = shape;
    groups.set(made, group);
    return made;
  };

  return {
    plugin,
    step: (dt: number) => engine._step(dt),
    body,
    /** A static collider on a node of its own, at the origin (the shape built where it stands) or at `at`, turned
     *  by `turn`. remove() removes it. */
    fixed(shape: PhysicsShape, group = SOLID, friction = 0.5, at?: XYZ, turn?: Quaternion) {
      const node = new TransformNode("solid", scene);
      if (at) node.position.set(at.x, at.y, at.z);
      if (turn) node.rotationQuaternion = turn.clone();
      return body(node, PhysicsMotionType.STATIC, shape, group, friction);
    },
    /** Removes a body and its node. */
    remove(body: PhysicsBody) {
      const node = body.transformNode;
      body.shape?.dispose();
      body.dispose();
      if (node.name === "solid") node.dispose();
    },
    /** The nearest hit of a ray from `start` along the unit `dir`, up to `length`, among the groups in `mask`. */
    ray(start: XYZ, dir: XYZ, length: number, mask = ALL): Hit | undefined {
      from.set(start.x, start.y, start.z);
      to.set(start.x + dir.x * length, start.y + dir.y * length, start.z + dir.z * length);
      plugin.raycast(from, to, ray, { membership: QUERY, collideWith: mask });
      return ray.hasHit ? hitOf(ray, ray.hitDistance) : undefined;
    },
    /** The nearest hit of `shape`, turned by `turn`, swept from `start` along the unit `dir` up to `distance`. */
    cast(shape: PhysicsShape, turn: Quaternion, start: XYZ, dir: XYZ, distance: number, mask = ALL): Hit | undefined {
      return asQuery(shape, mask, () => {
        from.set(start.x, start.y, start.z);
        to.set(start.x + dir.x * distance, start.y + dir.y * distance, start.z + dir.z * distance);
        plugin.shapeCast({ shape, rotation: turn, startPosition: from, endPosition: to, shouldHitTriggers: false }, castIn, castHit);
        return castHit.hasHit ? hitOf(castHit, castHit.hitFraction * distance) : undefined;
      });
    },
    /** Whether `shape`, turned by `turn` at `at`, overlaps anything among the groups in `mask`. */
    overlaps(shape: PhysicsShape, turn: Quaternion, at: XYZ, mask = ALL) {
      return asQuery(shape, mask, () => {
        plugin.shapeProximity({ shape, position: v(at), rotation: turn, maxDistance: 0, shouldHitTriggers: false }, near, nearHit);
        return nearHit.hasHit;
      });
    },
    bodies: () => engine.getBodies(),
  };
}

export type Physics = ReturnType<typeof createPhysics>;
