// The WebGPU engine, for a trial: does WebGPU take the time Safari on a phone spends carrying out WebGL calls?
// Loaded only with `engine=webgpu` in the address (src/engine.ts); without it the game runs on WebGL2 as always.
//
//   const engine = await createWebGPU(canvas)   undefined where the browser has no WebGPU
//
// The game's own shaders are GLSL; Babylon turns them into WGSL with glslang and Tint, which it fetches from its CDN
// on the first start.
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine.js";
import { WebGPUTintWASM } from "@babylonjs/core/Engines/WebGPU/webgpuTintWASM.js";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage.js";

export async function createWebGPU(canvas: HTMLCanvasElement) {
  if (!(await WebGPUEngine.IsSupportedAsync)) return undefined;
  // The leaves, grass and animals sample their textures after a discard, which WGSL's uniformity analysis forbids.
  WebGPUTintWASM.DisableUniformityAnalysis = true;
  const engine = new WebGPUEngine(canvas, { antialias: true, stencil: true });
  await engine.initAsync();
  const glsl = engine._getShaderProcessor(ShaderLanguage.GLSL)!;
  const before = glsl.preProcessor;
  glsl.preProcessor = (code, ...rest) => before ? before.call(glsl, oneEach(code), ...rest) : oneEach(code);
  return engine;
}

/** Babylon gives each uniform, varying and attribute its WebGPU binding line by line, one declaration a line, so
 *  `uniform float a, b; varying vec2 c;` becomes three lines of one name each. */
export const oneEach = (code: string) => code.replace(/\b(uniform|varying|attribute)\s+((?:(?:highp|mediump|lowp)\s+)?\w+)\s+([^;(){}]+);/g,
  (_, keyword: string, type: string, names: string) => names.split(",").map((name) => `\n${keyword} ${type} ${name.trim()};\n`).join(""));
