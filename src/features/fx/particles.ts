// Draws every particle of the fx feature in one draw call: one quad per particle, instanced, through three's
// standard material with a few lines added. So dust and drops take the same sun, shadows, sky light, haze and tone
// mapping as the ground, and are never brighter than the world around them.
//
//   const drawn = createParticles(stage, world, capacity);
//   drawn.write(pool, camera);     each frame: copies the living particles in, far ones first; takes the way the light
//                                  travels now (sun or moon, daylightOf(scene).towards) and the pond's level now
//
// Shapes are drawn in the shader, no textures. Particles fade softly where they meet the ground and the water:
// the ground's height is baked once into a small texture the fragment shader reads.
import * as THREE from "three";
import type { World } from "../../contracts.ts";
import type { Stage } from "../../engine.ts";
import { daylightOf, SUN_DIRECTION } from "../../light.ts";
import { alpha, KIND, MODE, size, type Particle } from "./sim.ts";

/** The ground baked into a texture: SPAN metres square around the middle, one sample every STEP metres. */
const SPAN = 70, STEP = 0.5;

function groundTexture(world: World) {
  const n = Math.round(SPAN / STEP) + 1, data = new Uint16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    data[j * n + i] = THREE.DataUtils.toHalfFloat(world.heightAt(-SPAN / 2 + i * STEP, -SPAN / 2 + j * STEP));
  }
  const texture = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  // Texel centres sit on the samples: uv = (xz - min) / span, with half a texel on each side.
  const scale = (n - 1) / n / SPAN, offset = 0.5 / n;
  return { texture, rect: new THREE.Vector4(-SPAN / 2, -SPAN / 2, scale, offset) };
}

const VERTEX_HEAD = /* glsl */`
attribute vec4 iPos;    // centre, kind
attribute vec4 iShape;  // size, turn, squash, seed
attribute vec4 iMove;   // velocity, mode
attribute vec4 iColor;  // linear colour, opacity
uniform vec3 sunTowards;
varying vec4 vColor;
varying vec2 vQuad;
varying vec3 vWorld;
varying float vKind, vMode, vSeed, vSoft;
`;

// Replaces beginnormal_vertex: places the corner, and picks a normal that lights the shape as wished.
const VERTEX_PLACE = /* glsl */`
vec3 centre = iPos.xyz;
float kind = iPos.w, mode = iMove.w, sz = iShape.x;
vec2 corner = position.xy;               // -0.5 … 0.5
vQuad = corner * 2.0;
vColor = iColor; vKind = kind; vMode = mode; vSeed = iShape.w;
float c = cos(iShape.y), s = sin(iShape.y);
vec2 q = vec2(corner.x * iShape.z, corner.y);
q = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * sz;
vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
vec3 toCam = normalize(cameraPosition - centre);
vec3 fxPos;
vec3 objectNormal;
vSoft = sz * 0.3;
if (mode > 0.5 && mode < 2.5) {          // flat on water or ground
  fxPos = centre + vec3(q.x, 0.0, -q.y);
  objectNormal = vec3(0.0, 1.0, 0.0);
} else if (mode > 2.5) {                 // stretched along the velocity: falling drops
  float speed = length(iMove.xyz);
  vec3 along = speed > 0.05 ? iMove.xyz / speed : camUp;
  vec3 side = normalize(cross(along, toCam) + 1e-5);
  float len = sz * (1.0 + min(speed * 0.035 / sz, 4.0));
  fxPos = centre + side * corner.x * sz + along * corner.y * len;
  objectNormal = normalize(toCam + vec3(0.0, 0.5, 0.0));
  vSoft = 0.01;
} else {                                 // facing the camera, pulled a little towards it so it does not cut the ground
  fxPos = centre + camRight * q.x + camUp * q.y + toCam * sz * 0.4;
  objectNormal = normalize(mix(vec3(0.0, 1.0, 0.0), toCam, 0.45));
  if (kind > 5.5 && kind < 6.5) objectNormal = sunTowards;   // motes: lit when the sun reaches them
  if (kind > 2.5 && kind < 5.5 || kind > 7.5) vSoft = 0.01;  // chips, blades, leaves, seeds: small, hardly soft
}
vWorld = fxPos;
`;

