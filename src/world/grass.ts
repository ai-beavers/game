import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { Stage } from "../engine.ts";
import { seeded } from "./noise.ts";
import { heightAt, RIM, SITE, pondRatio } from "./terrain.ts";

export const grassOf = (scene: Scene) => scene.metadata.wind as { value: number } | undefined;

export function buildGrass({ scene }: Stage, blocked: (x: number, z: number) => boolean) {
  const random = seeded(11), wind = { value: 0.25 };
  scene.metadata.wind = wind;
  const mesh = new Mesh("grass", scene), data = new VertexData();
  data.positions = [-0.012,0,0, 0.012,0,0, 0.045,0.15,0.025, 0,0,-0.015, 0,0,0.015, -0.03,0.12,0.025, 0.02,0,0.02, 0.038,0,0.02, 0.071,0.18,0.02];
  data.indices = [0,1,2,3,4,5,6,7,8];
  data.applyToMesh(mesh);
  const mat = new ShaderMaterial("wind in grass", scene, {
    vertexSource: `precision highp float; attribute vec3 position;
      #include<instancesDeclaration>
      uniform mat4 viewProjection; uniform float time, wind; varying float tip;
      void main() {
        #include<instancesVertex>
        vec4 p = finalWorld * vec4(position,1.); tip = position.y * 4.;
        p.x += tip * (0.02 + wind * 0.09) * sin(p.z * 1.7 + p.x + time * 2.);
        gl_Position = viewProjection * p;
      }`,
    fragmentSource: `precision highp float; varying float tip; uniform float daylight;
      void main(){ gl_FragColor=vec4(mix(vec3(.20,.33,.10),vec3(.46,.58,.23),tip)*daylight,1.); }`,
  }, { attributes: ["position"], uniforms: ["world", "viewProjection", "time", "wind", "daylight"] });
  mesh.material = mat;
  mat.backFaceCulling = false;
  const matrices: number[] = [];
  for (let i = 0; i < 26000; i++) {
    const x = (random() * 2 - 1) * RIM, z = (random() * 2 - 1) * RIM;
    if (Math.hypot(x,z) > RIM || pondRatio(x,z) < 1.18 || blocked(x,z) || Math.hypot(x-SITE.x,z-SITE.z) < SITE.radius) continue;
    matrices.push(...Matrix.Compose(Vector3.One().scale(0.5 + random() * 0.8), Quaternion.RotationAxis(Vector3.Up(), random()*6.28),
      new Vector3(x, heightAt(x,z)-0.02, z)).asArray());
  }
  mesh.thinInstanceSetBuffer("matrix", new Float32Array(matrices), 16, true);
  return { update(time: number) { mat.setFloat("time", time).setFloat("wind", wind.value).setFloat("daylight", Math.min(1, scene.lights[0]!.intensity)); } };
}
