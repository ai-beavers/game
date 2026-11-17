// One tree the build feature has taken over from the world: drawn by itself, with the bite growing into the
// hourglass a beaver leaves, then falling as a Rapier body (hinged on the cut at first, so it tips slowly, then
// free), lying, and at last gone into wood. The stump that stays is the props' gnawed stump (stump_1).
//
//   const m = measure(world.trees[i]);           sizes in the tree's template and in the world, cached
//   const view = takeTree(stage, world, i);      hides the world's instance, draws its own copy
//   view.bite(0.4)                               the hourglass 40 % deep (0 … 1)
//   view.fall(direction)  · view.step(dt) → "landed" | "rest" | undefined  · view.lie(at, turn) · view.dispose()
import * as THREE from "three";
import type { World, WorldTree } from "../../contracts.ts";
import { RAPIER, type Stage } from "../../engine.ts";

/** Height of the bite's narrowest point above the ground, and half the height of the finished hourglass, m. */
export const BITE_HEIGHT = 0.5, BITE_HALF = 0.28;
const STUMP_RADIUS = 0.16, STUMP_TIP = 0.52; // stump_1 as tools/blender/props.py builds it

const isLeaves = (mesh: THREE.Mesh) => {
  const material = [mesh.material].flat()[0]!;
  if (material.name === "leaves") return true;
  mesh.geometry.computeBoundingBox();
  return !material.name && mesh.geometry.boundingBox!.min.y > 1; // the stand-in props: unnamed, the crown up high
};

/** The template's meshes with their transforms relative to the template (as the world draws them). */
function parts(template: THREE.Object3D) {
  template.updateMatrixWorld(true);
  const found: { mesh: THREE.Mesh; local: THREE.Matrix4 }[] = [];
  template.traverse((o) => { if ((o as THREE.Mesh).isMesh) found.push({ mesh: o as THREE.Mesh, local: o.matrixWorld.clone() }); });
  return found;
}

export interface Measure {
  scale: number; position: THREE.Vector3; turn: THREE.Quaternion;
  /** Template space: y of the bite's waist, half height of the full hourglass. */
  bite: number; band: number;
  /** Template space: the trunk's middle (x, z) and radius at a height. */
  centerAt(y: number): THREE.Vector2; radiusAt(y: number): number;
  /** World, m: trunk from the waist to the crown, its radius at the bite, the crown's middle above the ground and
   *  its radius. */
  trunk: number; radius: number; crownHeight: number; crownRadius: number;
}

const measured = new WeakMap<WorldTree, Measure>();

export function measure(tree: WorldTree): Measure {
  const known = measured.get(tree);
  if (known) return known;
  const position = new THREE.Vector3(), turn = new THREE.Quaternion(), size = new THREE.Vector3();
  tree.matrix.decompose(position, turn, size);
  const scale = size.x, wood: THREE.Vector3[] = [], leaves: THREE.Vector3[] = [];
  for (const { mesh, local } of parts(tree.model)) {
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute, into = isLeaves(mesh) ? leaves : wood;
    for (let i = 0; i < pos.count; i++) into.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(local));
  }
  // The trunk is a tube: its vertices lie in rings. Each low ring gives a middle and a radius; between rings, mix.
  const rings = new Map<number, THREE.Vector3[]>();
  for (const p of wood) if (p.y < 3 && Math.hypot(p.x, p.z) < 1) {
    const key = Math.round(p.y * 40);
    rings.set(key, [...rings.get(key) ?? [], p]);
  }
  const levels = [...rings.entries()].filter(([, ps]) => ps.length >= 6).map(([, ps]) => {
    const c = new THREE.Vector2(ps.reduce((a, p) => a + p.x, 0) / ps.length, ps.reduce((a, p) => a + p.z, 0) / ps.length);
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
  const centerAt = (y: number) => at(y, (l) => l.c, (a, b, t) => a.clone().lerp(b, t), new THREE.Vector2());
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

/** A copy of a bark material that leaves out everything between cutLow and cutHigh (template y). */
function cutMaterial(base: THREE.Material | undefined, toTree: THREE.Matrix4, cut: { low: { value: number }; high: { value: number } }) {
  const m = base ? base.clone() : new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { toTree: { value: toTree }, cutLow: cut.low, cutHigh: cut.high });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform mat4 toTree;\nvarying float vTreeY;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTreeY = (toTree * vec4(transformed, 1.0)).y;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float cutLow, cutHigh;\nvarying float vTreeY;")
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vTreeY > cutLow && vTreeY < cutHigh) discard;");
  };
  m.customProgramCacheKey = () => `build-cut-${base ? "colour" : "depth"}`;
  return m;
}

