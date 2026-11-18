import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import type { Day } from "./clock.ts";

export function createDome(scene: Scene) {
  const dome = MeshBuilder.CreateSphere("sky", { diameter: 220, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
  dome.infiniteDistance = true;
  dome.isPickable = false;
  const material = new ShaderMaterial("sky", scene, {
    vertexSource: `precision highp float;
      attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 ray;
      void main(){ ray = position; gl_Position = worldViewProjection * vec4(position, 1.); }`,
    fragmentSource: `precision highp float;
      varying vec3 ray; uniform vec3 sun, moon, horizon; uniform float time, night, clouds;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x), mix(hash(i+vec2(0.,1.)), hash(i+1.), f.x), f.y);
      }
      void main() {
        vec3 d = normalize(ray);
        float h = max(d.y, 0.);
        vec3 zenith = mix(vec3(.22,.52,.83), vec3(.02,.03,.085), night);
        vec3 sky = mix(horizon, zenith, smoothstep(0.,.85,h));
        float sunCos = max(0., dot(d,sun));
        sky += vec3(1.,.68,.36) * (pow(sunCos,36.)*.25 + smoothstep(.99968,.99988,sunCos)*1.6) * (1.-night);
        float moonCos = max(0., dot(d,moon)); // a bright disc (it blooms) in a wide cool halo
        sky += vec3(.82,.88,1.) * (smoothstep(.99955,.99975,moonCos)*2.2 + .2*pow(moonCos,300.) + .06*pow(moonCos,12.)) * night;
        vec3 cell = d * 190.; float star = hash(floor(cell.xy) + floor(cell.z)*13.);
        float twinkle = .6 + .4 * sin(time * (1.5 + 3. * fract(star * 91.)) + star * 400.);
        sky += night * step(.98,star) * (.4 + 1.2 * fract(star * 37.)) * twinkle * (1.-smoothstep(.1,.38,length(fract(cell)-.5))) * smoothstep(.05,.25,h) * (1.-clouds);
        vec2 p = d.xz / max(h+.04,.04)*2. + vec2(time*.008, time*.003);
        float cover = noise(p)*.62 + noise(p*2.1)*.27 + noise(p*5.3)*.11;
        float layer = smoothstep(.55-.38*clouds,.75-.26*clouds,cover)*smoothstep(.015,.13,h);
        vec3 cloud = mix(vec3(.95,.96,.99), vec3(.39,.45,.53), clouds);
        gl_FragColor = vec4(mix(sky, cloud*(1.-night*.86),layer), 1.);
      }`,
  }, { attributes: ["position"], uniforms: ["worldViewProjection", "sun", "moon", "horizon", "time", "night", "clouds"] });
  material.disableDepthWrite = true;
  dome.material = material;

  return (day: Day, horizon: Color3, clouds: number, time: number) => {
    material.setVector3("sun", day.sun).setVector3("moon", day.moon).setColor3("horizon", horizon)
      .setFloat("night", day.night).setFloat("clouds", clouds).setFloat("time", time);
  };
}
