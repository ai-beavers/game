// Running on all fours: with Shift held the beaver drops from walking upright onto its front paws and bounds along,
// long and low, as a beaver runs; let go of Shift and it rises onto its hind legs again.
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Kit } from "../kit.ts";
import type { Station } from "../live.ts";

const LOWER = 0.15; // m the head must come down to count as on all fours

export const runOnAllFours = (kit: Kit): Station[] => {
  const { player, world, beaver, live, wait, until, walkTo, expect } = kit;
  /** m a bone is above the feet in this picture. */
  const above = (name: string) => {
    const bone = beaver.root.getDescendants(false, (n) => n.name === name)[0] as TransformNode | undefined;
    expect(!!bone, `the beaver has no ${name} bone`);
    bone!.computeWorldMatrix(true);
    return bone!.getAbsolutePosition().y - player.feet.y;
  };
  return [
    ["Run on all fours", async () => {
      if (player.afloat) await walkTo(world.spawn.x, world.spawn.z, { arrived: () => !player.afloat, limit: 40 });
      await wait(0.8);
      expect(!player.afloat && player.motion.grounded, "wanted to start on land, still afloat or in the air");
      const head = above("head"), paw = above("hand_L");
      let low = Infinity, pawLow = Infinity, done = false;
      const running = () => {
        if (player.motion.speed > 1.7 && player.motion.grounded) { low = Math.min(low, above("head")); pawLow = Math.min(pawLow, above("hand_L")); }
        return done;
      };
      // Shift held for three seconds of the game's time (live: longer, to be seen), out to the clearing's far side
      const time = wait(live ? 5 : 3).then(() => { done = true; });
      await walkTo(world.spawn.x + 4, world.spawn.z + 1, { run: 1, arrived: running, limit: 20 });
      await time;
      expect(low < head - LOWER, `running, the head stays at ${low.toFixed(2)} m, standing ${head.toFixed(2)} m: not on all fours`);
      expect(pawLow < paw - 0.1, `running, the front paw stays at ${pawLow.toFixed(2)} m, standing ${paw.toFixed(2)} m: not on the ground`);
      await until(() => above("head") > head - 0.05, 2, `stopped running, the head stays at ${above("head").toFixed(2)} m, standing ${head.toFixed(2)} m`);
    }, "Around the clearing"],
  ];
};
