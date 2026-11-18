import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Stage } from "../engine.ts";
import { daylightOf } from "../light.ts";
import { POND, SUNSET, WATER_LEVEL, heightAt } from "./terrain.ts";

// The pond: one flat sheet at the live water level, drawn once, alpha-blended over the ground and whatever is under
// it (no second render of the scene). Everything is made up in its one shader:
// - its colour above is the sky of the hour as the dome draws it (horizon to zenith, clouds), mirrored through gently
//   moving ripples, with a darker band low down where the bank and the trees would mirror (none where the evening sun
//   goes down), and a glint of the light that throws the shadows: the sun by day, the moon's path by night;
// - how much of that shows is a Fresnel falloff: looking down you see into it, at a grazing look you see sky;
// - under the surface, the light that comes back out fades from the ground itself (the bank shows through) to a deep
//   colour, by how much water a look passes through; the ground's depth below the sheet is kept per vertex and the
//   live level added, so the shoreline moves as the dam lifts the pond;
// - at the shore a thin light line, and a band of darker wet ground just above it: the vertices of the sheet that lie
//   a little under the bank are laid onto it there, so that band follows the level too.
// Lit like the grass (sky from above, the sun through its shadow map, the same fog, gamma for the post-process).
// Drawn before the rings, splashes and fish (alphaIndex), writing no depth, so they all show on and under it.
const WET = 0.1; // m of bank above the water that are wet

