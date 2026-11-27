// Switch on the lightbulb (a viewer's wish): the bare bulb on its crooked post beside the workbench. At the post E
// offers "Pull the cord"; one pull switches the bulb on and it glows, the next switches it off and the glow is gone. It
// needs no sticks or goods, at any hour: the station starts from a bulb switched off.
import { FRONT, STAND } from "../../lightbulb/place.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the lightbulb feature puts on window for tools (src/features/lightbulb/index.ts); only the part the tour needs. */
interface LightbulbDebug { state: { on: boolean; pulling: boolean; glow: number } }

const OFFER = "Pull the cord";

export const lightbulb = (kit: Kit): Station[] => {
  const { player, live, until, tap, expect, walkTo, wait } = kit;
  return [
    ["Switch on the lightbulb", async () => {
      const bulb = (window as { lightbulb?: LightbulbDebug }).lightbulb ?? skip("no lightbulb feature");
      const state = () => bulb.state, offered = () => player.offer()?.text === OFFER;
      // 1. To the post, from the spawn's side, until E would pull the cord.
      await walkTo(STAND.x + FRONT.x * 1.2, STAND.z + FRONT.z * 1.2, { near: 0.4, hop: true, limit: 60 });
      for (let attempt = 0; attempt < 3 && !offered(); attempt++)
        await walkTo(STAND.x, STAND.z, { near: 0.15, arrived: offered, limit: 15 }).catch(() => undefined);
      expect(offered(), `at the lightbulb's post E offers "${player.offer()?.text ?? "nothing"}", not "${OFFER}"`);
      /** E, and the pull played out to its end. */
      const pull = async () => {
        await tap("act");
        await until(() => !state().pulling, 2, "the paw is still at the cord 2 s after the pull");
      };
      // 2. A bulb left on before (a round earlier): off first.
      if (state().on) {
        await pull();
        expect(!state().on, "pulled the cord at a lit bulb, it stayed on");
      }
      // 3. One pull: on, and it glows.
      await pull();
      await until(() => state().on && state().glow > 0, 1, () => `pulled the cord, the bulb is ${state().on ? "on" : "off"} with a glow of ${state().glow.toFixed(2)}`);
      await wait(live ? 4 : 0.3); // live: a while lit, for the stream to see it glow
      expect(offered(), `with the bulb lit E offers "${player.offer()?.text ?? "nothing"}", not "${OFFER}"`);
      // 4. Another: off, no glow.
      await pull();
      await until(() => !state().on && state().glow === 0, 1, () => `pulled the cord again, the bulb is ${state().on ? "on" : "off"} with a glow of ${state().glow.toFixed(2)}`);
    }],
  ];
};
