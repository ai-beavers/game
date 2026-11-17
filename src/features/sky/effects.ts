// What the weather and the hour put into the air near the beaver, each one draw call, all moved on the GPU:
//
//   const rain = makeRain(scene);         rain.update(time, amount, wind, camera.position, color)
//   const mist = makeMist(scene);         mist.update(time, amount, color)       low layers over the pond
//   const flies = makeFireflies(scene);   flies.update(time, amount)             near the reeds at night
//
// time stands still while the game is paused (the caller only advances it then), so everything here does too.
import * as THREE from "three";
import { POND, WATER_LEVEL } from "../../world/terrain.ts";

const DROPS = 6000, BOX = 26, HEIGHT = 14;

/** Streaks that fall and are blown, in a box that travels with the camera. */
export function makeRain(scene: THREE.Scene) {
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
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(DROPS * 4 * 3), 3)); // unused, three wants it
  geometry.setAttribute("corner", new THREE.BufferAttribute(corners, 2));
  geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 4));
  geometry.setIndex(index);
  const uniforms = {
    time: { value: 0 }, amount: { value: 0 }, wind: { value: new THREE.Vector2() }, centre: { value: new THREE.Vector3() },
    color: { value: new THREE.Color() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, // streaks face either way
    vertexShader: /* glsl */`
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
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 color;
      varying float vAlpha;
      varying float vAlong;
      void main() {
        if (vAlpha <= 0.0) discard;
        gl_FragColor = vec4(color, vAlpha * 0.4 * sin(vAlong * 3.14159));
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = "rain";
  scene.add(mesh);
  return {
    mesh,
    update(time: number, amount: number, wind: THREE.Vector2, camera: THREE.Vector3, color: THREE.Color) {
      mesh.visible = amount > 0.001;
      uniforms.time.value = time;
      uniforms.amount.value = amount;
      uniforms.wind.value.copy(wind);
      uniforms.centre.value.copy(camera);
      uniforms.color.value.copy(color);
    },
  };
}

/** Low layers of drifting mist over the pond and its banks. */
export function makeMist(scene: THREE.Scene) {
  const uniforms = { time: { value: 0 }, amount: { value: 0 }, color: { value: new THREE.Color() } };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
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
        #include <colorspace_fragment>
      }`,
  });
  const group = new THREE.Group();
  group.name = "mist";
  for (const [i, h] of [0.12, 0.3, 0.5, 0.75].entries()) {
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(POND.radius * 5, POND.radius * 5).rotateX(-Math.PI / 2), material);
    sheet.position.set(POND.x, WATER_LEVEL + h, POND.z);
    sheet.renderOrder = 3 + i;
    group.add(sheet);
  }
  scene.add(group);
  return {
    group,
    update(time: number, amount: number, color: THREE.Color) {
      group.visible = amount > 0.002;
      uniforms.time.value = time;
      uniforms.amount.value = amount;
      uniforms.color.value.copy(color);
    },
  };
}

const FLIES = 48;

/** Small lights that wander slowly around the pond's edge, between the reeds. */
export function makeFireflies(scene: THREE.Scene) {
  const seeds = new Float32Array(FLIES * 4);
  for (let i = 0; i < FLIES * 4; i++) seeds[i] = Math.random();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(FLIES * 3), 3));
  geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 4));
  const uniforms = { time: { value: 0 }, amount: { value: 0 }, scale: { value: 600 } };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: /* glsl */`
      attribute vec4 seed;
      uniform float time, amount, scale;
      varying float vGlow;
      void main() {
        float a = seed.x * 6.2832 + time * (0.05 + 0.08 * seed.y) * (seed.z > 0.5 ? 1.0 : -1.0);
        float r = ${POND.radius.toFixed(2)} * (0.85 + 0.45 * seed.y) + 0.4 * sin(time * 0.3 + seed.w * 20.0);
        vec3 p = vec3(${POND.x}.0 + cos(a) * r, ${WATER_LEVEL}.0 + 0.25 + 1.1 * seed.w + 0.25 * sin(time * 0.7 + seed.x * 30.0), ${POND.z}.0 + sin(a) * r);
        vec4 view = viewMatrix * vec4(p, 1.0);
        float blink = smoothstep(0.55, 1.0, sin(time * (0.8 + seed.z) + seed.y * 40.0));
        vGlow = amount * blink;
        gl_PointSize = vGlow > 0.0 ? scale * 0.05 / -view.z : 0.0;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: /* glsl */`
      varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float glow = ((1.0 - smoothstep(0.0, 1.0, d)) * 0.5 + (1.0 - smoothstep(0.0, 0.3, d))) * vGlow;
        if (glow < 0.004) discard;
        gl_FragColor = vec4(vec3(0.85, 1.0, 0.35) * glow, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = "fireflies";
  scene.add(points);
  return {
    points,
    update(time: number, amount: number, height: number) {
      points.visible = amount > 0.01;
      uniforms.time.value = time;
      uniforms.amount.value = amount;
      uniforms.scale.value = height; // drawing buffer height: points keep their size on any screen
    },
  };
}
