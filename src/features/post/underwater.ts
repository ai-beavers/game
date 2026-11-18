// The look under water: when the camera goes below the pond's surface, one full-screen pass turns the picture into
// green-blue water. It works per pixel from the camera's ray and a depth map:
// - the waterline: where the near plane lies under the (gently waving) surface the pixel is under water, above it the
//   picture stays as it is, with a thin line between, so a camera half in shows both halves and a line, never a pop;
// - under water: fog thickens with the distance through water, the light is dimmer and greener the deeper a thing
//   lies, and soft moving caustics play on everything below the surface (bed, lodge, dam, fish, the beaver);
// - the surface from below (the water sheet is drawn from above only): where a ray reaches the surface before
//   anything else, a bright rippling ceiling: inside Snell's window (about 49° round straight up) what is above
//   shows through, wavering; outside it the water mirrors itself.
// The depth map is a second pass of the scene (camera-space z, float), on only while the beaver dives or the camera is
// at or under the surface, as is the pass itself; above the water (swimming too) it costs nothing.
//
//   const underwater = createUnderwater(game);   underwater.update(dt) each frame; underwater.on: the camera is under
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess.js";
import "@babylonjs/core/Rendering/depthRendererSceneComponent.js";
import type { Game } from "../../game.ts";
import { daylightOf, SUN_INTENSITY } from "../../light.ts";
import { waterOf } from "../../world/water.ts";

const NEAR = 0.25; // m: the pass and the depth map are on while the beaver dives or the camera is this close above (it keeps 0.3)

ShaderStore.ShadersStore.underwaterFragmentShader = `precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler, depthSampler;
uniform mat4 unproject;
uniform vec3 eye, forward, water;
uniform float level, time, near, sun;
// soft moving caustics: the light focused by the ripples above, a net of bright lines (p in metres)
float caustic(vec2 p, float t) {
  p *= 1.5;
  vec2 i = p;
  float c = 1.;
  for (int n = 0; n < 3; n++) {
    float tt = t * (1. - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1. / length(vec2(p.x / (sin(i.x + tt) / .006), p.y / (cos(i.y + tt) / .006)));
  }
  c = 1.17 - pow(c / 3., 1.4);
  return min(1., pow(abs(c), 5.));
}
// the surface's tilt seen from below: a few slow waves at unrelated angles, no grid
vec2 ripple(vec2 p, float t) {
  return .05 * vec2(sin(dot(p, vec2(2.9, 1.1)) + t * 1.3) + .6 * sin(dot(p, vec2(-1.7, 4.3)) - t * 1.9),
                    sin(dot(p, vec2(.8, -3.4)) + t * 1.6) + .6 * sin(dot(p, vec2(4.1, 2.2)) + t * 1.1));
}
void main() {
  vec3 colour = texture2D(textureSampler, vUV).rgb;
  vec4 far = unproject * vec4(vUV * 2. - 1., 1., 1.);
  vec3 dir = normalize(far.xyz / far.w - eye);
  float along = max(dot(dir, forward), .01);
  // The waterline: is this pixel's bit of the near plane under the surface?
  vec3 at = eye + dir * (near / along);
  float side = level + .01 * sin(at.x * 5.3 + time * 1.7) + .007 * sin(at.z * 7.1 - time * 2.3) - at.y;
  float px = max(fwidth(side), 1e-5), wet = smoothstep(-px, px, side), line = 1. - smoothstep(px, 3. * px, abs(side));
  if (wet <= 0. && line <= 0.) { gl_FragColor = vec4(colour, 1.); return; }

  float z = abs(texture2D(depthSampler, vUV).r);
  float dist = z > 0. ? z / along : 1e4; // nothing drawn there: the sky, far away
  float start = near / along, toSurface = dir.y > 1e-4 ? (level - eye.y) / dir.y : 1e4;
  if (toSurface < start) toSurface = 1e4;
  float seen = min(dist, toSurface);
  vec3 lit = colour;
  if (toSurface < dist) { // the surface from below
    vec3 s = eye + dir * toSurface;
    vec2 tilt = ripple(s.xz, time);
    float up = dir.y + dot(tilt, dir.xz) * .5;
    float window = smoothstep(.6, .72, up); // Snell's window: cos 48.6° = .66
    float sheen = caustic(s.xz * .45 + tilt * 4., time * .5); // the light running in the ripples
    vec3 through = texture2D(textureSampler, vUV + tilt * .25).rgb * vec3(.7, .9, .9) + water * 2. * sheen;
    // total reflection: the dim water itself, silvering towards the window, streaked with the ripples' light
    vec3 mirror = water * (.6 + 1.1 * smoothstep(.25, .66, up)) * (.8 + 1.2 * sheen * (.4 + sun));
    lit = mix(mirror, through, window);
  } else if (dist < 1e3) { // something under water: dimmer and greener the deeper it lies, caustics playing on it
    vec3 hit = eye + dir * dist;
    float deep = max(0., level - hit.y);
    lit = colour * mix(vec3(1.), vec3(.55, .85, .8), smoothstep(0., .4, deep)) * exp(-deep * .5);
    lit += colour * sun * 2.2 * caustic(hit.xz, time * .7) * exp(-deep * 1.) * smoothstep(0., .05, deep);
  }
  // fog through water: green-blue, thicker with distance; about half gone at 2 m, all but gone at 7 m
  vec3 under = mix(lit, water, 1. - exp(-seen * .38));
  vec3 picture = mix(colour, under, wet);
  picture = mix(picture, water * .5 + vec3(.02, .03, .03), line * .85); // the meniscus: a thin dark line
  gl_FragColor = vec4(picture, 1.);
}`;

