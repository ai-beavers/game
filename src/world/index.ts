// The world the beaver walks through: daylight and haze, the ground with its pond and hill, grass, trees, rocks,
// reeds, and the loose things to carry (sticks) and push (crates). Implements CreateWorld from src/contracts.ts.
//
//   const world = await createWorld(stage, props?);   props from src/props, or stand-ins made here when left out
//   run(stage, fixed, (dt) => { world.update(dt, player.node.position); … });
//
// The clearing uses mesh instances. The backdrop batches its transforms into thin instances.
// Their colliders are fixed: trunks as cylinders, stumps, logs and rocks as convex hulls of their own vertices.
// A tree can be handed over to another part (world.trees[i].hide() / .clear(): the build feature fells them), and
// loose things added and taken away (world.addLoose / removeLoose).
import { Vector3, Quaternion, Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { CreateWorld, Props, Stick, WorldTree } from "../contracts.ts";
import { RAPIER, type Stage } from "../engine.ts";
import { daylight } from "../light.ts";
import { buildGrass } from "./grass.ts";
import { placeAll, SPAWN, type Spot } from "./place.ts";
import { bushes, standInProps } from "./props.ts";
import { instance, vertices, bounds, meshes } from "./models.ts";
import { buildTerrain, heightAt, POND, RIM, SITE } from "./terrain.ts";
import { buildWater } from "./water.ts";

export { heightAt, standInProps };

const UP = new Vector3(0, 1, 0);

const placement = (s: Spot, sink: number) => Matrix.Compose(
  Vector3.One().scale(s.scale), Quaternion.RotationAxis(UP, s.turn),
  new Vector3(s.x, heightAt(s.x, s.z) - sink * s.scale, s.z));

function scatter(templates: TransformNode[], spots: Spot[], sink: number) {
  const roots = spots.map(s => {
    const root = instance(templates[s.variant % templates.length]!, "scenery");
    root.rotationQuaternion = Quaternion.Identity();
    placement(s, sink).decompose(root.scaling, root.rotationQuaternion, root.position);
    root.freezeWorldMatrix();
    for (const mesh of root.getChildMeshes()) mesh.freezeWorldMatrix();
    return root;
  });
  return (i: number) => roots[i]!.dispose();
}

/** Far trees, reeds and bushes never move or disappear individually. */
function scatterBackdrop(templates: TransformNode[], spots: Spot[], sink: number) {
  templates.forEach((template, variant) => {
    const placements = spots.filter(spot => spot.variant % templates.length === variant).map(spot => placement(spot, sink));
    if (!placements.length) return;
    for (const source of meshes(template)) {
      const batch = source.clone(source.name + " backdrop", null, true);
      batch.parent = null;
      batch.position.setAll(0);
      batch.rotation.setAll(0);
      batch.rotationQuaternion = Quaternion.Identity();
      batch.scaling.setAll(1);
      batch.setEnabled(true);
      const matrices = new Float32Array(placements.length * 16);
      const local = source.computeWorldMatrix(true);
      placements.forEach((place, i) => local.multiply(place).copyToArray(matrices, i * 16));
      batch.thinInstanceSetBuffer("matrix", matrices, 16, true);
      batch.receiveShadows = true;
    }
  });
}

export const createWorld: CreateWorld = async (stage: Stage, given?: Props) => {
  const { scene, physics } = stage;
  const light = daylight(stage);

  buildTerrain(stage);
  const water = buildWater(stage);
  const props = given ?? standInProps(scene), layout = placeAll();
  const pick = (list: TransformNode[], s: Spot) => list[s.variant % list.length]!;
  const fixed = (desc: RAPIER.ColliderDesc) => physics.createCollider(desc.setFriction(0.9));

  // Trees: drawn instanced; a trunk cylinder each, as thick as the template's trunk at knee height.
  const hideTree = scatter(props.tree, layout.tree, 0.12);
  scatterBackdrop(props.tree, layout.farTree, 0.2);
  const trees: WorldTree[] = layout.tree.map((s, k) => {
    const knee = vertices(pick(props.tree, s)).filter((p) => p.y > 0.6 && p.y < 1.4);
    const radius = Math.max(0.12, Math.min(0.5, ...knee.map((p) => Math.hypot(p.x, p.z)))) * s.scale; // the trunk, not low branches
    let trunk: RAPIER.Collider | undefined = fixed(RAPIER.ColliderDesc.cylinder(1.5, radius).setTranslation(s.x, heightAt(s.x, s.z) + 1.3, s.z));
    return {
      place: new Vector3(s.x, heightAt(s.x, s.z), s.z), radius, model: pick(props.tree, s), matrix: placement(s, 0.12),
      hide: () => hideTree(k),
      clear: () => { if (trunk) physics.removeCollider(trunk, true); trunk = undefined; },
    };
  });
  // Stumps, logs, rocks: convex hulls of the placed template.
  for (const [kind, sink] of [["stump", 0.04], ["log", 0.04], ["rock", 0.1]] as const) {
    scatter(props[kind], layout[kind], sink);
    for (const s of layout[kind]) {
      const m = placement(s, sink), hull = new Float32Array(vertices(pick(props[kind], s)).flatMap((p) => Vector3.TransformCoordinates(p, m).asArray()));
      const desc = RAPIER.ColliderDesc.convexHull(hull);
      if (desc) fixed(desc);
    }
  }
  scatterBackdrop(props.reed, layout.reed, 0.05);
  scatterBackdrop(bushes(scene), layout.bush, 0.35);

  // Behind the thicket on the bank, out of sight: a ring of walls, in case something gets up the bank.
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
    const r = RIM + 6, x = Math.cos(a) * r, z = Math.sin(a) * r;
    fixed(RAPIER.ColliderDesc.cuboid(0.5, 6, r * Math.PI / 24 + 0.5).setTranslation(x, heightAt(x, z), z)
      .setRotation(Quaternion.RotationAxis(UP, -a)));
  }

  // Loose things: a body each, the mesh bound to it. The mesh's template stands on y = 0, the body sits at its middle.
  const loose = (template: TransformNode, size: Vector3, at: Vector3, turn: Quaternion, mass: number) => {
    const { center, size: extent } = bounds(template);
    const holder = new TransformNode("loose", scene);
    const copy = instance(template, template.name, holder);
    copy.scaling.set(size.x / extent.x, size.y / extent.y, size.z / extent.z);
    copy.position = center.multiply(copy.scaling).negate();
    holder.position.copyFrom(at);
    holder.rotationQuaternion = turn.clone();
    const body = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z).setRotation(turn)
      .setLinearDamping(0.3).setAngularDamping(3));
    // A box's own inertia, but at least a floor: a thin stick would otherwise roll and jitter on the ground's edges.
    const [x2, y2, z2] = [size.x ** 2, size.y ** 2, size.z ** 2], floor = mass * 0.006;
    const inertia = { x: Math.max(floor, mass * (y2 + z2) / 12), y: Math.max(floor, mass * (x2 + z2) / 12), z: Math.max(floor, mass * (x2 + y2) / 12) };
    physics.createCollider(RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setMassProperties(mass, { x: 0, y: 0, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 }).setFriction(0.9).setRestitution(0), body);
    stage.bind(holder, body);
    return { mesh: holder, body };
  };
  const crates = layout.crate.map((s) => {
    const at = new Vector3(s.x, heightAt(s.x, s.z) + 0.26, s.z);
    return loose(pick(props.crate, s), new Vector3(0.5, 0.5, 0.5), at, Quaternion.RotationAxis(UP, s.turn), 5);
  });
  const sticks: Stick[] = layout.stick.map((s) => {
    const half = s.scale / 2, t = s.thickness!, dx = Math.sin(s.turn) * half, dz = Math.cos(s.turn) * half;
    const a = heightAt(s.x - dx, s.z - dz), b = heightAt(s.x + dx, s.z + dz), mid = heightAt(s.x, s.z);
    // Along the ground between its ends, resting just above the highest of three points.
    const turn = Quaternion.RotationYawPitchRoll(s.turn, Math.atan2(a - b, s.scale), 0);
    const at = new Vector3(s.x, Math.max(mid, (a + b) / 2) + t / 2 + 0.01, s.z);
    return loose(pick(props.stick, s), new Vector3(t, t, s.scale), at, turn, 0.3);
  });

  const pushed: Stick[] = [...crates]; // loose things that are not picked up: crates, and logs added later
  const addLoose = (kind: "stick" | "log", variant: number, size: Vector3, at: Vector3, turn: Quaternion, mass: number) => {
    const thing = loose(props[kind][variant % props[kind].length]!, size, at, turn, mass);
    (kind === "stick" ? sticks : pushed).push(thing);
    return thing;
  };
  const removeLoose = (thing: Stick) => {
    for (const list of [sticks, pushed]) if (list.includes(thing)) list.splice(list.indexOf(thing), 1);
    watch.delete(thing);
    stage.unbind(thing.mesh);
    physics.removeRigidBody(thing.body);
  };

  const solid = [...layout.tree.map((s) => ({ s, r: 0.5 })), ...layout.rock.map((s) => ({ s, r: 0.55 * s.scale })),
    ...layout.stump.map((s) => ({ s, r: 0.4 })), ...layout.log.map((s) => ({ s, r: 1.2 })),
    ...layout.stick.map((s) => ({ s, r: 0.3 }))]; // a trampled spot around each stick, so it can be found
  const grass = buildGrass(stage, (x, z) => solid.some(({ s, r }) => Math.hypot(s.x - x, s.z - z) < r));

  // Rapier leaves a thin box on the ground rocking a fraction of a degree, for ever, and a crate creeping a few
  // millimetres a second; neither falls asleep. A loose thing that has moved less than a centimetre in a second,
  // touching nothing that moves, is put to sleep; any touch wakes it again.
  const watch = new Map<Stick, { at: RAPIER.Vector; time: number }>();
  const rest = (dt: number) => {
    for (const stick of [...sticks, ...pushed]) {
      const body = stick.body, seen = watch.get(stick);
      if (!body.isDynamic() || body.isSleeping()) { watch.delete(stick); continue; }
      let alone = true;
      physics.contactPairsWith(body.collider(0), (other) => { if (other.parent() && !other.parent()!.isFixed()) alone = false; });
      const at = body.translation();
      if (!alone || !seen) { watch.set(stick, { at, time: 0 }); continue; }
      if ((seen.time += dt) < 1) continue;
      if (Math.hypot(at.x - seen.at.x, at.y - seen.at.y, at.z - seen.at.z) < 0.01) body.sleep();
      watch.set(stick, { at, time: 0 });
    }
  };

  let time = 0;
  return {
    spawn: new Vector3(SPAWN.x, heightAt(SPAWN.x, SPAWN.z), SPAWN.z),
    sticks,
    get waterLevel() { return water.level; }, // live: the pond rises as the dam grows
    heightAt,
    trees,
    site: { x: SITE.x, z: SITE.z, radius: SITE.radius, height: SITE.height },
    pond: { x: POND.x, z: POND.z, radius: POND.radius },
    props,
    addLoose,
    removeLoose,
    update(dt, focus) {
      time += dt;
      water.update(time);
      grass.update(time);
      light.follow(focus);
      rest(dt);
    },
  };
};
