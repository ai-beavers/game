// How the beaver's capsule moves through the world: collide and slide over Havok shape casts, at the game's fixed
// step. Havok's own character controller moves by the picture's time and keeps no gap, so the game has its own.
//
//   const mover = createMover(physics, shape, { gap: OFFSET, slope: SLOPE, mass: 12 })
//   const { moved, grounded } = mover.move(centre, wish, snap)   once a step; then the capsule goes to centre + moved
//
// The capsule keeps `gap` from everything; it slides along what it meets, never up a wall steeper than `slope` (it
// may slide down one); with `snap` > 0 it stays on walkable ground that falls away under it by up to that much
// (stairs down, a hill's crest). Loose things in the way are pushed, as hard as a body of `mass` kg would push them.
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { ALL, dynamic, GROUND, type Hit, type Physics, type PhysicsBody, type PhysicsShape, type XYZ } from "../physics.ts";

export interface Collision { body: PhysicsBody | undefined; normal: Vector3; wish: Vector3 }

const ROUNDS = 4, TINY = 1e-5;

export function createMover(physics: Physics, shape: PhysicsShape, options: { gap: number; slope: number; mass: number }) {
  const still = Quaternion.Identity(), walkable = Math.cos(options.slope);
  const at = new Vector3(), rest = new Vector3(), dir = new Vector3(), side = new Vector3(), moved = new Vector3(), out = new Vector3();
  const collisions: Collision[] = [];
  const down = { x: 0, y: -1, z: 0 };
  // A cast over the ground's heightfields meets the edges between its cells and tells their normal, steep where the
  // ground is flat (measured): the face's own normal, from a ray down at the hit, is the one the mover goes by.
  const surface = (hit: Hit) => {
    if (hit.shape?.filterMembershipMask !== GROUND) return hit.normal.normalize();
    const face = physics.ray({ x: hit.point.x, y: hit.point.y + 0.1, z: hit.point.z }, down, 0.2, GROUND);
    return (face ?? hit).normal.normalize();
  };
  const groundUnder = (from: XYZ, distance: number, mask: number) => {
    const hit = physics.cast(shape, still, from, down, distance, mask);
    return hit && surface(hit).y >= walkable ? hit : undefined;
  };

  return {
    /** What the last move ran into. */
    collisions,
    /** Moves the capsule centred at `from` by `wish` (m) among `mask`: how far it got (`out` of it: pushed off
     *  what it touched, to keep the gap), and whether it stands. */
    move(from: XYZ, wish: XYZ, snap: number, mask = ALL, dt = 1 / 60) {
      collisions.length = 0;
      out.setAll(0);
      at.set(from.x, from.y, from.z);
      rest.set(wish.x, wish.y, wish.z);
      const wishV = new Vector3(wish.x, wish.y, wish.z), climbing = wish.y > 0;
      for (let round = 0; round < ROUNDS; round++) {
        const length = rest.length();
        if (length < TINY) break;
        dir.copyFrom(rest).scaleInPlace(1 / length);
        const hit = physics.cast(shape, still, at, dir, length + options.gap, mask);
        if (!hit) { at.addInPlace(rest); break; }
        const n = surface(hit), into = -Vector3.Dot(dir, n);
        // As far as keeps `gap` from the surface along its normal; then out along the normal by what is missing (a
        // slant way in leaves it closer than that).
        const slant = Math.max(into, 1e-3), travel = Math.max(0, Math.min(length, hit.distance - options.gap / slant));
        const away = n.scale(Math.max(0, options.gap - (hit.distance - travel) * slant));
        at.addInPlace(dir.scale(travel)).addInPlace(away);
        out.addInPlace(away);
        collisions.push({ body: hit.body, normal: n.clone(), wish: wishV });
        if (hit.body && dynamic(hit.body) && into > 0) {
          // A push up to the speed it walks into it with, by no more than `mass` kg could give.
          const need = length / dt * into - Vector3.Dot(hit.body.getLinearVelocity(), dir);
          const mass = Math.min(options.mass, hit.body.getMassProperties().mass ?? 1);
          if (need > 0) hit.body.applyImpulse(dir.scale(mass * need), hit.point);
        }
        rest.scaleInPlace((length - travel) / length);
        // Along the surface; but where that goes up ground too steep to walk (a wall), only along the wall, level:
        // it slides down a steep bank (falling or diving onto it), never up one.
        side.copyFrom(rest).subtractInPlace(n.scale(Vector3.Dot(rest, n)));
        if (n.y < walkable && !climbing && side.y > 0) {
          side.set(n.x, 0, n.z);
          if (side.lengthSquared() > TINY) side.normalize();
          rest.subtractInPlace(side.scale(Vector3.Dot(rest, side)));
          rest.y = Math.min(rest.y, 0);
        } else rest.copyFrom(side);
      }
      // Kept on walkable ground that falls away under it.
      if (snap > 0 && !climbing) {
        const below = groundUnder(at, snap + options.gap, mask);
        if (below) at.y -= Math.max(0, below.distance - options.gap);
      }
      moved.set(at.x - from.x, at.y - from.y, at.z - from.z);
      const grounded = !climbing && !!groundUnder(at, options.gap * 2 + 0.01, mask);
      return { moved, grounded, out };
    },
  };
}
