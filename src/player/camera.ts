// The third-person camera: orbits a point above the beaver's feet, drag to turn it, wheel to zoom (2 … 8 m).
// At rest it stands low behind the beaver and looks a little over it, so the beaver sits in the lower third, a bit left
// of the middle, with the horizon, the sky and the pond in the picture. It follows with a little lag on a critically
// damped spring, looks ahead where the beaver goes, stands back a touch at a run, goes lower over the water and closer
// and to the side for gnawing and building. All of that is a pure function of the beaver's state (rig, stepRig), tested
// in camera.test.ts; the player's own look (drag, stick, finger) is 1:1 and only nudged back to rest after LEFT_ALONE s.
// It never passes through the ground or things: a small ball is cast in Rapier from the beaver to where the camera
// wants to be; when something comes in between the camera moves in quickly but smoothly (at once only when it would be
// inside it), and goes out again slowly. Over the pond it stays above the water; while the beaver dives it goes under
// with it (lower, closer, flatter) and stays under the surface, passing through it in one smooth move (underWater).
//
//   const camera = followCamera(stage, (collider) => true /* which colliders block the view */);
//   camera.update(dt, feet, going?)   once per frame, with the feet where the picture shows them and what the beaver
//                                     does (velocity, afloat, busy, water level); without it: standing on dry land
//   camera.yaw                        the way it looks, for steering relative to it
//   camera.turn(yaw, pitch)           other devices (stick, touch): turn by these radians, pitch kept in range
//   camera.zoom(scale)                distance times scale, kept in 2 … 8 m (eased in the picture)
//   camera.invertY = true             mouse drag up and down turned round (settings.invertY; the controls feature sets it)
//   camera.aim, camera.floor          look past the beaver, stay above a height (the tour's live view; players leave them).
//   camera.room                       how far it may stand along a way, for things without a collider (live view too).
//                                     Once floor is set the live view directs: the player framing above is off.
//
// Mouse and pen drag here; touches are left to whoever handles touch (src/features/controls).
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { RUN_SPEED, WALK_SPEED } from "../contracts.ts";
import { RAPIER, type Stage } from "../engine.ts";

const LOOK_HEIGHT = 0.7; // m above the feet
const MIN_DISTANCE = 2, MAX_DISTANCE = 8;
const MIN_PITCH = -0.05, MAX_PITCH = 1.35; // rad above the horizon: even at 8 m the camera stays above the feet
const UNDER_PITCH = -0.7; // rad: diving, the camera may go below the beaver and look up at the surface
export const REST_PITCH = 0.24, REST_DISTANCE = 4.5; // rad, m: low enough for the horizon, high enough to see the ground ahead
const FOLLOW = 12; // 1/s, how fast the look point catches up (live view)
const LET_OUT = 3; // 1/s, how fast the camera goes back out once the view is free
const LET_IN = 14; // 1/s, how fast it comes in when something comes between (player)
const CLOSE = 1.4; // m: when the view has less room than this, it tries other angles
const TILT = 5; // 1/s, how fast it changes angle for that
const BALL = 0.18; // m, radius of the cast ball: keeps the near plane out of walls
// The player's framing.
export const FOV = Math.PI / 4; // rad, vertical, as engine.ts sets it
const MIN_WIDE = 0.95, MAX_FOV = 1.15; // rad: a tall phone opens the view to see this much across, but not wider than this
const LOW = 0.27, LEFT = 0.12; // the look point this far below and left of the middle (fractions of half the screen)
const LAG = 7, LAG_UP = 3; // 1/s: the look point follows the feet sideways and up and down (jumps barely move it)
const LEAD = 0.35, LEAD_EASE = 3; // s of travel it looks ahead, and 1/s how fast that lead changes
const RUN_WIDEN = 0.08, RUN_FOV = 0.04, MOOD = 2.5; // at a run: farther (fraction) and wider (rad); 1/s for all such moods
const RAMP = 0.7; // 1/s: swimming and working come in no faster than this, so a sudden change never jolts the camera
const SWIM_PITCH = 0.13, SWIM_BACK = 0.08; // lower (rad) and farther (fraction) while swimming
const WORK_CLOSE = 0.22, WORK_SIDE = 0.45; // closer (fraction) and round to the side (rad) while gnawing or building
const ZOOM = 6; // 1/s, the eased zoom
const LEFT_ALONE = 3, CENTRE = 0.5, AHEAD = 0.5; // s without look input, 1/s back to rest, rad within which it swings behind
const WATER_GAP = 0.3, UNDER_GAP = 0.12; // m the camera keeps above the water, and below it while the beaver dives
const DIVE_RAMP = 1.2; // 1/s: how fast the camera goes under and up again (under in about a second, through the surface in a third)
const DIVE_LOOK = 0.4, DIVE_PITCH = 0.75, DIVE_CLOSE = 0.3; // diving: look point lower (m), pitch flatter (fraction), closer (fraction)

