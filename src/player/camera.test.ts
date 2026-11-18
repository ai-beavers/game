// The player camera's framing and feel, without a screen: the beaver's steering (state.ts) moves the feet at `fps`,
// the rig (camera.ts) turns that into where the camera stands and looks, and per frame we measure
//   accel   the hardest the camera's position speeds up or slows down, m/s² (a jerk shows as a spike)
//   swing   the fastest the way it looks turns, rad/s
// for what players do: start, stop, reverse, jump, turn on the spot, swim in, start gnawing. Collisions are left out
// (Rapier). `bun test src/player/camera` prints the table.
import { describe, expect, test } from "bun:test";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { RUN_SPEED, WALK_SPEED } from "../contracts.ts";
import { FOV, REST_DISTANCE, REST_PITCH, lens, newRig, orbit, spring, stepRig, view } from "./camera.ts";
import { newSteering, steer } from "./state.ts";

const GRAVITY = 18, JUMP_SPEED = Math.sqrt(2 * GRAVITY * 0.6) + GRAVITY / 120; // as src/player
interface Wish { want?: number; run?: boolean; jump?: boolean; water?: boolean; busy?: boolean }
const MANOEUVRES: Record<string, { seconds: number; wish: (t: number) => Wish }> = {
  start: { seconds: 3, wish: (t) => ({ want: t > 0.5 ? 0 : undefined, run: true }) },
  stop: { seconds: 4, wish: (t) => ({ want: t < 2 ? 0 : undefined, run: true }) },
  reverse: { seconds: 4, wish: (t) => ({ want: t < 2 ? 0 : Math.PI, run: true }) },
  jump: { seconds: 3, wish: (t) => ({ want: 0, jump: t > 1 && t < 1.05 }) },
  "turn on the spot": { seconds: 3, wish: (t) => ({ want: t > 0.5 && t < 0.8 ? Math.PI : undefined }) }, // a tap on S
  "swim in": { seconds: 5, wish: (t) => ({ want: 0, water: t > 1.5 }) },
  gnaw: { seconds: 4, wish: (t) => ({ want: t < 1 ? 0 : undefined, busy: t > 1.3 }) },
};

/** Plays a manoeuvre with the camera behind the beaver; returns the worst accel and swing, and the last frame. */
function play(name: string, fps = 60) {
  const { seconds, wish } = MANOEUVRES[name]!, dt = 1 / fps, rig = newRig(), s = newSteering(), feet = new Vector3();
  let vy = 0, ground = 0, accel = 0, swing = 0, lowest = Infinity, highest = -Infinity;
  const at: Vector3[] = [], looks: Vector3[] = [];
  let last = { position: new Vector3(), feet: new Vector3() };
  for (let t = 0; t < seconds; t += dt) {
    const w = wish(t), afloat = !!w.water;
    steer(s, w.busy ? undefined : w.want, w.want === undefined || w.busy ? 0 : 1, afloat ? 0.5 : w.run ? RUN_SPEED : WALK_SPEED, 6, 9, dt);
    const velocity = { x: Math.sin(s.facing) * s.speed, z: Math.cos(s.facing) * s.speed };
    feet.x += velocity.x * dt; feet.z += velocity.z * dt;
    if (afloat) ground += (-0.3 - ground) * Math.min(1, 5 * dt); // sinks to swimming depth
    if (w.jump && feet.y <= ground) vy = JUMP_SPEED;
    vy -= GRAVITY * dt; feet.y = Math.max(ground, feet.y + vy * dt);
    if (feet.y <= ground) vy = 0;
    const shot = stepRig(rig, dt, feet, { velocity, facing: s.facing, afloat, busy: !!w.busy }, Math.PI, REST_PITCH, REST_DISTANCE, 16 / 9);
    const position = orbit(shot.pivot, shot.yaw, shot.pitch, shot.distance);
    at.push(position); looks.push(view(position, shot.pivot.add(shot.lead), shot.rise, shot.across));
    lowest = Math.min(lowest, position.y); highest = Math.max(highest, position.y);
    last = { position, feet: feet.clone() };
  }
  for (let i = 2; i < at.length; i++) accel = Math.max(accel, at[i]!.subtract(at[i - 1]!.scale(2)).add(at[i - 2]!).length() / dt ** 2);
  for (let i = 1; i < looks.length; i++) swing = Math.max(swing, Math.acos(Math.min(1, Vector3.Dot(looks[i]!, looks[i - 1]!))) / dt);
  return { accel, swing, rise: highest - lowest, ...last };
}

describe("feel", () => {
  test("table", () => {
    console.table(Object.fromEntries(Object.keys(MANOEUVRES).map((m) => {
      const r = play(m);
      return [m, { "accel m/s²": +r.accel.toFixed(2), "swing rad/s": +r.swing.toFixed(2), "up and down m": +r.rise.toFixed(2) }];
    })));
  });
  // The beaver speeds up at 6 m/s² and brakes at 9: the camera never moves harder than the beaver does, much softer
  // where the beaver itself does not jolt (into the water, down to work), and never turns the view fast.
  const BOUNDS: Record<string, number> = { start: 4, stop: 5, reverse: 9, jump: 4, "turn on the spot": 2, "swim in": 3, gnaw: 3 };
  for (const m of Object.keys(MANOEUVRES)) test(`${m}: at most ${BOUNDS[m]} m/s²`, () => {
    const r = play(m);
    expect(r.accel).toBeLessThan(BOUNDS[m]!);
    expect(r.swing).toBeLessThan(0.5);
  });
  test("a jump moves the camera less than half as high", () => {
    expect(play("jump").rise).toBeLessThan(0.3);
  });
  test("the same at 30, 60 and 144 frames a second", () => {
    for (const m of ["start", "reverse", "swim in"]) {
      const at60 = play(m, 60), rel = (r: ReturnType<typeof play>) => r.position.subtract(r.feet);
      for (const fps of [30, 144]) expect(rel(play(m, fps)).subtract(rel(at60)).length()).toBeLessThan(0.05);
    }
  });
});

