// The hotbar: a pinecone bought at the trading post, then 2 brings it out of the backpack into the paw and 1 puts it
// back, each with the reach over the shoulder. With the pinecone in the paw, E at a stick puts it back first and picks
// the stick up; 2 with the stick in hand puts the stick down first.
import { POST_GOODS as GOODS, type Ledger } from "../../trade/ledger.ts";
import { FRONT, standAt } from "../../trade/place.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";
import { isEnabled } from "../../../physics.ts";

/** What the trade feature puts on window for tools (src/features/trade/index.ts); only the part the tour needs. */
interface TradeDebug { state: Ledger; held: string | undefined }

export const hotbar = (kit: Kit): Station[] => {
  const { player, expect, until, tap, after, hudText, needBuild, fetchStick, reach, walkTo, key } = kit;
  /** Presses a slot's key; resolves once the reach is over, with the good in the paw then and how far the paw went. */
  const select = async (n: number, wanted: string | undefined, why: string) => {
    let most = 0;
    key(`Digit${n}`);
    await until(() => {
      most = Math.max(most, player.motion.reachBack ?? 0);
      return trade().held === wanted && most > 0.9 && !player.motion.reachBack;
    }, 5, `${why}: the paw holds ${trade().held ?? "nothing"} (reached ${most.toFixed(2)} of the way to the backpack)`);
  };
  const trade = () => (window as { trade?: TradeDebug }).trade ?? skip("no trade feature");
  return [
    ["Hold a good", async () => {
      needBuild();
      const good = "pinecone", spot = GOODS.findIndex((g) => g.id === good), stand = standAt(spot);
      // A pinecone bought as a player buys it: a stick carried to its spot, E.
      await fetchStick();
      await walkTo(stand.x + FRONT.x * 1.4, stand.z + FRONT.z * 1.4, { near: 0.4, hop: true, limit: 60 });
      await reach("trade", () => stand);
      const traded = after("goodTraded");
      await tap("act");
      await until(traded, 6, "paid a stick at the pinecone's spot, no pinecone went into the backpack");
      await until(() => !player.motion.reachBack, 3, "the paw stayed at the backpack");
      expect(hudText("hotbar-count-2").startsWith("×"), `the hotbar's slot 2 says "${hudText("hotbar-count-2")}", not the pinecones' count`);

      await select(2, good, "pressed 2, no pinecone came out of the backpack");
      await select(1, undefined, "pressed 1, the pinecone stayed in the paw");

      // E at a stick with the pinecone in the paw: the pinecone goes back first, then the stick comes up.
      await select(2, good, "pressed 2 again, no pinecone came out");
      await fetchStick();
      expect(!!player.carrying && trade().held === undefined, `E at a stick: ${player.carrying ? "a stick" : "no stick"} in the hand, ${trade().held ?? "nothing"} in the paw`);
      // 2 with the stick in hand: the stick is put down, then the pinecone comes out.
      const stick = player.carrying!;
      await select(2, good, "pressed 2 with a stick in the hand, no pinecone came out");
      expect(!player.carrying && isEnabled(stick.body), "pressed 2 with a stick in the hand, the stick was not put down");
      await select(1, undefined, "pressed 1, the pinecone stayed in the paw");
    }],
  ];
};