export function buildWater({ scene, camera }: Stage) {
  const size = POND.radius * 3;
  const mesh = MeshBuilder.CreateGround("water", { width: size, height: size, subdivisions: 96 }, scene);
  mesh.position.set(POND.x, WATER_LEVEL, POND.z);
  mesh.alphaIndex = 1;
  mesh.isPickable = false;
  const positions = mesh.getVerticesData("position")!, depths = [];
  for (let i = 0; i < positions.length; i += 3) depths.push(WATER_LEVEL - heightAt(POND.x + positions[i]!, POND.z + positions[i + 2]!));
  mesh.setVerticesData("depth", depths, false, 1);
  // shortcut: sampler2DShadow needs WebGL2, as the grass does.
  const mat = new ShaderMaterial("pond", scene, {
    vertexSource: `precision highp float;
      attribute vec3 position; attribute float depth; uniform mat4 world, viewProjection;
      uniform float level; varying float waterDepth; varying vec3 at;
      void main() {
        waterDepth = depth + level;
        vec3 p = position;
        if (waterDepth < 0. && waterDepth > -${WET + 0.03}) p.y = .03 - waterDepth; // laid onto the bank: the wet band
        vec4 w = world * vec4(p, 1.);
        at = w.xyz;
        gl_Position = viewProjection * w;
      }`,
    fragmentSource: `precision highp float;
      uniform vec3 eye, horizon, toLight, lightColor, skyLight, fogColor; uniform float time, rain, night, clouds, fogDensity, gamma, edge;
      uniform mat4 lightMatrix; uniform highp sampler2DShadow shadowMap;
      varying float waterDepth; varying vec3 at;
      vec2 grad(vec2 i) { float h = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453) * 6.2832; return vec2(cos(h), sin(h)); }
      vec2 noiseSlope(vec2 p) { // the gradient of 2D gradient noise (quintic), analytic
        vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6. - 15.) + 10.), du = 30. * f * f * (f * (f - 2.) + 1.);
        vec2 ga = grad(i), gb = grad(i + vec2(1, 0)), gc = grad(i + vec2(0, 1)), gd = grad(i + 1.);
        float va = dot(ga, f), vb = dot(gb, f - vec2(1, 0)), vc = dot(gc, f - vec2(0, 1)), vd = dot(gd, f - 1.);
        return ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * (va - vb - vc + vd) + vec2(vb, vc) - va);
      }
      // One octave of ripples: noise turned by angle, k cells per metre, drifting along its own way; its slope fades
      // out once a cell gets narrower than a few pixels (fw: metres per pixel), so it never aliases into a pattern.
      vec2 ripple(vec2 p, float angle, float k, vec2 drift, float a, float fw) {
        mat2 turn = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
        return a * (1. - smoothstep(.12, .35, k * fw)) * (noiseSlope(turn * p * k + drift * time) * turn);
      }
      void main() {
        float far = length(eye - at), fog = clamp(exp(-pow(fogDensity * far, 2.)), 0., 1.);
        if (waterDepth < 0.) { // the wet bank just above the water: darker, shinier earth, no water
          float wet = smoothstep(-${WET}, -.01, waterDepth);
          gl_FragColor = vec4(pow(fogColor, vec3(gamma)) * (1. - fog), (.42 * wet) * fog + (1. - fog) * wet);
          if (wet <= 0.) discard;
          return;
        }
        vec2 p = at.xz;
        // Ripples: four octaves of gradient noise at unrelated angles, sizes and drifts, so no period and no direction.
        float fw = max(length(dFdx(p)), length(dFdy(p)));
        vec2 s = ripple(p, .3, .83, vec2(.21, .13), .022, fw) + ripple(p, 2.17, 1.71, vec2(-.19, .31), .018, fw)
          + ripple(p, 4.05, 3.37, vec2(.43, -.37), .014, fw) + ripple(p, 5.6, 6.91, vec2(-.71, -.53), .010, fw);
        vec3 slope = vec3(s.x, 0., s.y);
        for (int i = 0; i < 2; i++) { // two layers of drops, each ring at its own time
          vec2 q = p * 3.5 + float(i) * vec2(.37, .61), cell = fract(q) - .5;
          float phase = fract(sin(dot(floor(q), vec2(12.9, 78.2)) + float(i) * 7.) * 43758.5);
          float r = length(cell), t = fract(time * 1.1 + phase);
          slope.xz += rain * (1. - smoothstep(.12, .35, 25. * fw)) * cell / max(r, .01) * sin(r * 45. - t * 20.) * smoothstep(.45, 0., r) * (1. - t) * .3;
        }
        vec3 normal = normalize(vec3(-slope.x, 1., -slope.z));
        vec3 view = normalize(eye - at), mirrored = reflect(-view, normal);
        float facing = max(0., dot(view, normal));
        float fresnel = .03 + .9 * pow(1. - facing, 4.);

        // The sky the surface mirrors, as the dome draws it, then the bank and its trees low down.
        float up = max(mirrored.y, 0.);
        vec3 zenith = mix(vec3(.22,.52,.83), vec3(.02,.03,.085), night);
        vec3 sky = mix(horizon, zenith, smoothstep(0., .85, up));
        sky = mix(sky, mix(vec3(.95,.96,.99), vec3(.39,.45,.53), clouds) * (1. - night * .86), clouds * .6);
        sky = pow(sky, vec3(1. / gamma));
        float off = atan(mirrored.z, mirrored.x) - ${SUNSET.angle};
        float gap = smoothstep(${SUNSET.width}, ${SUNSET.width * 0.5}, abs(atan(sin(off), cos(off))));
        float trees = (1. - smoothstep(.03, mix(.32, .1, gap), up + slope.x * 2.)) * (1. - .7 * gap);
        sky = mix(sky, sky * vec3(.32,.38,.26) * .7, trees * .85);

        // Light on the water: the sky's, and the sun's (or moon's) through the shadow map.
        vec4 fromLight = lightMatrix * vec4(at, 1.);
        vec3 clip = fromLight.xyz / fromLight.w, uvz = clip * .5 + .5;
        float shadow = all(greaterThanEqual(uvz, vec3(0.))) && all(lessThanEqual(uvz, vec3(1.))) ? texture(shadowMap, uvz) : 1.;
        shadow = mix(shadow, 1., smoothstep(1. - edge, 1., clamp(dot(clip.xy, clip.xy), 0., 1.)));
        vec3 lit = clamp(skyLight + lightColor * max(0., toLight.y) * shadow, 0., 1.);

        // Into the water: the ground shows through where it is shallow, a deep green-blue where a look passes through much.
        float through = waterDepth / max(facing, .25);
        float murk = min(.8, 1. - exp(-through * 1.5));
        vec3 deep = mix(vec3(.10,.25,.22), vec3(.03,.11,.14), smoothstep(.2, 1., waterDepth)) * lit;

        float glint = pow(max(0., dot(mirrored, toLight)), mix(220., 45., max(rain, night))) * mix(1.6, 2.2, night); // the moon's path is wider and softer
        vec3 shine = lightColor * glint * shadow * step(0., toLight.y);
        float shore = smoothstep(.018, .0, waterDepth + .006 * sin(time * 1.4 + p.x * 9. + p.y * 7.)); // a thin light line
        float alpha = fresnel + (1. - fresnel) * murk;
        vec3 colour = (sky * fresnel + deep * (1. - fresnel) * murk) / max(alpha, .001) + shine;
        colour = mix(colour, lit * vec3(.8,.82,.76), shore * .5);
        alpha = max(alpha, shore * .3) + min(1., glint) * .5;
        alpha *= smoothstep(0., .015, waterDepth + .01);
        gl_FragColor = vec4(pow(mix(fogColor, colour, fog), vec3(gamma)), clamp(mix(1., alpha, fog), 0., 1.));
      }`,
  }, { attributes: ["position", "depth"], uniforms: ["world", "viewProjection", "level", "eye", "horizon", "toLight", "lightColor",
    "skyLight", "fogColor", "time", "rain", "night", "clouds", "fogDensity", "gamma", "edge", "lightMatrix"], samplers: ["shadowMap"], needAlphaBlending: true });
  mat.disableDepthWrite = true;
  mat.zOffset = -2; // the wet band lies just over the bank
  mesh.material = mat;
  const light = daylightOf(scene)!;
  mat.onBindObservable.add(() => { // after the shadow map of this frame is drawn
    const effect = mat.getEffect()!;
    effect.setMatrix("lightMatrix", light.shadows.getTransformMatrix());
    effect.setDepthStencilTexture("shadowMap", light.shadows.getShadowMapForRendering());
  });
  /** What the sky feature hands over each frame: rain 0 … 1, cloud cover 0 … 1, night 0 … 1 (as the dome has them). */
  const sky = { rain: 0, clouds: 0, night: 0 };
  const lightColor = new Color3(), skyLight = new Color3(), toLight = new Vector3();
  let goal = WATER_LEVEL, last = 0;
  const water = {
    mesh, material: mat, sky,
    get level() { return mesh.position.y; },
    get goal() { return goal; },
    setLevel(level: number, smooth = true) { goal = level; if (!smooth) mesh.position.y = level; },
    update(time: number) {
      mesh.position.y += (goal - mesh.position.y) * (1 - Math.exp(-2 * Math.max(0, time - last)));
      last = time;
      light.sun.diffuse.scaleToRef(light.sun.intensity, lightColor);
      light.sky.diffuse.scaleToRef(light.sky.intensity, skyLight);
      light.sun.direction.scaleToRef(-1, toLight);
      mat.setFloat("level", mesh.position.y - WATER_LEVEL).setFloat("time", time).setFloat("rain", sky.rain)
        .setFloat("night", sky.night).setFloat("clouds", sky.clouds).setColor3("horizon", scene.fogColor)
        .setVector3("eye", (scene.activeCamera ?? camera).globalPosition).setVector3("toLight", toLight)
        .setColor3("lightColor", lightColor).setColor3("skyLight", skyLight).setColor3("fogColor", scene.fogColor)
        .setFloat("fogDensity", scene.fogMode ? scene.fogDensity : 0).setFloat("edge", light.shadows.frustumEdgeFalloff)
        .setFloat("gamma", scene.imageProcessingConfiguration.applyByPostProcess ? 2.2 : 1);
    },
  };
  scene.metadata.water = water;
  return water;
}

export const waterOf = (scene: Scene) => scene.metadata.water as ReturnType<typeof buildWater> | undefined;
