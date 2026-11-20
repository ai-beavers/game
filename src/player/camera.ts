// The player's camera, in the third-person view (the usual one) or the first-person view (V switches; see the end).
// The third-person view: orbits a point above the beaver's feet, drag to turn it, wheel to zoom (2 … 8 m).
// At rest it stands low behind the beaver and looks a little over it, so the beaver sits in the lower third, a bit left
// of the middle, with the horizon, the sky and the pond in the picture. It follows with a little lag on a critically
// damped spring, looks ahead where the beaver goes, stands back a touch at a run, goes lower over the water and closer
// and to the side for gnawing and building. All of that is a pure function of the beaver's state (rig, stepRig), tested
// in camera.test.ts; the player's own look (drag, stick, finger) is 1:1 and only nudged back to rest after LEFT_ALONE s.
// It never passes through the ground or things: a small ball is cast in Rapier from the beaver to where the camera
// wants to be; when something comes in between the camera moves in quickly but smoothly (at once only when it would be
// inside it), and goes out again slowly. Over the pond it stays above the water. While the beaver dives it goes under
// with it where the water has room for it: level with the beaver, further back and a little to the side, the lens a
// touch wider, so the bed below and the surface above are in the picture; the surface is then a ceiling it keeps
// under as it keeps clear of the bed (beneath), and it passes through it in one eased move each way (underWater).
// Where there is no room under (the shallows, the bank behind) it stays above and looks down through the surface.
//
//   const camera = followCamera(stage, (collider) => true /* which colliders block the view */);
//   camera.update(dt, feet, going?)   once per frame, with the feet where the picture shows them and what the beaver
//                                     does (velocity, afloat, busy, water level); without it: standing on dry land
//   camera.yaw                        the way it looks, for steering relative to it
//   camera.turn(yaw, pitch)           other devices (stick, touch): turn by these radians, pitch kept in range
//   camera.zoom(scale)                distance times scale, kept in 2 … 8 m (eased in the picture)
//   camera.touched                    rises with every turn, zoom and press on the picture by the player
//   camera.invertY = true             mouse drag up and down turned round (settings.invertY; the controls feature sets it)
//   camera.room                       how far it may stand along a way, for things without a collider (the live tour's).
//   camera.view                       "third-person" or "first-person"; V switches it, except while paused (a menu,
//                                     photo mode).
//   camera.eyes                       where the beaver sees from (Beaver.eyes), for the first-person view.
//   camera.hold = point               another part (src/features/stare) holds the camera: it keeps its place across,
//                                     stops following the feet, eases its height to the point's and looks at it.
//                                     undefined: let go; it eases back behind the beaver on the usual spring. Only in
//                                     the third-person view; not a touch by the player.
//
// The first-person view stands at the eyes, as the picture shows them, and looks the player's yaw and pitch (pitch
// within EYE_PITCH either way), with no lag and none of the framing above; zoom does nothing there. The player's own
// beaver and what it wears (meshes on OWN_LAYER) are left out of the picture; they still throw their shadow. Back in
// the third-person view the yaw stays, the rig starts afresh at the beaver, pitch and distance are at rest again.
//
// Mouse and pen drag here; touches are left to whoever handles touch (src/features/controls).
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Node } from "@babylonjs/core/node.js";
import { RUN_SPEED, WALK_SPEED } from "../contracts.ts";
import { RAPIER, type Stage } from "../engine.ts";

