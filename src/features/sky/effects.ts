import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Material } from "@babylonjs/core/Materials/material.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { POND } from "../../world/terrain.ts";

const DROPS = 2600, BOX = 26, HEIGHT = 14, FLIES = 48;

function atmosphere(scene: Scene, name: string, vertex: string, fragment: string, attributes: string[], uniforms: string[]) {
  const material = new ShaderMaterial(name, scene, {
    vertexSource: `precision highp float; uniform mat4 world, view, projection; uniform vec3 cameraPosition; attribute vec3 position; ${vertex}`,
    fragmentSource: `precision highp float; ${fragment}`,
  }, { attributes, uniforms: ["world", "view", "projection", "cameraPosition", ...uniforms], needAlphaBlending: true });
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  return material;
}

/** Streaks that fall and are blown, in a box that travels with the camera. */
export function makeRain(scene: Scene) {
  const corners = new Float32Array(DROPS * 4 * 2), seeds = new Float32Array(DROPS * 4 * 4), index: number[] = [];
  for (let d = 0; d < DROPS; d++) {
    const seed = [Math.random(), Math.random(), Math.random(), Math.random()];
    [[-1, 0], [1, 0], [-1, 1], [1, 1]].forEach(([side, end], k) => {
      corners.set([side!, end!], (d * 4 + k) * 2);
      seeds.set(seed, (d * 4 + k) * 4);
    });
    const v = d * 4;
    index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
  }
  const mesh = new Mesh("rain", scene);
  mesh.setVerticesData("position", new Float32Array(DROPS * 12), false, 3);
  mesh.setVerticesData("corner", corners, false, 2);
  mesh.setVerticesData("seed", seeds, false, 4);
  mesh.setIndices(index);
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.isPickable = false;
  const material = atmosphere(scene, mesh.name, `
      attribute vec2 corner;
      attribute vec4 seed;
      uniform float time, amount;
      uniform vec2 wind;
      uniform vec3 centre;
      varying float vAlpha;
      varying float vAlong;
      void main() {
        vec3 velocity = vec3(wind.x, -(8.0 + 3.0 * seed.z), wind.y);
        float fall = mod(seed.w * ${HEIGHT}.0 + time * -velocity.y, ${HEIGHT}.0);
        vec3 p = vec3(seed.x * ${BOX}.0, ${HEIGHT}.0 - fall, seed.y * ${BOX}.0);
        p.xz += velocity.xz * (fall / -velocity.y);
        p.xz = centre.xz + mod(p.xz - centre.xz + ${BOX / 2}.0, ${BOX}.0) - ${BOX / 2}.0;
        p.y += centre.y - 2.0;
        vec3 along = normalize(velocity), toEye = normalize(cameraPosition - p);
        vec3 side = normalize(cross(along, toEye));
        p -= along * corner.y * (0.35 + 0.25 * seed.z);
        p += side * corner.x * (0.003 + 0.0012 * distance(p, cameraPosition)); // thin close by, a pixel or so far off
        vAlong = corner.y;
        vAlpha = step(seed.z, amount) * (1.0 - smoothstep(3.0, ${BOX / 2}.0, distance(p.xz, centre.xz)));
        gl_Position = projection * view * vec4(p, 1.0);
      }`, `
      uniform vec3 color;
      varying float vAlpha;
      varying float vAlong;
      void main() {
        if (vAlpha <= 0.0) discard;
        gl_FragColor = vec4(color, vAlpha * 0.4 * sin(vAlong * 3.14159));

      }`, ["position", "corner", "seed"], ["time", "amount", "wind", "centre", "color"]);
  mesh.material = material;
  return (time: number, amount: number, wind: Vector2, camera: Vector3, color: Color3) => {
    mesh.setEnabled(amount > 0.001);
    material.setFloat("time", time).setFloat("amount", amount).setVector2("wind", wind).setVector3("centre", camera).setColor3("color", color);
  };
}

