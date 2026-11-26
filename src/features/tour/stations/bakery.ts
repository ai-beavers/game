// Baking: three sticks carried one by one to the bakery's oven and fed into its fire, the prompt counting them up;
// each stick leaves the world, and after the bake a loaf goes into the backpack.
import { FRONT, STAND } from "../../bakery/place.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the bakery feature puts on window for tools (src/features/bakery/index.ts); only the part the tour needs. */
interface BakeryDebug { state: { paid: number; loaves: number; baking: boolean } }

export const baking = (kit: Kit): Station[] => {
  const { player, world, expect, until, tap, after, last, needBuild, fetchStick, reach, walkTo, loose, wait } = kit;
  return [
    ["Bake a loaf", async () => {
      needBuild();
      const bakery = (window as { bakery?: BakeryDebug }).bakery ?? skip("no bakery feature");
      // A loaf half fed from an earlier round is finished first: the count starts where the saved oven is.
      const loaves = bakery.state.loaves;
      for (let n = bakery.state.paid; n < 3; n++) {
        await fetchStick();
        // Up to the hut from in front of it, as a beaver coming from the spawn does.
        await walkTo(STAND.x + FRONT.x * 1.4, STAND.z + FRONT.z * 1.4, { near: 0.4, hop: true, limit: 60 });
        await reach("trade", () => STAND);
        const text = `Bake a loaf, ${n}/3`;
        expect(player.offer()!.text === text, `E offers "${player.offer()!.text}" at the oven, not "${text}"`);
        const stick = player.carrying!;
        await tap("act");
        await until(() => !player.carrying, 3, "pressed E at the oven, the stick stayed in the paw");
        expect(!world.sticks.includes(stick) && !loose().includes(stick), "the stick fed to the oven is still in the world");
        if (n < 2) await until(() => bakery.state.paid === n + 1, 2, `the oven counts ${bakery.state.paid} sticks, not ${n + 1}`);
      }
      const traded = after("goodTraded");
      await until(() => bakery.state.baking, 2, "the third stick went in, the loaf is not baking");
      expect(player.offer()?.text?.startsWith("Bake") !== true, "the oven offers more while the loaf bakes");
      await wait(1); // it bakes a while: no loaf yet
      expect(!traded(), "the loaf came out of the oven at once");
      await until(traded, 8, "the loaf baked, none went into the backpack");
      expect(last.goodTraded!.good === "loaf" && last.goodTraded!.count === loaves + 1, `the backpack got ${last.goodTraded!.good} ×${last.goodTraded!.count}, not loaf ×${loaves + 1}`);
      expect(bakery.state.loaves === loaves + 1 && bakery.state.paid === 0, `the backpack holds ${bakery.state.loaves} loaves (not ${loaves + 1}), ${bakery.state.paid} sticks in the oven`);
      await until(() => (player.motion.reachBack ?? 0) === 0, 3, "the paw stayed at the backpack");
    }, "Baking"],
  ];
};