const LOOK_HEIGHT = 0.7; // m above the feet
const MIN_DISTANCE = 2, MAX_DISTANCE = 8;
const MIN_PITCH = -0.05, MAX_PITCH = 1.35; // rad above the horizon: even at 8 m the camera stays above the feet
const UNDER_PITCH = -0.7; // rad: diving, the camera may go below the beaver and look up at the surface
export const REST_PITCH = 0.24, REST_DISTANCE = 4.5; // rad, m: low enough for the horizon, high enough to see the ground ahead
const LET_OUT = 3; // 1/s, how fast the camera goes back out once the view is free
const LET_IN = 14; // 1/s, how fast it comes in when something comes between
const CLOSE = 1.4, ROOMY = 2; // m: when the view has less room than this (above, under water), it tries other angles
const TILT = 5; // 1/s, how fast it changes angle for that
const BALL = 0.18; // m, radius of the cast ball: keeps the near plane out of walls
// The player's framing.
export const FOV = Math.PI / 4; // rad, vertical, as engine.ts sets it
const MIN_WIDE = 0.95, MAX_FOV = 1.15; // rad: a tall phone opens the view to see this much across, but not wider than this
const LOW = 0.27, LEFT = 0.12; // the look point this far below and left of the middle (fractions of half the screen)
const LAG = 7, LAG_UP = 3, LAG_DOWN = 5; // 1/s: the look point follows the feet sideways, up and down (jumps barely move it), and so diving
const LEAD = 0.35, LEAD_EASE = 3; // s of travel it looks ahead, and 1/s how fast that lead changes
const RUN_WIDEN = 0.08, RUN_FOV = 0.04, MOOD = 2.5; // at a run: farther (fraction) and wider (rad); 1/s for all such moods
const RAMP = 0.7; // 1/s: swimming and working come in no faster than this, so a sudden change never jolts the camera
const SWIM_PITCH = 0.13, SWIM_BACK = 0.08; // lower (rad) and farther (fraction) while swimming
const WORK_CLOSE = 0.22, WORK_SIDE = 0.45; // closer (fraction) and round to the side (rad) while gnawing or building
const ZOOM = 6; // 1/s, the eased zoom
const LEFT_ALONE = 3, CENTRE = 0.5, AHEAD = 0.5; // s without look input, 1/s back to rest, rad within which it swings behind
const JOLT = 0.22, JOLT_FOV = 0.07, JOLT_EASE = 9; // a blow at full strength: m the picture jumps, rad the lens closes in, 1/s it settles
const WATER_GAP = 0.3, UNDER_GAP = 0.25; // m the camera keeps above the water, and below it while the beaver dives
const DIVE_RAMP = 1.0; // 1/s: how fast the camera goes under and up again (under in about a second, through the surface in a third)
// Under water: the look point lower (m, at the diving body), the camera level with it (rad lower), a little nearer
// (fraction), round to the side (rad), the lens a little wider (rad), the beaver in the middle of the height (fraction of LOW kept).
const DIVE_LOOK = 0.4, DIVE_LEVEL = 0.07, DIVE_CLOSE = 0.1, DIVE_SIDE = 0.3, DIVE_FOV = 0.12, DIVE_LOW = 0.2;
const ROOF = 2; // m: under the surface, looking down, the camera rises to it no further than this from the look point
const PEER_PITCH = 0.35, PEER_CLOSE = 0.25; // diving with no room under: higher (rad) and nearer (fraction), to look down through the surface
// The first-person view.
const EYE_PITCH = 1.2; // rad up and down from the horizon
/** The layer of the player's own beaver and what it wears: drawn in the third-person view (and in photo mode from
 *  it), not in the first-person view. Within Babylon's default layer mask, so any other camera draws it. */
export const OWN_LAYER = 0x08000000;
const ALL_LAYERS = 0x0fffffff; // Babylon's default camera.layerMask
export type View = "third-person" | "first-person";
const HOLD_IN = 4, HOLD_OUT = 3, HOLD_SINK = 0.6; // 1/s: into a hold and back out of it; how fast a held camera sinks to its point
const ROOM_DEPTH = 0.35, ROOM_IN = 1.8, ROOM_OUT = 1.2; // m: it goes under where water this deep reaches this far back, up again under that

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
  dive: 0, diveV: 0, diveGoal: 0, deep: true, peer: 0, peerV: 0, peerGoal: 0,
});
export type Rig = ReturnType<typeof newRig>;

/** What the picture should be for the beaver's feet and Going, the player's yaw, pitch and distance, the screen's
 *  aspect, dt s after the last step, and how far back from the beaver the water is deep enough for the camera (m).
 *  Pure but for moving the rig on. */
