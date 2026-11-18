import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { daylightOf } from "../light.ts";
import { grassOf } from "./grass.ts";

// The leaves of trees, bushes and reeds (assets/props.glb, material "leaves"): soft masses with leaf cards at their
// edges. Lit like the grass (src/world/grass.ts): sky from above, the sun through its shadow map, the same fog and
// gamma; and shaped for volume: the sky lights the top and leaves the underside cool and dim, the sun wraps softly
// round each mass, and a low sun puts a warm rim on the edges, strongest looking into it. Per vertex: masses are
// few vertices and many pixels. The wind sways each crown as a whole, higher more, and flutters the leaf cards'
// tips (vertex alpha: how freely a vertex flutters), with the grass's wind (scene.metadata.wind).
// shortcut: the sun's shadow map draws crowns standing still (the sway is a few centimetres); a ShadowDepthWrapper if it ever shows.
const made = new WeakMap<Scene, ShaderMaterial>();

export function foliageMaterial(scene: Scene, leaves: BaseTexture) {
  const known = made.get(scene);
  if (known) return known;
  const mat = new ShaderMaterial("leaves", scene, {
    vertexSource: `precision highp float; attribute vec3 position, normal; attribute vec2 uv; attribute vec4 color;
      #include<instancesDeclaration>
      uniform mat4 viewProjection, lightMatrix; uniform highp sampler2DShadow shadowMap;
      uniform vec3 eye, sky, sun, toSun; uniform vec2 breeze; uniform float time, wind, fogDensity, edge;
      varying vec2 vUV; varying vec3 light; varying float clear;
      void main() {
        #include<instancesVertex>
        vec4 p = finalWorld * vec4(position, 1.);
        vec3 n = normalize(mat3(finalWorld) * normal);
        float phase = dot(finalWorld[3].xz, vec2(.31, .23)), h = clamp(position.y / 9., 0., 1.);
        float sway = h * h * (.05 + .3 * wind) * (.55 + .45 * sin(time * (.7 + .5 * wind) + phase) + .2 * sin(time * 1.9 + phase * 2.3));
        p.xz += breeze * sway;
        p.xyz += (n * .5 + vec3(.3, .6, .2)) * color.a * (.012 + .05 * wind) * sin(time * (5. + 4. * wind) + dot(p.xyz, vec3(2.3, 1.7, 2.9)));
        gl_Position = viewProjection * p;
        vUV = uv;
        vec4 fromLight = lightMatrix * vec4(p.xyz + n * .15, 1.);
        vec3 clip = fromLight.xyz / fromLight.w, uvz = clip * .5 + .5;
        float shadow = all(greaterThanEqual(uvz, vec3(0.))) && all(lessThanEqual(uvz, vec3(1.))) ? texture(shadowMap, uvz) : 1.;
        shadow = mix(shadow, 1., smoothstep(1. - edge, 1., clamp(dot(clip.xy, clip.xy), 0., 1.)));
        vec3 view = normalize(eye - p.xyz);
        float far = length(eye - p.xyz), day = step(0., toSun.y), low = day * (1. - smoothstep(.15, .55, toSun.y));
        vec3 dome = sky * mix(vec3(.7, .78, .98), vec3(1.3, 1.26, 1.1), n.y * .5 + .5); // cool and dim underneath
        float wrap = clamp(dot(n, toSun) * .6 + .4, 0., 1.);
        // the sun through the leaves: a little of it reaches the shaded side, warm and green
        vec3 lit = min(dome + sun * day * (wrap * wrap * shadow + vec3(.16, .2, .08) * (1. - wrap)), vec3(1.15));
        float rim = pow(1. - max(0., dot(n, view)), 2.) * (.3 + 1.2 * pow(max(0., dot(-view, toSun)), 3.));
        float into = pow(max(0., dot(-view, toSun)), 4.) * day; // looking into the sun: it glows through the leaves
        light = pow(color.rgb, vec3(1. / 2.2)) * (lit + sun * (vec3(2., 1.3, .6) * rim * low + vec3(.45, .55, .15) * into * (1. - .5 * wrap)) * (.6 + .4 * shadow));
        clear = clamp(exp(-pow(fogDensity * far, 2.)), 0., 1.);
      }`,
    fragmentSource: `precision highp float; uniform sampler2D leaves; uniform vec3 fogColor; uniform float gamma;
      varying vec2 vUV; varying vec3 light; varying float clear;
      void main() {
        vec4 leaf = texture2D(leaves, vUV);
        if (leaf.a < .5) discard;
        gl_FragColor = vec4(pow(mix(fogColor, leaf.rgb * light, clear), vec3(gamma)), 1.);
      }`,
  }, { attributes: ["position", "normal", "uv", "color"], uniforms: ["world", "viewProjection", "lightMatrix", "eye", "time", "wind", "breeze",
    "sky", "sun", "toSun", "fogColor", "fogDensity", "edge", "gamma"], samplers: ["shadowMap", "leaves"], needAlphaTesting: true });
  mat.backFaceCulling = false;
  mat.setTexture("leaves", leaves);
  mat.getAlphaTestTexture = () => leaves; // the sun's shadow map cuts the cards' leaves out too
  mat.needAlphaBlendingForMesh = () => false; // vertex alpha is the flutter, not transparency
  const sky = new Color3(), sun = new Color3(), toSun = new Vector3(), start = performance.now();
  mat.onBindObservable.add(() => { // after the shadow map of this frame is drawn
    const light = daylightOf(scene), effect = mat.getEffect();
    if (!light || !effect) return;
    light.sky.diffuse.scaleToRef(light.sky.intensity, sky);
    light.sun.diffuse.scaleToRef(light.sun.intensity, sun);
    light.sun.direction.scaleToRef(-1, toSun);
    effect.setMatrix("lightMatrix", light.shadows.getTransformMatrix());
    effect.setDepthStencilTexture("shadowMap", light.shadows.getShadowMapForRendering());
    effect.setFloat("time", (performance.now() - start) / 1000);
    effect.setFloat("wind", grassOf(scene)?.value ?? 0.25);
    effect.setFloat2("breeze", 0.87, 0.49); // the way the sky's wind blows (src/features/sky)
    effect.setColor3("sky", sky);
    effect.setColor3("sun", sun);
    effect.setVector3("toSun", toSun);
    effect.setColor3("fogColor", scene.fogColor);
    effect.setFloat("fogDensity", scene.fogMode ? scene.fogDensity : 0);
    effect.setFloat("edge", light.shadows.frustumEdgeFalloff);
    effect.setFloat("gamma", scene.imageProcessingConfiguration.applyByPostProcess ? 2.2 : 1);
    effect.setVector3("eye", scene.activeCamera!.globalPosition);
  });
  made.set(scene, mat);
  return mat;
}
