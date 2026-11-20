import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { Stage } from "../engine.ts";
import { daylightOf, LANTERN_GLSL, LANTERN_UNIFORMS } from "../light.ts";
import { seeded } from "./noise.ts";
import { BASIN, FIRST_RIM, groundColor, heightAt, RIM, SITE, pondRatio, slopeAt, WATER_LEVEL } from "./terrain.ts";

const TILE = 11, REACH = 27; // m: the side of a tile of grass; the farthest a blade still stands (the shader's reach)

export const grassOf = (scene: Scene) => scene.metadata.wind as { value: number } | undefined;

// The blades are lit the way the StandardMaterial of the ground beneath them is (sky from above, the sun through its
// shadow map, the sum clamped at 1, the same fog, and like it turned into linear light when the picture's image
// processing runs as a post-process), in the ground's own colour: darker at the root, lighter at the tip.
// Each blade carries that colour and a random share that decides how far from the camera it still stands, so the
// meadow thins out with distance without an edge.
export function buildGrass({ scene, camera }: Stage, blocked: (x: number, z: number) => boolean, soil: StandardMaterial) {
  const random = seeded(11), wind = { value: 0.25 };
  scene.metadata.wind = wind;
  const mesh = new Mesh("grass", scene), data = new VertexData();
  data.positions = [-0.012,0,0, 0.012,0,0, 0.045,0.15,0.025, 0,0,-0.015, 0,0,0.015, -0.03,0.12,0.025, 0.02,0,0.02, 0.038,0,0.02, 0.071,0.18,0.02];
  data.indices = [0,1,2,3,4,5,6,7,8];
  data.applyToMesh(mesh);
  // shortcut: sampler2DShadow needs WebGL2 (the shadows' PCF filter needs it too); a WebGL1 fallback when someone has one.
  const mat = new ShaderMaterial("wind in grass", scene, {
    // All of it per vertex (three to a blade, one at the tip): far fewer than the blades' pixels.
    vertexSource: `precision highp float; attribute vec3 position; attribute vec4 ground;
      #include<instancesDeclaration>
      uniform mat4 viewProjection, lightMatrix; uniform highp sampler2DShadow shadowMap;
      uniform vec3 eye, sky, sun, toSun, soil, fogColor; uniform float time, wind, fogDensity, edge, gamma;
      varying vec3 colour; ${LANTERN_GLSL}
      void main() {
        #include<instancesVertex>
        float far = length(finalWorld[3].xyz - eye), reach = mix(9., ${REACH}., ground.w); // each blade stands up to its own distance, then shrinks away
        vec4 p = finalWorld * vec4(position * smoothstep(reach, reach - 3., far), 1.);
        float tip = position.y * 4., h = tip * 1.4;
        float tall = length(finalWorld[1].xyz), weed = step(2., tall); // grass is at most 1.3 high, pondweed 4 and more
        p.x += tip * mix(0.02 + wind * 0.09, 0.05 * tall, weed) * sin(p.z * 1.7 + p.x + time * mix(2., .9, weed));
        p.z += weed * tip * 0.03 * tall * sin(p.x * 2.3 + time * .7);
        gl_Position = viewProjection * p;
        vec4 fromLight = lightMatrix * p;
        vec3 clip = fromLight.xyz / fromLight.w, uvz = clip * .5 + .5;
        float shadow = all(greaterThanEqual(uvz, vec3(0.))) && all(lessThanEqual(uvz, vec3(1.))) ? texture(shadowMap, uvz) : 1.;
        shadow = mix(shadow, 1., smoothstep(1. - edge, 1., clamp(dot(clip.xy, clip.xy), 0., 1.)));
        float facing = max(0., toSun.y) + .3 * h * length(toSun.xz) * step(0., toSun.y); // a low sun lights the tips
        vec3 lit = ground.rgb * soil * mix(vec3(.55,.57,.52), vec3(1.15,1.2,.95), h) * clamp(sky + sun * facing * shadow + lantern(p.xyz), 0., 1.);
        colour = pow(mix(fogColor, lit, clamp(exp(-pow(fogDensity * far, 2.)), 0., 1.)), vec3(gamma));
      }`,
    fragmentSource: `precision highp float; varying vec3 colour; void main(){ gl_FragColor = vec4(colour, 1.); }`,
  }, { attributes: ["position", "ground"], uniforms: ["world", "viewProjection", "lightMatrix", "eye", "time", "wind", "sky", "sun", "toSun",
    "soil", "fogColor", "fogDensity", "edge", "gamma", ...LANTERN_UNIFORMS], samplers: ["shadowMap"] });
  mesh.material = mat;
  mat.backFaceCulling = false;
  const light = daylightOf(scene)!;
  mat.onBindObservable.add(() => { // after the shadow map of this frame is drawn
    const effect = mat.getEffect()!;
    effect.setMatrix("lightMatrix", light.shadows.getTransformMatrix());
    effect.setDepthStencilTexture("shadowMap", light.shadows.getShadowMapForRendering());
  });
  // In tiles, each a mesh of its own, so the tiles out of the camera's view are not drawn at all.
  const tiles = new Map<number, { matrices: number[]; grounds: number[] }>(), colour = new Color3();
  const weeds = { matrices: [] as number[], grounds: [] as number[] }; // the pondweed, in the first mesh (life reads it)
  let matrices: number[] = [], grounds: number[] = [];
  const at = (x: number, z: number) => {
    const key = Math.floor(x / TILE + 50) * 1000 + Math.floor(z / TILE + 50);
    let tile = tiles.get(key);
    if (!tile) tiles.set(key, tile = { matrices: [], grounds: [] });
    ({ matrices, grounds } = tile);
  };
  for (let i = 0; i < 26000 * (RIM / FIRST_RIM) ** 2; i++) { // as thick as in the first, smaller clearing
    const x = (random() * 2 - 1) * RIM, z = (random() * 2 - 1) * RIM;
    if (Math.hypot(x,z) > RIM || pondRatio(x,z) < 1.18 || blocked(x,z) || Math.hypot(x-SITE.x,z-SITE.z) < SITE.radius) continue;
    const h = heightAt(x,z);
    at(x, z);
    matrices.push(...Matrix.Compose(Vector3.One().scale(0.5 + random() * 0.8), Quaternion.RotationAxis(Vector3.Up(), random()*6.28),
      new Vector3(x, h-0.02, z)).asArray());
    grounds.push(...groundColor(x, z, h, slopeAt(x, z), colour).asArray(), random());
  }
  // Pondweed in the deep basin: the same blades, drawn with the meadow, tall and narrow, in tufts on the bed; the
  // shader sways a tall blade more (below, the water sways it, not the wind; near enough).
  const weed = new Color3(0.16, 0.3, 0.1);
  for (let i = 0; i < 40; i++) {
    const x = BASIN.x + (random() * 2 - 1) * BASIN.along, z = BASIN.z + (random() * 2 - 1) * BASIN.across * 1.4, h = heightAt(x, z);
    if (h > WATER_LEVEL - 1.2) continue;
    ({ matrices, grounds } = weeds);
    for (let k = 0; k < 7; k++) {
      const tall = 4 + random() * 7; // 0.6 … 1.6 m
      matrices.push(...Matrix.Compose(new Vector3(1.6, tall, 1.6), Quaternion.RotationAxis(Vector3.Up(), random() * 6.28),
        new Vector3(x + (random() - 0.5) * 0.3, h - 0.05, z + (random() - 0.5) * 0.3)).asArray());
      grounds.push(...weed.scale(0.7 + random() * 0.5).asArray(), 1);
    }
  }
  const parts: Mesh[] = [];
  for (const tile of tiles.values()) {
    const part = mesh.clone("grass tile");
    // Instance buffers live on the geometry: shared, the weeds' buffers (set last) drew every tile and the GL refused.
    part.makeGeometryUnique();
    parts.push(part);
    part.thinInstanceSetBuffer("matrix", new Float32Array(tile.matrices), 16, true);
    part.thinInstanceSetBuffer("ground", new Float32Array(tile.grounds), 4, true);
    part.thinInstanceRefreshBoundingInfo();
  }
  mesh.thinInstanceSetBuffer("matrix", new Float32Array(weeds.matrices), 16, true);
  mesh.thinInstanceSetBuffer("ground", new Float32Array(weeds.grounds), 4, true);
  const sky = new Color3(), sun = new Color3(), toSun = new Vector3();
  return { update(time: number) {
    // A tile all of whose blades stand farther than they reach (the shader's REACH) is not drawn at all. Cost per
    // frame: one distance to each tile's box, at most 36 tiles (66 m square in 11 m tiles); the blades out of reach are not drawn.
    const eye = (scene.activeCamera ?? camera).globalPosition;
    for (const part of parts) {
      const { minimumWorld: lo, maximumWorld: hi } = part.getBoundingInfo().boundingBox;
      part.isVisible = Math.hypot(Math.max(lo.x - eye.x, 0, eye.x - hi.x), Math.max(lo.z - eye.z, 0, eye.z - hi.z)) < REACH;
    }
    light.sky.diffuse.scaleToRef(light.sky.intensity, sky);
    light.sun.diffuse.scaleToRef(light.sun.intensity, sun);
    light.sun.direction.scaleToRef(-1, toSun);
    mat.setFloat("time", time).setFloat("wind", wind.value).setColor3("sky", sky).setColor3("sun", sun).setVector3("toSun", toSun)
      .setColor3("soil", soil.diffuseColor).setColor3("fogColor", scene.fogColor).setFloat("fogDensity", scene.fogMode ? scene.fogDensity : 0)
      .setFloat("edge", light.shadows.frustumEdgeFalloff).setFloat("gamma", scene.imageProcessingConfiguration.applyByPostProcess ? 2.2 : 1).setVector3("eye", (scene.activeCamera ?? camera).globalPosition)
      .setVector3("lanternAt", light.lantern.at).setColor3("lanternGlow", light.lantern.glow);
  } };
}
