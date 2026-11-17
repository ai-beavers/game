// The pond's surface: a grid over the pond that knows how deep the water is under each point. Its material is
// three's standard one with a few lines added: tinted by depth, clear and soft at the shore, small moving ripples,
// and more sky reflection (and less see-through) at a glancing angle. In rain, rings spread where the drops fall.
// The surface can move (the build feature starts the pond low and the dam fills it to WATER_LEVEL): depth, shore
// and rain rings follow it. The grid covers the basin up to WATER_LEVEL; higher water would end at its edge.
//
//   const water = buildWater(stage);   each frame: water.update(time)
//   waterOf(scene).rain.value = 0.8;   rain on the pond, 0 … 1 (the sky feature sets it; found again by scene)
//   waterOf(scene).level               the surface's height now: the one live water level (player, World.waterLevel)
//   water.setLevel(0.08)               rises there over a second or two; setLevel(0.08, false): at once
import * as THREE from "three";
import type { Stage } from "../engine.ts";
import { POND, WATER_LEVEL, heightAt } from "./terrain.ts";

const RISE_TIME = 1.5; // s: how fast the surface follows a new level (it eases, so most of it in this time)

export function buildWater({ scene }: Stage) {
  const size = POND.radius * 3, cells = 72;
  const geometry = new THREE.PlaneGeometry(size, size, cells, cells).rotateX(-Math.PI / 2).translate(POND.x, WATER_LEVEL, POND.z);
  const pos = geometry.attributes.position as THREE.BufferAttribute, depth = new Float32Array(pos.count);
  // Depth under the surface at WATER_LEVEL; the shader adds the rise (negative while the pond is lower).
  for (let i = 0; i < pos.count; i++) depth[i] = WATER_LEVEL - heightAt(pos.getX(i), pos.getZ(i));
  geometry.setAttribute("depth", new THREE.BufferAttribute(depth, 1));

  const time = { value: 0 }, rain = { value: 0 }, rise = { value: 0 };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, depthWrite: false,
    envMap: scene.environment, envMapIntensity: 0.26,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = time;
    shader.uniforms.waterRain = rain;
    shader.uniforms.waterRise = rise;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float depth;\nuniform float waterRise;\nvarying float vDepth;\nvarying vec2 vWaterXZ;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvDepth = depth + waterRise;\nvWaterXZ = position.xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform float waterTime, waterRain;
        varying float vDepth;
        varying vec2 vWaterXZ;
        // Slope of a few travelling waves: small ripples that cross each other.
        vec2 ripple(vec2 p, float t) {
          vec2 s = vec2(0.0);
          vec2 dirs[4] = vec2[4](vec2(0.8, 0.6), vec2(-0.5, 0.86), vec2(0.97, -0.24), vec2(-0.71, -0.71));
          float freq[4] = float[4](5.0, 7.3, 11.0, 15.0), speed[4] = float[4](0.9, 1.1, 1.4, 1.7);
          for (int i = 0; i < 4; i++) {
            float phase = dot(p, dirs[i]) * freq[i] + t * speed[i] * freq[i] * 0.25 + sin(dot(p, dirs[(i + 1) % 4]) * 1.7) * 2.0;
            s += dirs[i] * cos(phase) * 0.035 / (1.0 + float(i) * 0.5);
          }
          return s;
        }
        float waterHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // Slope of rain rings: in each cell of a grid a drop falls now and then at a random place, and its ring
        // spreads and fades. Two grids, offset, so the rings do not stand in rows.
        vec2 rainRings(vec2 p, float t) {
          vec2 s = vec2(0.0);
          for (int layer = 0; layer < 2; layer++) {
            vec2 q = p * 2.6 + float(layer) * vec2(0.37, 0.71), cell = floor(q);
            float start = waterHash(cell + float(layer) * 13.0), cycle = t * 1.3 + start, age = fract(cycle);
            vec2 seed = cell + floor(cycle) * vec2(3.1, 7.7);
            if (waterHash(seed) > waterRain * 0.9) continue;
            vec2 d = fract(q) - 0.25 - 0.5 * vec2(waterHash(seed + 1.3), waterHash(seed + 2.9));
            float r = length(d), front = r - age * 0.42;
            float ring = sin(front * 55.0) * (1.0 - smoothstep(0.0, 0.07, abs(front))) * (1.0 - age) * (1.0 - age);
            s += d / max(r, 1e-3) * ring * 0.5;
          }
          return s;
        }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        float deep = smoothstep(0.0, 1.1, vDepth);
        diffuseColor.rgb = mix(vec3(0.09, 0.12, 0.07), vec3(0.015, 0.04, 0.036), deep);`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        vec2 slope = ripple(vWaterXZ, waterTime) * smoothstep(0.0, 0.25, vDepth);
        if (waterRain > 0.0) slope += rainRings(vWaterXZ, waterTime) * smoothstep(0.0, 0.1, vDepth);
        normal = normalize(normal + (viewMatrix * vec4(-slope.x, 0.0, -slope.y, 0.0)).xyz);`)
      .replace("#include <opaque_fragment>", `
        float facing = saturate(dot(normal, geometryViewDir));
        float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
        float body = mix(0.35, 0.93, smoothstep(0.0, 0.9, vDepth));    // deeper water hides more of the floor
        float alpha = mix(body, 1.0, fresnel) * smoothstep(0.0, 0.07, vDepth); // and fades out at the shore
        outgoingLight += vec3(0.5, 0.55, 0.5) * (1.0 - smoothstep(0.0, 0.05, vDepth)) * 0.15; // a thin wet line
        gl_FragColor = vec4(outgoingLight, alpha);`);
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "water";
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  scene.add(mesh);
  // The surface moves as a whole: the mesh by the rise, the depth in the shader by the same.
  let goal = WATER_LEVEL, last = 0;
  const show = (level: number) => { rise.value = level - WATER_LEVEL; mesh.position.y = rise.value; };
  const water = {
    mesh, material, rain,
    /** Height of the surface now, m. */
    get level() { return WATER_LEVEL + rise.value; },
    /** Where the surface is going. */
    get goal() { return goal; },
    /** Moves the surface to this height: smoothly over about RISE_TIME, or at once. */
    setLevel(level: number, smooth = true) { goal = level; if (!smooth) show(level); },
    /** Once per frame with the world's clock (it stands still while paused, and so does the water). */
    update(t: number) {
      const dt = Math.max(0, t - last);
      last = t;
      time.value = t;
      const now = WATER_LEVEL + rise.value;
      if (now !== goal) show(Math.abs(goal - now) < 1e-4 ? goal : now + (goal - now) * (1 - Math.exp(-3 * dt / RISE_TIME)));
    },
  };
  scene.userData.water = water;
  return water;
}

/** The pond a scene was given, for parts that did not make it (the sky feature). */
export const waterOf = (scene: THREE.Scene) => scene.userData.water as ReturnType<typeof buildWater> | undefined;
