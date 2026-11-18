// The third-person camera: orbits a point above the beaver's feet, drag to turn it, wheel to zoom (2 … 8 m).
// It never passes through the ground or things: a small ball is cast in Rapier from the beaver to where the camera
// wants to be; when something is in between the camera comes in at once, and goes out again slowly.
//
//   const camera = followCamera(stage, (collider) => true /* which colliders block the view */);
//   camera.update(dt, feet);          once per frame, with the feet where the picture shows them
//   camera.yaw                        the way it looks, for steering relative to it
//   camera.turn(yaw, pitch)           other devices (stick, touch): turn by these radians, pitch kept in range
//   camera.zoom(scale)                distance times scale, kept in 2 … 8 m
//   camera.invertY = true             mouse drag up and down turned round (settings.invertY; the controls feature sets it)
//   camera.aim, camera.floor          look past the beaver, stay above a height (the tour's live view; players leave them)
//
// Mouse and pen drag here; touches are left to whoever handles touch (src/features/controls).
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { RAPIER, type Stage } from "../engine.ts";

const LOOK_HEIGHT = 0.7; // m above the feet
const MIN_DISTANCE = 2, MAX_DISTANCE = 8;
const MIN_PITCH = -0.05, MAX_PITCH = 1.35; // rad above the horizon: even at 8 m the camera stays above the feet
const FOLLOW = 12; // 1/s, how fast the look point catches up
const LET_OUT = 3; // 1/s, how fast the camera goes back out once the view is free
const CLOSE = 1.4; // m: when the view has less room than this, it tries other angles
const TILT = 5; // 1/s, how fast it changes angle for that
const BALL = 0.18; // m, radius of the cast ball: keeps the near plane out of walls

export function followCamera({ camera, physics, canvas }: Stage, blocks: (collider: RAPIER.Collider) => boolean) {
  const look = new Vector3(), direction = new Vector3(), ball = new RAPIER.Ball(BALL);
  const rotation = { x: 0, y: 0, z: 0, w: 1 };
  let started = false, shown = 4, shownPitch = 0.35;
  const freeAt = (yaw: number, pitch: number, distance: number) => {
    direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const hit = physics.castShape(look, rotation, direction, ball, 0, distance, true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, blocks);
    return hit ? Math.max(0.05, hit.time_of_impact - 0.02) : distance;
  };
  const state = {
    yaw: Math.PI, // camera stands at -z of the beaver, looking along +z
    pitch: 0.35,
    distance: 4,
    invertY: false,
    /** Added to the look point for the picture only: the live view's director frames ahead and above the beaver. */
    aim: new Vector3(),
    /** Lowest height the camera may take at x, z; the live view keeps it out of water and reeds, which have no collider. */
    floor: (_x: number, _z: number) => -Infinity,
    /** How far it really is now, after pulling in for things in the way. */
    get shown() { return shown; },
    turn(yaw: number, pitch: number) {
      state.yaw += yaw;
      state.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, state.pitch + pitch));
    },
    zoom(scale: number) {
      state.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, state.distance * scale));
    },
    update(dt: number, feet: Vector3) {
      const goal = direction.set(feet.x, feet.y + LOOK_HEIGHT, feet.z);
      if (!started) { look.copyFrom(goal); started = true; }
      else Vector3.LerpToRef(look, goal, 1 - Math.exp(-FOLLOW * dt), look);
      state.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, state.pitch));
      // Hemmed in (a wall right behind, a ramp overhead): look for a steeper or flatter angle with room, so the
      // camera does not end up inside the beaver's back.
      let aim = state.pitch;
      const room = Math.min(state.distance, CLOSE);
      if (freeAt(state.yaw, aim, state.distance) < room) {
        let best = -Infinity;
        for (let p = MIN_PITCH; p <= MAX_PITCH + 1e-6; p += 0.1) {
          const score = Math.min(room, freeAt(state.yaw, p, state.distance)) - 0.4 * Math.abs(p - state.pitch);
          if (score > best) { best = score; aim = p; }
        }
      }
      shownPitch += (aim - shownPitch) * (1 - Math.exp(-TILT * dt));
      const free = freeAt(state.yaw, shownPitch, state.distance);
      shown = free < shown ? free : Math.min(free, shown + (free - shown) * (1 - Math.exp(-LET_OUT * dt)));
      camera.position.copyFrom(look.add(direction.scale(shown)));
      camera.position.y = Math.max(camera.position.y, state.floor(camera.position.x, camera.position.z));
      // Pulled in close (something in the way), it looks at the beaver itself, so the beaver never leaves the picture.
      camera.setTarget(look.add(state.aim.scale(Math.min(1, shown / state.distance))));
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
