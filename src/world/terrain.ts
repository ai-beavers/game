// The ground: one height function for the whole place, and the mesh and Rapier collider made from the same samples.
//
//   heightAt(x, z)                 ground height; pure, also used by the tests and the placement rules
//   buildTerrain(stage)            adds the ground mesh and its fixed trimesh collider, returns the mesh
//
// The layout, in metres, y up, +z is where the beaver looks at the start:
//   meadow clearing around (0, 0), about 33 m across, closed by a bank that rises 4 m into thicket
//   pond at POND, 1.2 m deep, a shallow shore all round; the building site SITE is flat at its west shore
//   hill at HILL, 3 m high: the side facing the clearing is walkable (< 25°), the side facing the bank is steep
import * as THREE from "three";
import { RAPIER, type Stage } from "../engine.ts";
import { fbm, mix, noise, smoothstep } from "./noise.ts";

export const WATER_LEVEL = 0;
export const POND = { x: 5, z: 5, radius: 3.7, depth: 1.2 };
export const SITE = { x: -0.8, z: 4.8, radius: 1.6, height: 0.1 };
export const HILL = { x: -8, z: -7, height: 3, gentle: 10, steep: 3.6 };
export const RIM = 16.5; // where the bank starts, from the middle
export const SIZE = 90, CELL = 0.5; // the ground mesh: SIZE m square, one sample every CELL m

const gentleDir = new THREE.Vector2(-HILL.x, -HILL.z).normalize(); // the hill's walkable side faces the clearing

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
  const r = rimDistance(x, z);
  h += 4 * smoothstep(RIM, RIM + 6, r);
  h += Math.max(0, r - RIM - 6) * 0.18 + 5 * smoothstep(RIM + 6, RIM + 25, r) * (0.6 + fbm(x * 0.04, z * 0.04, 2));
  // The building site: levelled.
  const ds = Math.hypot(x - SITE.x, z - SITE.z);
  h = mix(SITE.height, h, smoothstep(SITE.radius, SITE.radius + 1.4, ds));
  // The pond: a bowl with a flat floor and a shallow shore.
  const t = pondRatio(x, z);
  h = mix(WATER_LEVEL - POND.depth, h, smoothstep(0.2, 1.3, t));
  return h;
}

/** Steepness at a place, as rise over run (1 = 45°). */
export function slopeAt(x: number, z: number) {
  const e = 0.25;
  return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
}

const C = (hex: number) => new THREE.Color(hex);
const PALETTE = {
  grass: C(0x56732a), lush: C(0x3f6122), dry: C(0x8a8a3c), earth: C(0x6e5638), sand: C(0xa89572),
  mud: C(0x3a3324), rock: C(0x7a766c), forest: C(0x3b4424),
};

/** Ground colour at a place, linear RGB, written into `out`. */
export function groundColor(x: number, z: number, h: number, slope: number, out: THREE.Color) {
  out.copy(PALETTE.grass).lerp(PALETTE.lush, smoothstep(-0.25, 0.35, fbm(x * 0.15 + 11, z * 0.15, 3)));
  out.lerp(PALETTE.dry, smoothstep(0.15, 0.45, fbm(x * 0.09 - 5, z * 0.09 + 8, 3)) * 0.7);
  // Bare earth: the building site, and a few worn patches.
  const ds = Math.hypot(x - SITE.x, z - SITE.z);
  out.lerp(PALETTE.earth, Math.max(1 - smoothstep(SITE.radius - 0.3, SITE.radius + 0.9, ds) + noise(x * 2, z * 2) * 0.25,
    smoothstep(0.32, 0.5, fbm(x * 0.3 + 40, z * 0.3, 2))) * 0.9);
  // Forest floor up on the bank.
  const bank = smoothstep(RIM + 0.3, RIM + 2.5, rimDistance(x, z));
  out.lerp(PALETTE.forest, bank);
  // Sand at the water, mud below it.
  const near = 1 - smoothstep(1.15, 1.6, pondRatio(x, z));
  out.lerp(PALETTE.sand, near * (1 - smoothstep(0.12, 0.35 + noise(x * 3, z * 3) * 0.1, h)));
  out.lerp(PALETTE.mud, smoothstep(-0.03, -0.45, h));
  // Rock where it is steep.
  // Rock where it is steep; on the bank only in patches, it is earth and roots there.
  out.lerp(PALETTE.rock, smoothstep(0.7, 1.05, slope + noise(x * 1.7, z * 1.7) * 0.12) * (1 - bank));
  out.lerp(PALETTE.earth, bank * Math.max(0, noise(x * 0.7, z * 0.7)) * 0.7);
  return out;
}

const DETAIL_GLSL = /* glsl */`
float worldHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float worldNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(worldHash(i), worldHash(i + vec2(1, 0)), f.x), mix(worldHash(i + vec2(0, 1)), worldHash(i + vec2(1, 1)), f.x), f.y);
}`;

/** The ground mesh and its collider, from one grid of heightAt samples. */
export function buildTerrain({ scene, physics }: Stage) {
  const n = Math.round(SIZE / CELL) + 1, half = SIZE / 2;
  const positions = new Float32Array(n * n * 3), colors = new Float32Array(n * n * 3);
  const color = new THREE.Color();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + i * CELL, z = -half + j * CELL, h = heightAt(x, z), k = (j * n + i) * 3;
    positions.set([x, h, z], k);
    groundColor(x, z, h, slopeAt(x, z), color).toArray(colors, k);
  }
  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let q = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    indices.set([a, c, b, b, c, d], q); // counter-clockwise seen from above
    q += 6;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  // Fine variation in world space, so the ground is not smooth vertex colour up close.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vGroundPos;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>\nvarying vec3 vGroundPos;${DETAIL_GLSL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        float grain = worldNoise(vGroundPos.xz * 1.3) * 0.5 + worldNoise(vGroundPos.xz * 5.1) * 0.3 + worldNoise(vGroundPos.xz * 17.0) * 0.2;
        diffuseColor.rgb *= 0.7 + grain * 0.55;`);
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "ground";
  mesh.receiveShadow = true;
  scene.add(mesh);
  // Rapier's heightfield: rows run along z, columns along x, stored column by column, centred on the collider
  // (checked with ray casts, see world.test.ts). Smoother contacts than a trimesh: thin sticks come to rest on it.
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j + i * n] = positions[(j * n + i) * 3 + 1]!;
  physics.createCollider(RAPIER.ColliderDesc.heightfield(n - 1, n - 1, heights, { x: SIZE, y: 1, z: SIZE }));
  return mesh;
}