export function createUnderwater(game: Game) {
  const { stage, world } = game, { scene, camera, engine } = stage;
  const depth = scene.enableDepthRenderer(camera, false, true, undefined, true);
  depth.enabled = true; // two frames to compile its shaders while the game starts, then only near the water
  let warm = 2;
  const pass = new PostProcess("underwater", "underwater", ["unproject", "eye", "forward", "water", "level", "time", "near", "sun"],
    ["depthSampler"], 1, null, Constants.TEXTURE_BILINEAR_SAMPLINGMODE, engine, false, null, Constants.TEXTURETYPE_HALF_FLOAT);
  const unproject = new Matrix(), forward = new Vector3(), tint = new Color3();
  let attached = false, time = 0, on = false;
  pass.onApply = (effect) => {
    const level = waterOf(scene)?.level ?? world.waterLevel, light = daylightOf(scene);
    camera.getTransformationMatrix().invertToRef(unproject);
    camera.getDirectionToRef(Vector3.Forward(scene.useRightHandedSystem), forward);
    // the water's own colour, as bright as the light of the hour (the horizon's, linear), green-blue
    const sky = scene.fogColor, bright = Math.pow(0.3 * sky.r + 0.55 * sky.g + 0.15 * sky.b, 2.2);
    tint.set(0.05, 0.2, 0.19).scaleInPlace(0.25 + 1.6 * bright);
    const sun = light ? light.sun.intensity / SUN_INTENSITY * Math.max(0, -light.sun.direction.y) : 0.5;
    effect.setMatrix("unproject", unproject).setVector3("eye", camera.globalPosition).setVector3("forward", forward)
      .setColor3("water", tint).setFloat("level", level).setFloat("time", time).setFloat("near", camera.minZ).setFloat("sun", sun);
    effect.setTexture("depthSampler", depth.getDepthMap());
  };
  return {
    /** The camera's eye is under the surface: the picture is the under-water one. */
    get on() { return on; },
    update(dt: number) {
      time += dt;
      const level = waterOf(scene)?.level ?? world.waterLevel, eye = camera.globalPosition;
      const near = (game.player.diving || eye.y < level + NEAR) && world.heightAt(eye.x, eye.z) < level + NEAR;
      on = near && eye.y < level;
      depth.enabled = near || warm-- > 0;
      if (near === attached) return;
      attached = near;
      if (near) camera.attachPostProcess(pass, 0); // first: fog over the scene, then bloom and tone mapping
      else camera.detachPostProcess(pass);
    },
  };
}
