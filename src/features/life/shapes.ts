// The animals' bodies, built from code: smooth stretched spheres and cones merged into one geometry per kind, painted
// with vertex colours, and a material that moves wings, tails and legs in the vertex shader.
//
//   const mesh = animalMesh(birdShape(), count);      an InstancedMesh, one draw call for all birds
//   mesh.userData.anim                                 its per-animal vec4 (see each shape), set .needsUpdate after writing
//
// Every vertex knows which part it belongs to (attribute `part`); each shape's GLSL `pose()` turns parts around their
// joints from the per-animal `aAnim`. Animals face +z, y up, stand on y = 0, sizes in metres.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface Shape {
  name: string;
  geometry: THREE.BufferGeometry;
  /** GLSL: void pose(float part, vec4 anim, inout vec3 p, inout vec3 n) — moves a vertex and its normal. */
  pose: string;
  /** GLSL run in the fragment shader after the colour is known (diffuseColor, vPart, vLifeY are there). */
  fragment?: string;
  material?: THREE.MeshStandardMaterialParameters;
  /** A second colour set (attribute color2), chosen per animal with anim.w = 1. */
  variant?: boolean;
}

const C = (hex: number) => new THREE.Color(hex);
type Paint = (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void;

/** One smooth part: a sphere (or another geometry) moved into shape by `place`, painted by `paint`. */
function piece(base: THREE.BufferGeometry, part: number, place: (p: THREE.Vector3) => void, paint: Paint, paint2?: Paint) {
  const g = base;
  g.deleteAttribute("uv");
  const pos = g.attributes.position as THREE.BufferAttribute, p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { place(p.fromBufferAttribute(pos, i)); pos.setXYZ(i, p.x, p.y, p.z); }
  g.computeVertexNormals();
  const n = new THREE.Vector3(), c = new THREE.Color(), colors = new Float32Array(pos.count * 3), colors2 = new Float32Array(pos.count * 3);
  const normals = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); n.fromBufferAttribute(normals, i);
    paint(p, n, c); c.toArray(colors, i * 3);
    (paint2 ?? paint)(p, n, c); c.toArray(colors2, i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setAttribute("color2", new THREE.BufferAttribute(colors2, 3));
  g.setAttribute("part", new THREE.BufferAttribute(new Float32Array(pos.count).fill(part), 1));
  return g;
}

/** A sphere with its poles on z, stretched to half sizes (x, y, z), turned by `turn` (Euler), at `at`; `bend` shapes it first. */
function ellipsoid(size: [number, number, number], at: [number, number, number], segments: [number, number], part: number, paint: Paint,
  options: { turn?: [number, number, number]; bend?: (p: THREE.Vector3) => void; paint2?: Paint } = {}) {
  const sphere = new THREE.SphereGeometry(1, segments[0], segments[1]).rotateX(Math.PI / 2);
  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(options.turn ?? [0, 0, 0])));
  return piece(sphere, part, (p) => {
    options.bend?.(p);
    p.multiply(new THREE.Vector3(...size)).applyQuaternion(turn).add(new THREE.Vector3(...at));
  }, paint, options.paint2);
}

/** A tapered rod from a to b. */
function rod(a: [number, number, number], b: [number, number, number], r0: number, r1: number, part: number, paint: Paint) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), dir = to.clone().sub(from), length = dir.length();
  const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const g = new THREE.CylinderGeometry(r1, r0, length, 6, 1).translate(0, length / 2, 0);
  return piece(g, part, (p) => p.applyQuaternion(turn).add(from), paint);
}

const flat = (color: THREE.Color): Paint => (_p, _n, out) => void out.copy(color);
const streak = (x: number, z: number, f = 1) => 0.5 + 0.5 * Math.sin(x * 310 * f + Math.sin(z * 170 * f) * 2.5);

// The vertex shader's helpers for every shape.
const POSE_GLSL = /* glsl */`
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void turnAround(mat3 r, vec3 pivot, inout vec3 p, inout vec3 n) { p = r * (p - pivot) + pivot; n = r * n; }
`;

