// Sitting and crawling on land: C held sits the beaver on its haunches (the pond's Dive station keeps C diving
// afloat), Y held crawls it low on all fours, slower than walking, Shift or not. Both stand up again when let go.
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { WALK_SPEED } from "../../../contracts.ts";
import type { Kit } from "../kit.ts";
import type { Station } from "../live.ts";

const ACTIVITY = "Sit and crawl";
const LOWER = 0.04; // m the hips must go down to count as low

export const sitAndCrawl = (kit: Kit): Station[] => {
  const { player, world, beaver, live, want, wait, until, walkTo, flat, expect } = kit;
  const hipsBone = () => beaver.root.getDescendants(false, (n) => n.name === "hips")[0] as TransformNode | undefined;
  /** m the hips are above the feet in this picture. */
  const hips = () => {
    const bone = hipsBone();
    expect(!!bone, "the beaver has no hips bone");
    bone!.computeWorldMatrix(true);
    return bone!.getAbsolutePosition().y - player.feet.y;
  };
  const speed = () => Math.hypot(player.velocity.x, player.velocity.z);
  /** Out of the pond and standing still on land, then the hips' height standing. */
  const ashore = async () => {
    if (player.afloat) await walkTo(world.spawn.x, world.spawn.z, { arrived: () => !player.afloat, limit: 40 });
    await wait(0.8);
    expect(!player.afloat && player.motion.grounded, "wanted to start on land, still afloat or in the air");
    return hips();
  };
  const standsAgain = async (standing: number, key: string) => {
    await until(() => hips() > standing - 0.015, 1.5, `let go of ${key}, the hips stay low (${hips().toFixed(3)} m, standing ${standing.toFixed(3)} m)`);
    expect(player.motion.low === undefined, `let go of ${key}, the beaver still says it is ${player.motion.low}`);
  };
  return [
    ["Sit down", async () => {
      const standing = await ashore();
      want.dive = true;
      try {
        await wait(live ? 6 : 1); // live: long enough to see it sit, breathe and look round
        expect(player.motion.low === "sit", `held C on land, the beaver is not sitting (${player.motion.low ?? "standing"})`);
        expect(hips() < standing - LOWER, `held C on land, the hips are at ${hips().toFixed(3)} m, standing ${standing.toFixed(3)} m: not sitting`);
        expect(speed() < 0.05, `sitting, yet moving at ${speed().toFixed(2)} m/s`);
      } finally { want.dive = false; }
      await standsAgain(standing, "C");
    }, ACTIVITY],
    ["Crawl", async () => {
      const standing = await ashore();
      // Away from wherever it stands, over ground the walking station takes too.
      const to = flat(world.spawn.x, world.spawn.z) > 1.5 ? world.spawn : { x: world.spawn.x + 1, z: world.spawn.z + 3 };
      let top = 0, low = Infinity, done = false;
      const crawling = () => {
        if (player.motion.low === "crawl") { top = Math.max(top, speed()); low = Math.min(low, hips()); }
        return done;
      };
      want.crawl = true;
      try {
        // Y and W held, Shift too (a crawl stays a crawl), for two seconds of the game's time (live: longer, to be seen)
        const time = wait(live ? 5 : 2).then(() => { done = true; });
        await walkTo(to.x, to.z, { run: 1, near: 0.3, arrived: crawling, limit: 20 });
        await time;
        expect(low < standing - LOWER, `held Y and W on land, the hips stay at ${low.toFixed(3)} m, standing ${standing.toFixed(3)} m: not crawling`);
        expect(top > 0.1, `held Y and W, the beaver crawled at ${top.toFixed(2)} m/s: not moving`);
        expect(top < WALK_SPEED * 0.8, `crawling with Shift at ${top.toFixed(2)} m/s, not slower than walking (${WALK_SPEED} m/s)`);
        await wait(live ? 2 : 0.5); // held without moving: it stays low, ready to crawl on
        expect(player.motion.low === "crawl" && hips() < standing - LOWER, "held Y standing still, the beaver got up");
      } finally { want.crawl = false; }
      await standsAgain(standing, "Y");
    }, ACTIVITY],
  ];
};
