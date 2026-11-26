// What the beaver stands on and where the water is, read from the world's height alone.
//
//   const water = findWater(world.heightAt, world.waterLevel);   once: every water cell on a 0.5 m grid
//   water.nearest(x, z)          → { x, z, distance } the closest water, for the lapping sound
//   groundAt(world.heightAt, world.waterLevel, water, x, z)       → "grass" | "shore" | "water"
export type Ground = "grass" | "shore" | "water";

/** Shore: dry ground this close to the water, m. */
export const SHORE = 1.2;

export function findWater(heightAt: (x: number, z: number) => number, waterLevel: number, half = 45, cell = 0.5) {
  const xs: number[] = [], zs: number[] = [];
  for (let x = -half; x <= half; x += cell) for (let z = -half; z <= half; z += cell) {
    if (heightAt(x, z) < waterLevel) { xs.push(x); zs.push(z); }
  }
  return {
    cells: xs.length,
    nearest(x: number, z: number) {
      let best = Infinity, bx = x, bz = z;
      for (let i = 0; i < xs.length; i++) {
        const d = (xs[i]! - x) ** 2 + (zs[i]! - z) ** 2;
        if (d < best) { best = d; bx = xs[i]!; bz = zs[i]!; }
      }
      return { x: bx, z: bz, distance: Math.sqrt(best) };
    },
  };
}
export type Water = ReturnType<typeof findWater>;

export function groundAt(heightAt: (x: number, z: number) => number, waterLevel: number, water: Water, x: number, z: number): Ground {
  if (heightAt(x, z) < waterLevel) return "water";
  return water.nearest(x, z).distance < SHORE ? "shore" : "grass";
}