export function makeMist(scene: Scene) {
  const material = atmosphere(scene, "morning mist", `
      varying vec3 vWorld;
      void main() { vec4 w = world * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projection * view * w; }`, `
      uniform float time, amount;
      uniform vec3 color;
      varying vec3 vWorld;
      float mistHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float mistNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mistHash(i), mistHash(i + vec2(1, 0)), f.x), mix(mistHash(i + vec2(0, 1)), mistHash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec2 p = vWorld.xz * 0.35 + vec2(time * 0.03, time * 0.012) + vWorld.y * 3.0;
        float n = mistNoise(p) * 0.6 + mistNoise(p * 2.3 - time * 0.02) * 0.4;
        float edge = 1.0 - smoothstep(${(POND.radius * 0.8).toFixed(2)}, ${(POND.radius * 2.2).toFixed(2)}, distance(vWorld.xz, vec2(${POND.x}.0, ${POND.z}.0)));
        float a = amount * edge * smoothstep(0.2, 0.75, n) * 0.5;
        if (a < 0.003) discard;
        gl_FragColor = vec4(color, a);

      }`, ["position"], ["time", "amount", "color"]);
  const sheets = [0.12, 0.3, 0.55].map(height => {
    const mesh = MeshBuilder.CreateGround("mist", { width: POND.radius * 5, height: POND.radius * 5 }, scene);
    mesh.position.set(POND.x, height, POND.z);
    mesh.material = material;
    mesh.isPickable = false;
    return { mesh, height };
  });
  return (time: number, amount: number, level: number, color: Color3) => {
    for (const { mesh, height } of sheets) {
      mesh.setEnabled(amount > 0.002);
      mesh.position.y = height + level;
    }
    material.setFloat("time", time).setFloat("amount", amount).setColor3("color", color);
  };
}

export function makeFireflies(scene: Scene) {
  const mesh = new Mesh("fireflies", scene);
  const seeds = Float32Array.from({ length: FLIES * 4 }, () => Math.random());
  mesh.setVerticesData("position", new Float32Array(FLIES * 3), false, 3);
  mesh.setVerticesData("seed", seeds, false, 4);
  mesh.setIndices(Array.from({length: FLIES}, (_, i) => i));
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.isPickable = false;
  const material = atmosphere(scene, mesh.name, `
      attribute vec4 seed;
      uniform float time, amount, scale, level;
      varying float vGlow;
      void main() {
        float a = seed.x * 6.2832 + time * (0.05 + 0.08 * seed.y) * (seed.z > 0.5 ? 1.0 : -1.0);
        float r = ${POND.radius.toFixed(2)} * (0.85 + 0.45 * seed.y) + 0.4 * sin(time * 0.3 + seed.w * 20.0);
        vec3 p = vec3(${POND.x}.0 + cos(a) * r, level + 0.25 + 1.1 * seed.w + 0.25 * sin(time * 0.7 + seed.x * 30.0), ${POND.z}.0 + sin(a) * r);
        vec4 eye = view * vec4(p, 1.0);
        float blink = smoothstep(0.55, 1.0, sin(time * (0.8 + seed.z) + seed.y * 40.0));
        vGlow = amount * blink;
        gl_PointSize = vGlow > 0.0 ? scale * 0.05 / -eye.z : 0.0;
        gl_Position = projection * eye;
      }`, `
      varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float glow = ((1.0 - smoothstep(0.0, 1.0, d)) * 0.5 + (1.0 - smoothstep(0.0, 0.3, d))) * vGlow;
        if (glow < 0.004) discard;
        gl_FragColor = vec4(0.85, 1.0, 0.35, glow);

      }`, ["position", "seed"], ["time", "amount", "scale", "level"]);
  material.fillMode = Material.PointListDrawMode;
  material.alphaMode = Constants.ALPHA_ADD;
  mesh.material = material;
  return (time: number, amount: number, level: number) => {
    mesh.setEnabled(amount > 0.01);
    material.setFloat("time", time).setFloat("amount", amount).setFloat("scale", scene.getEngine().getRenderHeight()).setFloat("level", level);
  };
}
