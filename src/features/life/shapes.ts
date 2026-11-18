import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { hex as C } from "../../world/color.ts";
import { smoothstep } from "../../world/noise.ts";

const smooth = (x: number, a: number, b: number) => smoothstep(a, b, x);
type Paint = (p: Vector3, n: Vector3, out: Color3) => void;
interface Piece { data: VertexData; part: number[]; second: number[] }
/** lit: lit by the scene's sun (or moon) and sky instead of the daylight number, for the larger animals that stand in
 *  the dusk and the moonlight; their pose takes a second vec4 (`more`) and their tint is not used. */
interface Shape { name: string; geometry: Piece; pose: string; fragment?: string; variant?: boolean; lit?: boolean }

function piece(data: VertexData, joint: number, place: (p: Vector3) => void, paint: Paint, paint2 = paint): Piece {
  const positions = data.positions!, normals = data.normals!, c = new Color3(), colors = [], second = [], part = [];
  for (let i = 0; i < positions.length; i += 3) {
    const p = Vector3.FromArray(positions, i);
    place(p);
    p.toArray(positions, i);
  }
  VertexData.ComputeNormals(positions, data.indices!, normals);
  for (let i = 0; i < positions.length; i += 3) {
    const p = Vector3.FromArray(positions, i), n = Vector3.FromArray(normals, i);
    paint(p, n, c);
    colors.push(c.r, c.g, c.b, 1);
    paint2(p, n, c);
    second.push(c.r, c.g, c.b);
    part.push(joint);
  }
  data.colors = colors;
  return { data, part, second };
}

function ellipsoid(size: [number, number, number], at: [number, number, number], segments: [number, number], joint: number, paint: Paint,
  options: { turn?: [number, number, number]; bend?: (p: Vector3) => void; paint2?: Paint } = {}) {
  const sphere = VertexData.CreateSphere({ diameter: 2, segments: Math.ceil(Math.max(...segments) / 2) });
  const rotation = Quaternion.FromEulerAngles(...(options.turn ?? [0, 0, 0]));
  const scale = new Vector3(...size), offset = new Vector3(...at);
  return piece(sphere, joint, p => {
    options.bend?.(p);
    p.multiplyInPlace(scale).applyRotationQuaternionInPlace(rotation).addInPlace(offset);
  }, paint, options.paint2);
}

function rod(a: [number, number, number], b: [number, number, number], r0: number, r1: number, joint: number, paint: Paint) {
  const start = new Vector3(...a), delta = new Vector3(...b).subtract(start);
  const data = VertexData.CreateCylinder({ height: delta.length(), diameterTop: 2 * r1, diameterBottom: 2 * r0, tessellation: 6 });
  const rotation = Quaternion.Identity();
  Quaternion.FromUnitVectorsToRef(Vector3.Up(), delta.normalizeToNew(), rotation);
  const center = start.add(delta.scale(0.5));
  return piece(data, joint, p => p.applyRotationQuaternionInPlace(rotation).addInPlace(center), paint);
}
const merge = (pieces: Piece[]) => ({
  data: pieces[0]!.data.merge(pieces.slice(1).map(p => p.data)),
  part: pieces.flatMap(p => p.part), second: pieces.flatMap(p => p.second),
});
const flat = (color: Color3): Paint => (_p, _n, out) => void out.copyFrom(color);
const streak = (x: number, z: number, f = 1) => 0.5 + 0.5 * Math.sin(x * 310 * f + Math.sin(z * 170 * f) * 2.5);
const POSE_GLSL = /* glsl */`
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void turnAround(mat3 r, vec3 pivot, inout vec3 p, inout vec3 n) { p = r * (p - pivot) + pivot; n = r * n; }
`;