const FRAGMENT_HEAD = /* glsl */`
uniform sampler2D groundHeight;
uniform vec4 groundRect;
uniform float waterLevel;
varying vec4 vColor;
varying vec2 vQuad;
varying vec3 vWorld;
varying float vKind, vMode, vSeed, vSoft;
float fxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fxNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fxHash(i), fxHash(i + vec2(1, 0)), f.x), mix(fxHash(i + vec2(0, 1)), fxHash(i + vec2(1, 1)), f.x), f.y);
}
// How much of the quad a shape covers at this point, 0 … 1.
float fxShape(float kind, vec2 p, float seed) {
  float r = length(p);
  if (kind < 0.5) {                      // puff: a soft lumpy cloud
    float lumps = fxNoise(p * 2.3 + seed * 17.0) * 0.6 + fxNoise(p * 5.0 - seed * 9.0) * 0.4;
    return pow(max(0.0, 1.0 - r * r), 1.8) * smoothstep(0.15, 0.75, lumps * (1.15 - r * 0.5));
  }
  if (kind < 1.5) return smoothstep(1.0, 0.45, r);              // drop
  if (kind < 2.5) {                      // ring: a thin bright line with a faint inside
    float wobble = (fxNoise(vec2(atan(p.y, p.x) * 3.0, seed * 40.0)) - 0.5) * 0.08;
    float line = exp(-pow((r - 0.8 - wobble) / 0.09, 2.0)) * (0.55 + 0.45 * fxNoise(p * 6.0 + seed * 13.0));
    return (line + smoothstep(0.85, 0.0, r) * 0.08) * smoothstep(1.0, 0.92, r);
  }
  if (kind < 3.5) {                      // chip: a splinter with ragged ends
    float w = 0.55 + (fxNoise(vec2(p.y * 4.0, seed * 30.0)) - 0.5) * 0.4;
    float edge = max(abs(p.x) / w, abs(p.y) / (0.95 - fxNoise(vec2(p.x * 6.0, seed * 50.0)) * 0.2));
    return 1.0 - smoothstep(0.85, 1.0, edge);
  }
  if (kind < 4.5) {                      // blade of grass: thin, tapering to a point
    float half_ = 0.22 * (1.0 - (p.y * 0.5 + 0.5)) + 0.02;
    return 1.0 - smoothstep(half_ * 0.6, half_, abs(p.x));
  }
  if (kind < 5.5) {                      // leaf: pointed oval
    float half_ = 0.62 * sqrt(max(0.0, 1.0 - p.y * p.y));
    return 1.0 - smoothstep(half_ * 0.85, half_, abs(p.x));
  }
  if (kind < 6.5) return pow(max(0.0, 1.0 - r * r), 3.0);       // mote
  if (kind < 7.5) {                      // foam: flat, broken up
    return pow(max(0.0, 1.0 - r), 1.5) * smoothstep(0.25, 0.75, fxNoise(p * 3.5 + seed * 23.0));
  }
  return smoothstep(1.0, 0.5, r);        // seed
}
`;

const FRAGMENT_COLOR = /* glsl */`
float cover = fxShape(vKind, vQuad, vSeed);
vec2 groundUv = (vWorld.xz - groundRect.xy) * groundRect.z + groundRect.w;
float ground = texture2D(groundHeight, groundUv).r;
if (vMode > 0.5 && vMode < 1.5) cover *= smoothstep(0.0, 0.1, waterLevel - ground);   // rings thin out at the shore
else if (vMode < 0.5 || vMode > 2.5) cover *= smoothstep(0.0, vSoft, vWorld.y - max(ground, waterLevel - 0.02));
diffuseColor.rgb = vColor.rgb;
if (vKind > 4.5 && vKind < 5.5) diffuseColor.rgb *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.06, abs(vQuad.x)));  // leaf rib
diffuseColor.a = vColor.a * cover;
if (diffuseColor.a < 0.004) discard;
`;

export function createParticles({ scene }: Stage, world: World, capacity: number) {
  const light = daylightOf(scene);
  const base = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute("position", base.attributes.position!);
  geometry.setAttribute("normal", base.attributes.normal!);
  const attribute = (name: string) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, a);
    return a;
  };
  const pos = attribute("iPos"), shape = attribute("iShape"), move = attribute("iMove"), color = attribute("iColor");
  geometry.instanceCount = 0;

  const ground = groundTexture(world);
  const sunTowards = { value: SUN_DIRECTION.clone().negate() }, waterLevel = { value: world.waterLevel };
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, transparent: true, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.sunTowards = sunTowards;
    shader.uniforms.groundHeight = { value: ground.texture };
    shader.uniforms.groundRect = { value: ground.rect };
    shader.uniforms.waterLevel = waterLevel;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_HEAD}`)
      .replace("#include <beginnormal_vertex>", VERTEX_PLACE)
      .replace("#include <begin_vertex>", "vec3 transformed = fxPos;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_HEAD}`)
      .replace("#include <color_fragment>", FRAGMENT_COLOR);
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "fx";
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2; // after the water, so rings lie on it
  scene.add(mesh);

  const order: Particle[] = [], depth = new Map<Particle, number>(), forward = new THREE.Vector3();
  return {
    mesh,
    write(pool: Particle[], camera: THREE.Camera) {
      if (light) sunTowards.value.copy(light.towards).negate();
      waterLevel.value = world.waterLevel;
      camera.getWorldDirection(forward);
      const eye = camera.position;
      order.length = 0;
      for (const p of pool) {
        if (!p.alive || alpha(p) < 0.002) continue;
        depth.set(p, (p.x - eye.x) * forward.x + (p.y - eye.y) * forward.y + (p.z - eye.z) * forward.z);
        order.push(p);
      }
      order.sort((a, b) => depth.get(b)! - depth.get(a)!); // far first: see-through things drawn back to front
      const count = Math.min(order.length, capacity);
      for (let i = 0; i < count; i++) {
        const p = order[i]!, lift = p.mode === MODE.ground ? 0.012 : p.mode === MODE.water ? 0.004 : 0;
        // Leaves turn over while they fall: their width shrinks and grows.
        const squash = p.kind === KIND.leaf && p.mode === MODE.face ? p.squash * (0.25 + 0.75 * Math.abs(Math.cos(p.age * 3.1 + p.seed * 9))) : p.squash;
        pos.setXYZW(i, p.x, p.y + lift, p.z, p.kind);
        shape.setXYZW(i, size(p), p.rot, squash, p.seed);
        move.setXYZW(i, p.vx, p.vy, p.vz, p.mode);
        color.setXYZW(i, p.r, p.g, p.b, alpha(p));
      }
      depth.clear();
      geometry.instanceCount = count;
      for (const a of [pos, shape, move, color]) { a.clearUpdateRanges(); a.addUpdateRange(0, count * 4); a.needsUpdate = true; }
    },
  };
}