/** One InstancedMesh for all animals of a shape; its material poses them in the vertex shader, shadows included. */
export function animalMesh(shape: Shape, count: number) {
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
  shape.geometry.setAttribute("aAnim", anim);
  const head = `${POSE_GLSL}\n${shape.pose}\nattribute float part;\nattribute vec4 aAnim;\nvarying float vPart;\nvarying float vLifeY;\n`
    + (shape.variant ? "attribute vec3 color2;\n" : "");
  const vertex = (withNormals: boolean) => (s: THREE.WebGLProgramParametersWithUniforms) => {
    s.vertexShader = s.vertexShader.replace("#include <common>", `#include <common>\n${head}`)
      .replace("#include <begin_vertex>", `vec3 transformed = position; vec3 posedNormal = vec3(0.0, 1.0, 0.0);
        pose(part, aAnim, transformed, posedNormal); vPart = part;
        vLifeY = (modelMatrix * ${"instanceMatrix"} * vec4(transformed, 1.0)).y;`);
    if (withNormals) s.vertexShader = s.vertexShader.replace("#include <beginnormal_vertex>", `vec3 objectNormal = normal;
        { vec3 posedPosition = position; pose(part, aAnim, posedPosition, objectNormal); }`);
    if (shape.variant) s.vertexShader = s.vertexShader.replace("#include <color_vertex>", `#include <color_vertex>
        vColor.rgb = mix(color, color2, aAnim.w);
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= instanceColor.rgb;
        #endif`);
  };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, ...shape.material });
  material.onBeforeCompile = (s) => {
    vertex(true)(s);
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vPart;\nvarying float vLifeY;")
      .replace("#include <color_fragment>", `#include <color_fragment>\n${shape.fragment ?? ""}`);
  };
  material.customProgramCacheKey = () => `life-${shape.name}`;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (s) => {
    vertex(false)(s);
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vPart;\nvarying float vLifeY;");
  };
  depth.customProgramCacheKey = () => `life-depth-${shape.name}`;
  const mesh = new THREE.InstancedMesh(shape.geometry, material, count);
  mesh.customDepthMaterial = depth;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; // they move every frame; all of them stay near the clearing
  mesh.name = `life-${shape.name}`;
  mesh.userData.anim = anim;
  return mesh;
}

const merge = (name: string, parts: THREE.BufferGeometry[]) => {
  const g = mergeGeometries(parts);
  if (!g) throw new Error(`life: the parts of ${name} do not fit together`);
  return g;
};

// ---- a small songbird, 17 cm long --------------------------------------------------------------------------------
// anim: x wingbeat phase, y how hard the wings beat, z 0 folded … 1 spread, w 1 for a bird of prey's long wings.
// Parts: 0 body, 1 left wing, 2 right wing, 3 legs.