export function animalMesh(scene: Scene, shape: Shape, count: number) {
  const mesh = new Mesh("life-" + shape.name, scene), geometry = shape.geometry;
  geometry.data.applyToMesh(mesh);
  mesh.setVerticesData("part", geometry.part, false, 1);
  mesh.setVerticesData("color2", geometry.second, false, 3);
  const lit = shape.lit, anim = new Float32Array(count * 4), tint = new Float32Array(count * 4).fill(1), more = new Float32Array(lit ? count * 4 : 0);
  mesh.thinInstanceSetBuffer("matrix", new Float32Array(count * 16), 16, false);
  mesh.thinInstanceSetBuffer("aAnim", anim, 4, false);
  mesh.thinInstanceSetBuffer(lit ? "aMore" : "tint", lit ? more : tint, 4, false);
  const mat = new ShaderMaterial(mesh.name, scene, {
    vertexSource: `precision highp float; attribute vec3 position, normal, color2; attribute vec4 color, aAnim, ${lit ? "aMore" : "tint"};
      attribute float part; varying vec4 shade; varying float vPart,vLifeY; varying vec3 vWorld; ${lit ? "varying vec3 vNormal;" : ""}
      #include<instancesDeclaration>
      uniform mat4 viewProjection;
      ${POSE_GLSL}
      ${shape.pose}
      void main(){
        #include<instancesVertex>
        vec3 p=position,n=normal; ${lit ? "pose(part,aAnim,aMore,p,n)" : "pose(part,aAnim,p,n)"};
        vec4 at=finalWorld*vec4(p,1.); vPart=part; vWorld=at.xyz; vLifeY=at.y;
        ${lit ? `shade=vec4(color.rgb,1.); vNormal=normalize(mat3(finalWorld)*n);` : `
        shade=vec4(mix(color.rgb,color2,${shape.variant ? "aAnim.w" : "0."})*tint.rgb,1.);
        shade.rgb*=.65+.35*max(0.,normalize(mat3(finalWorld)*n).y);`}
        gl_Position=viewProjection*at;
      }`,
    // Lit: the sky from above and the ground's bounce from below, as a hemispheric light does, and the sun or moon.
    fragmentSource: `precision highp float; varying vec4 shade; varying float vPart,vLifeY; varying vec3 vWorld; uniform float daylight, waterLevel; uniform vec3 cameraPosition;
      ${lit ? `varying vec3 vNormal; uniform vec3 sunDirection, sunColor, skyColor, groundColor;` : ""}
      void main(){vec4 diffuseColor=shade;
        ${lit ? `vec3 n=normalize(vNormal);
        diffuseColor.rgb*=mix(groundColor,skyColor,.5+.5*n.y)+sunColor*max(0.,dot(n,-sunDirection));` : ""}
        ${shape.fragment ?? ""}
        gl_FragColor=vec4(diffuseColor.rgb${lit ? "" : "*daylight"},diffuseColor.a);
      }`,
  }, {
    attributes: ["position", "normal", "color", "part", "aAnim", "color2", lit ? "aMore" : "tint"],
    uniforms: ["world", "viewProjection", "daylight", "waterLevel", "cameraPosition", ...lit ? ["sunDirection", "sunColor", "skyColor", "groundColor"] : []],
    needAlphaBlending: shape.name === "fish" || shape.name === "dragonfly",
  });
  mesh.material = mat;
  mesh.alwaysSelectAsActiveMesh = true;
  mat.backFaceCulling = false;
  mesh.isPickable = false;
  return { mesh, material: mat, anim, tint, more };
}
// ---- a small songbird, 17 cm long --------------------------------------------------------------------------------
// anim: x wingbeat phase, y how hard the wings beat, z 0 folded … 1 spread, w 1 for a bird of prey's long wings.
// Parts: 0 body, 1 left wing, 2 right wing, 3 legs.

