import { meshes, vertices, instance, material } from "../../world/models.ts";
// One tree the build feature has taken over from the world: drawn by itself, with the bite growing into the
// hourglass a beaver leaves, then falling as a Rapier body (hinged on the cut at first, so it tips slowly, then
// free), lying, and at last gone into wood. The stump that stays is the props' gnawed stump (stump_1). A tree grown
// back on that stump is another view of the same tree (regrown): a sapling scaled up to the full tree, then as before.
//
//   const m = measure(world.trees[i]);           sizes in the tree's template and in the world, cached
//   const view = takeTree(stage, world, i);      hides the world's instance, draws its own copy
//   view.bite(0.4)                               the hourglass 40 % deep (0 … 1)
//   view.fall(direction)  · view.step(dt) → "landed" | "rest" | undefined  · view.lie(at, turn) · view.dispose()
//   takeTree(stage, world, i, true)              grown back: view.grow(0.3) a sapling, view.grow(1) the tree, solid
//   view.unstump()                               the stump goes (a tree stands on it again)
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh.js";
import { Material } from "@babylonjs/core/Materials/material.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Plane } from "@babylonjs/core/Maths/math.plane.js";
import { Quaternion, Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { World, WorldTree } from "../../contracts.ts";
import { RAPIER, type Stage } from "../../engine.ts";

/** Height of the bite's narrowest point above the ground, and half the height of the finished hourglass, m. */
export const BITE_HEIGHT = 0.5, BITE_HALF = 0.28;
const STUMP_RADIUS = 0.16, STUMP_TIP = 0.52; // stump_1 as tools/blender/props.py builds it

export interface Measure {
  scale: number; position: Vector3; turn: Quaternion;
  /** Template space: y of the bite's waist, half height of the full hourglass. */
  bite: number; band: number;
  /** Template space: the trunk's middle (x, z) and radius at a height. */
  centerAt(y: number): Vector2; radiusAt(y: number): number;
  /** World, m: trunk from the waist to the crown, its radius at the bite, the crown's middle above the ground and
   *  its radius. */
  trunk: number; radius: number; crownHeight: number; crownRadius: number;
}

const measured = new WeakMap<WorldTree, Measure>();

export function measure(tree: WorldTree): Measure {
  const known = measured.get(tree);
  if (known) return known;
  const position = new Vector3(), turn = new Quaternion(), size = new Vector3();
  tree.matrix.decompose(size, turn, position);
  const scale = size.x, wood = vertices(tree.model, false), leaves = vertices(tree.model, true);
  // The trunk is a tube: its vertices lie in rings. Each low ring gives a middle and a radius; between rings, mix.
  const rings = new Map<number, Vector3[]>();
  for (const p of wood) if (p.y < 3 && Math.hypot(p.x, p.z) < 1) {
    const key = Math.round(p.y * 40);
    rings.set(key, [...rings.get(key) ?? [], p]);
  }
  const levels = [...rings.entries()].filter(([, ps]) => ps.length >= 6).map(([, ps]) => {
    const c = new Vector2(ps.reduce((a, p) => a + p.x, 0) / ps.length, ps.reduce((a, p) => a + p.z, 0) / ps.length);
    const d = ps.map((p) => Math.hypot(p.x - c.x, p.z - c.y)).sort((a, b) => a - b);
    return { y: ps.reduce((a, p) => a + p.y, 0) / ps.length, c, r: d[Math.floor(d.length / 2)]! };
  }).sort((a, b) => a.y - b.y);
  const fallback = tree.radius / scale;
  const at = <T>(y: number, get: (l: (typeof levels)[number]) => T, mix: (a: T, b: T, t: number) => T, none: T): T => {
    if (!levels.length) return none;
    if (y <= levels[0]!.y) return get(levels[0]!);
    for (let k = 1; k < levels.length; k++) if (y <= levels[k]!.y) {
      const a = levels[k - 1]!, b = levels[k]!;
      return mix(get(a), get(b), (y - a.y) / (b.y - a.y));
    }
    return get(levels[levels.length - 1]!);
  };
  const radiusAt = (y: number) => at(y, (l) => l.r, (a, b, t) => a + (b - a) * t, fallback);
  const centerAt = (y: number) => at(y, (l) => l.c, (a, b, t) => Vector2.Lerp(a, b, t), new Vector2());
  const ground = tree.place.y, toTemplate = (h: number) => (ground + h - position.y) / scale;
  const toWorld = (y: number) => y * scale + position.y - ground;
  const ys = leaves.map((p) => p.y).sort((a, b) => a - b);
  const crownLow = ys.length ? toWorld(ys[Math.floor(ys.length * 0.05)]!) : 3;
  const crownHeight = ys.length ? toWorld(ys[Math.floor(ys.length * 0.5)]!) : 4;
  const spread = leaves.map((p) => Math.hypot(p.x, p.z)).sort((a, b) => a - b);
  const m: Measure = {
    scale, position, turn, bite: toTemplate(BITE_HEIGHT), band: BITE_HALF / scale, centerAt, radiusAt,
    trunk: Math.max(1.2, crownLow - BITE_HEIGHT), radius: radiusAt(toTemplate(BITE_HEIGHT)) * scale,
    crownHeight, crownRadius: spread.length ? spread[Math.floor(spread.length * 0.6)]! * scale : 1.2,
  };
  measured.set(tree, m);
  return m;
}

// ---- drawing the bite ----------------------------------------------------------------------------------------------

/** The actual outline at either rim of the notch. Blender trunks can lean and have irregular cross-sections. */
function trunkSections(tree: WorldTree, m: Measure, sides: number) {
  const faces: [Vector3, Vector3, Vector3][] = [];
  for (const part of meshes(tree.model)) {
    if (part.material?.name === "leaves") continue;
    const indices = part.getIndices()!, positions = part.getVerticesData("position")!, transform = part.computeWorldMatrix(true);
    const vertices = Array.from({ length: positions.length / 3 }, (_, i) => Vector3.TransformCoordinates(Vector3.FromArray(positions, i * 3), transform));
    for (let i = 0; i < indices.length; i += 3) {
      const a = vertices[indices[i]!]!, b = vertices[indices[i + 1]!]!, c = vertices[indices[i + 2]!]!;
      if (Math.min(a.y, b.y, c.y) <= m.bite + m.band && Math.max(a.y, b.y, c.y) >= m.bite - m.band) faces.push([a, b, c]);
    }
  }
  return (y: number) => {
    const segments: [Vector2, Vector2][] = [];
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const face of faces) {
      const line: Vector2[] = [];
      for (let i = 0; i < 3; i++) {
        const a = face[i]!, b = face[(i + 1) % 3]!;
        if ((a.y > y) === (b.y > y)) continue;
        const t = (y - a.y) / (b.y - a.y), x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        line.push(new Vector2(x, z));
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      if (line.length === 2) segments.push([line[0]!, line[1]!]);
    }
    const center = segments.length ? new Vector2((minX + maxX) / 2, (minZ + maxZ) / 2) : m.centerAt(y);
    const radii = Array.from({ length: sides }, (_, i) => {
      const angle = i * Math.PI * 2 / sides, dx = Math.cos(angle), dz = Math.sin(angle);
      let nearest = Infinity;
      for (const [a, b] of segments) {
        const sx = b.x - a.x, sz = b.y - a.y, denominator = dx * sz - dz * sx;
        if (Math.abs(denominator) < 1e-8) continue;
        const x = a.x - center.x, z = a.y - center.y;
        const r = (x * sz - z * sx) / denominator, t = (x * dz - z * dx) / denominator;
        if (t >= -1e-5 && t <= 1 + 1e-5 && r > 0) nearest = Math.min(nearest, r);
      }
      return Number.isFinite(nearest) ? nearest : m.radiusAt(y);
    });
    return { center, radii };
  };
}

/** Clip the original bark above and below the bite. Its two remaining ends share the source geometry. */
function notch(root: TransformNode, tree: WorldTree, m: Measure) {
  const scene = root.getScene(), upper = new Plane(0, -1, 0, 0), lower = new Plane(0, 1, 0, 0);
  const bark: { material: Material; plane: Plane }[] = [], bottom: Mesh[] = [];
  for (const part of root.getChildMeshes()) {
    if (!(part instanceof InstancedMesh) || part.material?.name === "leaves") continue;
    const source = part.sourceMesh, original = source.material!;
    for (const plane of [upper, lower]) {
      const half = source.clone("cut " + part.name, root, true);
      half.position.copyFrom(part.position);
      half.rotationQuaternion = part.rotationQuaternion!.clone();
      half.scaling.copyFrom(part.scaling);
      half.setEnabled(true);
      const copy = original.clone("cut " + original.name)!;
      half.material = copy;
      bark.push({ material: copy, plane });
      if (plane === lower) bottom.push(half);
      // Material clones may share their source texture or own a clone, depending on the texture type.
      const ownMaps = copy.getActiveTextures().filter(texture => !original.hasTexture(texture));
      half.onDisposeObservable.addOnce(() => { copy.dispose(); for (const tex of new Set(ownMaps)) tex.dispose(); });
    }
    part.dispose();
  }

  const cut = new Mesh("gnawed wood", scene);
  cut.parent = root;
  cut.receiveShadows = true;
  const cutMaterial = material(scene, "fresh wood", 0xe8c294);
  cut.material = cutMaterial;
  cut.onDisposeObservable.addOnce(() => cutMaterial.dispose());

  const rows = 12, sides = 28, count = (rows + 1) * sides;
  const section = trunkSections(tree, m, sides);
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Float32Array(count * 4);
  const indices: number[] = [];
  for (let row = 0; row < rows; row++) for (let i = 0; i < sides; i++) {
    const a = row * sides + i, b = row * sides + (i + 1) % sides;
    indices.push(a, a + sides, b, b, a + sides, b + sides);
  }
  cut.setIndices(indices);
  const syncPlanes = () => {
    for (const entry of bark) entry.material.clipPlane = entry.plane.transform(root.getWorldMatrix());
  };
  root.onAfterWorldMatrixUpdateObservable.add(syncPlanes);
  let last = -1, broken = false;
  function update(progress: number, split = false) {
    if (split === broken && Math.abs(progress - last) < 0.005) return;
    last = progress; broken = split;
    for (const mesh of bottom) mesh.setEnabled(!split);
    cut.setEnabled(progress > 0);
    const halfHeight = m.band * (0.35 + 0.65 * progress);
    upper.d = m.bite + (progress ? 0.97 * halfHeight : 0);
    lower.d = -(m.bite - (progress ? 0.97 * halfHeight : 0));
    syncPlanes();
    const low = section(m.bite - halfHeight), high = section(m.bite + halfHeight);
    for (let row = 0; row <= rows; row++) {
      const fraction = split ? row / rows : row / rows * 2 - 1;
      const edge = Math.abs(fraction), y = m.bite + fraction * halfHeight, t = (fraction + 1) / 2;
      const center = Vector2.Lerp(low.center, high.center, t);
      const cutRatio = 1.018 * (1 - (split ? 0.995 : 0.86 * progress ** 0.8) * (1 - edge));
      for (let i = 0; i < sides; i++) {
        const k = row * sides + i, angle = i * Math.PI * 2 / sides;
        const radius = (low.radii[i]! * (1 - t) + high.radii[i]! * t) * cutRatio;
        const tooth = 1 + 0.055 * (1 - edge) * progress * Math.sin(angle * 11 + y * 67);
        positions[k * 3] = center.x + radius * tooth * Math.cos(angle);
        positions[k * 3 + 1] = y;
        positions[k * 3 + 2] = center.y + radius * tooth * Math.sin(angle);
        const shade = 0.86 + 0.12 * Math.sin(y * 125 + angle * 4) - Math.max(0, edge - 0.72) * 1.6;
        colors.set([shade, shade * 0.92, shade * 0.8, 1], k * 4);
      }
    }
    VertexData.ComputeNormals(positions, indices, normals, { useRightHandedSystem: true });
    if (!cut.isVerticesDataPresent("position")) {
      cut.setVerticesData("position", positions, true);
      cut.setVerticesData("normal", normals, true);
      cut.setVerticesData("color", colors, true);
    } else {
      cut.updateVerticesData("position", positions, true);
      cut.updateVerticesData("normal", normals);
      cut.updateVerticesData("color", colors);
    }
  }
  update(0);
  return update;
}

export type TreeView = ReturnType<typeof takeTree>;

export function takeTree(stage: Stage, world: World, index: number, regrown = false) {
  const { scene, physics } = stage, tree = world.trees![index]!, m = measure(tree);
  tree.hide();
  const root = instance(tree.model, "felled tree");
  root.position.copyFrom(m.position);
  root.rotationQuaternion = m.turn.clone();
  root.scaling.setAll(m.scale);
  const updateNotch = notch(root, tree, m), center = m.centerAt(m.bite);
  const cutPoint = new Vector3(center.x, m.bite, center.y);
  const waist = () => Vector3.TransformCoordinates(cutPoint, root.computeWorldMatrix(true));
  let holder: TransformNode | undefined, body: RAPIER.RigidBody | undefined, hinge: { joint: RAPIER.ImpulseJoint; anchor: RAPIER.RigidBody } | undefined;
  let spin = 0, since = 0, still = 0, landed = false, resting = false;
  let stump: TransformNode | undefined, stumpCollider: RAPIER.Collider | undefined;
  // The world's trunk collider is gone for a tree grown back: it gets one like it once fully grown.
  let trunk: RAPIER.Collider | undefined, size = regrown ? -1 : 1;
  const clear = () => {
    tree.clear();
    if (trunk) physics.removeCollider(trunk, true);
    trunk = undefined;
  };

  /** Moves root under a body at the waist, which carries the trunk and crown colliders. */
  const makeBody = (kind: RAPIER.RigidBodyDesc, at: Vector3, turn: Quaternion) => {
    const w = waist();
    holder = new TransformNode("falling tree", scene);
    root.position.subtractInPlace(w);
    root.parent = holder;
    holder.position.copyFrom(at);
    holder.rotationQuaternion = turn.clone();
    body = physics.createRigidBody(kind.setTranslation(at.x, at.y, at.z).setRotation(turn));
    physics.createCollider(RAPIER.ColliderDesc.cylinder(m.trunk / 2, m.radius).setTranslation(0, m.trunk / 2, 0).setDensity(500).setFriction(0.8), body);
    const crown = new Vector3(0, m.crownHeight - BITE_HEIGHT, 0);
    physics.createCollider(RAPIER.ColliderDesc.ball(m.crownRadius * 0.45).setTranslation(crown.x, crown.y, crown.z).setDensity(40).setFriction(1), body);
    stage.bind(holder, body);
    return w;
  };

  const addStump = () => {
    const template = world.props?.stump[0];
    if (!template || stump) return;
    const k = m.radius / STUMP_RADIUS, sink = 0.04;
    stump = instance(template, "gnawed stump");
    stump.position.set(tree.place.x, tree.place.y - sink, tree.place.z);
    stump.rotationQuaternion = m.turn.clone();
    stump.scaling.set(k, (BITE_HEIGHT + sink) / STUMP_TIP, k);
  };
  const solidStump = () => {
    if (stumpCollider) return;
    stumpCollider = physics.createCollider(RAPIER.ColliderDesc.cylinder(0.14, m.radius * 1.1)
      .setTranslation(tree.place.x, tree.place.y + 0.12, tree.place.z).setFriction(0.9));
  };

  return {
    index, measure: m,
    get body() { return body; },
    /** Shows the bite this deep, 0 … 1, while the tree still stands. */
    bite(progress: number) {
      if (!body) updateNotch(progress);
    },
    /** Starts the fall this way (horizontal, unit): the stump stays, the rest tips over on a hinge at the cut. */
    fall(direction: Vector3) {
      if (body) return;
      const w = waist();
      makeBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.3), w, new Quaternion());
      clear();
      addStump();
      updateNotch(1, true);
      const axis = new Vector3(0, 1, 0).cross(direction).normalize();
      const anchor = physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(w.x, w.y, w.z));
      const joint = physics.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, axis), anchor, body!, true);
      hinge = { joint, anchor };
      body!.setAngvel(axis.scaleInPlace(0.12), true);
    },
    /** Once per physics step while it falls: "landed" when the crown hits the ground (once), "rest" when it lies
     *  still (once; it is fixed from then on). */
    step(dt: number): "landed" | "rest" | undefined {
      if (!body || resting) return;
      since += dt;
      const turn = body.rotation(), up = Vector3.Up().applyRotationQuaternion(new Quaternion(turn.x, turn.y, turn.z, turn.w));
      const tilt = Math.acos(Math.min(1, up.y)), w = body.angvel(), now = Math.hypot(w.x, w.y, w.z);
      if (hinge && tilt > 1.1) { // off the stump: from here on it falls free
        physics.removeImpulseJoint(hinge.joint, true);
        physics.removeRigidBody(hinge.anchor);
        hinge = undefined;
        solidStump();
      }
      let event: "landed" | "rest" | undefined;
      if (!landed && tilt > 0.9 && spin > 0.3 && now < spin * 0.6) { landed = true; event = "landed"; }
      if (!landed) spin = Math.max(spin, now);
      const v = body.linvel();
      still = landed && Math.hypot(v.x, v.y, v.z) < 0.15 && now < 0.15 ? still + dt : 0;
      if (!event && (still > 0.6 || since > 10)) {
        resting = true;
        if (!landed) landed = true;
        body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
        solidStump();
        return "rest";
      }
      return event;
    },
    /** Lies here at once, fixed (a saved game, or another player's tree). */
    lie(at: Vector3, turn: Quaternion) {
      clear();
      addStump();
      solidStump();
      if (hinge) { physics.removeImpulseJoint(hinge.joint, true); physics.removeRigidBody(hinge.anchor); hinge = undefined; }
      if (body) {
        body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
        body.setTranslation(at, true); body.setRotation(turn, true);
      } else {
        makeBody(RAPIER.RigidBodyDesc.fixed(), at, turn);
        updateNotch(1, true);
      }
      landed = resting = true;
    },
    /** Where the crown is, in the world. */
    crown() {
      return holder ? Vector3.TransformCoordinates(new Vector3(0, m.crownHeight - BITE_HEIGHT, 0), holder.computeWorldMatrix(true)) : new Vector3(tree.place.x, tree.place.y + m.crownHeight, tree.place.z);
    },
    /** The trunk as a line from the cut to the crown, in the world (only once it has a body). */
    trunkLine() {
      if (!body) return undefined;
      const t = body.translation(), q = body.rotation(), from = new Vector3(t.x, t.y, t.z);
      const along = Vector3.Up().applyRotationQuaternion(new Quaternion(q.x, q.y, q.z, q.w));
      return { from, along, to: from.add(along.scale(m.trunk)) };
    },
    /** A tree grown back, standing: this much of its full size (0 … 1), scaled about its foot; solid when full. */
    grow(scale: number) {
      if (!regrown || body || scale === size) return;
      size = scale;
      root.scaling.setAll(m.scale * scale);
      root.position.copyFrom(tree.place).addInPlace(m.position.subtract(tree.place).scaleInPlace(scale));
      if (scale >= 1 && !trunk) trunk = physics.createCollider(RAPIER.ColliderDesc.cylinder(1.5, tree.radius)
        .setTranslation(tree.place.x, tree.place.y + 1.3, tree.place.z).setFriction(0.9)); // as the world's (src/world)
    },
    /** The stump goes: a tree grown back stands on it. */
    unstump() {
      stump?.dispose();
      if (stumpCollider) physics.removeCollider(stumpCollider, true);
      stump = stumpCollider = undefined;
    },
    /** Only the stump: the trunk and crown are gone (into wood). */
    dispose() {
      addStump();
      solidStump();
      if (hinge) { physics.removeImpulseJoint(hinge.joint, true); physics.removeRigidBody(hinge.anchor); hinge = undefined; }
      clear();
      if (body) physics.removeRigidBody(body);
      if (holder) { stage.unbind(holder); holder.dispose(); } else root.dispose();
      body = undefined;
    },
  };
}