export function birdShape(): Shape {
  const back = C(0x6b4a2e), belly = C(0xd8c9a8), cap = C(0x5a5048), cheek = C(0xb9a58a), bill = C(0x3a332c), dark = C(0x2e241c);
  const body: Paint = (p, n, out) => {
    out.copy(back).lerp(dark, streak(p.x, p.z) * 0.35);
    out.lerp(belly, THREE.MathUtils.smoothstep(-n.y + p.z * 4, -0.2, 0.5));
  };
  const head: Paint = (p, n, out) => {
    out.copy(cap).lerp(cheek, THREE.MathUtils.smoothstep(-n.y, -0.3, 0.2));
    if (Math.abs(n.x) > 0.55 && n.y > -0.15 && n.y < 0.45 && n.z > 0.15 && n.z < 0.6) out.copy(dark); // the eye
    if (n.y < -0.3) out.copy(belly);
  };
  const wing: Paint = (p, _n, out) => {
    out.copy(back).lerp(dark, 0.25 + streak(p.z, p.x, 0.6) * 0.3);
    if (Math.abs(p.x) > 0.11) out.lerp(dark, 0.6); // dark flight feathers at the tips
    if (Math.abs(p.z - 0.005) < 0.006) out.lerp(belly, 0.7); // a pale wing bar
  };
  const wingShape = (side: number) => ellipsoid([0.06, 0.004, 0.034], [side * 0.085, 0.072, -0.004], [10, 5], side > 0 ? 1 : 2, wing, {
    bend: (p) => { p.z += -0.35 * p.x * p.x * side - 0.3 * (p.x * side > 0 ? p.x * side : 0); }, // swept back at the tip
  });
  const leg = flat(C(0x8a6a58));
  return {
    name: "bird",
    geometry: merge("bird", [
      ellipsoid([0.034, 0.036, 0.064], [0, 0.058, -0.004], [14, 10], 0, body, { bend: (p) => { p.y *= 1 + p.z * 0.12; } }),
      ellipsoid([0.026, 0.025, 0.027], [0, 0.093, 0.05], [12, 8], 0, head),
      piece(new THREE.ConeGeometry(0.0075, 0.022, 7).rotateX(Math.PI / 2), 0, (p) => p.add(new THREE.Vector3(0, 0.089, 0.083)), flat(bill)),
      ellipsoid([0.02, 0.0035, 0.048], [0, 0.064, -0.098], [8, 4], 0, (p, _n, o) => void o.copy(back).lerp(dark, 0.5), { turn: [-0.25, 0, 0] }),
      wingShape(1), wingShape(-1),
      rod([0.013, 0, 0.01], [0.012, 0.03, 0.0], 0.0022, 0.003, 3, leg), rod([-0.013, 0, 0.01], [-0.012, 0.03, 0.0], 0.0022, 0.003, 3, leg),
      rod([0.013, 0.001, 0.01], [0.013, 0.001, 0.03], 0.0018, 0.0015, 3, leg), rod([-0.013, 0.001, 0.01], [-0.013, 0.001, 0.03], 0.0018, 0.0015, 3, leg),
    ]),
    pose: /* glsl */`
      void pose(float part, vec4 anim, inout vec3 p, inout vec3 n) {
        if (part > 0.5 && part < 2.5) {
          float side = part < 1.5 ? 1.0 : -1.0, fold = 1.0 - anim.z;
          vec3 shoulder = vec3(side * 0.024, 0.074, 0.012);
          // A bird of prey (anim.w = 1): long broad wings with fingered tips, held flat to soar.
          p.x = shoulder.x + (p.x - shoulder.x) * (1.0 + 0.9 * anim.w);
          p.z = shoulder.z + (p.z - shoulder.z) * (1.0 + 0.35 * anim.w);
          float beat = sin(anim.x) * 1.05 * anim.y + 0.12 * anim.z;
          mat3 r = rotZ(side * beat) * rotY(side * 1.62 * fold) * rotZ(side * 0.02 * fold);
          turnAround(r, shoulder, p, n);
          p.z = shoulder.z + (p.z - shoulder.z) * (1.0 - 0.3 * fold); // folded, the wing lies shorter along the back
          p.x += side * 0.015 * fold;
        } else if (part > 2.5) {
          p.y = 0.03 + (p.y - 0.03) * (1.0 - anim.z); // legs tucked away in flight
        }
      }`,
    material: { roughness: 0.85 },
  };
}

// ---- a roach-like fish, 22 cm long -------------------------------------------------------------------------------
// anim: x swimming phase, y how far the tail swings. Seen through the water: drawn after the pond's surface, tinted and
// faded by how deep it swims.