/** One step of a critically damped spring, exact for any dt: x with its speed v towards goal at rate w (1/s). */
export function spring(x: number, v: number, goal: number, w: number, dt: number): [number, number] {
  const e = x - goal, k = v + w * e, decay = Math.exp(-w * dt);
  return [goal + (e + k * dt) * decay, (v - w * k * dt) * decay];
}

/** What the camera knows of the beaver: horizontal velocity (m/s), facing (rad), swimming, gnawing or building, the
 *  water level. */
export interface Going { velocity: { x: number; z: number }; facing: number; afloat: boolean; busy: boolean; level?: number; diving?: boolean }
const STANDING: Going = { velocity: { x: 0, z: 0 }, facing: 0, afloat: false, busy: false };

/** Field of view and how much nearer for a screen of this aspect: a tall phone sees wider, and comes in so the beaver
 *  does not shrink much. */
export function lens(aspect: number) {
  const fov = Math.min(MAX_FOV, Math.max(FOV, 2 * Math.atan(Math.tan(MIN_WIDE / 2) / aspect)));
  return { fov, near: Math.sqrt(Math.tan(FOV / 2) / Math.tan(fov / 2)) };
}

/** The smoothed state of the player's framing; stepRig moves it on. */
export const newRig = () => ({
  started: false,
  pivot: new Vector3(), speed: new Vector3(), lead: new Vector3(), leadSpeed: new Vector3(),
  run: 0, runV: 0, swim: 0, swimV: 0, swimGoal: 0, work: 0, workV: 0, workGoal: 0, side: 1, zoom: REST_DISTANCE, zoomV: 0,
  dive: 0, diveV: 0, diveGoal: 0,
});
export type Rig = ReturnType<typeof newRig>;

/** What the picture should be for the beaver's feet and Going, the player's yaw, pitch and distance, the screen's
 *  aspect, dt s after the last step. Pure but for moving the rig on. */
export function stepRig(rig: Rig, dt: number, feet: Vector3, going: Going, yaw: number, pitch: number, distance: number, aspect: number) {
  const { pivot, speed, lead, leadSpeed } = rig, v = going.velocity;
  const goal = { x: feet.x, y: feet.y + LOOK_HEIGHT - DIVE_LOOK * rig.dive, z: feet.z };
  if (!rig.started || Math.hypot(goal.x - pivot.x, goal.y - pivot.y, goal.z - pivot.z) > 5) { // the start, a teleport
    pivot.set(goal.x, goal.y, goal.z); speed.setAll(0); lead.setAll(0); leadSpeed.setAll(0);
    rig.zoom = distance; rig.zoomV = 0; rig.started = true;
  }
  [pivot.x, speed.x] = spring(pivot.x, speed.x, goal.x, LAG, dt);
  [pivot.z, speed.z] = spring(pivot.z, speed.z, goal.z, LAG, dt);
  [pivot.y, speed.y] = spring(pivot.y, speed.y, goal.y, LAG_UP, dt);
  [lead.x, leadSpeed.x] = spring(lead.x, leadSpeed.x, v.x * LEAD, LEAD_EASE, dt);
  [lead.z, leadSpeed.z] = spring(lead.z, leadSpeed.z, v.z * LEAD, LEAD_EASE, dt);
  const running = Math.max(0, Math.min(1, (Math.hypot(v.x, v.z) - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));
  [rig.run, rig.runV] = spring(rig.run, rig.runV, going.afloat ? 0 : running, MOOD, dt);
  const ramp = (from: number, to: number) => from + Math.max(-RAMP * dt, Math.min(RAMP * dt, to - from));
  rig.swimGoal = ramp(rig.swimGoal, +going.afloat);
  rig.workGoal = ramp(rig.workGoal, +going.busy);
  [rig.swim, rig.swimV] = spring(rig.swim, rig.swimV, rig.swimGoal, MOOD, dt);
  // To the side the camera already leans to, seen from behind the beaver; chosen once as the work starts.
  if (going.busy && rig.workGoal === 0) rig.side = Math.sin(yaw - going.facing - Math.PI) < 0 ? -1 : 1;
  [rig.work, rig.workV] = spring(rig.work, rig.workV, rig.workGoal, MOOD, dt);
  rig.diveGoal += Math.max(-DIVE_RAMP * dt, Math.min(DIVE_RAMP * dt, +!!going.diving - rig.diveGoal));
  [rig.dive, rig.diveV] = spring(rig.dive, rig.diveV, rig.diveGoal, 3 * DIVE_RAMP, dt);
  [rig.zoom, rig.zoomV] = spring(rig.zoom, rig.zoomV, distance, ZOOM, dt);
  const { fov, near } = lens(aspect), half = Math.tan((fov + RUN_FOV * rig.run) / 2);
  return {
    pivot, lead,
    yaw: yaw + WORK_SIDE * rig.work * rig.side,
    pitch: Math.max(lowest(rig), pitch - SWIM_PITCH * rig.swim) * (pitch > 0 ? 1 - DIVE_PITCH * rig.dive : 1),
    distance: rig.zoom * near * (1 + RUN_WIDEN * rig.run + SWIM_BACK * rig.swim - WORK_CLOSE * rig.work) * (1 - DIVE_CLOSE * rig.dive),
    /** 0 above the water … 1 under it with the diving beaver (underWater). */
    under: Math.max(0, Math.min(1, rig.dive)),
    fov: fov + RUN_FOV * rig.run,
    /** rad the view looks above and right of the look point, so the beaver sits low and left of the middle. */
    rise: Math.atan(LOW * half), across: Math.atan(LEFT * half * aspect),
  };
}

/** The camera's height y kept clear of the water's surface at `level`: WATER_GAP above it, or (under 1) UNDER_GAP
 *  below it; between the two it passes through, on a smooth curve, so crossing the surface is a move, not a cut. */
export function underWater(y: number, level: number, under: number) {
  // soft bounds (a hard max bends the path at the bound, a jolt): at most SOFT/2 further from the surface
  const soft = (a: number, b: number) => (a + b + Math.sqrt((a - b) ** 2 + SOFT * SOFT)) / 2;
  const above = soft(y, level + WATER_GAP), below = -soft(-y, -(level - UNDER_GAP)), k = under * under * (3 - 2 * under);
  return above + (below - above) * k;
}
const SOFT = 0.1;

/** The lowest pitch now: lower while diving, rising back with the rig as it comes up (no jump). */
const lowest = (rig: Rig) => MIN_PITCH + (UNDER_PITCH - MIN_PITCH) * Math.max(0, Math.min(1, rig.dive));

/** Where the camera stands for this frame (collisions aside): pivot + the way back at yaw and pitch, this far. */
export const orbit = (pivot: Vector3, yaw: number, pitch: number, distance: number) =>
  new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).scaleInPlace(distance).addInPlace(pivot);

