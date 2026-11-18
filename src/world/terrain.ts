import { hex } from "./color.ts";
import { material } from "./models.ts";
// The ground: one height function for the whole place, and the mesh and Rapier collider made from the same samples.
//
//   heightAt(x, z)                 ground height; pure, also used by the tests and the placement rules
//   buildTerrain(stage)            adds the ground mesh and its fixed trimesh collider, returns the mesh
//
// The layout, in metres, y up, +z is where the beaver looks at the start:
//   meadow clearing around (0, 0), about 33 m across, closed by a bank that rises 4 m into thicket
//   pond at POND, 1.2 m deep, a shallow shore all round, a basin 3 m deep in its south side (BASIN); the building
//   site SITE is flat at its west shore
//   hill at HILL, 3 m high: the side facing the clearing is walkable (< 25°), the side facing the bank is steep
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { Vector2 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { RAPIER, type Stage } from "../engine.ts";
import { fbm, mix, noise, seeded, smoothstep } from "./noise.ts";

export const WATER_LEVEL = 0;
export const POND = { x: 5, z: 5, radius: 3.7, depth: 1.2 };
export const SITE = { x: -0.8, z: 4.8, radius: 1.6, height: 0.1 };
export const HILL = { x: -8, z: -7, height: 3, gentle: 10, steep: 3.6 };
export const RIM = 16.5; // where the bank starts, from the middle
export const SIZE = 90, CELL = 0.5; // the ground mesh: SIZE m square, one sample every CELL m

const gentleDir = new Vector2(-HILL.x, -HILL.z).normalize(); // the hill's walkable side faces the clearing

/** Where the evening sun goes down (src/features/sky/clock.ts: from 30° high at 17:30 to the horizon at 20:20 it
 *  moves from about 29° to 2° of atan2(z, x)): the bank is low there and no far trees stand in it. */
export const SUNSET = { angle: 0.28, width: 0.46 };
/** 1 in the middle of the gap the evening sun shines through, 0 outside it. */
export function sunsetGap(x: number, z: number) {
  const off = Math.atan2(z, x) - SUNSET.angle;
  return smoothstep(SUNSET.width, SUNSET.width * 0.5, Math.abs(Math.atan2(Math.sin(off), Math.cos(off))));
}

/** Distance from the middle with a wobble, so the bank is not a circle. */
const rimDistance = (x: number, z: number) => Math.hypot(x, z) + fbm(x * 0.08 + 3, z * 0.08 - 2, 3) * 3;

/** How far out a point lies from the pond's centre: 1 at the (wobbly) rim of the pond basin. */
export function pondRatio(x: number, z: number) {
  const dx = x - POND.x, dz = z - POND.z, d = Math.hypot(dx, dz);
  const a = Math.atan2(dz, dx);
  return d / (POND.radius * (1 + 0.1 * noise(Math.cos(a) * 1.5 + 7, Math.sin(a) * 1.5)));
}

export function hillHeight(x: number, z: number) {
  const dx = x - HILL.x, dz = z - HILL.z, d = Math.hypot(dx, dz);
  const facing = d > 1e-6 ? (dx * gentleDir.x + dz * gentleDir.y) / d : 1;
  const reach = mix(HILL.steep, HILL.gentle, smoothstep(-0.35, 0.65, facing));
  return HILL.height * smoothstep(1, 0, d / reach);
}

export function heightAt(x: number, z: number): number {
  // The meadow: gently uneven.
  let h = 0.16 + fbm(x * 0.11, z * 0.11, 3) * 0.24;
  h = Math.max(h, h * 0.3 + hillHeight(x, z));
  // The bank at the edge, then land that keeps rising into far hills.
  // Low where the evening sun goes down; inside the clearing (r < RIM) nothing changes.
  const r = rimDistance(x, z), gap = sunsetGap(x, z);
  h += 4 * smoothstep(RIM, RIM + 6, r) * (1 - 0.7 * gap);
  h += (Math.max(0, r - RIM - 6) * 0.08 + 2 * smoothstep(RIM + 6, RIM + 25, r) * (0.6 + fbm(x * 0.04, z * 0.04, 2))) * (1 - 0.85 * gap);
  // The building site: levelled.
  const ds = Math.hypot(x - SITE.x, z - SITE.z);
  h = mix(SITE.height, h, smoothstep(SITE.radius, SITE.radius + 1.4, ds));
  // The pond: a bowl with a flat floor and a shallow shore, and the deep basin sunk into its south side.
  const t = pondRatio(x, z);
  h = mix(WATER_LEVEL - POND.depth, h, smoothstep(0.2, 1.3, t));
  return t < SHELF ? mix(Math.min(h, basinHeight(x, z)), h, smoothstep(SHELF - 0.12, SHELF, t)) : h;
}

/** The deep part: a basin about 3 m below the full pond on its south side, away from the dam (west shore) and the
 *  lodge (the middle). Longer along the bank than across; a steep drop-off from the shelf, a gentler slope up towards
 *  the middle, an uneven floor. It stays inside pondRatio SHELF, so the shallows along the bank (where the reeds and
 *  frogs are and the beaver wades), the shoreline and everything placed on land stay as they were. */
export const BASIN = { x: 4.1, z: 2.85, depth: 3, along: 2.4, across: 1.1 };
export const SHELF = 0.84;
const basinAlong = new Vector2(1, -0.25).normalize(); // roughly along the south bank
export function basinHeight(x: number, z: number) {
  const dx = x - BASIN.x, dz = z - BASIN.z;
  const a = (dx * basinAlong.x + dz * basinAlong.y) / BASIN.along, b = (-dx * basinAlong.y + dz * basinAlong.x) / BASIN.across;
  // across > 0 is towards the middle (north): there the side rises gently, towards the bank it drops off steeply
  const e = Math.hypot(a, b > 0 ? b * 0.6 : b * 1.15) * (1 + 0.12 * noise(x * 1.3 + 21, z * 1.3 - 4));
  const floor = WATER_LEVEL - BASIN.depth + 0.25 * fbm(x * 0.9 - 13, z * 0.9 + 6, 2) + 0.12 * smoothstep(0.1, 0.5, e);
  return mix(floor, WATER_LEVEL, smoothstep(0.5, 1.05, e));
}

/** Steepness at a place, as rise over run (1 = 45°). */
export function slopeAt(x: number, z: number) {
  const e = 0.25;
  return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
}


const PALETTE = {
  grass: hex(0x56732a), lush: hex(0x3f6122), dry: hex(0x8a8a3c), earth: hex(0x6e5638), sand: hex(0xa89572),
  mud: hex(0x3a3324), rock: hex(0x7a766c), forest: hex(0x3b4424),
};

/** Ground colour at a place, linear RGB, written into `out`. */
export function groundColor(x: number, z: number, h: number, slope: number, out: Color3) {
  out.copyFrom(PALETTE.grass);
  Color3.LerpToRef(out, PALETTE.lush, smoothstep(-0.25, 0.35, fbm(x * 0.15 + 11, z * 0.15, 3)), out);
  Color3.LerpToRef(out, PALETTE.dry, smoothstep(0.15, 0.45, fbm(x * 0.09 - 5, z * 0.09 + 8, 3)) * 0.7, out);
  // Bare earth: the building site, and a few worn patches.
  const ds = Math.hypot(x - SITE.x, z - SITE.z);
  Color3.LerpToRef(out, PALETTE.earth, Math.max(1 - smoothstep(SITE.radius - 0.3, SITE.radius + 0.9, ds) + noise(x * 2, z * 2) * 0.25,
    smoothstep(0.32, 0.5, fbm(x * 0.3 + 40, z * 0.3, 2))) * 0.9, out);
  // Forest floor up on the bank.
  const bank = smoothstep(RIM + 0.3, RIM + 2.5, rimDistance(x, z));
  Color3.LerpToRef(out, PALETTE.forest, bank, out);
  // Sand at the water, mud below it.
  const near = 1 - smoothstep(1.15, 1.6, pondRatio(x, z));
  Color3.LerpToRef(out, PALETTE.sand, near * (1 - smoothstep(0.12, 0.35 + noise(x * 3, z * 3) * 0.1, h)), out);
  Color3.LerpToRef(out, PALETTE.mud, smoothstep(-0.25, -0.7, h), out); // below the lowest level the pond has: sand shows through the shallows
  // Rock where it is steep; on the bank only in patches, it is earth and roots there.
  Color3.LerpToRef(out, PALETTE.rock, smoothstep(0.7, 1.05, slope + noise(x * 1.7, z * 1.7) * 0.12) * (1 - bank), out);
  Color3.LerpToRef(out, PALETTE.earth, bank * Math.max(0, noise(x * 0.7, z * 0.7)) * 0.7, out);
  return out;
}

/** The ground mesh and its collider, from one grid of heightAt samples. */
export function buildTerrain({ scene, physics }: Stage) {
  const n = Math.round(SIZE / CELL) + 1, half = SIZE / 2;
  const positions = new Float32Array(n * n * 3), colors = new Float32Array(n * n * 4);
  const color = new Color3();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + i * CELL, z = -half + j * CELL, h = heightAt(x, z), k = (j * n + i) * 3;
    positions.set([x, h, z], k);
    groundColor(x, z, h, slopeAt(x, z), color).toArray(colors, (j * n + i) * 4);
    colors[(j * n + i) * 4 + 3] = 1;
  }
  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let q = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    indices.set([a, b, c, b, d, c], q);
    q += 6;
  }
  const geometry = new VertexData();
  geometry.positions = positions;
  geometry.indices = indices;
  geometry.uvs = new Float32Array(n * n * 2);
  for (let i = 0; i < n*n; i++) {
    geometry.uvs[i*2] = positions[i*3]! / 2.5;
    geometry.uvs[i*2+1] = positions[i*3+2]! / 2.5;
  }
  geometry.normals = new Float32Array(positions.length);
  VertexData.ComputeNormals(positions, indices, geometry.normals);
  geometry.colors = colors;
  const mesh = new Mesh("ground", scene);
  geometry.applyToMesh(mesh);
  mesh.receiveShadows = true;
  const soil = material(scene, "meadow", 0xffffff);
  const grain = new DynamicTexture("soil grain", 128, scene, true);
  const ink = grain.getContext(), random = seeded(19);
  ink.fillStyle = "#eee";
  ink.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 3600; i++) {
    ink.fillStyle = i % 2 ? "rgba(65,57,33,0.18)" : "rgba(255,255,235,0.5)";
    ink.fillRect(random()*128, random()*128, 0.8+random()*2.8, 0.7+random()*1.4);
  }
  grain.wrapU = grain.wrapV = DynamicTexture.WRAP_ADDRESSMODE;
  grain.update();
  soil.diffuseTexture = grain;
  // A finer grain for close up: specks and short strokes on mid grey (grey leaves the colour as it is), every
  // 0.6 m, turned against the coarse layer so the two never line up; from afar its mipmaps fade to plain grey.
  const fine = new DynamicTexture("soil detail", 256, scene, true), pen = fine.getContext();
  pen.fillStyle = "rgb(128,128,128)";
  pen.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 12000; i++) {
    const shade = random() < 0.55 ? 20 + random() * 60 : 190 + random() * 65, x = random() * 256, y = random() * 256;
    const turn = random() * Math.PI, long = 1 + random() * 4, wide = 0.7 + random() * 0.8;
    pen.fillStyle = `rgb(${shade},${shade},${shade},${0.4 + random() * 0.5})`;
    for (const [dx, dy] of [[0, 0], [-256, 0], [0, -256], [-256, -256]] as const) { // drawn again across the edges, so it tiles
      pen.setTransform(Math.cos(turn), Math.sin(turn), -Math.sin(turn), Math.cos(turn), x + dx, y + dy);
      pen.fillRect(-long / 2, -wide / 2, long, wide);
    }
  }
  pen.setTransform(1, 0, 0, 1, 0, 0);
  fine.wrapU = fine.wrapV = DynamicTexture.WRAP_ADDRESSMODE;
  fine.uScale = fine.vScale = 4.3;
  fine.wAng = 0.61;
  fine.level = 2; // the ambient texture multiplies the lit colour: mid grey times 2 is 1
  fine.update();
  soil.ambientTexture = fine;
  mesh.material = soil;
  // Rapier's heightfield: rows run along z, columns along x, stored column by column, centred on the collider
  // (checked with ray casts, see world.test.ts). Smoother contacts than a trimesh: thin sticks come to rest on it.
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j + i * n] = positions[(j * n + i) * 3 + 1]!;
  physics.createCollider(RAPIER.ColliderDesc.heightfield(n - 1, n - 1, heights, { x: SIZE, y: 1, z: SIZE }));
  return mesh;
}
