// The Dance floor's rules as plain numbers, so they can be tested without a scene: whether a point is on the floor,
// whether the beaver dances, how loud the beat is at a distance, which tiles are lit at a beat and how brightly they
// glow for the sky's dark.
//
//   onFloor(x, z)                  feet at x, z stand on the floor
//   still = stepStill(still, dt, facts)   once a step: how long the beaver has stood still for dancing
//   dances(still)                  whether it dances now
//   loudness(x, z)                 the beat's gain for a beaver at x, z: 1 on the floor … 0 out of earshot
//   lit(beat)                      which tiles are lit at a beat time (beats since the start), row by row
//   brightness(sky.dark)           how brightly the lit tiles glow
// The night factor is the shop's (its café lamps'), so the clearing's glowing things come on at one dusk.
import { lampNight } from "../shop/rules.ts";
import { FLOOR } from "./place.ts";

/** Whether feet at (x, z) stand on the floor: within its square, edges included. */
export const onFloor = (x: number, z: number) => Math.abs(x - FLOOR.x) <= FLOOR.half && Math.abs(z - FLOOR.z) <= FLOOR.half;

/** What the beaver is doing, as the dance needs it. holding: a stick or a good in the paws (the lantern is no matter);
 *  low: sitting or crawling, as the player keeps it (left out: standing). */
export interface Facts {
  x: number; z: number;
  grounded: boolean; afloat: boolean; moving: boolean; acting: boolean; holding: boolean; riding: boolean;
  low?: "sit" | "crawl";
}

/** s of standing still on the floor before the dance starts: a stop on the way across is no dance. */
export const DANCE_AFTER = 0.6;

/** Whether the beaver may dance at all: on the floor, on land, still, empty paws, not riding, sitting or crawling. */
const free = (f: Facts) => onFloor(f.x, f.z) && f.grounded && !f.afloat && !f.moving && !f.acting && !f.holding && !f.riding && !f.low;

/** s it has stood still on the floor, free to dance, up to this step; anything else starts it over at 0. */
export const stepStill = (still: number, dt: number, f: Facts) => free(f) ? still + dt : 0;

/** Whether it dances, having stood still for `still` s. */
export const dances = (still: number) => still >= DANCE_AFTER;

/** m from the floor's edge at which the beat can no longer be heard. */
export const EARSHOT = 20;

/** The beat's gain for a beaver with its feet at (x, z): full on the floor, falling away from its edge, nothing from
 *  EARSHOT m on. The clearing's tune steps back by the same amount. */
export function loudness(x: number, z: number) {
  const dx = Math.max(0, Math.abs(x - FLOOR.x) - FLOOR.half), dz = Math.max(0, Math.abs(z - FLOOR.z) - FLOOR.half);
  const t = Math.min(1, Math.hypot(dx, dz) / EARSHOT);
  return (1 - t) * (1 - t);
}

/** A number 0 … 1 that looks random but is the same for the same n. */
const hash = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

/** Which tiles are lit at `beat` (beats since the start, any real number), row by row (index row · tiles + column).
 *  Each bar of four beats has its own pattern: a chequerboard flipping, stripes running across, rings going out from
 *  the middle, sparkles at random; within a beat it holds. */
export function lit(beat: number): boolean[] {
  const n = Math.floor(beat), kind = Math.floor(n / 4) % 4, size = FLOOR.tiles, mid = (size - 1) / 2, out: boolean[] = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const ring = Math.max(Math.abs(row - mid), Math.abs(col - mid));
    out.push(kind === 0 ? (row + col + n) % 2 === 0
      : kind === 1 ? (((row + col - n) % 4) + 4) % 4 === 0
      : kind === 2 ? ring === n % Math.ceil(size / 2)
      : hash(row * 7 + col * 13 + n * 31) < 0.4);
  }
  // A beat with nothing or everything lit would read as a gap in the pattern: the middle tile flips then.
  const on = out.filter(Boolean).length, middle = Math.floor(size * size / 2);
  if (on === 0 || on === out.length) out[middle] = !out[middle];
  return out;
}

/** How brightly the lit tiles glow, by the sky's dark (0 … 1): softly by day, brightly from dusk to dawn. */
export const GLOW = { day: 0.55, night: 1.25 };
export const brightness = (dark: number) => GLOW.day + (GLOW.night - GLOW.day) * lampNight(dark);
