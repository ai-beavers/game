// The beaver's coat: shell texturing in one MeshPhysicalMaterial, patched through onBeforeCompile.
//
//   const uniforms = furUniforms();
//   body.material = furMaterial(uniforms);    body.geometry: an InstancedBufferGeometry, one instance per shell
//   uniforms.anger.value = 0.5;  uniforms.dressed.value = 0;  ...
//
// The body is drawn many times in one instanced call, each copy (shell) pushed further out along the normal and
// combed down and back along the skin. A grid over the rest pose decides per cell how tall its strand is, and each
// shell keeps only the strands that reach it. Shell 0 is the solid skin under the coat.
// The body's vertex colour, renamed to the attribute furMask, holds R = fur length, G = pale markings,
// B = shade in creases, A = what the shirt covers (tools/blender/build.py).
import * as THREE from "three";

// Coat colours, linear. Tuned for daylight() in src/light.ts (exposure 0.5, sun 4.2, sky environment 0.22).
export const CALM = new THREE.Color(0.075, 0.03, 0.013), PALE = new THREE.Color(0.22, 0.15, 0.095), RED = new THREE.Color(0.5, 0.012, 0.006);
export const SHEEN = new THREE.Color(0.05, 0.03, 0.017), SHEEN_RED = new THREE.Color(0.6, 0.05, 0.02);
const GLOSS = "vec3(0.09, 0.055, 0.038)"; // the guard hair's highlight colour, calm
const RIM = "vec3(0.55, 0.7, 1.0)"; // the sky's light caught on the coat's edge
const FUR_FILL = "2.5"; // the sky's fill on the coat, against a smooth surface

export function furUniforms() {
  return {
    furLength: { value: 0.034 }, furShells: { value: 24 }, furDensity: { value: 700 }, anger: { value: 0 }, dressed: { value: 1 },
    furCalm: { value: CALM.clone() }, furPale: { value: PALE.clone() }, furRed: { value: RED.clone() },
  };
}
export type FurUniforms = ReturnType<typeof furUniforms>;

