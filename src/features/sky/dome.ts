import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Vector2 } from "@babylonjs/core/Maths/math.vector.js";
import type { Settings } from "../../settings.ts";
import { SUNSET } from "../../world/terrain.ts";
import type { Day } from "./clock.ts";
// The sky and what lies beyond the forest, in one shader on one sphere around the camera:
// - the sky from the horizon colour (also the fog's) up to the zenith (the water mirrors both), warm round the sun's
//   place when it is low and cool opposite it, the sun's and the moon's discs, stars at night;
// - cumulus on a flat layer overhead: value noise, lit from the side the sun (by night the moon) stands on, shaded
//   at the base, a bright edge towards the light; their cover follows the weather, they drift with the wind;
// - three ridges of far hills by compass direction, the nearest with a line of tree crowns, each further one closer
//   to the colour of the air; low where the evening sun goes down (src/world/terrain.ts SUNSET), so the valley
//   behind the gap stays open; mist settles into their valleys first.
// Nothing here can be reached, and it costs one draw call.

/** Up to here (sine of the height over the horizon) the hills may reach: above it the shader skips them. */
const HILLS_TOP = 0.3;

export function createDome(scene: Scene) {
  const dome = MeshBuilder.CreateSphere("sky", { diameter: 220, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
  dome.infiniteDistance = true;
  dome.isPickable = false;
  const material = new ShaderMaterial("sky", scene, {
    vertexSource: `precision highp float;
      attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 ray;
      void main(){ ray = position; gl_Position = worldViewProjection * vec4(position, 1.); }`,
    fragmentSource: `precision highp float;
      varying vec3 ray; uniform vec3 sun, moon, horizon; uniform vec2 drift; uniform float time, night, clouds, haze, mist, detail;
      float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x), mix(hash(i+vec2(0.,1.)), hash(i+1.), f.x), f.y);
      }
      // Height (sine) of a ridge in this compass direction c (a unit vector, so the noise closes round the circle).
      float ridge(vec2 c, float k, float low, float high, float gap) {
        float n = noise(c * (2.6 + k * 1.7) + k * 9.1) * .62 + noise(c * (6.5 + k * 3.) - k * 4.3) * .38;
        if (detail > .5) n = n * .8 + noise(c * 21. + k) * .2;
        return mix(high, low, gap) * (.55 + .9 * n);
      }
      void main() {
        vec3 d = normalize(ray);
        float h = max(d.y, 0.);
        vec2 dir = normalize(d.xz + vec2(1e-5, 0.)), toSun = normalize(sun.xz + vec2(1e-5, 0.));
        // Low sun: from 25° up to 10° under the horizon; side: 1 towards the sun's compass direction, 0 opposite.
        float low = (1. - smoothstep(0., .42, sun.y)) * smoothstep(-.18, -.02, sun.y), side = dot(dir, toSun) * .5 + .5;
        float sunUp = smoothstep(-.12, .04, sun.y), band = exp(-h * 7.);
        vec3 zenith = mix(vec3(.22,.52,.83), vec3(.02,.03,.085), night);
        vec3 sky = mix(horizon, zenith, smoothstep(0.,.85,h));
        vec3 warm = mix(vec3(1.,.97,.9), vec3(1.,.5,.22), low);
        float calm = 1. - clouds * .75;
        sky = mix(sky, vec3(.78,.27,.07), low * exp(-h * 3.5) * pow(side, 2.5) * .8 * calm); // a warm band under the low sun
        sky = mix(sky, dot(sky, vec3(.33)) * vec3(.72,.82,1.3), low * band * (1. - side) * .8); // cool opposite it
        float sunCos = max(0., dot(d,sun));
        vec3 glow = warm * (pow(sunCos, 9.) * (.06 + .16 * low) + pow(sunCos, 120.) * .25) * sunUp * calm;
        sky += glow;
        sky += mix(vec3(1.,.93,.8), vec3(1.,.42,.14), low) * smoothstep(.99968,.99988,sunCos) * 2. * sunUp;
        float moonCos = max(0., dot(d,moon)); // a bright disc (it blooms) in a wide cool halo
        float disc = smoothstep(.99955,.99975,moonCos);
        sky += vec3(.82,.88,1.) * (disc * (2.2 - .5 * noise(d.xz * 900.)) + .2*pow(moonCos,300.) + .06*pow(moonCos,12.)) * night;

        // Cumulus on a layer overhead, further off towards the horizon; fine octaves fade out there (no shimmer).
        float cover = 0.;
        if (d.y > -.02) {
          vec2 p = d.xz / (h + .1) * 3. - drift;
          float lod = smoothstep(.04, .3, h);
          float coarse = noise(p) * .5 + noise(p * 2.03 + 3.1) * .28;
          float n = coarse + mix(.075, noise(p * 4.1 - 1.7) * .15, lod);
          n += detail > .5 ? mix(.04, noise(p * 8.3 + 5.2) * .08, lod) : .04;
          float edge = mix(.6, .3, clouds);
          cover = smoothstep(edge, edge + .1, n) * smoothstep(-.02, .1, d.y);
          float thick = smoothstep(edge, edge + .35, n);
          // Lit where the cloud thins towards the light and lower in the picture than its bulk (the base, in its own
          // shade): one coarse look a step towards the sun (or the moon) and up the sky.
          vec2 toLight = normalize(mix(sun.xz, moon.xz, night) + vec2(1e-5, 0.)), q = p + toLight * .16 - dir * .12;
          float lit = detail > .5 ? noise(q) * .5 + noise(q * 2.03 + 3.1) * .28 : coarse + .1 * thick;
          lit = clamp(.6 + (coarse - lit) * 3.5, 0., 1.);
          vec3 light = warm * sunUp * (1. - night) * (1. - .3 * low) + vec3(.5,.56,.72) * night * .12;
          vec3 shade = mix(horizon, zenith, .4) * mix(.58, .3, thick);
          vec3 cloud = shade + light * (lit * .78 + .03) * mix(1., .35, clouds);
          cloud += light * (1. - thick) * (pow(sunCos, 6.) * (1. - night) + pow(moonCos, 16.) * night * 2.) * .9; // the bright rim
          cloud = mix(cloud, mix(vec3(.95,.96,.99), vec3(.39,.45,.53), clouds) * (1. - night * .86), clouds * .55); // overcast: flat grey
          cloud = mix(cloud, sky, (1. - smoothstep(0., .35, h)) * .5); // far off: into the air's colour
          sky = mix(sky, cloud, cover);
        }
        // Under a grey sky the low sky is the fog's colour, as the fogged land in front of it is.
        sky = mix(sky, horizon, (1. - smoothstep(0., .4, h)) * min(1., clouds + haze) * .9);
        vec3 cell = d * 190.; float star = hash(floor(cell.xy) + floor(cell.z)*13.);
        float twinkle = .6 + .4 * sin(time * (1.5 + 3. * fract(star * 91.)) + star * 400.);
        sky += night * step(.98,star) * (.4 + 1.2 * fract(star * 37.)) * twinkle * (1.-smoothstep(.1,.38,length(fract(cell)-.5))) * smoothstep(.05,.25,h) * (1. - cover) * (1. - clouds);

        // Far hills, nearest last; each the colour of the air behind it the further off it is.
        if (d.y < ${HILLS_TOP}) {
          float a = atan(d.z, d.x), off = a - ${SUNSET.angle.toFixed(3)};
          float gap = smoothstep(${(SUNSET.width * 1.7).toFixed(3)}, ${(SUNSET.width * 0.35).toFixed(3)}, abs(atan(sin(off), cos(off))));
          vec3 air = mix(sky, horizon, .3) + glow * .3; // the air in front: the sky behind, hazier
          vec3 land = vec3(.13,.2,.12) * mix(1., .1, night) * (1. - clouds * .35) * mix(1., .75, side * low) + vec3(.1,.04,0.) * low * (1. - side) * sunUp;
          float settle = .008 + .04 * mist; // the mist's top: valleys go under first
          for (int i = 2; i >= 0; i--) {
            float k = float(i);
            float top = ridge(dir, k, .025 + .016 * k, .13 + .045 * k, gap);
            if (i == 0) { // the nearest ridge carries tree crowns
              float c = (a / 6.2832 + .5) * 900., f = fract(c) - .5, r = hash(vec2(floor(c), 7.));
              top += (.004 + .008 * r) * sqrt(max(0., 1. - 4. * f * f)) * step(.25, r);
            }
            float inside = smoothstep(top + .0012, top - .0012, d.y);
            float away = clamp(.28 + .2 * k + clouds * .2 + haze * .5, 0., 1.);
            vec3 hill = mix(land * (1. + .25 * k), air, away);
            hill = mix(hill, air, smoothstep(top, top - .06, d.y) * .3 + smoothstep(settle, settle - .03, d.y) * (.3 + .45 * mist));
            sky = mix(sky, hill, inside);
          }
          sky += glow * .25 * (1. - smoothstep(0., .1, h)); // the low sun's glow hangs in front of them
        }
        gl_FragColor = vec4(mix(sky, horizon, haze * .7 * (1. - smoothstep(0., .5, h))), 1.);
      }`,
  }, { attributes: ["position"], uniforms: ["worldViewProjection", "sun", "moon", "horizon", "drift", "time", "night", "clouds", "haze", "mist", "detail"] });
  material.disableDepthWrite = true;
  dome.material = material;

  return {
    /** Each frame: the hour, the horizon (the fog's colour), cloud cover, fog and mist 0 … 1, where the wind has taken the clouds. */
    update(day: Day, horizon: Color3, clouds: number, fog: number, mist: number, drift: Vector2, time: number) {
      material.setVector3("sun", day.sun).setVector3("moon", day.moon).setColor3("horizon", horizon).setVector2("drift", drift)
        .setFloat("night", day.night).setFloat("clouds", clouds).setFloat("haze", fog).setFloat("mist", mist).setFloat("time", time);
    },
    /** settings.quality: low draws simpler clouds and hills. */
    quality(quality: Settings["quality"]) { material.setFloat("detail", quality === "low" ? 0 : 1); },
  };
}
