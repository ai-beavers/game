// The world as a bot knows it, without a browser: where the trees stand and how thick they are (measured from
// assets/props.glb as the game measures them, src/features/build/tree.ts), where the world's sticks lie, the dam and
// the lodge, the ground and the water, what stands in the way, and where a felled tree comes to rest and its wood
// lies (as the build feature lays it out from the "rest" change). For bot.ts.
//
//   const world = await loadWorld();
//   world.trees[i] · world.fallDirection(i) · world.restFor(i, direction) · world.woodOf(i, rest)
//   world.groundAt(x, z, placed) · world.level(placed) · world.atDam(x, z) · world.atCache(x, y, z) · world.cache
//   world.obstacles(state, crates)                what stands in the way, the crates where the host last said
//   heading(from, to, world.obstacles(state))     which way to walk, round what stands in the way
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Logger } from "@babylonjs/core/Misc/logger.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Scene } from "@babylonjs/core/scene.js";
import "@babylonjs/loaders/glTF/2.0/glTFLoader.js";
import type { WorldTree } from "../../contracts.ts";
import { vertices } from "../../world/models.ts";
import { placeAll } from "../../world/place.ts";
import { heightAt, POND, RIM, SITE, WATER_LEVEL } from "../../world/terrain.ts";
import { BITE_HEIGHT, measure } from "../build/tree.ts";
import { bitesToFell, CACHE_AT, crestHeight, DAM, damPlan, live, pondLevel, profile, SLOTS, woodFrom, type BuildState, type TreeState } from "../build/rules.ts";
import { CRATES, woodId } from "./protocol.ts";
import { footprint as tradingPost } from "../trade/place.ts";
import { footprint as bakery } from "../bakery/place.ts";
import { footprint as workbench } from "../workbench/place.ts";
import { footprint as lightbulb } from "../lightbulb/place.ts";
import { COLLIDER as OLD_BEAVER_R, PLACE as OLD_BEAVER } from "../old-beaver/rules.ts";

export type Rest = NonNullable<TreeState["rest"]>;
export interface Circle { x: number; z: number; r: number }
export interface TreeInfo {
  x: number; z: number; y: number;
  /** The trunk collider's radius (src/world), and the measured one the bites go by. */
  collider: number; radius: number;
  trunk: number; crownHeight: number; crownRadius: number;
  /** Bites that fell it. */
  need: number;
}

const UP = new Vector3(0, 1, 0);
const BODY = 0.25; // m a beaver keeps from what stands in the way

/** props.glb without its textures: the null engine cannot decode them, and only the shapes and material names count. */
function shapesOnly(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset), length = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  for (const key of ["extensionsRequired", "extensionsUsed", "images", "textures", "samplers"]) delete gltf[key];
  gltf.materials = (gltf.materials ?? []).map((m: { name?: string }) => ({ name: m.name }));
  const json = new TextEncoder().encode(JSON.stringify(gltf)), padded = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(0x20);
  padded.set(json);
  const bin = bytes.subarray(20 + length), out = new Uint8Array(20 + padded.length + bin.length), o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, out.length, true); // "glTF", version 2
  o.setUint32(12, padded.length, true); o.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(padded, 20);
  out.set(bin, 20 + padded.length);
  return out;
}

