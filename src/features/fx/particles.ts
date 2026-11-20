// Each visible particle occupies one billboard in the same instanced draw.
import { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { ToHalfFloat } from "@babylonjs/core/Misc/halfFloat.js";
import { Vector4 } from "@babylonjs/core/Maths/math.vector.js";
import type { World } from "../../contracts.ts";
import type { Stage } from "../../engine.ts";
import { SUN_DIRECTION } from "../../light.ts";
import { alpha, KIND, MODE, size, type Particle } from "./sim.ts";

/** The ground baked into a texture: SPAN metres square around the middle, one sample every STEP metres. */
const SPAN = 70, STEP = 0.5;

function groundTexture(world: World, scene: Scene) {
  const n = Math.round(SPAN / STEP) + 1, data = new Uint16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    data[j * n + i] = ToHalfFloat(world.heightAt(-SPAN / 2 + i * STEP, -SPAN / 2 + j * STEP));
  }
  const texture = RawTexture.CreateRTexture(data, n, n, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  // Texel centres sit on the samples: uv = (xz - min) / span, with half a texel on each side.
  const scale = (n - 1) / n / SPAN, offset = 0.5 / n;
  return { texture, rect: new Vector4(-SPAN / 2, -SPAN / 2, scale, offset) };
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

// All particle orientations share a quad.
const VERTEX_PLACE = /* glsl */`
vec3 centre = iPos.xyz;
float kind = iPos.w, mode = iMove.w, sz = iShape.x;
vec2 corner = position.xy;               // -0.5 … 0.5
vQuad = corner * 2.0;
vColor = iColor; vKind = kind; vMode = mode; vSeed = iShape.w;
float c = cos(iShape.y), s = sin(iShape.y);
vec2 q = vec2(corner.x * iShape.z, corner.y);
q = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * sz;
vec3 camRight = vec3(view[0][0], view[1][0], view[2][0]);
vec3 camUp = vec3(view[0][1], view[1][1], view[2][1]);
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
  if (kind > 2.5 && kind < 5.5 || kind > 7.5 && kind < 8.5) vSoft = 0.01;  // chips, blades, leaves, seeds: small, hardly soft
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
  if (kind < 8.5) return smoothstep(1.0, 0.5, r);   // seed
  if (kind < 9.5) {                      // flame: a tongue, wide at the foot, licking up to a point
    float y = p.y * 0.5 + 0.5;
    float lick = (fxNoise(vec2(p.y * 3.0 - seed * 31.0, seed * 7.0)) - 0.5) * 0.35 * y;
    float half_ = 0.62 * pow(max(0.0, 1.0 - y), 0.7) * (0.85 + 0.3 * fxNoise(p * 4.0 + seed * 11.0));
    return (1.0 - smoothstep(half_ * 0.35, half_, abs(p.x - lick))) * smoothstep(-1.0, -0.55, p.y);
  }
  float lumps = fxNoise(p * 1.8 + seed * 17.0) * 0.6 + fxNoise(p * 4.0 - seed * 9.0) * 0.4;   // smoke: a soft, loose cloud
  return pow(max(0.0, 1.0 - r * r), 2.2) * smoothstep(0.1, 0.7, lumps);
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
  const sun = scene.getLightByName("sun") as DirectionalLight | null;
  const sky = scene.getLightByName("skylight");
  const mesh = MeshBuilder.CreatePlane("fx", { size: 1 }, scene);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.alphaIndex = 2;
  const buffers = ["iPos", "iShape", "iMove", "iColor"] as const;
  const buffer = (name: (typeof buffers)[number]) => {
    const data = new Float32Array(capacity * 4);
    mesh.thinInstanceSetBuffer(name, data, 4, false);
    return data;
  };
  const pos = buffer("iPos"), shape = buffer("iShape"), move = buffer("iMove"), color = buffer("iColor");
  const ground = groundTexture(world, scene);
  const material = new ShaderMaterial("particles", scene, {
    vertexSource: `precision highp float;
      attribute vec3 position;
      uniform mat4 view, viewProjection;
      uniform vec3 cameraPosition, sunColor;
      uniform float skylight;
      ${VERTEX_HEAD}
      void main() {
        ${VERTEX_PLACE}
        if (kind < 8.5 || kind > 9.5) vColor.rgb *= skylight + sunColor * max(0.,dot(objectNormal,sunTowards)); // flames light themselves
        gl_Position = viewProjection * vec4(fxPos, 1.);
      }`,
    fragmentSource: `precision highp float;
      uniform vec3 cameraPosition,fogColor;
      uniform float fogDensity;
      ${FRAGMENT_HEAD}
      void main() {
        vec4 diffuseColor;
        ${FRAGMENT_COLOR}
        float haze = distance(cameraPosition,vWorld)*fogDensity;
        diffuseColor.rgb = mix(fogColor, diffuseColor.rgb, exp(-haze*haze));
        gl_FragColor = diffuseColor;
      }`,
  }, { attributes: ["position", ...buffers], uniforms: ["view","viewProjection","cameraPosition","sunTowards","sunColor","skylight",
    "groundRect","waterLevel","fogColor","fogDensity"], samplers: ["groundHeight"], needAlphaBlending: true });
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.setTexture("groundHeight", ground.texture).setVector4("groundRect", ground.rect);
  mesh.material = material;

  const write4 = (data: Float32Array, offset: number, x: number, y: number, z: number, w: number) => {
    data[offset] = x;
    data[offset + 1] = y;
    data[offset + 2] = z;
    data[offset + 3] = w;
  };
  const order: Particle[] = [], depth = new Map<Particle, number>();
  return {
    mesh,
    write(pool: Particle[], camera: Camera) {
      const forward = camera.getForwardRay().direction;
      material.setVector3("sunTowards", (sun?.direction ?? SUN_DIRECTION).negate())
        .setColor3("sunColor", sun ? sun.diffuse.scale(sun.intensity * 0.45) : scene.ambientColor)
        .setFloat("skylight", Math.min(1, sky?.intensity ?? 0.65))
        .setColor3("fogColor", scene.fogColor)
        .setFloat("fogDensity", scene.fogMode === Scene.FOGMODE_NONE ? 0 : scene.fogDensity)
        .setVector3("cameraPosition", camera.globalPosition).setFloat("waterLevel", world.waterLevel);
      const eye = camera.globalPosition;
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
        write4(pos, i * 4, p.x, p.y + lift, p.z, p.kind);
        write4(shape, i * 4, size(p), p.rot, squash, p.seed);
        write4(move, i * 4, p.vx, p.vy, p.vz, p.mode);
        write4(color, i * 4, p.r, p.g, p.b, alpha(p));
      }
      depth.clear();
      mesh.setEnabled(count > 0);
      mesh.forcedInstanceCount = count;
      if (count) for (const name of buffers) mesh.thinInstancePartialBufferUpdate(name, count, 0);
    },
  };
}