export function birdShape(): Shape {
  const back = C(0x6b4a2e), belly = C(0xd8c9a8), cap = C(0x5a5048), cheek = C(0xb9a58a), bill = C(0x3a332c), dark = C(0x2e241c);
  const body: Paint = (p, n, out) => {
    Color3.LerpToRef(back, dark, streak(p.x, p.z) * 0.35, out);
    Color3.LerpToRef(out, belly, smooth(-n.y + p.z * 4, -0.2, 0.5), out);
  };
  const head: Paint = (p, n, out) => {
    Color3.LerpToRef(cap, cheek, smooth(-n.y, -0.3, 0.2), out);
    if (Math.abs(n.x) > 0.55 && n.y > -0.15 && n.y < 0.45 && n.z > 0.15 && n.z < 0.6) out.copyFrom(dark); // the eye
    if (n.y < -0.3) out.copyFrom(belly);
  };
  const wing: Paint = (p, _n, out) => {
    Color3.LerpToRef(back, dark, 0.25 + streak(p.z, p.x, 0.6) * 0.3, out);
    if (Math.abs(p.x) > 0.11) Color3.LerpToRef(out, dark, 0.6, out); // dark flight feathers at the tips
    if (Math.abs(p.z - 0.005) < 0.006) Color3.LerpToRef(out, belly, 0.7, out); // a pale wing bar
  };
  const wingShape = (side: number) => ellipsoid([0.06, 0.004, 0.034], [side * 0.085, 0.072, -0.004], [10, 5], side > 0 ? 1 : 2, wing, {
    bend: (p) => { p.z += -0.35 * p.x * p.x * side - 0.3 * (p.x * side > 0 ? p.x * side : 0); }, // swept back at the tip
  });
  const leg = flat(C(0x8a6a58));
  return {
    name: "bird",
    geometry: merge([
      ellipsoid([0.034, 0.036, 0.064], [0, 0.058, -0.004], [14, 10], 0, body, { bend: (p) => { p.y *= 1 + p.z * 0.12; } }),
      ellipsoid([0.026, 0.025, 0.027], [0, 0.093, 0.05], [12, 8], 0, head),
      piece(VertexData.CreateCylinder({ diameterTop: 0, diameterBottom: 0.015, height: 0.022, tessellation: 7 }).transform(Matrix.RotationX(Math.PI / 2)), 0, (p) => p.addInPlace(new Vector3(0, 0.089, 0.083)), flat(bill)),
      ellipsoid([0.02, 0.0035, 0.048], [0, 0.064, -0.098], [8, 4], 0, (p, _n, o) => void Color3.LerpToRef(back, dark, 0.5, o), { turn: [-0.25, 0, 0] }),
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
  };
}

// ---- a roach-like fish, 22 cm long -------------------------------------------------------------------------------
// anim: x swimming phase, y how far the tail swings. Seen through the water: drawn after the pond's surface, tinted and
// faded by how deep it swims.

export function fishShape(): Shape {
  const back = C(0x2a3324), side = C(0x9aa294), belly = C(0xe2e0d2), fin = C(0xb4502c);
  const body: Paint = (_p, n, out) => {
    Color3.LerpToRef(back, side, smooth(n.y, 0.75, 0.15), out);
    Color3.LerpToRef(out, belly, smooth(-n.y, 0.2, 0.7), out);
    if (Math.abs(n.x) > 0.5 && n.z > 0.5 && n.y > 0) out.copyFrom(C(0x1a1a14)); // the eye
  };
  return {
    name: "fish",
    geometry: merge([
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
      float under = clamp(waterLevel-vLifeY, 0.0, 1.0);
      // Murky green-grey shapes, lighter than the deep water behind them, so the school shows from the bank.
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.2, 0.15), clamp(0.35 + under * 1.2, 0.0, 0.75));
      // At a glancing look the surface mirrors the sky and hides what is under it.
      float facing = abs(normalize(cameraPosition-vWorld).y);
      diffuseColor.a = clamp(0.8 - under * 1.2, 0.3, 0.75) * smoothstep(0.06, 0.35, facing);`,
  };
}

// ---- a mallard pair, 55 cm long ----------------------------------------------------------------------------------
// anim: x paddling phase (it beats the wings too), y wings 0 folded … 1 spread in flight, z head dip 0 … 1, w 0 drake …
// 1 hen. Floats with y = 0 at the water line. Parts: 0 body, 1 head, 2 left wing, 3 right wing.

export function duckShape(): Shape {
  const green = C(0x0e3a22), collar = C(0xf0f0e8), chest = C(0x5a2e1c), grey = C(0xa8a6a0), back = C(0x5e5444), black = C(0x16161a);
  const yellow = C(0xc8b03a), hen = C(0x8a6a44), henDark = C(0x3e2c1c), speculum = C(0x2a3cb0), orange = C(0xb87a30);
  const drakeBody: Paint = (p, n, out) => {
    Color3.LerpToRef(grey, back, smooth(n.y, 0.55, 0.9), out);
    if (p.z > 0.13) out.copyFrom(chest);
    if (p.z < -0.17) out.copyFrom(black);
    if (Math.abs(n.x) > 0.75 && p.z > -0.11 && p.z < -0.06 && p.y > 0.07 && p.y < 0.1) out.copyFrom(speculum);
  };
  const henBody: Paint = (p, n, out) => {
    Color3.LerpToRef(hen, henDark, streak(p.x * 0.5, p.z * 0.5, 0.5) * 0.55, out);
    Color3.LerpToRef(out, C(0xa88a64), smooth(-n.y, 0.0, 0.6), out);
    if (Math.abs(n.x) > 0.75 && p.z > -0.11 && p.z < -0.06 && p.y > 0.07 && p.y < 0.1) out.copyFrom(speculum);
  };
  const drakeHead: Paint = (p, n, out) => {
    Color3.LerpToRef(green, C(0x1c5a38), Math.max(0, n.x * n.x - 0.3), out);
    if (p.y < 0.15) out.copyFrom(collar);
    if (p.y < 0.138) out.copyFrom(chest);
    if (Math.abs(n.x) > 0.6 && n.z > 0.35 && n.y > 0.1 && n.y < 0.5 && p.y > 0.17) out.copyFrom(black);
  };
  const henHead: Paint = (p, n, out) => {
    Color3.LerpToRef(hen, henDark, streak(p.x * 0.6, p.y * 0.6, 0.6) * 0.4, out);
    if (Math.abs(n.x) > 0.5 && n.y > 0.05 && n.y < 0.25 && p.y > 0.17) out.copyFrom(henDark); // the eye stripe
  };
  const neckBase = new Vector3(0, 0.09, 0.16);
  const drakeWing: Paint = (p, n, out) => {
    Color3.LerpToRef(grey, back, smooth(Math.abs(p.x), 0.1, 0.3), out);
    if (p.z < -0.005 && p.z > -0.035 && Math.abs(p.x) > 0.08 && Math.abs(p.x) < 0.2 && n.y < 0) out.copyFrom(speculum); // the blue under the wing
  };
  const henWing: Paint = (p, _n, out) => void Color3.LerpToRef(hen, henDark, streak(p.x, p.z, 0.5) * 0.5, out);
  // Spread out from the shoulder; the pose folds them along the back, inside the body, until it flies.
  const wing = (side: number) => ellipsoid([0.15, 0.008, 0.07], [side * 0.2, 0.1, 0.03], [10, 4], side > 0 ? 2 : 3, drakeWing, {
    paint2: henWing, bend: (p) => { p.z -= 0.25 * p.x * p.x; },
  });
  return {
    name: "duck",
    variant: true,
    geometry: merge([
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
      wing(1), wing(-1),
    ]),
    pose: /* glsl */`
      void pose(float part, vec4 anim, inout vec3 p, inout vec3 n) {
        if (part > 1.5) {
          float side = part < 2.5 ? 1.0 : -1.0, fold = 1.0 - anim.y;
          vec3 shoulder = vec3(side * 0.05, 0.1, 0.03);
          turnAround(rotZ(side * sin(anim.x * 0.8) * 0.9 * anim.y) * rotY(side * 1.5 * fold), shoulder, p, n);
          p = mix(shoulder, p, 0.35 + 0.65 * anim.y); // folded, small and inside the body
        } else if (part > 0.5) turnAround(rotX(anim.z * 1.1 + sin(anim.x * 0.5) * 0.06), vec3(${neckBase.x}, ${neckBase.y}, ${neckBase.z}), p, n);
        p.x += sin(anim.x) * 0.004 * smoothstep(-0.1, -0.3, p.z);
      }`,
  };
}

// ---- a green frog, 10 cm long sitting ----------------------------------------------------------------------------
// anim: x breathing phase, y hind legs 0 folded … 1 stretched. Parts: 0 body, 1 left hind leg, 2 right hind leg.

export function frogShape(): Shape {
  const green = C(0x4f7a26), olive = C(0x3a4e1e), spot = C(0x22301a), belly = C(0xd8d098), gold = C(0xc8a038);
  const skin: Paint = (p, n, out) => {
    Color3.LerpToRef(green, olive, streak(p.x * 1.5, p.z * 1.5, 0.4) * 0.6, out);
    if (Math.sin(p.x * 260) * Math.sin(p.z * 230 + 1) > 0.55) out.copyFrom(spot);
    Color3.LerpToRef(out, belly, smooth(-n.y, 0.1, 0.6), out);
  };
  const eye: Paint = (_p, n, out) => void out.copyFrom(n.z > 0.2 && n.y > -0.1 ? (Math.abs(n.x) > 0.75 ? C(0x0a0a08) : gold) : green);
  const leg = (side: number) => [
    ellipsoid([0.013, 0.012, 0.032], [side * 0.032, 0.02, -0.022], [8, 6], side > 0 ? 1 : 2, skin, { turn: [0.15, side * 0.35, 0] }),
    ellipsoid([0.009, 0.007, 0.034], [side * 0.042, 0.009, -0.004], [8, 5], side > 0 ? 1 : 2, skin, { turn: [0, -side * 0.3, 0] }),
    ellipsoid([0.011, 0.003, 0.02], [side * 0.05, 0.003, 0.03], [6, 4], side > 0 ? 1 : 2, flat(olive), { turn: [0, side * 0.3, 0] }),
  ];
  return {
    name: "frog",
    geometry: merge([
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
  };
}

// ---- a butterfly, 9 cm across --------------------------------------------------------------------------------------
// anim: x wingbeat phase. Colour per animal from instanceColor (white wings take it, the body stays dark).

export function butterflyShape(): Shape {
  const body = C(0x1c1814), white = C(0xffffff), edge = C(0x2a2018);
  const wing: Paint = (p, _n, out) => {
    const r = Math.hypot(p.x, p.z);
    out.copyFrom(white);
    if (r > 0.038 && p.z > 0) out.copyFrom(edge); // dark tips of the forewings
    if (Math.hypot(Math.abs(p.x) - 0.028, p.z - 0.02) < 0.006) Color3.LerpToRef(edge, C(0x7080ff), 0.4, out); // an eye spot
  };
  const pair = (side: number) => [
    ellipsoid([0.027, 0.0012, 0.018], [side * 0.026, 0, 0.012], [10, 4], side > 0 ? 1 : 2, wing, { turn: [0, side * -0.45, 0] }),
    ellipsoid([0.02, 0.0012, 0.016], [side * 0.018, 0, -0.012], [10, 4], side > 0 ? 1 : 2, wing, { turn: [0, side * 0.55, 0] }),
  ];
  return {
    name: "butterfly",
    geometry: merge([
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
  };
}

// ---- a dragonfly, 8 cm long ----------------------------------------------------------------------------------------
// anim: x wingbeat phase. Body colour per animal from instanceColor; the wings are clear, dithered (alphaHash).

export function dragonflyShape(): Shape {
  const body: Paint = (p, _n, out) => void out.setAll(Math.sin(p.z * 400) > 0.6 ? 0.25 : 1);
  const wing = flat(C(0xe8f0f4));
  const wings = (side: number) => [
    ellipsoid([0.034, 0.0008, 0.0075], [side * 0.036, 0.007, 0.014], [8, 3], side > 0 ? 1 : 2, wing, { turn: [0, side * -0.12, 0] }),
    ellipsoid([0.032, 0.0008, 0.0085], [side * 0.034, 0.007, -0.002], [8, 3], side > 0 ? 1 : 2, wing, { turn: [0, side * 0.12, 0] }),
  ];
  return {
    name: "dragonfly",
    geometry: merge([
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
  };
}

// ---- a roe deer, 75 cm at the shoulder ---------------------------------------------------------------------------
// anim: x gait phase, y 0 … 1 walking, z 0 … 1 bounding, w head 0 up … 1 down to the grass. more: x head turned
// (radians), y and z left and right ear flicked, w the white tail up. Parts: 0 body, 1 neck and head, 2 left ear,
// 3 right ear, 4 … 7 legs (front left, front right, hind left, hind right), 8 tail.

export function deerShape(): Shape {
  const coat = C(0x9a5a30), back = C(0x6e3e22), belly = C(0xd2b08a), white = C(0xf2eee4), dark = C(0x241a14), hoof = C(0x2e2620);
  const body: Paint = (p, n, out) => {
    Color3.LerpToRef(coat, back, smooth(n.y, 0.4, 0.95) * 0.7, out);
    Color3.LerpToRef(out, belly, smooth(-n.y, 0.35, 0.8), out);
    if (p.z < -0.3 && n.z < -0.3 && p.y > 0.5) out.copyFrom(white); // the rump patch
  };
  const nose = new Vector3(0, 0.975, 0.63);
  const head: Paint = (p, n, out) => {
    Color3.LerpToRef(coat, back, smooth(n.y, 0.5, 1) * 0.6, out);
    if (p.y < 0.975 && p.z > 0.55 && n.y < -0.2) out.copyFrom(white); // the chin
    if (Vector3.Distance(p, nose) < 0.04) out.copyFrom(dark);
    if (Math.abs(n.x) > 0.7 && p.z > 0.5 && p.z < 0.56 && p.y > 1.02) out.copyFrom(dark); // the eye
  };
  const ear = (side: number) => ellipsoid([0.036, 0.075, 0.014], [side * 0.055, 1.13, 0.46], [8, 6], side > 0 ? 2 : 3,
    (_p, n, out) => void out.copyFrom(n.z > 0.3 ? belly : back), { turn: [0.2, 0, -side * 0.5] });
  const leg = (side: number, front: boolean) => {
    const part = front ? (side > 0 ? 4 : 5) : (side > 0 ? 6 : 7), x = side * 0.08;
    const paint: Paint = (p, _n, out) => void Color3.LerpToRef(coat, back, 0.3 + 0.4 * smooth(p.y, 0.45, 0.1), out);
    return front ? [
      rod([x, 0.58, 0.27], [x, 0.3, 0.28], 0.038, 0.026, part, paint),
      rod([x, 0.3, 0.28], [x, 0.04, 0.29], 0.022, 0.017, part, paint),
      ellipsoid([0.02, 0.03, 0.028], [x, 0.025, 0.3], [6, 5], part, flat(hoof)),
    ] : [
      ellipsoid([0.07, 0.15, 0.1], [side * 0.075, 0.55, -0.27], [10, 8], part, body),
      rod([x, 0.5, -0.27], [x, 0.32, -0.36], 0.035, 0.025, part, paint),
      rod([x, 0.32, -0.36], [x, 0.04, -0.31], 0.02, 0.017, part, paint),
      ellipsoid([0.02, 0.03, 0.028], [x, 0.025, -0.3], [6, 5], part, flat(hoof)),
    ];
  };
  return {
    name: "deer",
    lit: true,
    geometry: merge([
      ellipsoid([0.15, 0.17, 0.4], [0, 0.62, -0.02], [18, 12], 0, body, {
        bend: (p) => { if (p.z > 0) p.y *= 1 + 0.15 * p.z; if (p.z < 0 && p.y < 0) p.y *= 1 + 0.25 * p.z; },
      }),
      ellipsoid([0.06, 0.065, 0.2], [0, 0.83, 0.36], [10, 8], 1, body, { turn: [-0.95, 0, 0] }),
      ellipsoid([0.065, 0.07, 0.11], [0, 1.02, 0.53], [12, 10], 1, head, {
        turn: [0.45, 0, 0], bend: (p) => { const f = Math.max(0, p.z); p.x *= 1 - 0.35 * f; p.y *= 1 - 0.25 * f; },
      }),
      ear(1), ear(-1),
      ...leg(1, true), ...leg(-1, true), ...leg(1, false), ...leg(-1, false),
      ellipsoid([0.032, 0.02, 0.055], [0, 0.69, -0.42], [8, 6], 8, (_p, n, out) => void out.copyFrom(n.y < 0 || n.z < -0.5 ? white : coat), { turn: [-0.6, 0, 0] }),
    ]),
    pose: /* glsl */`
      void pose(float part, vec4 anim, vec4 more, inout vec3 p, inout vec3 n) {
        if (part > 3.5 && part < 7.5) {
          float side = mod(part, 2.0) < 0.5 ? 1.0 : -1.0, front = part < 5.5 ? 1.0 : 0.0;
          // A walk in four beats (hind left, front left, hind right, front right); a bound with the pairs together.
          float at = anim.x + 6.2832 * (front * 0.25 + (side > 0.0 ? 0.0 : 0.5));
          float swing = sin(at) * 0.45 * anim.y, lift = max(0.0, cos(at)) * 0.75 * anim.y;
          float stretch = sin(anim.x);
          swing += anim.z * (front > 0.5 ? 0.9 * stretch - 0.2 : 0.1 - 0.9 * stretch);
          lift += anim.z * max(0.0, -stretch) * 0.9;
          vec3 hip = vec3(side * 0.08, 0.6, front > 0.5 ? 0.27 : -0.27), knee = front > 0.5 ? vec3(side * 0.08, 0.3, 0.28) : vec3(side * 0.08, 0.32, -0.36);
          if (p.y < knee.y + 0.01) turnAround(rotX(front > 0.5 ? lift : -lift), knee, p, n);
          turnAround(rotX(-swing), hip, p, n);
        } else if (part > 7.5) {
          turnAround(rotX(more.w * 1.6), vec3(0.0, 0.72, -0.4), p, n);
        } else if (part > 0.5) {
          if (part > 1.5) {
            float side = part < 2.5 ? 1.0 : -1.0, e = part < 2.5 ? more.y : more.z;
            turnAround(rotX(-0.7 * e) * rotZ(side * 0.4 * e), vec3(side * 0.04, 1.07, 0.46), p, n);
          }
          turnAround(rotY(more.x) * rotX(anim.w * 1.6), vec3(0.0, 0.62, 0.22), p, n);
        }
        n = normalize(n);
      }`,
  };
}

// ---- a tawny owl, 38 cm tall ---------------------------------------------------------------------------------------
// anim: x wingbeat phase, y how hard they beat, z wings 0 folded (sitting upright) … 1 spread (flying, the body
// level), w the head turned (radians). more: x 1 while it sits (its branch is drawn), 0 in flight. Parts: 0 body,
// 1 head, 2 eyes, 3 left wing, 4 right wing, 5 the branch. The eyes shine back the light (fragment).

export function owlShape(): Shape {
  const brown = C(0x5e3e26), dark = C(0x32221a), pale = C(0x9a7a56), disc = C(0x9a7858), bark = C(0x3a3028);
  const plumage: Paint = (p, n, out) => {
    Color3.LerpToRef(brown, dark, streak(p.x, p.y, 0.5) * 0.45, out);
    if (n.z > 0.3 && p.y < 0.22) Color3.LerpToRef(pale, dark, Math.max(0, Math.sin(p.y * 160 + Math.sin(p.x * 90) * 2)) * 0.6, out); // a streaked breast
  };
  const face: Paint = (p, n, out) => {
    Color3.LerpToRef(brown, dark, streak(p.x, p.y, 0.6) * 0.3, out);
    if (n.z > 0.4) out.copyFrom(n.z > 0.55 ? disc : dark); // the facial disc, rimmed dark
  };
  const wing = (side: number) => ellipsoid([0.3, 0.012, 0.11], [side * 0.3, 0.22, -0.02], [12, 4], side > 0 ? 3 : 4, (p, _n, out) => {
    Color3.LerpToRef(brown, dark, 0.2 + streak(p.z, p.x, 0.4) * 0.4, out);
    if (Math.sin(Math.abs(p.x) * 70) > 0.6 && Math.abs(p.x) > 0.25) Color3.LerpToRef(out, pale, 0.5, out); // barred flight feathers
  }, { bend: (p) => { p.z -= 0.25 * p.x * p.x; } });
  const eye = (side: number) => ellipsoid([0.027, 0.027, 0.012], [side * 0.037, 0.335, 0.078], [8, 6], 2, flat(C(0x101010)));
  return {
    name: "owl",
    lit: true,
    geometry: merge([
      ellipsoid([0.11, 0.15, 0.1], [0, 0.16, 0], [16, 12], 0, plumage, { bend: (p) => { p.x *= 1 + Math.max(0, -p.y) * 0.12; } }),
      ellipsoid([0.05, 0.012, 0.085], [0, 0.03, -0.07], [8, 4], 0, flat(brown), { turn: [-1.1, 0, 0] }),
      ellipsoid([0.025, 0.012, 0.03], [0.04, 0.008, 0.04], [6, 4], 0, flat(pale)), ellipsoid([0.025, 0.012, 0.03], [-0.04, 0.008, 0.04], [6, 4], 0, flat(pale)),
      ellipsoid([0.095, 0.085, 0.085], [0, 0.33, 0.01], [16, 12], 1, face),
      piece(VertexData.CreateCylinder({ diameterTop: 0, diameterBottom: 0.022, height: 0.03, tessellation: 6 }).transform(Matrix.RotationX(Math.PI / 2 + 0.5)), 1,
        (p) => p.addInPlace(new Vector3(0, 0.31, 0.095)), flat(C(0xc8b080))),
      eye(1), eye(-1),
      wing(1), wing(-1),
      rod([0, -0.005, 0.12], [0, -0.01, -0.5], 0.02, 0.024, 5, flat(bark)),
      rod([0, -0.008, -0.2], [0.12, 0.06, -0.3], 0.008, 0.012, 5, flat(bark)),
    ]),
    pose: /* glsl */`
      void pose(float part, vec4 anim, vec4 more, inout vec3 p, inout vec3 n) {
        vec3 shoulder = vec3(0.0, 0.24, 0.0), neck = vec3(0.0, 0.3, 0.0);
        mat3 level = rotX(anim.z * 1.25); // in flight the body lies level between the wings
        if (part > 4.5) p *= more.x;
        else if (part > 2.5) {
          float side = part < 3.5 ? 1.0 : -1.0, fold = 1.0 - anim.z;
          vec3 root = vec3(side * 0.06, 0.22, 0.0);
          turnAround(rotZ(side * (sin(anim.x) * 0.9 * anim.y + 0.08)) * rotY(side * 1.5 * fold), root, p, n);
          p = mix(root, p, 0.3 + 0.7 * anim.z); // folded, small and against the body
        } else if (part > 0.5) {
          turnAround(rotY(anim.w), neck, p, n);
          p += level * (neck - shoulder) - (neck - shoulder); // the head stays upright, carried forward with the body
        } else turnAround(level, shoulder, p, n);
        n = normalize(n);
      }`,
    fragment: /* glsl */`
      if (vPart > 1.5 && vPart < 2.5) {
        float back = max(0.0, dot(normalize(vNormal), normalize(cameraPosition - vWorld)));
        diffuseColor.rgb = vec3(1.0, 0.8, 0.42) * (0.6 + 2.4 * back * back);
      }`,
  };
}
