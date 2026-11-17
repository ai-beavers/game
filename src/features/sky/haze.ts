// The haze's colour, read from the sky itself: after each new environment the sky's horizon is read back from its
// cube (eight directions around), and each frame the haze takes the colour of the horizon the camera looks at,
// passed through the same tone mapping the screen uses. The haze is mixed in after tone mapping (three's fog
// chunk), so that is the space its colour lives in.
//
//   const haze = horizonReader(light);
//   haze.read(renderer);                               after light.relight()
//   haze.color(cameraYaw, exposure, sideways, out)     linear colour for scene.fog.color
//
// The first reading is taken as the tuned afternoon: the result is scaled so that it gives HAZE exactly then.
import * as THREE from "three";
import type { Daylight } from "../../light.ts";
import { HAZE } from "../../world/sky.ts";

const BINS = 8;

/** three's ACESFilmicToneMapping, for one colour: radiance in, linear display colour (0 … 1) out. */
export function aces(c: THREE.Color, exposure: number, out = new THREE.Color()) {
  const s = exposure / 0.6, r = c.r * s, g = c.g * s, b = c.b * s;
  const fit = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const x = fit(0.59719 * r + 0.35458 * g + 0.04823 * b);
  const y = fit(0.076 * r + 0.90834 * g + 0.01566 * b);
  const z = fit(0.0284 * r + 0.13383 * g + 0.83777 * b);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return out.setRGB(clamp(1.60475 * x - 0.53108 * y - 0.07367 * z), clamp(-0.10208 * x + 1.10813 * y - 0.00605 * z),
    clamp(-0.00327 * x - 0.07276 * y + 1.07602 * z), THREE.LinearSRGBColorSpace);
}

export function horizonReader(light: Daylight) {
  const size = light.cube.width, sides = [0, 1, 4, 5]; // +x, -x, +z, -z: the faces that hold the horizon
  const rows = sides.map(() => new Float32Array(size * 2 * 4));
  const bins = Array.from({ length: BINS }, () => new THREE.Color()), counts = new Array<number>(BINS).fill(0);
  const average = new THREE.Color(), point = new THREE.Vector3(), seen = new THREE.Color(), toned = new THREE.Color();
  const scale = new THREE.Color(1, 1, 1), haze = new THREE.Color(HAZE);
  let reading = false, ready = false;

  const take = (exposure: number) => {
    for (const b of bins) b.setRGB(0, 0, 0);
    counts.fill(0);
    sides.forEach((face, f) => {
      const camera = light.cubeCamera.children[face] as THREE.PerspectiveCamera, row = rows[f]!;
      camera.updateMatrixWorld();
      for (let x = 0; x < size; x += 4) {
        point.set(((x + 0.5) / size) * 2 - 1, 0, 0.5).unproject(camera).sub(camera.position);
        const bin = Math.round((Math.atan2(point.x, point.z) / (Math.PI * 2) + 1) * BINS) % BINS, b = bins[bin]!;
        const i = x * 4, j = (size + x) * 4;
        b.r += (row[i]! + row[j]!) / 2; b.g += (row[i + 1]! + row[j + 1]!) / 2; b.b += (row[i + 2]! + row[j + 2]!) / 2;
        counts[bin]!++;
      }
    });
    average.setRGB(0, 0, 0);
    bins.forEach((b, i) => { b.multiplyScalar(1 / Math.max(1, counts[i]!)); average.add(b); });
    average.multiplyScalar(1 / BINS);
    if (!ready) {
      aces(average, exposure, toned);
      scale.setRGB(haze.r / Math.max(toned.r, 1e-4), haze.g / Math.max(toned.g, 1e-4), haze.b / Math.max(toned.b, 1e-4));
      ready = true;
    }
  };

  return {
    /** Horizon colours by direction, linear radiance; bins[i] faces azimuth i * 45° (atan2(x, z)). */
    bins, average,
    /** Starts reading the cube as it is now; the colours arrive a few frames later, without stalling the GPU.
     *  The first call must come while the sky is still the tuned afternoon. */
    read(renderer: THREE.WebGLRenderer) {
      if (reading) return;
      reading = true;
      const exposure = renderer.toneMappingExposure;
      // All four reads are queued now, so they see the same cube even if it is drawn again before they arrive.
      Promise.all(sides.map((face, f) => renderer.readRenderTargetPixelsAsync(light.cube, 0, size / 2 - 1, size, 2, rows[f]!, face)))
        .then(() => take(exposure), (error) => console.warn("sky: horizon not read", error))
        .finally(() => { reading = false; });
    },
    /** The haze for a camera looking along yaw (atan2(x, z) of its view); sideways 0 … 1: how much the colour
     *  follows the view instead of the average around (strong only with a low sun). */
    color(yaw: number, exposure: number, sideways: number, out: THREE.Color) {
      if (!ready) return out.copy(haze);
      const at = ((((yaw / (Math.PI * 2)) % 1) + 1) % 1) * BINS, i = Math.floor(at) % BINS, t = at - Math.floor(at);
      seen.copy(bins[i]!).lerp(bins[(i + 1) % BINS]!, t);
      seen.lerp(average, 1 - sideways);
      aces(seen, exposure, out);
      return out.multiply(scale);
    },
  };
}
