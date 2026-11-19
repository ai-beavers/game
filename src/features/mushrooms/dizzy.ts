// The dizzy view: one full-screen pass of its own, and a slow sway of the camera, both as strong as `dizzy` (0 … 1).
// - colour: the hues turn slowly through the rainbow (a full turn in HUE_TURN s), a little apart across the screen,
//   the brightness kept (the turn is about the grey axis, in YIQ);
// - wave: the picture's coordinates move in slow gentle sines, a few thousandths of the screen;
// - sway: the camera rolls and nods slowly, under two degrees, about once in four seconds.
// Nothing flashes or jitters: every part is a slow sine scaled by `dizzy`, which itself fades in and out.
// The pass is on the camera only while dizzy > 0 (else it costs nothing), right after the under-water pass when that
// is on (the dizziness lies over the water look) and before bloom and tone mapping. The HUD is drawn after the post
// chain, as always, and stays steady. Steering is not touched: only the picture moves.
//
//   const view = createDizzy(stage);   view.update(dt, dizzy) once a picture, after the player's camera has moved
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess.js";
import type { Stage } from "../../engine.ts";

/** s for one full turn of the hues (no faster than 6 s, so the colour never flickers). */
export const HUE_TURN = 9;
/** The picture's wave, a fraction of the screen, and its sway: roll and nod in radians, s per swing. */
const WAVE = 0.004, ROLL = 0.03, NOD = 0.012, SWAY = 4.2;

ShaderStore.ShadersStore.dizzyFragmentShader = `precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float strength, time, wave, turn;
void main() {
  vec2 uv = vUV + strength * wave * vec2(sin(vUV.y * 7. + time * 1.1) + .5 * sin(vUV.x * 4. - time * .7),
                                         sin(vUV.x * 6. - time * .9) + .5 * sin(vUV.y * 3. + time * .6));
  vec3 c = texture2D(textureSampler, clamp(uv, .001, .999)).rgb;
  // The hue turned about the grey axis (YIQ): the brightness stays, the colour goes round the rainbow.
  float y = dot(c, vec3(.299, .587, .114));
  vec2 iq = vec2(dot(c, vec3(.596, -.274, -.322)), dot(c, vec3(.211, -.523, .312)));
  float a = turn + 1.2 * (vUV.x + .6 * vUV.y), ca = cos(a), sa = sin(a);
  iq = mat2(ca, sa, -sa, ca) * iq * 1.35 + .02 * vec2(cos(a), sin(a)) * y; // a little more colourful, a faint tint even on grey
  vec3 turned = max(vec3(0.), vec3(y + .956 * iq.x + .621 * iq.y, y - .272 * iq.x - .647 * iq.y, y - 1.106 * iq.x + 1.703 * iq.y));
  gl_FragColor = vec4(mix(c, turned, strength), 1.);
}`;

export function createDizzy(stage: Stage) {
  const { scene, camera, engine } = stage;
  let pass: PostProcess | undefined, time = 0, strength = 0;
  const make = () => {
    const p = new PostProcess("dizzy", "dizzy", ["strength", "time", "wave", "turn"], null, 1, null,
      Constants.TEXTURE_BILINEAR_SAMPLINGMODE, engine, false, null, Constants.TEXTURETYPE_HALF_FLOAT);
    p.onApply = (effect) => {
      effect.setFloat("strength", strength).setFloat("time", time).setFloat("wave", WAVE).setFloat("turn", (time / HUE_TURN) * Math.PI * 2);
    };
    return p;
  };
  let attached = false;
  const attach = () => {
    pass ??= make();
    // After the under-water pass when it is on, else first: before bloom and tone mapping.
    const under = camera._postProcesses.findIndex((p) => p?.name === "underwater");
    camera.attachPostProcess(pass, under + 1);
    attached = true;
  };
  const detach = () => { if (pass) camera.detachPostProcess(pass); attached = false; };
  scene.onDisposeObservable.add(() => pass?.dispose());
  return {
    get on() { return attached; },
    update(dt: number, dizzy: number) {
      strength = dizzy;
      if (dizzy <= 0) { if (attached) detach(); time = 0; return; }
      time += dt;
      if (!attached) attach();
      // The under-water pass comes and goes at the front: keep this one right after it.
      const list = camera._postProcesses, at = list.indexOf(pass!), under = list.findIndex((p) => p?.name === "underwater");
      if (under > at) { detach(); attach(); }
      // The camera's sway, on top of where the player's camera put it this picture (it sets its turn anew each one).
      if (scene.activeCamera === camera) {
        const t = (time / SWAY) * Math.PI * 2;
        camera.rotation.z += dizzy * ROLL * Math.sin(t);
        camera.rotation.x += dizzy * NOD * Math.sin(t * 0.7 + 1);
      }
    },
  };
}