export function stepRig(rig: Rig, dt: number, feet: Vector3, going: Going, yaw: number, pitch: number, distance: number, aspect: number, room = Infinity) {
  const { pivot, speed, lead, leadSpeed } = rig, v = going.velocity;
  const goal = { x: feet.x, y: feet.y + LOOK_HEIGHT - DIVE_LOOK * rig.dive, z: feet.z };
  if (!rig.started || Math.hypot(goal.x - pivot.x, goal.y - pivot.y, goal.z - pivot.z) > 5) { // the start, a teleport
    pivot.set(goal.x, goal.y, goal.z); speed.setAll(0); lead.setAll(0); leadSpeed.setAll(0);
    rig.zoom = distance; rig.zoomV = 0; rig.started = true;
  }
  [pivot.x, speed.x] = spring(pivot.x, speed.x, goal.x, LAG, dt);
  [pivot.z, speed.z] = spring(pivot.z, speed.z, goal.z, LAG, dt);
  // under water the beaver goes up and down for long, not in jumps: it follows that as closely as sideways
  [pivot.y, speed.y] = spring(pivot.y, speed.y, goal.y, LAG_UP + (LAG_DOWN - LAG_UP) * Math.max(0, Math.min(1, rig.dive)), dt);
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
  // Under only where the water has room for the camera (with a margin either way, so it does not hunt at the edge);
  // diving in the shallows it stays above and looks down through the surface.
  rig.deep = room > (rig.deep ? ROOM_OUT : ROOM_IN);
  const down = +(!!going.diving && rig.deep);
  if (down && rig.diveGoal === 0) rig.side = Math.sin(yaw - going.facing - Math.PI) < 0 ? -1 : 1;
  rig.diveGoal += Math.max(-DIVE_RAMP * dt, Math.min(DIVE_RAMP * dt, down - rig.diveGoal));
  [rig.dive, rig.diveV] = spring(rig.dive, rig.diveV, rig.diveGoal, 3 * DIVE_RAMP, dt);
  rig.peerGoal = ramp(rig.peerGoal, +(!!going.diving && !rig.deep));
  [rig.peer, rig.peerV] = spring(rig.peer, rig.peerV, rig.peerGoal, MOOD, dt);
  [rig.zoom, rig.zoomV] = spring(rig.zoom, rig.zoomV, distance, ZOOM, dt);
  const under = Math.max(0, Math.min(1, rig.dive)), tilt = SWIM_PITCH * rig.swim + DIVE_LEVEL * rig.dive - PEER_PITCH * rig.peer;
  const { fov, near } = lens(aspect), wide = fov + RUN_FOV * rig.run + DIVE_FOV * under, half = Math.tan(wide / 2);
  return {
    pivot, lead,
    yaw: yaw + (WORK_SIDE * rig.work + DIVE_SIDE * rig.dive) * rig.side,
    // the player's pitch less the moods; under water the limit moves with them, so looking round stays 1:1
    pitch: Math.max(lowest(rig) - (SWIM_PITCH * rig.swim + DIVE_LEVEL) * under, pitch - tilt),
    distance: rig.zoom * near * (1 + RUN_WIDEN * rig.run + SWIM_BACK * rig.swim - WORK_CLOSE * rig.work) * (1 - DIVE_CLOSE * rig.dive - PEER_CLOSE * rig.peer),
    /** 0 above the water … 1 under it with the diving beaver (beneath, underWater). */
    under,
    fov: wide,
    /** rad the view looks above and right of the look point, so the beaver sits low and left of the middle. */
    rise: Math.atan(LOW * half) * (1 - (1 - DIVE_LOW) * under), across: Math.atan(LEFT * half * aspect),
  };
}

/** Under water (under 1) the surface is a ceiling, as the ground is a floor: the camera at pitch and distance from a
 *  look point at height y stays UNDER_GAP below the surface at `level`, along its own way (closer, never pushed
 *  sideways into the bank), and at least ROOF from the look point (flatter, or below it, when that is near the
 *  surface). Between 0 and 1 it eases in; so it does while the look point is less than HEAD under the surface, and
 *  on ways flatter than STEEP, where underWater's soft bound alone keeps it under. Returns [pitch, distance]. */
export function beneath(y: number, pitch: number, distance: number, level: number, under: number): [number, number] {
  if (under <= 0) return [pitch, distance];
  const head = level - UNDER_GAP - y, cap = Math.asin(Math.max(-1, Math.min(1, head / (distance + (Math.min(distance, ROOF) - distance) * ease(head / HEAD)))));
  const p = pitch + (softMin(pitch, cap, 0.1) - pitch) * under, k = under * ease(head / HEAD) * ease(p / STEEP - 0.5);
  if (k <= 0) return [p, distance];
  return [p, distance + (softMin(distance, head / Math.sin(p), 0.5) - distance) * k];
}
const HEAD = 0.3, STEEP = 0.2;
const ease = (x: number) => { const h = Math.max(0, Math.min(1, x)); return h * h * (3 - 2 * h); };
/** The smaller of a and b, rounded off over about s: no kink where one starts to bind (a kink is a jolt). */
const softMin = (a: number, b: number, s: number) => (a + b - Math.sqrt((a - b) ** 2 + s * s)) / 2;

