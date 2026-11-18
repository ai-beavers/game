// Trading: a stick carried to the trading post and paid in for a pinecone, which goes into the backpack. On the way
// the stick is shown at the building site, where E must still build it into the dam: the post never takes the
// dam's prompt.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { SLOTS } from "../../build/rules.ts";
import { GOODS, offerText, type Ledger } from "../../trade/ledger.ts";
import { FRONT, standAt } from "../../trade/place.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the trade feature puts on window for tools (src/features/trade/index.ts); only the part the tour needs. */
interface TradeDebug { state: Ledger }

export const trading = (kit: Kit): Station[] => {
  const { player, world, live, expect, until, tap, after, last, hudText, needBuild, fetchStick, reach, walkTo, loose } = kit;
  return [
    ["Trade a stick", async () => {
      const b = needBuild(), trade = (window as { trade?: TradeDebug }).trade ?? skip("no trade feature");
      await fetchStick();
      // At the building site with the stick in hand, E still builds: the dam's prompt is the dam's.
      if (!live) {
        const { origin, across } = b.dam.frame, to = origin.subtract(across.scale(1.25)), n = b.state.dam.length;
        kit.subject = () => origin;
        await walkTo(to.x, to.z, { near: 0.4, hop: true });
        const offer = player.offer();
        if (n < SLOTS) expect(offer?.action === "build" && offer.text === "Build into dam", `with a stick at the dam, E would "${offer?.text}", not "Build into dam"`);
        else expect(offer?.action !== "trade", `with a stick at the building site, E would "${offer?.text}"`);
      }
      const spot = GOODS.findIndex((g) => g.id === "pinecone"), stand = standAt(spot), good = GOODS[spot]!.id;
      // Up to the counter from in front of it, as a beaver coming from the meadow does.
      kit.subject = () => stand;
      const approach = new Vector3(stand.x + FRONT.x * 1.4, 0, stand.z + FRONT.z * 1.4);
      await walkTo(approach.x, approach.z, { near: 0.4, hop: true, limit: 60 });
      await reach("trade", () => stand);
      const text = offerText(trade.state, good);
      expect(player.offer()!.text === text, `E offers "${player.offer()!.text}" at the pinecone, not "${text}"`);
      const stick = player.carrying!, owned = trade.state.owned[good] ?? 0, traded = after("goodTraded");
      await tap("act");
      await until(traded, 6, "paid a stick at the pinecone's spot, no pinecone went into the backpack");
      expect(last.goodTraded!.good === good && last.goodTraded!.count === owned + 1, `the backpack got ${last.goodTraded!.good} ×${last.goodTraded!.count}, not ${good} ×${owned + 1}`);
      expect(trade.state.owned[good] === owned + 1, `the backpack holds ${trade.state.owned[good]} pinecones, not ${owned + 1}`);
      expect(!world.sticks.includes(stick) && !loose().includes(stick) && player.carrying !== stick, "the stick paid in is still in the world");
      const line = `Pinecone${owned + 1 > 1 ? ` ×${owned + 1}` : ""}`;
      await until(() => hudText("backpack").includes(line), 2, `the backpack row says "${hudText("backpack")}", not "${line}"`);
      await until(() => (player.motion.reachBack ?? 0) === 0, 3, "the paw stayed at the backpack");
    }, "Trading"],
  ];
};