export function furMaterial(uniforms: FurUniforms) {
  const material = new THREE.MeshPhysicalMaterial({ roughness: 0.62, sheen: 1, sheenRoughness: 0.45, sheenColor: SHEEN.clone(), alphaToCoverage: true });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
        attribute vec4 furMask;
        uniform float furLength, furShells, dressed;
        varying float vShell;
        varying vec3 vRest, vRestNormal, vFurStrand;
        varying vec4 vFurMask;`)
      // Before skinning turns the normal: the shell offset is added in the rest pose and skinned with the vertex.
      .replace("#include <skinbase_vertex>", `vec3 furNormal = objectNormal;
        // Combed down and back, along the skin, in tufts that each lean their own way: no coat hangs in straight lines.
        vec3 furLean = vec3(0.0, -1.0, -0.4) + 0.25 * vec3(sin(position.y * 43.0 + position.z * 29.0), 0.3 * sin(position.x * 31.0), cos(position.x * 37.0 + position.y * 23.0));
        vec3 furFlow = furLean - furNormal * dot(furLean, furNormal);
        furFlow = furFlow / max(length(furFlow), 0.2);
        #include <skinbase_vertex>`)
      .replace("#include <skinnormal_vertex>", `#include <skinnormal_vertex>
        vec3 furStrand = normalize(mix(furNormal, furFlow, 0.7));
        #ifdef USE_SKINNING
          furStrand = (skinMatrix * vec4(furStrand, 0.0)).xyz;
        #endif
        vFurStrand = normalMatrix * furStrand;`)
      .replace("#include <morphtarget_vertex>", `#include <morphtarget_vertex>
        vShell = float(gl_InstanceID) / (furShells - 1.0);
        vRest = position;
        vRestNormal = normal;
        vFurMask = furMask;
        // Above the collar of a worn shirt the fur is short, as if tucked in, instead of hanging over it.
        float furHeight = vShell * furLength * furMask.x * mix(1.0, clamp(furMask.w * 2.0 - 1.0, 0.08, 1.0), dressed);
        // Long guard hair lies along the body: out a little, then mostly down and back.
        transformed += furNormal * furHeight * (1.0 - 0.7 * vShell) + furFlow * furHeight * vShell * 2.2;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform float furDensity, anger, dressed;
        uniform vec3 furCalm, furPale, furRed;
        varying float vShell;
        varying vec3 vRest, vRestNormal, vFurStrand;
        varying vec4 vFurMask;
        float furHash(vec3 p) { p = fract(p * 0.3183099 + 0.1) * 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`)
      // The gloss of guard hair: a highlight across the strands, not across the surface (Kajiya-Kay). It runs inside
      // the light loop, so it gets each light's shadow, as the rest of the shading does.
      .replace("#include <lights_physical_pars_fragment>", `#include <lights_physical_pars_fragment>
        void RE_Direct_Fur(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
          RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
          float furTurn = dot(normalize(vFurStrand), normalize(directLight.direction + geometryViewDir));
          float furLit = clamp(dot(geometryNormal, directLight.direction) + 0.35, 0.0, 1.0);
          reflectedLight.directSpecular += directLight.color * mix(${GLOSS}, furRed * 1.6, anger) * furLit * vShell * vFurMask.z
            * pow(sqrt(max(0.0, 1.0 - furTurn * furTurn)), 48.0);
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Fur`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        // Under the shirt, when it is worn: no body deep inside, bare skin without fur near its edges.
        float furCover = mix(1.0, vFurMask.w, dressed);
        if (furCover < 0.25 || (furCover < 0.75 && vShell > 0.0)) discard;
        // Strands are columns along the main axis of the rest normal: a 3D grid would band where the surface curves through it.
        vec3 furAxis = abs(vRestNormal);
        bool furX = furAxis.x > furAxis.y && furAxis.x > furAxis.z, furY = furAxis.y > furAxis.z;
        vec2 furCell = (furX ? vRest.yz : furY ? vRest.zx : vRest.xy) * furDensity;
        vec3 furId = vec3(floor(furCell), furX ? 1.0 : furY ? 2.0 : 3.0);
        float strand = mix(0.45, 1.0, furHash(furId)), tone = furHash(furId + 7.3);  // underfur and guard hair
        vec2 furCentre = 0.5 + 0.35 * (vec2(furHash(furId + 1.7), furHash(furId + 4.1)) - 0.5);  // off the grid, so no rows show
        if (vShell > 0.0) {
          // A strand keeps most of its width and tapers late, like a hair, not a cone: the coat stays dense to its
          // edge, where a cone would thin out into dots.
          float edge = sqrt(max(0.0, 1.0 - vShell / strand)) * 0.95 - length(fract(furCell) - furCentre) * 2.0;
          diffuseColor.a = clamp(edge / max(fwidth(edge), 1e-4) + 0.5, 0.0, 1.0);
          if (diffuseColor.a <= 0.0) discard;
        }
        // Strand by strand, and in soft patches a hand wide: no coat is one colour.
        float furPatch = 0.88 + 0.24 * (0.5 + 0.5 * sin(vRest.x * 21.0 + 2.0 * sin(vRest.y * 13.0)) * sin(vRest.z * 17.0 + 1.3));
        // The skin under the strands (shell 0) takes no strand's tone: on short fur its grid would show as squares.
        vec3 fur = mix(furCalm, furPale, vFurMask.y) * (vShell > 0.0 ? mix(0.7, 1.25, tone) : 0.95) * furPatch;
        fur *= 1.0 + 0.3 * smoothstep(0.75, 1.0, vShell) * step(0.7, tone);  // a few guard hairs end paler
        fur = mix(fur, furRed * mix(0.75, 1.2, tone), anger);
        // Roots sit in the shade of their neighbours, creases in the shade of the body. Where little coat grows (the
        // short fur of the face, skin by the collar) the skin is shaded less.
        float furDepth = step(0.75, furCover) * smoothstep(0.05, 0.5, vFurMask.x);
        diffuseColor.rgb = fur * mix(0.3, mix(0.12, 1.0, vShell * vShell), furDepth) * mix(0.6, 1.0, vFurMask.z);`)
      // Against the sky the outer tips catch its light: a soft rim, strongest where the coat turns away from the eye.
      // Light scatters from strand to strand, so a coat in the shade is brighter than a smooth surface would be.
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse *= ${FUR_FILL};
        float furEdge = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
        reflectedLight.indirectDiffuse += ${RIM} * 0.05 * pow(furEdge, 3.0) * vShell * vFurMask.z * (1.0 - anger) * diffuseColor.a;`);
  };
  return material;
}
