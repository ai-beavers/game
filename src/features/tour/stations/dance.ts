// Dance (a viewer's wish): out to the Dance floor by the bank with empty paws, stand still on it, and the beaver
// dances by itself and hears the beat; step off it and the dance stops. Any hour, any weather: the floor is always
// there. A stick in the paws is put down first, a good in the paw put away (slot 1).
import { FLOOR } from "../../dance-floor/place.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the dance floor feature puts on window for tools (src/features/dance-floor/index.ts); only the part the tour needs. */
interface DanceFloorDebug { state: { on: boolean; dancing: boolean; loudness: number } }

export const dance = (kit: Kit): Station[] => {
  const { player, live, until, expect, walkTo, wait, key, world } = kit;
  return [
    ["Dance", async () => {
      const floor = (window as { danceFloor?: DanceFloorDebug }).danceFloor ?? skip("no dance floor feature");
      const state = () => floor.state, held = () => (window as { trade?: { held?: string } }).trade?.held;
      // 1. Empty paws: a stick put down, a good back in the backpack.
      if (player.carrying) {
        if (!player.putDown()) return skip("a stick in the paws, and it cannot be set down here");
        await until(() => !player.carrying, 2, "set the stick down, it is still in the paws");
      }
      if (held() !== undefined) {
        key("Digit1");
        await until(() => held() === undefined, 3, () => `pressed 1, still ${held()} in the paw`);
      }
      // 2. Out to the floor and onto its middle, then stand still.
      await walkTo(FLOOR.x, FLOOR.z, { run: 1, near: 0.5, hop: true, limit: 120 });
      expect(state().on, `walked to the dance floor, but stands at ${player.feet.x.toFixed(1)}, ${player.feet.z.toFixed(1)}, off it`);
      expect(player.feet.y - world.heightAt(player.feet.x, player.feet.z) < 0.1, "on the dance floor the feet stand high over the ground: a step up");
      await until(() => state().dancing, 3, "stood still on the dance floor with empty paws for 3 s, the beaver does not dance");
      expect(player.motion.low === "dance", `dancing, yet the Motion others see says ${player.motion.low ?? "standing"}`);
      expect(state().loudness > 0, "dancing on the floor, the beat is silent");
      await wait(live ? 8 : 0.5); // live: a while dancing, for the stream
      expect(state().dancing, "the dance stopped by itself while the beaver stood still");
      // 3. Off the floor to the east, towards the bank: the dance stops as it moves and stays stopped beside it.
      await walkTo(FLOOR.x + FLOOR.half + 1.2, FLOOR.z, { near: 0.3, limit: 15 });
      expect(!state().on, "walked off the dance floor, still on it");
      await wait(1);
      expect(!state().dancing && player.motion.low !== "dance", "stood beside the dance floor, still dancing");
    }, "Dance night"],
  ];
};