/** The way the camera looks (unit) from `from` at `at`, turned up by rise and to the right by across, without roll. */
export function view(from: Vector3, at: Vector3, rise: number, across: number) {
  const to = at.subtract(from), heading = Math.atan2(to.x, to.z) - across, up = Math.atan2(to.y, Math.hypot(to.x, to.z)) + rise;
  return new Vector3(Math.sin(heading) * Math.cos(up), Math.sin(up), Math.cos(heading) * Math.cos(up));
}

export function followCamera({ camera, physics, canvas, engine }: Stage, blocks: (collider: RAPIER.Collider) => boolean) {
  const look = new Vector3(), direction = new Vector3(), ball = new RAPIER.Ball(BALL), rig = newRig();
  const rotation = { x: 0, y: 0, z: 0, w: 1 }, noFloor = (_x: number, _z: number) => -Infinity;
  let started = false, shown = REST_DISTANCE, shownV = 0, shownPitch = REST_PITCH, idle = 0;
  const flags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
  const freeAt = (yaw: number, pitch: number, distance: number) => {
    direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const hit = physics.castShape(look, rotation, direction, ball, 0, distance, true, flags, undefined, undefined, undefined, blocks);
    const free = hit ? Math.max(0.05, hit.time_of_impact - 0.02) : distance;
    return state.room ? Math.min(free, state.room(look, direction, distance)) : free;
  };
  const state = {
    yaw: Math.PI, // camera stands at -z of the beaver, looking along +z
    pitch: REST_PITCH,
    distance: REST_DISTANCE,
    invertY: false,
    /** Added to the look point for the picture only: the live view's director frames ahead and above the beaver. */
    aim: new Vector3(),
    /** Lowest height the camera may take at x, z; the live view keeps it out of water and reeds, which have no collider. */
    floor: noFloor,
    /** How far the camera may stand from `from` along `direction` (unit), up to `distance`, for things without a
     *  collider; the live view keeps it out of crowns and bushes. */
    room: undefined as ((from: Vector3, direction: Vector3, distance: number) => number) | undefined,
    /** How far it really is now, after pulling in for things in the way. */
    get shown() { return shown; },
    turn(yaw: number, pitch: number) {
      if (yaw || pitch) idle = 0;
      state.yaw += yaw;
      state.pitch = Math.max(lowest(rig), Math.min(MAX_PITCH, state.pitch + pitch));
    },
    zoom(scale: number) {
      state.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, state.distance * scale));
    },
    update(dt: number, feet: Vector3, going: Going = STANDING) {
      const live = state.floor !== noFloor; // the tour's live view directs yaw, pitch, distance and aim itself
      state.pitch = Math.max(lowest(rig), Math.min(MAX_PITCH, state.pitch));
      const v = going.velocity, moving = Math.hypot(v.x, v.z);
      // Left alone for a while: back to the rest pitch, and round behind when it goes nearly away from the camera.
      if (!live && (idle += dt) > LEFT_ALONE && moving > 0.3) {
        const k = 1 - Math.exp(-CENTRE * dt * Math.min(1, moving / WALK_SPEED));
        state.pitch += (REST_PITCH - state.pitch) * k;
        const off = Math.atan2(Math.sin(Math.atan2(v.x, v.z) + Math.PI - state.yaw), Math.cos(Math.atan2(v.x, v.z) + Math.PI - state.yaw));
        if (Math.abs(off) < AHEAD) state.yaw += off * k;
      }
      const aspect = engine.getAspectRatio(camera) || 16 / 9;
      const shot = live
        ? { yaw: state.yaw, pitch: state.pitch, distance: state.distance, fov: lens(aspect).fov, rise: 0, across: 0, under: 0 }
        : stepRig(rig, dt, feet, going, state.yaw, state.pitch, state.distance, aspect);
      if (live) {
        const goal = direction.set(feet.x, feet.y + LOOK_HEIGHT, feet.z);
        if (!started) look.copyFrom(goal);
        else Vector3.LerpToRef(look, goal, 1 - Math.exp(-FOLLOW * dt), look);
        rig.started = false; // back to the player: the rig starts afresh where the beaver is
      } else look.copyFrom(rig.pivot);
      started = true;
      camera.fov = shot.fov;
      // Hemmed in (a wall right behind, a ramp overhead): look for a steeper or flatter angle with room, so the
      // camera does not end up inside the beaver's back.
      let aim = shot.pitch;
      // Diving: no steeper than keeps it under the surface, so the cast below finds the bed in the way, not the clamp.
      if (!live && going.level !== undefined && shot.under > 0) {
        const cap = Math.asin(Math.max(-1, Math.min(1, (going.level - UNDER_GAP - look.y) / shot.distance)));
        aim += (Math.min(aim, cap) - aim) * shot.under;
      }
      const room = Math.min(shot.distance, CLOSE);
      if (freeAt(shot.yaw, aim, shot.distance) < room) {
        let best = -Infinity;
        for (let p = lowest(rig); p <= MAX_PITCH + 1e-6; p += 0.1) {
          const score = Math.min(room, freeAt(shot.yaw, p, shot.distance)) - 0.4 * Math.abs(p - shot.pitch);
          if (score > best) { best = score; aim = p; }
        }
      }
      shownPitch += (aim - shownPitch) * (1 - Math.exp(-TILT * dt));
      const free = freeAt(shot.yaw, shownPitch, shot.distance);
      if (live) shown = free < shown ? free : Math.min(free, shown + (free - shown) * (1 - Math.exp(-LET_OUT * dt)));
      else {
        [shown, shownV] = spring(shown, shownV, free, free < shown ? LET_IN : LET_OUT, dt);
        // Only when the camera would be inside something does it jump in front of it.
        const inside = shown > free && physics.intersectionWithShape(orbit(look, shot.yaw, shownPitch, shown), rotation, ball, flags,
          undefined, undefined, undefined, blocks);
        if (inside) { shown = free; shownV = 0; }
      }
      camera.position.copyFrom(orbit(look, shot.yaw, shownPitch, shown));
      camera.position.y = Math.max(camera.position.y, state.floor(camera.position.x, camera.position.z));
      if (!live && going.level !== undefined) camera.position.y = underWater(camera.position.y, going.level, shot.under);
      // Pulled in close (something in the way), it looks at the beaver itself, so the beaver never leaves the picture.
      const near = Math.min(1, shown / shot.distance);
      const at = look.add(state.aim.scale(near));
      if (!live) at.addInPlace(rig.lead.scale(near));
      // The view turned up and to the side of that point by rise and across: the beaver low and left of the middle.
      camera.setTarget(view(camera.position, at, shot.rise, shot.across).addInPlace(camera.position));
    },
  };
  // Drag to orbit, wheel to zoom; the page does not scroll or pan.

  let dragging = -1;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") return;
    dragging = e.pointerId; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointerup", (e) => { if (e.pointerId === dragging) dragging = -1; });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== dragging) return;
    state.turn(-e.movementX * 0.006, e.movementY * 0.005 * (state.invertY ? -1 : 1));
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    state.zoom(Math.exp(e.deltaY * 0.001));
  }, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  return state;
}
export type FollowCamera = ReturnType<typeof followCamera>;