export function fishShape(): Shape {
  const back = C(0x2a3324), side = C(0x9aa294), belly = C(0xe2e0d2), fin = C(0xb4502c);
  const body: Paint = (_p, n, out) => {
    out.copy(back).lerp(side, THREE.MathUtils.smoothstep(n.y, 0.75, 0.15)).lerp(belly, THREE.MathUtils.smoothstep(-n.y, 0.2, 0.7));
    if (Math.abs(n.x) > 0.5 && n.z > 0.5 && n.y > 0) out.copy(C(0x1a1a14)); // the eye
  };
  return {
    name: "fish",
    geometry: merge("fish", [
      ellipsoid([0.02, 0.034, 0.11], [0, 0, 0], [12, 10], 0, body, {
        bend: (p) => { const t = p.z < 0 ? 1 + p.z * 0.62 : 1 - p.z * p.z * 0.15; p.x *= t; p.y *= t; p.y += 0.06 * (1 - p.z * p.z) * 0.2; },
      }),
      ellipsoid([0.003, 0.038, 0.032], [0, 0, -0.128], [6, 6], 0, flat(fin), { bend: (p) => { p.z += Math.abs(p.y) * 0.9 - 0.3; } }),
      ellipsoid([0.0025, 0.022, 0.03], [0, 0.034, 0.008], [6, 5], 0, flat(back), { turn: [0.3, 0, 0] }),
      ellipsoid([0.012, 0.0025, 0.02], [0.016, -0.02, 0.04], [5, 4], 0, flat(fin), { turn: [0, 0.6, -0.5] }),
      ellipsoid([0.012, 0.0025, 0.02], [-0.016, -0.02, 0.04], [5, 4], 0, flat(fin), { turn: [0, -0.6, 0.5] }),
    ]),
    pose: /* glsl */`
      void pose(float part, vec4 anim, inout vec3 p, inout vec3 n) {
        float back = smoothstep(0.06, -0.16, p.z);
        float swing = sin(anim.x - p.z * 22.0) * anim.y * (0.25 + back * 1.6);
        p.x += swing;
        n.x -= cos(anim.x - p.z * 22.0) * anim.y * 10.0 * back;
        n = normalize(n);
      }`,
    fragment: /* glsl */`
      float under = clamp(-vLifeY, 0.0, 1.0);
      // Murky green-grey shapes, lighter than the deep water behind them, so the school shows from the bank.
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.2, 0.15), clamp(0.35 + under * 1.2, 0.0, 0.75));
      // At a glancing look the surface mirrors the sky and hides what is under it.
      float facing = abs(dot(normalize(vViewPosition), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)));
      diffuseColor.a = clamp(0.8 - under * 1.2, 0.3, 0.75) * smoothstep(0.06, 0.35, facing);`,
    material: { roughness: 0.45, transparent: true, depthWrite: false },
  };
}

// ---- a mallard pair, 55 cm long ----------------------------------------------------------------------------------
// anim: x paddling phase, z head dip 0 … 1, w 0 drake … 1 hen. Floats with y = 0 at the water line. Parts: 0 body, 1 head.