/** The camera's height y kept clear of the water's surface at `level`: WATER_GAP above it, or (under 1) UNDER_GAP
 *  below it; between the two it passes through, on a smooth curve, so crossing the surface is a move, not a cut. */
export function underWater(y: number, level: number, under: number) {
  // soft bounds (a hard max bends the path at the bound, a jolt): at most SOFT/2 further from the surface; going
  // through, the bound above is softer still, so the way down does not brake at it just before the surface
  const above = -softMin(-y, -(level + WATER_GAP), SOFT + CROSS * under), below = softMin(y, level - UNDER_GAP, 3 * SOFT);
  const k = under * under * (3 - 2 * under);
  return above + (below - above) * k;
}
const SOFT = 0.1, CROSS = 0.6;

/** The lowest pitch now: lower while diving, rising back with the rig as it comes up (no jump). */
const lowest = (rig: Rig) => MIN_PITCH + (UNDER_PITCH - MIN_PITCH) * Math.max(0, Math.min(1, rig.dive));

/** Where the camera stands for this frame (collisions aside): pivot + the way back at yaw and pitch, this far. */
export const orbit = (pivot: Vector3, yaw: number, pitch: number, distance: number) =>
  new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).scaleInPlace(distance).addInPlace(pivot);

/** The way the first-person view looks (unit) at yaw and pitch: as the third-person camera at that yaw and pitch
 *  looks at the beaver, so steering by the yaw walks the way the eyes look (pitch > 0 looks down). */
export const gaze = (yaw: number, pitch: number) =>
  new Vector3(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));

/** The way the camera looks (unit) from `from` at `at`, turned up by rise and to the right by across, without roll. */
export function view(from: Vector3, at: Vector3, rise: number, across: number) {
  const to = at.subtract(from), heading = Math.atan2(to.x, to.z) - across, up = Math.atan2(to.y, Math.hypot(to.x, to.z)) + rise;
  return new Vector3(Math.sin(heading) * Math.cos(up), Math.sin(up), Math.cos(heading) * Math.cos(up));
}

