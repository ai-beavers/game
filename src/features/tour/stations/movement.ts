// Walking, running and jumping round the clearing, and a run out to its far meadow.
import type { Kit } from "../kit.ts";
import type { Station } from "../live.ts";

export const movement = (kit: Kit): Station[] => {
  const { player, world, walkTo, expect, after, tap, wait } = kit;
  return [
    ["Walk", async () => {
      const steps = after("footstep");
      await walkTo(world.spawn.x + 1, world.spawn.z + 3);
      expect(steps(), "walked without a footstep");
    }, "Around the clearing"],
    ["Run", async () => {
      let top = 0;
      const fast = () => { top = Math.max(top, player.motion.speed); return false; };
      await walkTo(world.spawn.x + 4, world.spawn.z + 1, { run: 1, arrived: fast });
      expect(top > 1.5, `top speed ${top.toFixed(2)} m/s, not running`);
    }, "Around the clearing"],
    ["Jump", async () => {
      const jumped = after("jump"), landed = after("land");
      for (let i = 0; i < 3; i++) { await tap("jump", 0.3); await wait(0.7); }
      expect(jumped() && landed(), "no jump, or no landing");
    }, "Around the clearing"],
    ["Walk to the bank", async () => {
      // Due south, away from where the sun sets: 28 m out, where the first clearing's bank stood 4 m high.
      const x = 0, z = -28;
      await walkTo(x, z, { run: 1, near: 1, limit: 60 });
      const out = Math.hypot(player.feet.x, player.feet.z), high = world.heightAt(player.feet.x, player.feet.z);
      expect(out > 26.5, `only ${out.toFixed(1)} m from the middle`);
      expect(high < 1, `the ground ${out.toFixed(1)} m out is ${high.toFixed(2)} m high, not low meadow`);
    }, "Around the clearing"],
  ];
};