export function duckShape(): Shape {
  const green = C(0x0e3a22), collar = C(0xf0f0e8), chest = C(0x5a2e1c), grey = C(0xa8a6a0), back = C(0x5e5444), black = C(0x16161a);
  const yellow = C(0xc8b03a), hen = C(0x8a6a44), henDark = C(0x3e2c1c), speculum = C(0x2a3cb0), orange = C(0xb87a30);
  const drakeBody: Paint = (p, n, out) => {
    out.copy(grey).lerp(back, THREE.MathUtils.smoothstep(n.y, 0.55, 0.9));
    if (p.z > 0.13) out.copy(chest);
    if (p.z < -0.17) out.copy(black);
    if (Math.abs(n.x) > 0.75 && p.z > -0.11 && p.z < -0.06 && p.y > 0.07 && p.y < 0.1) out.copy(speculum);
  };
  const henBody: Paint = (p, n, out) => {
    out.copy(hen).lerp(henDark, streak(p.x * 0.5, p.z * 0.5, 0.5) * 0.55);
    out.lerp(C(0xa88a64), THREE.MathUtils.smoothstep(-n.y, 0.0, 0.6));
    if (Math.abs(n.x) > 0.75 && p.z > -0.11 && p.z < -0.06 && p.y > 0.07 && p.y < 0.1) out.copy(speculum);
  };
  const drakeHead: Paint = (p, n, out) => {
    out.copy(green).lerp(C(0x1c5a38), Math.max(0, n.x * n.x - 0.3));
    if (p.y < 0.15) out.copy(collar);
    if (p.y < 0.138) out.copy(chest);
    if (Math.abs(n.x) > 0.6 && n.z > 0.35 && n.y > 0.1 && n.y < 0.5 && p.y > 0.17) out.copy(black);
  };
  const henHead: Paint = (p, n, out) => {
    out.copy(hen).lerp(henDark, streak(p.x * 0.6, p.y * 0.6, 0.6) * 0.4);
    if (Math.abs(n.x) > 0.5 && n.y > 0.05 && n.y < 0.25 && p.y > 0.17) out.copy(henDark); // the eye stripe
  };
  const neckBase = new THREE.Vector3(0, 0.09, 0.16);
  return {
    name: "duck",
    variant: true,
    geometry: merge("duck", [
      ellipsoid([0.125, 0.1, 0.26], [0, 0.04, 0], [18, 12], 0, drakeBody, {
        bend: (p) => {
          if (p.y < 0) p.y *= 0.6;
          const tail = Math.max(0, -p.z - 0.45); // a pointed tail, held a little up
          p.x *= 1 - tail * 0.9; p.y = p.y * (1 - tail * 0.7) + tail * 0.5;
          if (p.z > 0.3) p.y += (p.z - 0.3) * 0.25; // a full chest
        },
        paint2: henBody,
      }),
      ellipsoid([0.042, 0.065, 0.046], [0, 0.14, 0.18], [12, 8], 1, drakeHead, {
        turn: [-0.2, 0, 0], paint2: henHead, bend: (p) => { const wide = 1 + Math.max(0, -p.y) * 0.45; p.x *= wide; p.z *= wide; },
      }),
      ellipsoid([0.046, 0.046, 0.066], [0, 0.21, 0.21], [14, 10], 1, drakeHead, { paint2: henHead, bend: (p) => { p.y *= 1 - Math.max(0, p.z) * 0.25; } }),
      ellipsoid([0.026, 0.009, 0.055], [0, 0.196, 0.29], [8, 5], 1, flat(yellow), { turn: [0.25, 0, 0], paint2: flat(orange) }),
    ]).translate(0, -0.02, 0),
    pose: /* glsl */`
      void pose(float part, vec4 anim, inout vec3 p, inout vec3 n) {
        if (part > 0.5) turnAround(rotX(anim.z * 1.1 + sin(anim.x * 0.5) * 0.06), vec3(${neckBase.x}, ${neckBase.y}, ${neckBase.z}), p, n);
        p.x += sin(anim.x) * 0.004 * smoothstep(-0.1, -0.3, p.z);
      }`,
    material: { roughness: 0.7 },
  };
}

// ---- a green frog, 10 cm long sitting ----------------------------------------------------------------------------
// anim: x breathing phase, y hind legs 0 folded … 1 stretched. Parts: 0 body, 1 left hind leg, 2 right hind leg.

