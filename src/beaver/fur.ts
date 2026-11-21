// The model stores hair length, pale markings, crease shade and shirt coverage in RGBA.
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";

const LAYERS = [0, 0.55, 0.27, 0.82, 0.4, 0.68];
const varyings = "varying vec3 furRest, furNormal; varying vec4 coatMask; varying float shell;";

class Coat extends MaterialPluginBase {
  dressed = true;
  anger = 0;
  /** 0 dry … 1 dripping: darker, glossier, the shells combed flat. */
  wet = 0;
  /** 0 … 1: an old beaver's grey on the muzzle and face, and on the pale markings (the Old Beaver). */
  grey = 0;
  /** Times the grown beaver's count of hairs along and across: above 1 a finer, smoother coat (the River kit's). */
  fine = 1;
  /** 0 … 1: guard hairs over a shorter under-fur (the River kit's). Nearly half the hairs reach the coat's full
   *  length and pale a little to their tips; the others end at 0.72 of it. */
  guard = 0;
  /** light.ts's "sun": the rim of light on the coat's edge is brightest with it behind the beaver. */
  sun: DirectionalLight | null = null;

  constructor(material: PBRMaterial) {
    super(material, "Beaver coat", 200, {}, true, true);
  }

  override getClassName() { return "BeaverCoat"; }
  override getAttributes(attributes: string[]) { attributes.push("furMask", "furLayer"); }
  override getUniforms() {
    return {
      ubo: [{ name: "furState", size: 4, type: "vec4" }, { name: "furSun", size: 3, type: "vec3" }, { name: "furFine", size: 1, type: "float" }, { name: "furGuard", size: 1, type: "float" }],
      vertex: "uniform vec4 furState; uniform vec3 furSun; uniform float furFine, furGuard;", fragment: "uniform vec4 furState; uniform vec3 furSun; uniform float furFine, furGuard;",
    };
  }
  override bindForSubMesh(buffer: UniformBuffer) {
    buffer.updateFloat4("furState", this.anger, Number(this.dressed), this.wet, this.grey);
    const d = this.sun?.direction;
    buffer.updateFloat3("furSun", d?.x ?? 0, d?.y ?? -1, d?.z ?? 0);
    buffer.updateFloat("furFine", this.fine);
    buffer.updateFloat("furGuard", this.guard);
  }

  override getCustomCode(shader: string): Record<string, string> {
    if (shader === "vertex") return {
      CUSTOM_VERTEX_DEFINITIONS: `attribute vec4 furMask; attribute float furLayer; ${varyings}`,
      CUSTOM_VERTEX_UPDATE_POSITION: `
        shell = furLayer;
        furRest = position; furNormal = normal; coatMask = furMask;
        vec3 n = normalize(normalUpdated), down = vec3(0., -1., -.32);
        vec3 comb = down - n * dot(down, n);
        float furLength = .029 * furMask.r * mix(1., smoothstep(.35, .9, furMask.a), furState.y) * (1. - .5 * furState.z);
        positionUpdated += shell * furLength * (n * (1. - .38 * shell) + comb * shell * (1. + furState.z)); // wet: flat, combed down
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
        vec2 hair = uv * vec2(190., 95.) * furFine;
        vec2 id = floor(hair);
        float grain = furNoise(id);
        vec2 center = .5 + .36 * (vec2(grain,furNoise(id+14.7))-.5);
        if (shell > 0. && length(fract(hair)-center) > (.68-.48*shell)*(.7+.3*grain)*(1.-.35*furState.z)) discard; // wet: thin, clumped tips
        float guardHair = furGuard * step(.55, grain);
        if (shell > .72 && furGuard > 0. && guardHair == 0.) discard; // the under-fur ends here
        vec3 marking = vec3(.62, .4, .22); // warm cream: belly, chin, muzzle
        surfaceAlbedo = mix(surfaceAlbedo, marking, coatMask.g * (1.-furState.x));
        // Grey with age (furState.w): the markings, and the head from the cheeks up, most on the muzzle and face.
        float aged = furState.w * max(coatMask.g, smoothstep(.6, .7, furRest.y) * mix(.55, 1., smoothstep(-.02, .12, furRest.z)));
        surfaceAlbedo = mix(surfaceAlbedo, vec3(.36, .34, .32), aged);
        surfaceAlbedo *= mix(.68,1.,coatMask.b) * mix(.85,1.12,shell);
        surfaceAlbedo = mix(surfaceAlbedo, vec3(.8, .72, .6), guardHair * .28 * smoothstep(.3, 1., shell));
        // Sub-pixel strands blend to a solid coat when another player walks away.
        float detail = 1.-smoothstep(.55,1.5,max(fwidth(hair.x), fwidth(hair.y)));
        surfaceAlbedo *= mix(1., .8+.34*grain, detail);
        surfaceAlbedo *= 1. - .45 * furState.z; // wet fur is darker
        // and glossier: the reflectivity block below reads vReflectivityColor (.g roughness); no hook sits closer to it.
        vec4 wetReflectivity = vReflectivityColor;
        wetReflectivity.g *= 1. - .6 * furState.z;
        #define vReflectivityColor wetReflectivity
      `,
      // Soft light through the hair tips on the silhouette's edge, strongest with the sun behind the beaver.
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
        float rim = pow(1. - clamp(dot(normalW, viewDirectionW), 0., 1.), 3.);
        rim *= (.3 + .7 * max(dot(furSun, viewDirectionW), 0.)) * (.35 + .65 * max(dot(normalW, -furSun), 0.)) * (.45 + .55 * shell);
        finalEmissive += rim * vec3(.5, .33, .2) * (1. - .6 * furState.x) * (1. - .5 * furState.z);
      `,
    };
  }
}

/** layers: how far out along the hair each copy of the skin lies (0 … 1), the first ones the most spread: the
 *  nearer the camera, the more of them are drawn. */
export function createCoat(body: Mesh, material: PBRMaterial, layers = LAYERS) {
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
  coat.sun = body.getScene().getLightByName("sun") as DirectionalLight | null;
  return {
    coat,
    update() {
      const camera = body.getScene().activeCamera;
      if (!camera) return;
      const distance = Vector3.DistanceSquared(camera.globalPosition, body.absolutePosition);
      body.thinInstanceCount = Math.ceil(layers.length * (distance < 3 * 3 ? 1 : distance < 7 * 7 ? 2 / 3 : distance < 12 * 12 ? 1 / 3 : 0)) || 1;
    },
  };
}
