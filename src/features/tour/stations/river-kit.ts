// The River kit (src/features/river-kit), as a player meets it: the beaver walks off over the meadow and its child
// comes after it and stops beside it; left standing there, the kit finds something of its own to do; and when the
// beaver runs, the kit runs to keep up. Where the kit is and what it does come from the feature's debug handle:
// nothing on screen says them.
import { FAR, HURRY, IDLE, NEAR, WALK, type Kit as RiverKit } from "../../river-kit/rules.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

export const riverKit = (tools: Kit): Station[] => {
  const { player, world, until, walkTo, expect, flat } = tools;
  const need = () => (window as { riverKit?: RiverKit }).riverKit ?? skip("no river kit feature");
  /** A dry spot `far` m from the beaver, tried round the compass from where it faces. */
  const spot = (far: number) => {
    for (let i = 0; i < 16; i++) {
      const a = player.facing + i * Math.PI / 8, x = player.feet.x + Math.sin(a) * far, z = player.feet.z + Math.cos(a) * far;
      const dry = [0.25, 0.5, 0.75, 1].every((f) => world.heightAt(player.feet.x + (x - player.feet.x) * f, player.feet.z + (z - player.feet.z) * f) > world.waterLevel + 0.15);
      if (dry && Math.hypot(x, z) < 14) return { x, z };
    }
    return skip("no dry way for a walk from here");
  };
  return [
    ["The kit follows", async () => {
      const kit = need();
      await until(() => flat(kit.x, kit.z) < FAR + 0.3 && kit.speed === 0, 30, `the kit never came to the beaver: ${flat(kit.x, kit.z).toFixed(1)} m off, ${kit.following ? "on its way" : "standing"}`);
      const to = spot(6);
      await walkTo(to.x, to.z, { near: 0.5, limit: 40 });
      await until(() => flat(kit.x, kit.z) < NEAR + 0.2 && kit.speed === 0, 12, `the beaver walked 6 m, the kit is ${flat(kit.x, kit.z).toFixed(1)} m behind`);
      expect(world.heightAt(kit.x, kit.z) > world.waterLevel, "the kit stands in the water");
      // Left standing, it finds something of its own to do.
      await until(() => kit.doing !== "stand", IDLE + 2, `left standing ${IDLE + 2} s, the kit still only stands`);
      // The beaver runs: the kit runs too, and is beside it again.
      const on = spot(8);
      let fastest = 0;
      await walkTo(on.x, on.z, { run: 1, near: 0.5, limit: 40, arrived: () => { fastest = Math.max(fastest, kit.speed); return false; } });
      await until(() => { fastest = Math.max(fastest, kit.speed); return flat(kit.x, kit.z) < NEAR + 0.2 && kit.speed === 0; }, 12, `the beaver ran 8 m, the kit is ${flat(kit.x, kit.z).toFixed(1)} m behind`);
      expect(fastest > WALK, `the beaver ran ${HURRY} m and more ahead, the kit never ran (its fastest: ${fastest} m/s)`);
    }, "Around the clearing"],
  ];
};