export function frogShape(): Shape {
  const green = C(0x4f7a26), olive = C(0x3a4e1e), spot = C(0x22301a), belly = C(0xd8d098), gold = C(0xc8a038);
  const skin: Paint = (p, n, out) => {
    out.copy(green).lerp(olive, streak(p.x * 1.5, p.z * 1.5, 0.4) * 0.6);
    if (Math.sin(p.x * 260) * Math.sin(p.z * 230 + 1) > 0.55) out.copy(spot);
    out.lerp(belly, THREE.MathUtils.smoothstep(-n.y, 0.1, 0.6));
  };
  const eye: Paint = (_p, n, out) => void out.copy(n.z > 0.2 && n.y > -0.1 ? (Math.abs(n.x) > 0.75 ? C(0x0a0a08) : gold) : green);
  const leg = (side: number) => [
    ellipsoid([0.013, 0.012, 0.032], [side * 0.032, 0.02, -0.022], [8, 6], side > 0 ? 1 : 2, skin, { turn: [0.15, side * 0.35, 0] }),
    ellipsoid([0.009, 0.007, 0.034], [side * 0.042, 0.009, -0.004], [8, 5], side > 0 ? 1 : 2, skin, { turn: [0, -side * 0.3, 0] }),
    ellipsoid([0.011, 0.003, 0.02], [side * 0.05, 0.003, 0.03], [6, 4], side > 0 ? 1 : 2, flat(olive), { turn: [0, side * 0.3, 0] }),
  ];
  return {
    name: "frog",
    geometry: merge("frog", [
      ellipsoid([0.031, 0.02, 0.046], [0, 0.03, 0], [14, 10], 0, skin, { turn: [-0.35, 0, 0], bend: (p) => { if (p.y < 0) p.y *= 0.7; } }),
      ellipsoid([0.026, 0.016, 0.026], [0, 0.045, 0.035], [12, 8], 0, skin, { bend: (p) => { p.z += p.z > 0 ? -p.y * 0.2 : 0; } }),
      ellipsoid([0.0085, 0.0085, 0.0085], [0.016, 0.058, 0.041], [8, 6], 0, eye),
      ellipsoid([0.0085, 0.0085, 0.0085], [-0.016, 0.058, 0.041], [8, 6], 0, eye),
      rod([0.02, 0.025, 0.03], [0.026, 0.0, 0.045], 0.005, 0.004, 0, skin),
      rod([-0.02, 0.025, 0.03], [-0.026, 0.0, 0.045], 0.005, 0.004, 0, skin),
      ...leg(1), ...leg(-1),
    ]),
    pose: /* glsl */`
      void pose(float part, vec4 anim, inout vec3 p, inout vec3 n) {
        if (part > 0.5) {
          float side = part < 1.5 ? 1.0 : -1.0;
          vec3 hip = vec3(side * 0.024, 0.026, -0.035);
          // Stretched: the folded leg swings back and straightens out behind.
          vec3 q = p - hip;
          float reach = anim.y;
          q.z = mix(q.z, -abs(q.z + 0.03) * 1.6 - 0.01, reach);
          q.x *= 1.0 - 0.6 * reach;
          q.y *= 1.0 - 0.5 * reach;
          p = hip + q;
        } else if (p.y < 0.035 && p.z > 0.0 && p.z < 0.06) {
          p.y -= sin(anim.x * 6.0) * 0.0015 * smoothstep(0.035, 0.015, p.y); // the throat
        }
      }`,
    material: { roughness: 0.4 },
  };
}

// ---- a butterfly, 9 cm across --------------------------------------------------------------------------------------
// anim: x wingbeat phase. Colour per animal from instanceColor (white wings take it, the body stays dark).

export function butterflyShape(): Shape {
  const body = C(0x1c1814), white = C(0xffffff), edge = C(0x2a2018);
  const wing: Paint = (p, _n, out) => {
    const r = Math.hypot(p.x, p.z);
    out.copy(white);
    if (r > 0.038 && p.z > 0) out.copy(edge); // dark tips of the forewings
    if (Math.hypot(Math.abs(p.x) - 0.028, p.z - 0.02) < 0.006) out.copy(edge).lerp(C(0x7080ff), 0.4); // an eye spot
  };
  const pair = (side: number) => [
    ellipsoid([0.027, 0.0012, 0.018], [side * 0.026, 0, 0.012], [10, 4], side > 0 ? 1 : 2, wing, { turn: [0, side * -0.45, 0] }),
    ellipsoid([0.02, 0.0012, 0.016], [side * 0.018, 0, -0.012], [10, 4], side > 0 ? 1 : 2, wing, { turn: [0, side * 0.55, 0] }),
  ];
  return {
    name: "butterfly",
    geometry: merge("butterfly", [
      ellipsoid([0.0035, 0.0035, 0.018], [0, 0, 0], [6, 6], 0, flat(body)),
      ellipsoid([0.004, 0.004, 0.004], [0, 0.001, 0.02], [6, 4], 0, flat(body)),
      ...pair(1), ...pair(-1),
    ]),
    pose: /* glsl */`
      void pose(float part, vec4 anim, inout vec3 p, inout vec3 n) {
        if (part > 0.5) {
          float side = part < 1.5 ? 1.0 : -1.0;
          turnAround(rotZ(side * (0.15 + 1.15 * (0.5 + 0.5 * sin(anim.x)))), vec3(0.0), p, n);
        }
      }`,
    fragment: /* glsl */`if (vPart < 0.5) diffuseColor.rgb = vec3(0.02);`,
    material: { roughness: 0.75, side: THREE.DoubleSide },
  };
}

