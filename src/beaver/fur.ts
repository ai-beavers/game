// The model stores hair length, pale markings, crease shade and shirt coverage in RGBA.
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";

const layers = [0, 0.55, 0.27, 0.82, 0.4, 0.68];
const varyings = "varying vec3 furRest, furNormal; varying vec4 coatMask; varying float shell;";

class Coat extends MaterialPluginBase {
  dressed = true;
  anger = 0;

  constructor(material: PBRMaterial) {
    super(material, "Beaver coat", 200, {}, true, true);
  }

  override getClassName() { return "BeaverCoat"; }
  override getAttributes(attributes: string[]) { attributes.push("furMask", "furLayer"); }
  override getUniforms() {
    return {
      ubo: [{ name: "furState", size: 2, type: "vec2" }],
      vertex: "uniform vec2 furState;", fragment: "uniform vec2 furState;",
    };
  }
  override bindForSubMesh(buffer: UniformBuffer) { buffer.updateFloat2("furState", this.anger, Number(this.dressed)); }

  override getCustomCode(shader: string): Record<string, string> {
    if (shader === "vertex") return {
      CUSTOM_VERTEX_DEFINITIONS: `attribute vec4 furMask; attribute float furLayer; ${varyings}`,
      CUSTOM_VERTEX_UPDATE_POSITION: `
        shell = furLayer;
        furRest = position; furNormal = normal; coatMask = furMask;
        vec3 n = normalize(normalUpdated), down = vec3(0., -1., -.32);
        vec3 comb = down - n * dot(down, n);
        float furLength = .029 * furMask.r * mix(1., smoothstep(.35, .9, furMask.a), furState.y);
        positionUpdated += shell * furLength * (n * (1. - .38 * shell) + comb * shell);
      `,
    };
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `${varyings}
        float furNoise(vec2 p) {
          vec3 cell = fract(vec3(p.xyx)*.1031);
          cell += dot(cell,cell.yzx+33.33);
          return fract((cell.x+cell.y)*cell.z);
        }`,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: `
        if (shell > 0. && mix(1., coatMask.a, furState.y) < .65) discard;
        vec3 axis = abs(furNormal);
        vec2 uv = axis.x > max(axis.y,axis.z) ? furRest.zy :
                  (axis.z > axis.y ? furRest.xy : furRest.xz);
        vec2 hair = uv * vec2(190., 95.);
        vec2 id = floor(hair);
        float grain = furNoise(id);
        vec2 center = .5 + .36 * (vec2(grain,furNoise(id+14.7))-.5);
        if (shell > 0. && length(fract(hair)-center) > (.68-.48*shell)*(.7+.3*grain)) discard;
        vec3 marking = vec3(.42, .29, .18);
        surfaceAlbedo = mix(surfaceAlbedo, marking, coatMask.g * (1.-furState.x));
        surfaceAlbedo *= mix(.68,1.,coatMask.b) * mix(.85,1.12,shell);
        // Sub-pixel strands blend to a solid coat when another player walks away.
        float detail = 1.-smoothstep(.55,1.5,max(fwidth(hair.x), fwidth(hair.y)));
        surfaceAlbedo *= mix(1., .73+.48*grain, detail);
      `,
    };
  }
}

export function createCoat(body: Mesh, material: PBRMaterial) {
  const mask = body.getVerticesData("color");
  if (!mask || mask.length !== body.getTotalVertices() * 4) throw new Error("beaver.glb is missing its RGBA coat mask");
  body.useVertexColors = false;
  body.hasVertexAlpha = false;
  body.setVerticesData("furMask", mask, false, 4);
  const identity = Matrix.Identity(), matrices = new Float32Array(layers.length * 16);
  layers.forEach((_, i) => identity.copyToArray(matrices, i * 16));
  body.thinInstanceSetBuffer("matrix", matrices, 16, true);
  body.thinInstanceSetBuffer("furLayer", new Float32Array(layers), 1, true);
  const coat = new Coat(material);
  return {
    coat,
    update() {
      const camera = body.getScene().activeCamera;
      if (!camera) return;
      const distance = Vector3.DistanceSquared(camera.globalPosition, body.absolutePosition);
      body.thinInstanceCount = distance < 3 * 3 ? layers.length : distance < 7 * 7 ? 4 : distance < 12 * 12 ? 2 : 1;
    },
  };
}
