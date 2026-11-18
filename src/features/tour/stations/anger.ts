// The furious beaver: anger at its height, it runs.
import type { Kit } from "../kit.ts";
import type { Station } from "../live.ts";

export const anger = (kit: Kit): Station[] => {
  const { player, world, beaver, live, walkTo, expect } = kit;
  return [
    ["Furious beaver", async () => {
      player.setAnger(1);
      try {
        // Live it runs home from wherever it is; otherwise it starts at home (settle) and runs out over the grass.
        await walkTo(world.spawn.x + (live ? 0 : 3), world.spawn.z + (live ? 0 : 3), { run: 1, limit: 25 });
        expect(beaver.anger > 0.9, `anger ${beaver.anger.toFixed(2)}, not furious`);
      } finally { player.setAnger(0); }
    }],
  ];
};