// ---- a dragonfly, 8 cm long ----------------------------------------------------------------------------------------
// anim: x wingbeat phase. Body colour per animal from instanceColor; the wings are clear, dithered (alphaHash).

export function dragonflyShape(): Shape {
  const body: Paint = (p, _n, out) => void out.setScalar(Math.sin(p.z * 400) > 0.6 ? 0.25 : 1);
  const wing = flat(C(0xe8f0f4));
  const wings = (side: number) => [
    ellipsoid([0.034, 0.0008, 0.0075], [side * 0.036, 0.007, 0.014], [8, 3], side > 0 ? 1 : 2, wing, { turn: [0, side * -0.12, 0] }),
    ellipsoid([0.032, 0.0008, 0.0085], [side * 0.034, 0.007, -0.002], [8, 3], side > 0 ? 1 : 2, wing, { turn: [0, side * 0.12, 0] }),
  ];
  return {
    name: "dragonfly",
    geometry: merge("dragonfly", [
      ellipsoid([0.0032, 0.0032, 0.034], [0, 0.003, -0.034], [6, 8], 0, body),
      ellipsoid([0.0065, 0.0065, 0.01], [0, 0.004, 0.008], [8, 6], 0, body),
      ellipsoid([0.007, 0.006, 0.0055], [0, 0.005, 0.022], [8, 6], 0, flat(C(0x203040))),
      ...wings(1), ...wings(-1),
    ]),
    pose: /* glsl */`
      void pose(float part, vec4 anim, inout vec3 p, inout vec3 n) {
        if (part > 0.5) {
          float side = part < 1.5 ? 1.0 : -1.0;
          turnAround(rotZ(side * sin(anim.x + (p.z > 0.008 ? 0.0 : 1.6)) * 0.45), vec3(0.0, 0.007, 0.0), p, n);
        }
      }`,
    fragment: /* glsl */`if (vPart > 0.5) { diffuseColor.rgb = vec3(0.85, 0.9, 0.92); diffuseColor.a = 0.35; }`,
    material: { roughness: 0.3, metalness: 0.3, side: THREE.DoubleSide, alphaHash: true },
  };
}

// ---- rings on the water, where something went in -------------------------------------------------------------------

/** A flat ring that spreads and fades: instance matrix places and sizes it; attribute aAge 0 … 1 is how far along. */
export function ringMesh(count: number) {
  const geometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const age = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aAge", age);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute float aAge; varying float vAge; varying vec2 vXY;
      void main() { vAge = aAge; vXY = position.xz; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      varying float vAge; varying vec2 vXY;
      void main() {
        float r = length(vXY), edge = 0.15 + vAge * 0.85;
        float ring = smoothstep(edge - 0.12, edge - 0.02, r) * smoothstep(edge + 0.04, edge - 0.02, r);
        float inner = smoothstep(edge - 0.45, edge - 0.15, r) * smoothstep(edge - 0.1, edge - 0.2, r) * 0.4;
        gl_FragColor = vec4(vec3(0.85, 0.9, 0.88), (ring + inner) * (1.0 - vAge) * 0.55);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = "life-rings";
  mesh.userData.age = age;
  return mesh;
}
