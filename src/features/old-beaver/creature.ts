// What the Old Beaver looks like: a real beaver (loadBeaver), as Mrs. Beaver and the Shopkeeper are, in a dull,
// faded brown coat gone grey on the muzzle, the face and the pale markings (beaver.grey), with no shirt and no hat,
// sitting on his haunches as a player's beaver sits (the animator's "sit"), with only his breath and small idle moves.
//
//   const him = await oldBeaver(stage);   him.beaver.root (place and turn it) · him.update(dt) once a picture, while near
import { createAnimator } from "../../anim/index.ts";
import { loadBeaver } from "../../beaver/index.ts";
import type { Stage } from "../../engine.ts";
import { newMotion } from "../../player/state.ts";

/** His coat, linear RGB: a faded brown, duller than any player's, Mrs. Beaver's or the Shopkeeper's. */
export const COAT: [number, number, number] = [0.15, 0.085, 0.05];

export async function oldBeaver(stage: Stage) {
  const beaver = await loadBeaver(stage.scene);
  beaver.root.name = "old-beaver";
  beaver.coat = COAT;
  beaver.grey = 1;
  beaver.shirt = false;
  beaver.hat = false;
  for (const mesh of beaver.root.getChildMeshes(false)) mesh.isPickable = false;
  const animator = createAnimator(), motion = { ...newMotion(), grounded: true, low: "sit" as const };
  return {
    beaver,
    update(dt: number) {
      motion.time += dt;
      beaver.pose(animator.pose(motion, dt));
      beaver.update(dt);
    },
  };
}
