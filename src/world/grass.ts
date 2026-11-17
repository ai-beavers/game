// Grass: thousands of small tufts as one InstancedMesh, swaying in the wind in the vertex shader. Dense in the
// middle of the clearing, thinner towards the bank; none in the water, on the bare site, on steep rock or under
// solid things. Each tuft takes its colour from the ground under it, so grass and ground fit.
//
//   const grass = buildGrass(stage, blocked, count);   each frame: grass.update(time)
//   grassOf(scene).value = game.sky.wind;              how hard the wind blows, 0 … 1 (the fx feature sets it)
//
// Wind 0.25 is a light breeze, the sway the grass was tuned with, and what it keeps when nobody sets the wind.
// Stronger wind bends it further, flutters faster and sends gust fronts rolling across the meadow.
import * as THREE from "three";
import type { Stage } from "../engine.ts";
import { fbm, mix, seeded, smoothstep } from "./noise.ts";
import { RIM, SITE, WATER_LEVEL, groundColor, heightAt, pondRatio, slopeAt } from "./terrain.ts";

const BLADES = 7, TUFT_HEIGHT = 0.24;

/** One tuft: thin bent blades in a loose bunch; normals point up, so it is lit like the ground it grows on. */
function tuftGeometry() {
  const random = seeded(3), positions: number[] = [], colors: number[] = [], heights: number[] = [];
  for (let b = 0; b < BLADES; b++) {
    const a = random() * Math.PI * 2, r = random() * 0.12, x0 = Math.cos(a) * r, z0 = Math.sin(a) * r;
    const facing = random() * Math.PI, w = 0.009 + random() * 0.008, h = TUFT_HEIGHT * (0.55 + random() * 0.6);
    const lean = 0.15 + random() * 0.35, wx = Math.cos(facing) * w, wz = Math.sin(facing) * w;
    const out = { x: Math.cos(a) * lean, z: Math.sin(a) * lean };
    const at = (t: number, side: number) => [x0 + side * wx * (1 - t) + out.x * t * t * h, h * t, z0 + side * wz * (1 - t) + out.z * t * t * h];
    // Two quads and a tip: base-left, base-right, mid-left, mid-right, tip.
    const v = [at(0, -1), at(0, 1), at(0.55, -1), at(0.55, 1), at(1, 0)];
    for (const tri of [[0, 1, 2], [2, 1, 3], [2, 3, 4]]) for (const i of tri) {
      positions.push(...v[i]!);
      const t = v[i]![1]! / TUFT_HEIGHT;
      heights.push(t);
      const shade = 0.5 + 0.55 * Math.min(1, v[i]![1]! / h);
      colors.push(shade, shade, shade);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(positions.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("bend", new THREE.Float32BufferAttribute(heights, 1));
  return geometry;
}

/** The light breeze the sway was tuned for. */
export const BREEZE = 0.25;

/** How hard the wind blows on the grass of a scene, 0 … 1; set `.value`. Undefined without grass. */
export const grassOf = (scene: THREE.Scene) => scene.getObjectByName("grass")?.userData.wind as { value: number } | undefined;

/** The wind's pace for a strength: how fast the gust fronts roll and the blades flutter, per second of play. Each is
 *  summed over time (not multiplied with it), so a change of strength changes the pace, never jumps the phase. */
export function windPace(strength: number) {
  const above = Math.max(0, strength - BREEZE);
  return { front: 0.6 + 2.4 * strength, flutter: 4 + 7 * above };
}

/** `blocked(x, z)` says where something solid stands. */
export function buildGrass({ scene }: Stage, blocked: (x: number, z: number) => boolean, count = 21000) {
  const time = { value: 0 }, strength = { value: BREEZE }, front = { value: 0 }, flutter = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { windTime: time, windStrength: strength, windFront: front, windFlutter: flutter });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float windTime, windStrength, windFront, windFlutter;\nattribute float bend;")
      .replace("#include <project_vertex>", `
        vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
        vec2 root = instanceMatrix[3].xz;
        float gust = sin(root.x * 0.35 + windTime * 1.3) * 0.5 + sin(root.y * 0.27 - windTime * 0.9 + root.x * 0.1) * 0.5;
        float flutter = sin(windFlutter + root.x * 3.1 + root.y * 2.3) * 0.25;
        // 1 in a light breeze; gust fronts roll across the meadow the way the wind blows, once it is more than a breeze.
        float lean = 0.4 + 2.4 * windStrength;
        float rolling = pow(0.5 + 0.5 * sin(dot(root, vec2(0.871, 0.49)) * 0.22 - windFront), 4.0) * smoothstep(0.3, 0.9, windStrength);
        float push = min((0.10 + 0.09 * gust + 0.03 * flutter * (1.0 + 3.0 * max(0.0, windStrength - 0.25))) * lean + 0.2 * rolling, 0.3);
        vec2 off = vec2(0.8, 0.45) * push * bend * bend;
        mvPosition.xz += off;
        // A blade bent far is lower at its tip (it does not stretch); left out in a breeze, as tuned.
        float up = max(0.02, mvPosition.y - instanceMatrix[3].y), d2 = dot(off, off);
        mvPosition.y -= (up - sqrt(max(up * up - d2, up * up * 0.25))) * smoothstep(0.3, 0.6, windStrength);
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  const mesh = new THREE.InstancedMesh(tuftGeometry(), material, count);
  const random = seeded(11), m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const color = new THREE.Color(), y = new THREE.Vector3(0, 1, 0), tip = new THREE.Color(0xa8c050);
  let placed = 0;
  for (let tries = 0; tries < count * 8 && placed < count; tries++) {
    const a = random() * Math.PI * 2, r = Math.sqrt(random()) * (RIM + 1.5), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (random() > mix(1, 0.35, smoothstep(4, RIM, r)) * (0.8 + 0.4 * fbm(x * 0.3, z * 0.3, 2))) continue;
    const h = heightAt(x, z), slope = slopeAt(x, z);
    if (h < WATER_LEVEL + 0.02 || pondRatio(x, z) < 1.12 || slope > 0.75 || blocked(x, z)) continue;
    if (Math.hypot(x - SITE.x, z - SITE.z) < SITE.radius + 0.3 * random()) continue;
    groundColor(x, z, h, slope, color).lerp(tip, 0.1 + random() * 0.15).multiplyScalar(0.95 + random() * 0.3);
    mesh.setColorAt(placed, color);
    const size = 0.6 + random() * 0.6;
    m.compose(p.set(x, h - 0.02, z), q.setFromAxisAngle(y, random() * Math.PI * 2), s.set(size, size * (0.8 + random() * 0.5), size));
    mesh.setMatrixAt(placed++, m);
  }
  mesh.count = placed;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  mesh.name = "grass";
  mesh.userData.wind = strength;
  scene.add(mesh);
  let before = 0;
  return {
    mesh,
    update(t: number) {
      const dt = Math.max(0, Math.min(0.25, t - before)), pace = windPace(strength.value);
      before = time.value = t;
      front.value += dt * pace.front;
      flutter.value += dt * pace.flutter;
    },
  };
}