describe("framing", () => {
  /** Where a point shows on screen, -1 … 1 from the middle (y up), for the camera at rest at this aspect. */
  const rest = (aspect: number) => {
    const rig = newRig(), feet = Vector3.Zero(), standing = { velocity: { x: 0, z: 0 }, facing: 0, afloat: false, busy: false };
    let shot = stepRig(rig, 1 / 60, feet, standing, Math.PI, REST_PITCH, REST_DISTANCE, aspect);
    for (let i = 0; i < 120; i++) shot = stepRig(rig, 1 / 60, feet, standing, Math.PI, REST_PITCH, REST_DISTANCE, aspect);
    const from = orbit(shot.pivot, shot.yaw, shot.pitch, shot.distance), look = view(from, shot.pivot, shot.rise, shot.across);
    const half = Math.tan(shot.fov / 2), elevation = (v: Vector3) => Math.atan2(v.y, Math.hypot(v.x, v.z));
    const screenY = (p: Vector3) => Math.tan(elevation(p.subtract(from)) - elevation(look)) / half;
    const screenX = (p: Vector3) => {
      const to = p.subtract(from);
      return -Math.tan(Math.atan2(to.x, to.z) - Math.atan2(look.x, look.z)) / (half * aspect);
    };
    return { shot, beaver: { x: screenX(new Vector3(0, 0.4, 0)), y: screenY(new Vector3(0, 0.4, 0)) }, horizon: Math.tan(-elevation(look)) / half };
  };
  for (const [what, aspect] of [["desktop", 16 / 9], ["phone landscape", 844 / 390], ["phone portrait", 390 / 844]] as const) {
    test(`${what}: beaver in the lower third, a little off the middle, horizon in the picture`, () => {
      const { beaver, horizon } = rest(aspect);
      expect(beaver.y).toBeLessThan(-1 / 3); // below the lower third line
      expect(beaver.y).toBeGreaterThan(-0.75);
      expect(Math.abs(beaver.x)).toBeGreaterThan(0.04);
      expect(Math.abs(beaver.x)).toBeLessThan(0.25);
      expect(horizon).toBeGreaterThan(0);
      expect(horizon).toBeLessThan(0.8);
    });
  }
  test("a tall phone sees wider and comes closer, a wide screen keeps the usual lens", () => {
    expect(lens(16 / 9)).toEqual({ fov: FOV, near: 1 });
    const tall = lens(390 / 844);
    expect(tall.fov).toBeGreaterThan(FOV);
    expect(tall.near).toBeLessThan(1);
    expect(tall.near).toBeGreaterThan(0.7);
  });
  test("swimming: lower and flatter; gnawing: closer and to the side", () => {
    const after = (going: { afloat?: boolean; busy?: boolean }) => {
      const rig = newRig(), g = { velocity: { x: 0, z: 0 }, facing: 0, afloat: !!going.afloat, busy: !!going.busy };
      let shot = stepRig(rig, 1 / 60, Vector3.Zero(), g, Math.PI, REST_PITCH, REST_DISTANCE, 16 / 9);
      for (let i = 0; i < 180; i++) shot = stepRig(rig, 1 / 60, Vector3.Zero(), g, Math.PI, REST_PITCH, REST_DISTANCE, 16 / 9);
      return shot;
    };
    const dry = after({}), wet = after({ afloat: true }), work = after({ busy: true });
    expect(wet.pitch).toBeLessThan(dry.pitch - 0.1);
    expect(work.distance).toBeLessThan(dry.distance * 0.85);
    expect(Math.abs(work.yaw - dry.yaw)).toBeGreaterThan(0.4);
  });
  test("zoom eases: half way in about a quarter second, no overshoot", () => {
    const rig = newRig(), g = { velocity: { x: 0, z: 0 }, facing: 0, afloat: false, busy: false };
    stepRig(rig, 1 / 60, Vector3.Zero(), g, Math.PI, REST_PITCH, 4, 16 / 9);
    const at = (seconds: number) => { let d = 0; for (let t = 0; t < seconds; t += 1 / 60) d = stepRig(rig, 1 / 60, Vector3.Zero(), g, Math.PI, REST_PITCH, 8, 16 / 9).distance; return d; };
    const quarter = at(0.28);
    expect(quarter).toBeGreaterThan(5.5);
    expect(quarter).toBeLessThan(7);
    expect(at(3)).toBeLessThanOrEqual(8 + 1e-9);
  });
});

test("spring: exact for any step, critically damped (never past the goal)", () => {
  let a: [number, number] = [0, 0], b: [number, number] = [0, 0], peak = 0;
  for (let i = 0; i < 60; i++) { a = spring(a[0], a[1], 1, 6, 1 / 60); peak = Math.max(peak, a[0]); }
  b = spring(0, 0, 1, 6, 1);
  expect(a[0]).toBeCloseTo(b[0], 9);
  expect(peak).toBeLessThanOrEqual(1);
});