const WOOD = new THREE.Color().setRGB(0.74, 0.54, 0.32, THREE.SRGBColorSpace), BARK_RIM = new THREE.Color().setRGB(0.3, 0.23, 0.17, THREE.SRGBColorSpace);
const biteMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });

/** The gnawed wood as a turned shape: two cones meeting at the waist, depth 0 … 1 of the radius taken away; only the
 *  upper cone once the tree has fallen. Template space. */
function biteShape(m: Measure, progress: number, upperOnly: boolean) {
  const w = m.band * (0.35 + 0.65 * progress), depth = 0.84 * progress ** 0.8, rows = 8, points: THREE.Vector2[] = [];
  for (let k = upperOnly ? 0 : -rows; k <= rows; k++) {
    const t = k / rows, y = m.bite + t * w;
    points.push(new THREE.Vector2(Math.max(0.003, m.radiusAt(y) * 1.05 * (1 - depth * (1 - Math.abs(t)))), y));
  }
  const g = new THREE.LatheGeometry(points, 28), pos = g.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(x, z), edge = Math.abs(y - m.bite) / w;
    const teeth = 1 + 0.07 * Math.sin(a * 11 + y * m.scale * 90) * Math.max(0, 1 - edge) * Math.min(1, depth * 4); // tooth marks
    const centre = m.centerAt(y);
    pos.setXYZ(i, x * teeth + centre.x, y, z * teeth + centre.y);
    c.copy(WOOD).multiplyScalar(0.82 + 0.18 * Math.sin(y * m.scale * 160 + a * 3)).lerp(BARK_RIM, THREE.MathUtils.smoothstep(edge, 0.8, 1));
    c.toArray(colors, i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

// ---- the tree as a whole -------------------------------------------------------------------------------------------

export type TreeView = ReturnType<typeof takeTree>;

export function takeTree(stage: Stage, world: World, index: number) {
  const { scene, physics } = stage, tree = world.trees![index]!, m = measure(tree);
  tree.hide();
  const root = new THREE.Group(), copy = tree.model.clone();
  root.position.copy(m.position); root.quaternion.copy(m.turn); root.scale.setScalar(m.scale);
  root.add(copy);
  scene.add(root);
  copy.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const cut = { low: { value: 1e9 }, high: { value: -1e9 } };
  copy.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || isLeaves(mesh)) return;
    const toTree = toRoot.clone().multiply(mesh.matrixWorld);
    mesh.material = cutMaterial([mesh.material].flat()[0]!, toTree, cut);
    mesh.customDepthMaterial = cutMaterial(undefined, toTree, cut);
  });
  const bitten = new THREE.Mesh(new THREE.BufferGeometry(), biteMaterial);
  bitten.castShadow = bitten.receiveShadow = true;
  bitten.visible = false;
  root.add(bitten);
  let shown = -1;

  /** The waist of the bite, in the world. */
  const waist = () => {
    const c = m.centerAt(m.bite);
    return new THREE.Vector3(c.x, m.bite, c.y).applyMatrix4(root.matrixWorld);
  };
  root.updateMatrixWorld(true);

  let holder: THREE.Group | undefined, body: RAPIER.RigidBody | undefined, hinge: { joint: RAPIER.ImpulseJoint; anchor: RAPIER.RigidBody } | undefined;
  let spin = 0, since = 0, still = 0, landed = false, resting = false;
  let stump: THREE.Object3D | undefined, stumpCollider: RAPIER.Collider | undefined;

  /** Moves root under a body at the waist, which carries the trunk and crown colliders. */
  const makeBody = (kind: RAPIER.RigidBodyDesc, at: THREE.Vector3, turn: THREE.Quaternion) => {
    const w = waist();
    holder = new THREE.Group();
    scene.add(holder);
    root.position.sub(w); // root keeps its turn and scale, now relative to the waist
    holder.add(root);
    holder.position.copy(at); holder.quaternion.copy(turn);
    body = physics.createRigidBody(kind.setTranslation(at.x, at.y, at.z).setRotation(turn));
    physics.createCollider(RAPIER.ColliderDesc.cylinder(m.trunk / 2, m.radius).setTranslation(0, m.trunk / 2, 0).setDensity(500).setFriction(0.8), body);
    const crown = new THREE.Vector3(0, m.crownHeight - BITE_HEIGHT, 0);
    physics.createCollider(RAPIER.ColliderDesc.ball(m.crownRadius * 0.45).setTranslation(crown.x, crown.y, crown.z).setDensity(40).setFriction(1), body);
    stage.bind(holder, body);
    return w;
  };

  const addStump = () => {
    const template = world.props?.stump[0];
    if (!template || stump) return;
    const k = m.radius / STUMP_RADIUS, sink = 0.04;
    stump = template.clone();
    stump.traverse((o) => { o.castShadow = o.receiveShadow = true; });
    const holderOfStump = new THREE.Group().add(stump);
    holderOfStump.position.set(tree.place.x, tree.place.y - sink, tree.place.z);
    holderOfStump.quaternion.copy(m.turn);
    holderOfStump.scale.set(k, (BITE_HEIGHT + sink) / STUMP_TIP, k);
    scene.add(holderOfStump);
    stump = holderOfStump;
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
      if (body || Math.abs(progress - shown) < 0.004) return;
      shown = progress;
      bitten.visible = progress > 0.005;
      const w = m.band * (0.35 + 0.65 * progress);
      cut.low.value = bitten.visible ? m.bite - w * 0.97 : 1e9;
      cut.high.value = bitten.visible ? m.bite + w * 0.97 : -1e9;
      bitten.geometry.dispose();
      bitten.geometry = biteShape(m, progress, false);
    },
    /** Starts the fall this way (horizontal, unit): the stump stays, the rest tips over on a hinge at the cut. */
    fall(direction: THREE.Vector3) {
      if (body) return;
      const w = waist();
      makeBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.3), w, new THREE.Quaternion());
      tree.clear();
      addStump();
      bitten.geometry.dispose();
      bitten.geometry = biteShape(m, 1, true);
      bitten.visible = true;
      cut.low.value = -1e9; cut.high.value = m.bite + m.band * 0.97; // nothing below the upper cone
      const axis = new THREE.Vector3(0, 1, 0).cross(direction).normalize();
      const anchor = physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(w.x, w.y, w.z));
      const joint = physics.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, axis), anchor, body!, true);
      hinge = { joint, anchor };
      body!.setAngvel(axis.multiplyScalar(0.12), true);
    },
    /** Once per physics step while it falls: "landed" when the crown hits the ground (once), "rest" when it lies
     *  still (once; it is fixed from then on). */
    step(dt: number): "landed" | "rest" | undefined {
      if (!body || resting) return;
      since += dt;
      const turn = body.rotation(), up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(turn.x, turn.y, turn.z, turn.w));
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
    lie(at: THREE.Vector3, turn: THREE.Quaternion) {
      tree.clear();
      addStump();
      solidStump();
      if (hinge) { physics.removeImpulseJoint(hinge.joint, true); physics.removeRigidBody(hinge.anchor); hinge = undefined; }
      if (body) {
        body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
        body.setTranslation(at, true); body.setRotation(turn, true);
      } else {
        makeBody(RAPIER.RigidBodyDesc.fixed(), at, turn);
        bitten.geometry.dispose();
        bitten.geometry = biteShape(m, 1, true);
        bitten.visible = true;
        cut.low.value = -1e9; cut.high.value = m.bite + m.band * 0.97;
      }
      landed = resting = true;
    },
    /** Where the crown is, in the world. */
    crown() {
      return holder ? new THREE.Vector3(0, m.crownHeight - BITE_HEIGHT, 0).applyMatrix4(holder.matrixWorld) : waist().setY(tree.place.y + m.crownHeight);
    },
    /** The trunk as a line from the cut to the crown, in the world (only once it has a body). */
    trunkLine() {
      if (!body) return undefined;
      const t = body.translation(), q = body.rotation(), from = new THREE.Vector3(t.x, t.y, t.z);
      const along = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
      return { from, along, to: from.clone().addScaledVector(along, m.trunk) };
    },
    /** Only the stump: the trunk and crown are gone (into wood). */
    dispose() {
      addStump();
      solidStump();
      if (hinge) { physics.removeImpulseJoint(hinge.joint, true); physics.removeRigidBody(hinge.anchor); hinge = undefined; }
      if (body) physics.removeRigidBody(body);
      if (holder) { stage.unbind(holder); holder.removeFromParent(); }
      root.removeFromParent();
      bitten.geometry.dispose();
      copy.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && !isLeaves(mesh)) { ([mesh.material].flat()[0] as THREE.Material).dispose(); mesh.customDepthMaterial?.dispose(); }
      });
      body = undefined;
    },
  };
}
