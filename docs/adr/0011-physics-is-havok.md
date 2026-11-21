# Physics is Havok, with the beaver's own mover

On 2026-11-20 the maintainer chose Havok (`@babylonjs/havok`, through Babylon's physics v2) over Rapier, which the game had used from the start: "lets migrate completly to havok". The reason given was the features still to come. Before the move it was pointed out that Havok would not make the game's physics code shorter, and that its character controller differs from Rapier's; the maintainer chose the full move anyway.

## What changed with it

- **Queries filter by bitmask only.** Rapier took a filter function for every ray and shape cast (not the beaver, not the stick in its paws, only the ground). Havok takes collision masks. So every shape is in exactly one group (`src/physics.ts`: GROUND, SOLID, LOOSE, HEAVY, PLAYER, CREATURE), and each query names the groups it meets. A light stick is LOOSE; a crate or a log is HEAVY, as Rapier's "heavier than 1 kg" filters had it.
- **The beaver has its own mover** (`src/player/mover.ts`), a collide-and-slide over Havok shape casts. Havok's character controller moves by the picture's time (`scene.deltaTime`), not the game's fixed step, and keeps no gap; Rapier's was replaced, not mapped. The swim, climb-out and lodge tests (`src/player/shore.test.ts`) pass on it unchanged.
- **Physics is stepped by the game**, as before: `scene.physicsEnabled` is off, and `run()` steps Havok at STEP. Dynamic bodies move their nodes after each step, so the copy from body to mesh is gone.
- **A body taken out of the world** (a stick in someone's paws) is put in no group and held still (`enable`): Havok bodies cannot be switched off as Rapier's could.
- **The ground is two heightfields.** Havok stores a triangle mesh compressed, a centimetre off the drawn ground, so the fine patch by the pond is a heightfield too. It is square, because Babylon reorders a heightfield's samples for Havok the right way only for a square one.
- **Rapier's sleep watch is gone**: Havok puts a resting body to sleep by itself.

## What was not taken

Babylon's `PhysicsCharacterController`, for the reason above. Keeping Rapier for the beaver beside Havok for the rest: two worlds to keep in step.