export function followCamera(stage: Stage, blocks: (collider: RAPIER.Collider) => boolean) {
  const { camera, physics, canvas, engine } = stage;
  const look = new Vector3(), direction = new Vector3(), probe = new Vector3(), ball = new RAPIER.Ball(BALL), rig = newRig();
  const rotation = { x: 0, y: 0, z: 0, w: 1 };
  let shown = REST_DISTANCE, shownV = 0, shownPitch = REST_PITCH, idle = 0, touched = 0, jolt = 0;
  let seen: View = "third-person", eyes: TransformNode | undefined, eyeChain: TransformNode[] = [];
  // The hold: the point it looks at, where the camera stands for it, how far it is held (0 … 1, on a spring).
  let hold = false, held = 0, heldV = 0;
  const heldAt = new Vector3(), heldLook = new Vector3(), following = new Vector3();
  const pitchRange = (pitch: number) => seen === "first-person"
    ? Math.max(-EYE_PITCH, Math.min(EYE_PITCH, pitch)) : Math.max(lowest(rig), Math.min(MAX_PITCH, pitch));
  const flags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
  // wet: a ray as well, for the ball slips through the steep heightfield walls of the basin (measured)
  const ray = new RAPIER.Ray(look, direction);
  const freeAt = (yaw: number, pitch: number, distance: number, wet = false) => {
    direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const hit = physics.castShape(look, rotation, direction, ball, 0, distance, true, flags, undefined, undefined, undefined, blocks);
    let free = hit ? Math.max(0.05, hit.time_of_impact - 0.02) : distance;
    const wall = wet ? physics.castRay(ray, distance, true, flags, undefined, undefined, undefined, blocks) : null;
    if (wall) free = Math.min(free, Math.max(0.05, wall.timeOfImpact - BALL));
    return state.room ? Math.min(free, state.room(look, direction, distance)) : free;
  };
  const state = {
    yaw: Math.PI, // camera stands at -z of the beaver, looking along +z
    pitch: REST_PITCH,
    distance: REST_DISTANCE,
    invertY: false,
    /** How far the camera may stand from `from` along `direction` (unit), up to `distance`, for things without a
     *  collider; the live tour keeps it out of crowns and bushes. */
    room: undefined as ((from: Vector3, direction: Vector3, distance: number) => number) | undefined,
    /** How far it really is now, after pulling in for things in the way. */
    get shown() { return shown; },
    /** How many times the player turned or zoomed the camera or pressed on the picture. Only rises; setting yaw does not. */
    get touched() { return touched; },
    get view() { return seen; },
    set view(next: View) {
      if (next === seen) return;
      seen = next;
      camera.layerMask = next === "first-person" ? ALL_LAYERS & ~OWN_LAYER : ALL_LAYERS;
      if (next === "first-person") { state.pitch = pitchRange(state.pitch); return; }
      // Back behind the beaver: the rig afresh where the beaver is, at rest but for the yaw.
      rig.started = false;
      held = heldV = 0;
      state.pitch = shownPitch = REST_PITCH;
      state.distance = shown = REST_DISTANCE;
      shownV = idle = 0;
    },
    get hold(): Vector3 | undefined { return hold ? heldLook : undefined; },
    set hold(point: Vector3 | undefined) {
      if (point && !hold && held <= 0.001) heldAt.copyFrom(camera.position); // held where it stands now
      if (point) heldLook.copyFrom(point);
      hold = !!point;
    },
    get eyes() { return eyes; },
    set eyes(node: TransformNode | undefined) {
      eyes = node; eyeChain = [];
      for (let n: Node | null = node ?? null; n; n = n.parent) if (n instanceof TransformNode) eyeChain.unshift(n);
    },
    /** A blow landed (src/features/bear): the picture jumps and closes in for a moment, 0 … 1 hard; it settles by itself. */
    jolt(amount: number) { jolt = Math.max(jolt, amount); },
    turn(yaw: number, pitch: number) {
      if (yaw || pitch) { idle = 0; touched++; }
      state.yaw += yaw;
      state.pitch = pitchRange(state.pitch + pitch);
    },
    zoom(scale: number) {
      touched++;
      if (seen === "first-person") return; // it would push the camera out of the eyes
      state.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, state.distance * scale));
    },
    update(dt: number, feet: Vector3, going: Going = STANDING) {
      if (seen === "first-person" && eyes) {
        // At the eyes as the bones were just posed (the world matrices from the beaver's root down, recomputed once).
        for (const node of eyeChain) node.computeWorldMatrix(true);
        camera.position.copyFrom(eyes.getAbsolutePosition());
        camera.fov = lens(engine.getAspectRatio(camera) || 16 / 9).fov;
        state.pitch = pitchRange(state.pitch);
        camera.setTarget(gaze(state.yaw, state.pitch).addInPlace(camera.position));
        jolt = 0; // through its own eyes the picture already jumps with the head
        return;
      }
      state.pitch = pitchRange(state.pitch);
      const v = going.velocity, moving = Math.hypot(v.x, v.z);
      // Left alone for a while: back to the rest pitch, and round behind when it goes nearly away from the camera.
      if ((idle += dt) > LEFT_ALONE && moving > 0.3 && !hold) {
        const k = 1 - Math.exp(-CENTRE * dt * Math.min(1, moving / WALK_SPEED));
        state.pitch += (REST_PITCH - state.pitch) * k;
        const off = Math.atan2(Math.sin(Math.atan2(v.x, v.z) + Math.PI - state.yaw), Math.cos(Math.atan2(v.x, v.z) + Math.PI - state.yaw));
        if (Math.abs(off) < AHEAD) state.yaw += off * k;
      }
      const aspect = engine.getAspectRatio(camera) || 16 / 9;
      // Diving: how far back from the beaver, just under the surface, the water has room for the camera (the bed and
      // the bank are ground, with a collider).
      let room = Infinity;
      if (going.diving && going.level !== undefined) {
        probe.set(feet.x, going.level - ROOM_DEPTH, feet.z);
        direction.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
        const hit = physics.castShape(probe, rotation, direction, ball, 0, MAX_DISTANCE, true, flags, undefined, undefined, undefined, blocks);
        room = hit ? hit.time_of_impact : MAX_DISTANCE;
      }
      const shot = stepRig(rig, dt, feet, going, state.yaw, state.pitch, state.distance, aspect, room);
      look.copyFrom(rig.pivot);
      camera.fov = shot.fov;
      // Hemmed in (a wall right behind, a ramp overhead): look for a steeper or flatter angle with room, so the
      // camera does not end up inside the beaver's back.
      // Diving: the surface is a ceiling (beneath), so the casts below find the bed and the bank in the way, and
      // nothing moves the camera off its way after them.
      const under = (p: number): [number, number] => going.level !== undefined ? beneath(look.y, p, shot.distance, going.level, shot.under) : [p, shot.distance];
      let [aim] = under(shot.pitch);
      const freeUnder = (p: number) => { const [q, d] = under(p); return freeAt(shot.yaw, q, d, shot.under > 0); };
      const close = Math.min(shot.distance, CLOSE + (ROOMY - CLOSE) * shot.under);
      if (freeUnder(aim) < close) {
        let best = -Infinity;
        for (let p = lowest(rig); p <= MAX_PITCH + 1e-6; p += 0.1) {
          const score = Math.min(close, freeUnder(p)) - 0.4 * Math.abs(p - shot.pitch);
          if (score > best) { best = score; aim = under(p)[0]; }
        }
      }
      shownPitch += (aim - shownPitch) * (1 - Math.exp(-TILT * dt));
      const free = freeAt(shot.yaw, shownPitch, under(shownPitch)[1], shot.under > 0);
      [shown, shownV] = spring(shown, shownV, free, free < shown ? LET_IN : LET_OUT, dt);
      // Only when the camera would be inside something does it jump in front of it.
      const inside = shown > free && physics.intersectionWithShape(orbit(look, shot.yaw, shownPitch, shown), rotation, ball, flags,
        undefined, undefined, undefined, blocks);
      if (inside) { shown = free; shownV = 0; }
      camera.position.copyFrom(orbit(look, shot.yaw, shownPitch, shown));
      if (going.level !== undefined) camera.position.y = underWater(camera.position.y, going.level, shot.under);
      // Pulled in close (something in the way), it looks at the beaver itself, so the beaver never leaves the picture.
      const near = Math.min(1, shown / shot.distance);
      const at = look.add(rig.lead.scale(near));
      // The view turned up and to the side of that point by rise and across: the beaver low and left of the middle.
      const ahead = view(camera.position, at, shot.rise, shot.across);
      // Held (src/features/stare): its place across kept, its height easing to the point's, looking at the point; let
      // go, it springs back from there to where it would stand.
      [held, heldV] = spring(held, heldV, hold ? 1 : 0, hold ? HOLD_IN : HOLD_OUT, dt);
      if (hold) heldAt.y += (heldLook.y - heldAt.y) * (1 - Math.exp(-HOLD_SINK * dt));
      if (held > 0.001 || hold) {
        const k = Math.max(0, Math.min(1, held));
        following.copyFrom(camera.position);
        Vector3.LerpToRef(following, heldAt, k, camera.position);
        const to = heldLook.subtract(camera.position).normalize();
        camera.setTarget(Vector3.Lerp(ahead, to, k).normalize().addInPlace(camera.position));
        if (!hold && held <= 0.001) held = heldV = 0;
      } else camera.setTarget(ahead.addInPlace(camera.position));
      if (jolt > 0.01) {
        // Moved after it was aimed, so the whole picture shakes; the lens closes in a little with it.
        camera.position.addInPlaceFromFloats((Math.random() - 0.5) * JOLT * jolt, (Math.random() - 0.5) * JOLT * jolt, (Math.random() - 0.5) * JOLT * jolt);
        camera.fov -= JOLT_FOV * jolt;
        jolt *= Math.exp(-JOLT_EASE * dt);
      }
    },
  };
  // Drag to orbit, wheel to zoom; the page does not scroll or pan.

  let dragging = -1;
  canvas.addEventListener("pointerdown", (e) => {
    touched++;
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
  // V switches the view: not in a menu or photo mode (both pause), not while typing.
  const switchView = (e: KeyboardEvent) => {
    if (e.code !== "KeyV" || e.repeat || e.altKey || e.ctrlKey || e.metaKey || stage.paused) return;
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
    state.view = seen === "first-person" ? "third-person" : "first-person";
  };
  window.addEventListener("keydown", switchView);
  stage.scene.onDisposeObservable.add(() => window.removeEventListener("keydown", switchView));
  return state;
}
export type FollowCamera = ReturnType<typeof followCamera>;
