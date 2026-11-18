import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Stage } from "./engine.ts";
import type { Settings } from "./settings.ts";

export const SUN_DIRECTION = new Vector3(-0.45, -0.62, -0.5).normalize();
export const EXPOSURE = 0.5, SUN_INTENSITY = 4.2, SUN_COLOR = 0xfff1d6, ENVIRONMENT = 0.35;
/** How much of the sky's light still reaches a surface the sun lights clearly. A StandardMaterial clamps the sum of
 *  its lights at 1 before the albedo: a full-strength sky alone fills that, and the sun's shadows vanish from the
 *  ground. Under clouds and at night the sky keeps its full share (the sky feature fades between). */
export const SKY_FILL = 0.45;
/** The square the sun's one shadow map covers, metres, and how far ahead of the player its middle lies: the camera
 *  looks over the beaver, so what is behind the camera needs no shadows. */
const REACH = 36, AHEAD = 7;
const SHADOW_MAP = { low: 1024, medium: 2048, high: 2048 } as const;
const FILTER = { low: ShadowGenerator.QUALITY_LOW, medium: ShadowGenerator.QUALITY_MEDIUM, high: ShadowGenerator.QUALITY_HIGH } as const;

const lights = new WeakMap<Scene, ReturnType<typeof daylight>>();
export const daylightOf = (scene: Scene) => lights.get(scene);

export function daylight({ scene, camera }: Stage) {
  const sky = new HemisphericLight("skylight", Vector3.Up(), scene);
  sky.groundColor.set(0.28, 0.31, 0.18);
  const sun = new DirectionalLight("sun", SUN_DIRECTION.clone(), scene);
  sun.shadowMinZ = 0.1;
  sun.shadowMaxZ = 70;
  sun.shadowFrustumSize = REACH;
  const shadows = new ShadowGenerator(SHADOW_MAP.high, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = FILTER.high;
  shadows.bias = 0.0008;
  shadows.normalBias = 0.015;
  shadows.frustumEdgeFalloff = 0.25; // fades out towards the map's edge instead of stopping at a line
  // Everything that takes shadows throws them, but the ground. A renderListPredicate would rebuild the list every
  // frame and so mark every material's lights dirty (about 1 ms a frame): the list is replaced only when it changes.
  const caster = (mesh: AbstractMesh) => mesh.receiveShadows && mesh.name !== "ground";
  scene.onBeforeRenderObservable.add(() => {
    const list = shadows.getShadowMap()!.renderList ?? [];
    let i = 0, same = true;
    for (const mesh of scene.meshes) if (caster(mesh) && list[i++] !== mesh) { same = false; break; }
    if (!same || i !== list.length) shadows.getShadowMap()!.renderList = scene.meshes.filter(caster);
  });
  const right = new Vector3(), up = new Vector3(), centre = new Vector3(), ahead = new Vector3();
  const light = {
    sky, sun, towards: sun.direction, shadows,
    /** Keeps the shadow map over the ground in front of the player. Its middle moves in whole texels of the map,
     *  seen from the sun, so the shadows' edges stay put while the beaver and the camera move. */
    follow(focus: Vector3) {
      const eye = scene.activeCamera ?? camera, size = shadows.getShadowMap()!.getSize().width;
      eye.getDirectionToRef(Vector3.Forward(scene.useRightHandedSystem), ahead);
      ahead.y = 0;
      centre.copyFrom(focus).addInPlace(ahead.normalize().scaleInPlace(AHEAD));
      Vector3.CrossToRef(sun.direction, Vector3.UpReadOnly, right);
      if (right.lengthSquared() < 1e-6) right.set(1, 0, 0);
      right.normalize();
      Vector3.CrossToRef(right, sun.direction, up);
      up.normalize();
      const texel = REACH / size, x = Vector3.Dot(centre, right), y = Vector3.Dot(centre, up);
      centre.addInPlace(right.scale(Math.round(x / texel) * texel - x)).addInPlace(up.scale(Math.round(y / texel) * texel - y));
      sun.position.copyFrom(centre).subtractInPlace(sun.direction.scale(35));
    },
    /** Map size and filter for settings.quality: low keeps the old 1024 map with the cheapest filter. */
    quality(quality: Settings["quality"]) {
      if (shadows.mapSize !== SHADOW_MAP[quality]) shadows.mapSize = SHADOW_MAP[quality];
      shadows.filteringQuality = FILTER[quality];
    },
  };
  lights.set(scene, light);
  return light;
}