async function treeModels(): Promise<TransformNode[]> {
  Logger.LogLevels = Logger.WarningLogLevel | Logger.ErrorLogLevel;
  const scene = new Scene(new NullEngine());
  scene.useRightHandedSystem = true; // as engine.ts
  const bytes = new Uint8Array(await Bun.file(new URL("../../../assets/props.glb", import.meta.url)).arrayBuffer());
  const asset = await ImportMeshAsync(shapesOnly(bytes), scene, { pluginExtension: ".glb" });
  const trees = asset.transformNodes.filter((node) => /^tree_[0-9]+$/.test(node.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  for (const node of trees) node.parent = null; // as src/props
  return trees;
}

export async function loadWorld() {
  const layout = placeAll(), models = await treeModels();
  // shortcut: placement and trunk radius as src/world/index.ts makes them; should that change, change this too.
  const trees: TreeInfo[] = layout.tree.map((s) => {
    const model = models[s.variant % models.length]!, y = heightAt(s.x, s.z);
    const knee = vertices(model).filter((p) => p.y > 0.6 && p.y < 1.4);
    const collider = Math.max(0.12, Math.min(0.5, ...knee.map((p) => Math.hypot(p.x, p.z)))) * s.scale;
    const matrix = Matrix.Compose(Vector3.One().scale(s.scale), Quaternion.RotationAxis(UP, s.turn), new Vector3(s.x, y - 0.12 * s.scale, s.z));
    const tree = { place: new Vector3(s.x, y, s.z), radius: collider, model, matrix } as unknown as WorldTree;
    const m = measure(tree);
    return { x: s.x, z: s.z, y, collider, radius: m.radius, trunk: m.trunk, crownHeight: m.crownHeight, crownRadius: m.crownRadius, need: bitesToFell(m.radius) };
  });
  // The world's sticks, by id (protocol.ts: the world's own from 0), where src/world lays them.
  const sticks = layout.stick.map((s) => [s.x, heightAt(s.x, s.z) + s.thickness! / 2 + 0.01, s.z] as [number, number, number]);

  // shortcut: the dam's frame as src/features/build/dam.ts makes it; should that change, change this too.
  const across = new Vector3(POND.x - SITE.x, 0, POND.z - SITE.z).normalize(), along = new Vector3(-across.z, 0, across.x);
  const origin = new Vector3(SITE.x, 0, SITE.z).add(across.scale(1.1));
  origin.y = heightAt(origin.x, origin.z);
  const plan = damPlan(), lodgeAt = new Vector3(POND.x, 0, POND.z).add(across.scale(0.6));
  /** In the dam's frame: x across (towards the water), z along. */
  const local = (x: number, z: number) => {
    const dx = x - origin.x, dz = z - origin.z;
    return { x: dx * across.x + dz * across.z, z: dx * along.x + dz * along.z };
  };
  const world = (x: number, z: number) => ({ x: origin.x + across.x * x + along.x * z, z: origin.z + across.z * x + along.z * z });

  const groundAt = (x: number, z: number, placed: number) => {
    const l = local(x, z);
    return heightAt(x, z) + (placed ? crestHeight(Math.min(SLOTS, placed)) * profile(l.x, l.z) : 0);
  };
  const level = (placed: number) => pondLevel(WATER_LEVEL, placed);
  const dry = (x: number, z: number) => heightAt(x, z) > WATER_LEVEL + 0.05;

  /** Which way tree i falls: towards the clearing's middle, or the nearest way round from it that keeps the tree on dry
   *  land and off the building site, so its wood can be fetched. */
  const fallDirection = (i: number) => {
    const t = trees[i]!, inward = Math.atan2(-t.x, -t.z), reach = t.crownHeight + t.crownRadius * 0.5;
    for (const turn of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.2, -2.2, Math.PI]) {
      const a = inward + turn, dx = Math.sin(a), dz = Math.cos(a);
      let fine = true;
      for (let d = 0.5; d <= reach && fine; d += 0.5) {
        const x = t.x + dx * d, z = t.z + dz * d;
        fine = dry(x, z) && Math.hypot(x - SITE.x, z - SITE.z) > SITE.radius + 1 && Math.hypot(x, z) < RIM - 1;
      }
      if (fine) return a;
    }
    return inward;
  };

  /** Where tree i comes to rest when it falls this way: off its stump, the trunk along the ground, the crown on it.
   *  What the game's physics finds roughly, for when no browser is there to find it. */
  const restFor = (i: number, direction: number): Rest => {
    const t = trees[i]!, dx = Math.sin(direction), dz = Math.cos(direction);
    const ax = t.x + dx * (t.radius + 0.2), az = t.z + dz * (t.radius + 0.2), ay = heightAt(ax, az) + t.radius;
    const length = t.crownHeight - BITE_HEIGHT, cx = ax + dx * length, cz = az + dz * length;
    const lift = heightAt(cx, cz) + t.crownRadius * 0.45 - ay; // the crown's ball (tree.ts) on the ground
    const axis = new Vector3(dx * length, lift, dz * length).normalize();
    const turn = Quaternion.RotationAxis(UP.cross(axis).normalize(), Math.acos(Math.min(1, axis.y)));
    const r = (v: number) => Math.round(v * 1e4) / 1e4;
    return { at: [r(ax), r(ay), r(az)], turn: [r(turn.x), r(turn.y), r(turn.z), r(turn.w)] };
  };

  /** The trunk of a lying tree as a line from the cut towards the crown (tree.ts trunkLine). */
  const lineOf = (rest: Rest) => {
    const from = new Vector3(...rest.at), dir = UP.applyRotationQuaternion(new Quaternion(...rest.turn));
    return { from, along: dir };
  };

  /** The sticks tree i breaks into, lying where the build feature puts them (spawnWood) for this rest. */
  const woodOf = (i: number, rest: Rest) => {
    const t = trees[i]!, { from, along } = lineOf(rest), flat = new Vector3(along.x, 0, along.z).normalize(), side = new Vector3(-flat.z, 0, flat.x);
    return woodFrom(i, t.trunk, t.radius).flatMap((piece, k) => {
      if (piece.kind !== "stick") return [];
      const at = from.add(flat.scale(piece.along)).add(side.scale(piece.side));
      return [{ id: woodId(i, k), name: `t${i}:${k}`, at: [at.x, heightAt(at.x, at.z) + piece.thickness / 2 + 0.03, at.z] as [number, number, number] }];
    });
  };

  /** What a beaver walks around: trees standing and lying, stumps, rocks, logs, the Old Beaver, the crates (where the host last said
   *  they are, by id: a player may push them; else where they wait), and the lodge once it stands. */
  const fixed: Circle[] = [
    ...layout.rock.map((s) => ({ x: s.x, z: s.z, r: 0.55 * s.scale })),
    ...layout.stump.map((s) => ({ x: s.x, z: s.z, r: 0.4 })),
    ...layout.log.flatMap((s) => [-0.8, 0, 0.8].map((d) => ({ x: s.x + Math.sin(s.turn) * d, z: s.z + Math.cos(s.turn) * d, r: 0.45 }))),
    ...tradingPost(), // the trading post's counter (src/features/trade)
    ...bakery(), // the bakery's hut and oven (src/features/bakery)
    ...workbench(), // the workbench's stump (src/features/workbench)
    ...lightbulb(), // the Lightbulb's post beside it (src/features/lightbulb)
    { x: OLD_BEAVER.x, z: OLD_BEAVER.z, r: OLD_BEAVER_R }, // the Old Beaver (src/features/old-beaver): bots run headless, with no game to ask where he sits
  ];
  const obstacles = (state: BuildState, crates?: Map<number, [number, number, number]>): Circle[] => {
    const out = [...fixed];
    layout.crate.forEach((s, i) => { const at = crates?.get(CRATES + i); out.push({ x: at?.[0] ?? s.x, z: at?.[2] ?? s.z, r: 0.35 }); });
    trees.forEach((t, i) => {
      const now = live(state.trees[i]);
      if (now && now.fell === undefined) out.push({ x: t.x, z: t.z, r: t.collider });
      else out.push({ x: t.x, z: t.z, r: t.radius * 1.1 }); // the stump
      if (now?.rest) {
        const { from, along } = lineOf(now.rest);
        for (let d = 0; d <= t.trunk; d += 0.5) out.push({ x: from.x + along.x * d, z: from.z + along.z * d, r: t.radius + 0.05 });
      }
    });
    if (state.dam.length >= SLOTS) out.push({ x: lodgeAt.x, z: lodgeAt.z, r: 1.25 });
    return out;
  };

  // The food cache on the bed, and where a beaver floats to dive down to it: beside it, off the lodge and the sunken log.
  const bed = heightAt(CACHE_AT.x, CACHE_AT.z);
  const cache = { x: CACHE_AT.x, z: CACHE_AT.z, bed, spot: { x: CACHE_AT.x + 0.35, z: CACHE_AT.z - 0.2 } };

  return {
    trees, sticks, groundAt, level, fallDirection, restFor, lineOf, woodOf, obstacles, cache,
    dam: {
      origin, across, along, lodgeAt, local, world,
      /** Where the next stick goes into the dam (slot n < SLOTS). */
      slot: (n: number) => { const s = plan[Math.min(n, SLOTS - 1)]!; return world(s.x, s.z); },
    },
    /** Where E builds into the dam (build/index.ts atDam) and onto the lodge (atLodge). */
    atDam: (x: number, z: number) => { const l = local(x, z); return Math.abs(l.x) < DAM.base + 1 && Math.abs(l.z) < DAM.length / 2 + 0.7; },
    atLodge: (x: number, z: number) => Math.hypot(x - lodgeAt.x, z - lodgeAt.z) < 2,
    /** Diving down by the pile, where E wedges a stick into the cache (build/index.ts atCache). */
    atCache: (x: number, y: number, z: number) => Math.hypot(x - cache.x, z - cache.z) < 1.4 && y < bed + 1.6,
  };
}
export type BotWorld = Awaited<ReturnType<typeof loadWorld>>;

/** The heading from `from` to `to` (as facing: 0 = +z), round the nearest circle in the way. */
export function heading(from: { x: number; z: number }, to: { x: number; z: number }, circles: Circle[]) {
  const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d, straight = Math.atan2(dx, dz);
  let block: Circle | undefined, first = Infinity;
  for (const c of circles) {
    const r = c.r + BODY, ox = c.x - from.x, oz = c.z - from.z, s = ox * ux + oz * uz;
    if (Math.hypot(to.x - c.x, to.z - c.z) < r || s < -r || s > Math.min(d, 2.5) + r || Math.abs(ox * uz - oz * ux) >= r) continue;
    if (s < first) { first = s; block = c; }
  }
  if (!block) return straight;
  const ox = block.x - from.x, oz = block.z - from.z, cd = Math.hypot(ox, oz), r = block.r + BODY, centre = Math.atan2(ox, oz);
  if (cd < r) return centre + Math.PI; // inside: straight out
  const off = Math.asin(r / cd) + 0.1, gap = (a: number) => Math.abs(Math.atan2(Math.sin(a - straight), Math.cos(a - straight)));
  return gap(centre + off) < gap(centre - off) ? centre + off : centre - off;
}
