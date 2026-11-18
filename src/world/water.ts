import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import type { Stage } from "../engine.ts";
import { POND, WATER_LEVEL, heightAt } from "./terrain.ts";

export function buildWater({ scene, camera }: Stage) {
  const size = POND.radius * 3;
  const mesh = MeshBuilder.CreateGround("water", { width: size, height: size, subdivisions: 56 }, scene);
  mesh.position.set(POND.x, WATER_LEVEL, POND.z);
  const positions = mesh.getVerticesData("position")!, depths = [];
  for (let i = 0; i < positions.length; i += 3) depths.push(WATER_LEVEL - heightAt(POND.x + positions[i]!, POND.z + positions[i + 2]!));
  mesh.setVerticesData("depth", depths, false, 1);
  const mat = new ShaderMaterial("pond", scene, {
    vertexSource: `precision highp float;
      attribute vec3 position; attribute float depth; uniform mat4 world, worldViewProjection;
      uniform float level; varying float waterDepth; varying vec3 at;
      void main() {
        at = (world * vec4(position,1.)).xyz;
        waterDepth = depth + level;
        gl_Position = worldViewProjection * vec4(position,1.);
      }`,
    fragmentSource: `precision highp float;
      uniform vec3 eye, sky; uniform float time, rain, light;
      varying float waterDepth; varying vec3 at;
      void main() {
        if (waterDepth <= 0.) discard;
        vec2 p = at.xz;
        vec2 ripple = vec2(sin(dot(p,vec2(4.,2.))+time*1.2), cos(dot(p,vec2(-2.,5.))-time*1.6))*.035;
        vec2 cell = fract(p*3.)-.5;
        ripple += rain * cell * cos(length(cell)*47.-time*7.) * .22;
        vec3 normal = normalize(vec3(ripple.x,1.,ripple.y));
        vec3 view = normalize(eye-at);
        float reflectance = .12+.82*pow(1.-max(0.,dot(view,normal)),3.);
        vec3 bed = mix(vec3(.24,.30,.19),vec3(.06,.20,.20),smoothstep(0.,1.,waterDepth));
        vec3 color = mix(bed * light, sky, reflectance);
        color += light*vec3(.85,.81,.55)*pow(max(0.,dot(reflect(-normalize(vec3(.45,.62,.5)),normal),view)),90.);
        gl_FragColor = vec4(color, smoothstep(0.,.08,waterDepth)*mix(.42,.93,smoothstep(0.,.85,waterDepth)));
      }`,
  }, { attributes: ["position","depth"], uniforms: ["world","worldViewProjection","level","eye","sky","time","rain","light"], needAlphaBlending: true });
  mesh.material = mat;
  const rain = { value: 0 };
  let goal = WATER_LEVEL, last = 0;
  const water = {
    mesh, material: mat, rain,
    get level() { return mesh.position.y; },
    get goal() { return goal; },
    setLevel(level: number, smooth = true) { goal = level; if (!smooth) mesh.position.y = level; },
    update(time: number) {
      mesh.position.y += (goal - mesh.position.y) * (1 - Math.exp(-2 * Math.max(0, time - last)));
      last = time;
      mat.setFloat("level", mesh.position.y - WATER_LEVEL).setFloat("time", time).setFloat("rain", rain.value)
        .setVector3("eye", scene.activeCamera?.position ?? camera.position).setColor3("sky", scene.fogColor)
        .setFloat("light", Math.min(1, scene.lights[0]!.intensity));
    },
  };
  scene.metadata.water = water;
  return water;
}

export const waterOf = (scene: Scene) => scene.metadata.water as ReturnType<typeof buildWater> | undefined;
