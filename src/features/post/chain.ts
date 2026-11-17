// The effect chain the picture is drawn through when effects are on (and always in photo mode, for the depth of
// field). Built on three's EffectComposer:
//
//   scene into a multisampled half-float target (the fur's alpha-to-coverage needs the samples)
//   -> bloom on what is truly bright (blended into the same target) -> depth of field (photo mode only)
//   -> to the screen: three's OutputPass (the renderer's tone mapping, exposure and sRGB, as the plain draw does)
//      with the grade added to its shader: a little warmth and contrast, calmer greens, a soft vignette, dithering
//
// The grade sits in the output shader on purpose: a separate pass after it costs a write into a multisampled
// half-float target and its resolve, measured +9 ms a picture at 1280 x 720.
//
//   const chain = createChain(stage);
//   chain.configure("high", true);    quality and effects on or off (off: scene, depth of field, output only)
//   chain.blur = 0.5; chain.focus = 3; depth of field strength 0 … 1 and the focus distance in metres
//   chain.render();                   instead of renderer.render(scene, camera); follows the canvas size itself
import * as THREE from "three";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { Stage } from "../../engine.ts";
import type { Settings } from "../../settings.ts";

// Bloom works on linear light before tone mapping: with exposure 0.5 only the sun's glint on water and the sky
// right around the sun lie above this; a white shirt in full sun does not.
const BLOOM = { strength: 0.18, radius: 0.35, threshold: 5 };
// Depth of field at full strength: blur per metre off the focus, and the most blur, in parts of the picture.
const APERTURE = 0.0016, MAX_BLUR = 0.012;
const SAMPLES: Record<Settings["quality"], number> = { low: 2, medium: 4, high: 8 };

// Runs on display values (after tone mapping and sRGB), where "a little contrast" means what the eye sees.
const GRADE = /* glsl */ `
  {
    vec3 c = gl_FragColor.rgb, plain = c;
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // Afternoon: lights a little golden, shadows a little cool.
    c += vec3(0.03, 0.012, -0.025) * smoothstep(0.35, 0.9, luma) + vec3(-0.01, 0.0, 0.012) * (1.0 - smoothstep(0.05, 0.4, luma));
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);                        // a gentle S curve: depth without crushing
    // Greens lean to yellow and lose a little colour: grass and leaves sunlit, not neon or cyan.
    float green = clamp((c.g - max(c.r, c.b)) * 5.0, 0.0, 1.0);
    c.rb += vec2(0.045, -0.03) * green * c.g;
    luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, 1.06 - 0.14 * green);                      // everything else a touch richer
    vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
    c *= 1.0 - 0.22 * smoothstep(0.4, 1.1, length(p));                // corners a touch darker
    c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    gl_FragColor.rgb = mix(plain, clamp(c, 0.0, 1.0), grade);
  }
`;

export function createChain({ renderer, scene, camera }: Stage) {
  const target = (samples: number) => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, target(0));
  composer.setPixelRatio(1); // sized in drawing-buffer pixels below, so the renderer's pixel ratio is already in
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  // Soft by nature, so it runs at half the picture's size (its first mip at a quarter): a quarter of the cost.
  const fullBloom = bloom.setSize.bind(bloom);
  bloom.setSize = (width, height) => fullBloom(Math.ceil(width / 2), Math.ceil(height / 2));
  const dof = new BokehPass(scene, camera, { focus: 3, aperture: 0, maxblur: 0 });
  const output = new OutputPass();
  Object.assign(output.uniforms, { aspect: { value: 1 }, grade: { value: 1 } });
  const shader = output.material.fragmentShader, end = shader.lastIndexOf("}");
  output.material.fragmentShader = (shader.slice(0, end) + GRADE + shader.slice(end))
    .replace("varying vec2 vUv;", "varying vec2 vUv;\nuniform float aspect, grade;");
  for (const pass of [new RenderPass(scene, camera), bloom, dof, output]) composer.addPass(pass);

  // The scene goes into `scene`, multisampled; `spare` takes the depth of field. RenderPass draws into the
  // composer's read buffer, and the passes swap read and write, so both are put back before every picture.
  let scenes = target(4), spare = composer.renderTarget1;
  const size = new THREE.Vector2(), shown = new THREE.Vector2();
  let effects = true;
  const chain = {
    /** Depth of field strength, 0 (off) … 1. */
    blur: 0,
    /** Distance of the sharp plane from the camera, metres. */
    focus: 3,
    configure(quality: Settings["quality"], on: boolean) {
      effects = on;
      bloom.strength = quality === "low" ? 0 : BLOOM.strength;
      const samples = Math.min(SAMPLES[quality], renderer.capabilities.maxSamples);
      if (samples !== scenes.samples) { scenes.dispose(); scenes = target(samples); shown.set(0, 0); }
    },
    render() {
      renderer.getDrawingBufferSize(size);
      if (!size.equals(shown)) {
        composer.setSize(size.x, size.y);
        scenes.setSize(size.x, size.y);
        output.uniforms.aspect!.value = size.x / size.y;
        shown.copy(size);
      }
      composer.readBuffer = scenes;
      composer.writeBuffer = spare;
      bloom.enabled = effects && bloom.strength > 0;
      output.uniforms.grade!.value = effects ? 1 : 0;
      dof.enabled = chain.blur > 0;
      const u = dof.uniforms as Record<string, THREE.IUniform>;
      u.focus!.value = chain.focus;
      u.aperture!.value = APERTURE * chain.blur;
      u.maxblur!.value = MAX_BLUR * chain.blur;
      composer.render();
    },
  };
  return chain;
}
export type Chain = ReturnType<typeof createChain>;
