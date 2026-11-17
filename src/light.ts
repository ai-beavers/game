// Daylight, the one light everything in the game is tuned for: a warm afternoon sun with shadows, and a sky that
// is seen, fills the shadows and shows in every reflection. Every page uses it, so the fur looks the same in the
// lab as in the world.
//
//   const light = daylight(stage);
//   mesh.castShadow = true;   ground.receiveShadows = true;
//   light.follow(player.position);     each frame: sharp shadows stay around this place
//
// The hour and the weather (src/features/sky) change it through the same handle, found again with
// daylightOf(scene): light.towards is the way the light travels (sun by day, moon by night), light.air holds the
// sky's extra uniforms (night, moon, stars, overcast), light.relight() makes the environment anew from the sky as
// it is now. Left alone, everything stays the afternoon below.
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import type { Stage } from "./engine.ts";

export const SUN_DIRECTION = new THREE.Vector3(-0.45, -0.62, -0.5).normalize(); // the way the light travels
export const EXPOSURE = 0.5, SUN_INTENSITY = 4.2, SUN_COLOR = 0xfff1d6, ENVIRONMENT = 0.35;
const REACH = 14; // sharp shadows this far around the followed place, in metres
const ENV_SIZE = 256; // cube face size of the environment

// Added to three's Sky (Preetham): a night sky with stars and a moon under its daytime, and an overcast layer over
// everything. All are off (0) unless the sky feature turns them on.
const NIGHT_UNIFORMS = /* glsl */`
  uniform float night, overcast, stars;
  uniform vec3 nightColor, overcastColor, moonPosition, moonColor;
  float starHash(vec3 p) { p = fract(p * 0.3183099 + 0.1) * 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
`;
const NIGHT_SKY = /* glsl */`
  if (night > 0.0) {
    float up = max(direction.y, 0.0);
    texColor += night * nightColor * mix(1.0, 0.35, sqrt(up));
    vec3 cell = floor(direction * 260.0);
    float star = starHash(cell), spot = length(fract(direction * 260.0) - 0.5);
    texColor += stars * night * step(0.996, star) * (0.4 + 3.0 * fract(star * 97.0)) * (1.0 - smoothstep(0.0, 0.3, spot))
      * smoothstep(0.02, 0.2, direction.y) * vec3(0.8, 0.85, 1.0) * 0.05;
    vec3 moonWay = normalize(moonPosition);
    float moonCos = dot(direction, moonWay);
    texColor += night * moonColor * (smoothstep(0.99976, 0.99982, moonCos) * 1.5 + pow(max(moonCos, 0.0), 300.0) * 0.08);
  }
`;
const NIGHT_CLOUDS = /* glsl */`cloudColor *= max( dayFactor, 0.03 );
  cloudColor += night * (nightColor * 1.4 + moonColor * 0.02);`;
const OVERCAST = /* glsl */`
  if (overcast > 0.0) {
    float under = smoothstep(-0.05, 0.15, direction.y);
    vec3 layer = overcastColor * mix(0.85, 1.1, under);
    texColor = mix(texColor, layer, overcast);
  }
  gl_FragColor = vec4( texColor, 1.0 );`;

export type Daylight = ReturnType<typeof daylight>;

export function daylight({ renderer, scene }: Stage) {
  renderer.toneMappingExposure = EXPOSURE;
  const sky = new Sky();
  sky.scale.setScalar(1000);
  const material = sky.material as THREE.ShaderMaterial, air = material.uniforms;
  air.turbidity!.value = 2;
  air.rayleigh!.value = 1;
  air.mieCoefficient!.value = 0.004;
  air.mieDirectionalG!.value = 0.8;
  air.sunPosition!.value.copy(SUN_DIRECTION).negate();
  Object.assign(air, {
    night: { value: 0 }, overcast: { value: 0 }, stars: { value: 1 }, nightColor: { value: new THREE.Color(0, 0, 0) },
    overcastColor: { value: new THREE.Color(0.3, 0.32, 0.35) }, moonPosition: { value: new THREE.Vector3(0, 1, 0) },
    moonColor: { value: new THREE.Color(0.8, 0.85, 1.0) },
  });
  material.fragmentShader = material.fragmentShader
    .replace("const float pi =", `${NIGHT_UNIFORMS}\nconst float pi =`)
    .replace("// Clouds", `${NIGHT_SKY}\n// Clouds`)
    .replace("cloudColor *= max( dayFactor, 0.03 );", NIGHT_CLOUDS)
    .replace("gl_FragColor = vec4( texColor, 1.0 );", OVERCAST);
  scene.add(sky);

  // What the sky throws onto everything: taken from the sky itself, so fill light and reflections match it. The
  // sky is drawn into a cube, which is turned into the environment; both are kept and drawn into again.
  const pmrem = new THREE.PMREMGenerator(renderer), mirror = new THREE.Scene();
  mirror.add(sky.clone()); // shares the material, so it is always the sky that is seen
  const cube = new THREE.WebGLCubeRenderTarget(ENV_SIZE, { type: THREE.FloatType, generateMipmaps: false });
  const cubeCamera = new THREE.CubeCamera(0.1, 1000, cube);
  let environment: THREE.WebGLCubeRenderTarget | null = null;
  const relight = () => {
    cubeCamera.update(renderer, mirror);
    environment = pmrem.fromCubemap(cube.texture, environment) as THREE.WebGLCubeRenderTarget;
    scene.environment = environment.texture;
  };
  relight();
  scene.environmentIntensity = ENVIRONMENT;

  const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -REACH, right: REACH, top: REACH, bottom: -REACH, near: 1, far: 90 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const towards = SUN_DIRECTION.clone(), place = new THREE.Vector3();
  const follow = (at: THREE.Vector3) => {
    place.copy(at);
    sun.target.position.copy(at);
    sun.position.copy(at).addScaledVector(towards, -45);
  };
  follow(place);
  const light = {
    sun, sky, follow, relight,
    /** The way the light travels now; change it, then follow() again (or wait for the next frame). */
    towards,
    /** The sky's uniforms: three's Sky plus night, overcast, stars, nightColor, overcastColor, moonPosition, moonColor. */
    air,
    /** The sky as drawn for the environment, for reading its colour back (see horizon()). */
    cube, cubeCamera,
    /** Where follow() was last told to keep the shadows. */
    place,
  };
  scene.userData.daylight = light;
  return light;
}

/** The daylight a scene was given, for parts that did not make it (the sky feature). */
export const daylightOf = (scene: THREE.Scene) => scene.userData.daylight as Daylight | undefined;
