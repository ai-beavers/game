// A visitor who has never played: the hints and the stick marker. Stream false: the live stream leaves it out.
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

export const firstSteps = (kit: Kit): Station[] => {
  const { player, stage, frame, until, tap, walkTo, expect, hudText, loose, pickUp } = kit;
  return [
    // A visitor who has never played (src/features/hud): the walk hint, then the look hint, each gone once done; a
    // marker over the nearest stick until one is picked up.
    ["First steps", async () => {
      const hud = (window as { hud?: { fresh(steps?: string[]): void } }).hud ?? skip("no HUD");
      if (player.carrying) { await tap("act"); await until(() => !player.carrying, 3, "could not let go of the stick in the hand"); }
      hud.fresh();
      await frame(); await frame();
      const marker = () => stage.hud.getControlByName("first-marker"), hint = () => hudText("input-hints");
      expect(hint().includes("walk"), `a new player is shown "${hint()}", not how to walk`);
      if (loose().length) expect(player.offer() ? !marker()?.isVisible : !!marker()?.isVisible && hudText("first-marker").startsWith("Stick"), "no marker over a stick for a new player");
      await walkTo(player.feet.x + 2.5, player.feet.z + 2.5);
      await until(() => !hint().includes("walk"), 2, "walked 3 m, the walk hint stays");
      // The tour's camera swings round behind a walking beaver, which counts as a look: the look is asked for afresh.
      hud.fresh(["look"]);
      await frame(); await frame();
      expect(hint().includes("look around"), `walked, then "${hint()}" instead of how to look around`);
      player.camera.turn(1, 0);
      await until(() => !hint().includes("look around"), 2, "looked around, the look hint stays");
      if (!loose().length) return; // every stick is in the dam and the lodge: nothing to mark or pick up
      await pickUp();
      await frame(); await frame();
      expect(!marker()?.isVisible || !hudText("first-marker").startsWith("Stick"), "a stick in the hand, the stick marker stays");
    }, undefined, false],
  ];
};
