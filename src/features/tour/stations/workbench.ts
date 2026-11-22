// Crafting: a feather and a shell made into a charm at the workbench. Goods the backpack lacks are bought first at the
// trading post with sticks, as a player buys them; then E at the bench, the two goods used up, the charm into the
// backpack over the shoulder, on the hotbar, and into the paw from its slot. Last, with a good missing, the bench says
// what it needs. It plays in the tour's own saved goods ("beaver.trade.tour"), never a player's.
import { missing, POST_GOODS, type Ledger } from "../../trade/ledger.ts";
import { shelf } from "../../trade/hold.ts";
import { FRONT as POST_FRONT, standAt } from "../../trade/place.ts";
import { FRONT, STAND } from "../../workbench/place.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the trade and workbench features put on window for tools; only the part the tour needs. */
interface TradeDebug { state: Ledger; held: string | undefined }
interface WorkbenchDebug { state: { charms: number; making: boolean } }

export const crafting = (kit: Kit): Station[] => {
  const { player, expect, until, tap, key, after, last, hudText, needBuild, fetchStick, reach, walkTo } = kit;
  const owned = (l: Ledger, id: string) => l.owned[id] ?? 0;
  /** The hotbar's slot of a good owned: slot 1 is the stick, the goods follow in the goods list's order. */
  const slotOf = (l: Ledger, id: string) => shelf(l).indexOf(id) + 2;
  return [
    ["Make a charm", async () => {
      needBuild();
      const trade = (window as { trade?: TradeDebug }).trade ?? skip("no trade feature");
      const bench = (window as { workbench?: WorkbenchDebug }).workbench ?? skip("no workbench feature");
      const ledger = () => trade.state;

      // 1. A feather and a shell, bought with sticks at the trading post when the backpack lacks one.
      for (const good of missing(ledger(), "charm")) {
        const spot = POST_GOODS.findIndex((g) => g.id === good), stand = standAt(spot);
        while (!owned(ledger(), good)) {
          await fetchStick();
          await walkTo(stand.x + POST_FRONT.x * 1.4, stand.z + POST_FRONT.z * 1.4, { near: 0.4, hop: true, limit: 60 });
          await reach("trade", () => stand);
          const paid = ledger().paid[good] ?? 0;
          await tap("act");
          await until(() => !player.carrying, 3, `pressed E at the ${good}'s spot, the stick stayed in the paw`);
          await until(() => owned(ledger(), good) > 0 || (ledger().paid[good] ?? 0) > paid, 3, `paid a stick at the ${good}'s spot, its pile did not grow`);
        }
        await until(() => !player.motion.reachBack, 4, "the paw stayed at the backpack");
      }

      // 2. Up to the bench from its working side with empty paws: E offers the charm and what it uses.
      const walk = async () => {
        await walkTo(STAND.x + FRONT.x * 1.4, STAND.z + FRONT.z * 1.4, { near: 0.4, hop: true, limit: 60 });
        await reach("use", () => STAND);
      };
      await walk();
      const text = "Make a charm (feather + shell)";
      expect(player.offer()?.text === text, `E offers "${player.offer()?.text}" at the workbench, not "${text}"`);

      // 3. E: the goods are used up and the charm is made; it goes over the shoulder into the backpack.
      const before = { feather: owned(ledger(), "feather"), shell: owned(ledger(), "shell"), charm: owned(ledger(), "charm") };
      const made = after("goodTraded");
      await tap("act");
      await until(() => bench.state.making, 2, "pressed E at the workbench, no charm is being made");
      expect(player.offer()?.text?.startsWith("Make") !== true, "the bench offers another charm while one is being made");
      await until(made, 8, "the charm was made, none went into the backpack");
      expect(last.goodTraded!.good === "charm" && last.goodTraded!.count === before.charm + 1, `the backpack got ${last.goodTraded!.good} ×${last.goodTraded!.count}, not charm ×${before.charm + 1}`);
      await until(() => !bench.state.making && !player.motion.reachBack, 4, "the paw stayed at the backpack");

      // 4. The hotbar: the charm counted one up, the feather and the shell one down each (gone at none).
      const now = ledger();
      expect(owned(now, "charm") === before.charm + 1 && owned(now, "feather") === before.feather - 1 && owned(now, "shell") === before.shell - 1,
        `the backpack holds ${owned(now, "charm")} charms, ${owned(now, "feather")} feathers, ${owned(now, "shell")} shells (not ${before.charm + 1}, ${before.feather - 1}, ${before.shell - 1})`);
      const charmSlot = slotOf(now, "charm");
      await until(() => hudText(`hotbar-count-${charmSlot}`) === `×${before.charm + 1}`, 2, `the hotbar's charm slot ${charmSlot} says "${hudText(`hotbar-count-${charmSlot}`)}", not "×${before.charm + 1}"`);
      for (const good of ["feather", "shell"] as const) {
        const n = owned(now, good), slot = slotOf(now, good);
        if (n) expect(hudText(`hotbar-count-${slot}`) === `×${n}`, `the hotbar's ${good} slot says "${hudText(`hotbar-count-${slot}`)}", not "×${n}"`);
        else expect(!shelf(now).includes(good), `the hotbar still shows a ${good}, though none is left`);
      }

      // 5. Its slot's key brings the charm out of the backpack into the paw.
      key(`Digit${charmSlot}`);
      await until(() => trade.held === "charm" && !player.motion.reachBack, 5, `pressed ${charmSlot}, the paw holds ${trade.held ?? "nothing"}, not the charm`);

      // 6. With a good missing, the bench says what the charm needs; E there makes nothing. More pairs in the
      //    backpack are made into charms first, so one goes missing.
      while (!missing(ledger(), "charm").length) {
        const turn = after("goodTraded");
        await tap("act");
        await until(turn, 8, "pressed E with a pair still in the backpack, no charm was made");
        await until(() => !bench.state.making && !player.motion.reachBack, 4, "the paw stayed at the backpack");
      }
      await walk();
      const lack = missing(ledger(), "charm").join(" "), needs = lack === "feather" ? "Needs a feather" : lack === "shell" ? "Needs a shell" : "Needs a feather and a shell";
      expect(player.offer()?.text === needs, `with ${missing(ledger(), "charm").join(" and ")} missing the bench says "${player.offer()?.text}", not "${needs}"`);
      const charms = bench.state.charms, still = JSON.stringify(ledger().owned);
      await tap("act");
      await until(() => !player.motion.reachBack, 2, "the paw went to the backpack");
      expect(!bench.state.making && bench.state.charms === charms && JSON.stringify(ledger().owned) === still, "E at the bench with a good missing changed the backpack");
      key("Digit1"); // the charm back into the backpack: the paws free again
      await until(() => trade.held === undefined && !player.motion.reachBack, 5, "pressed 1, the charm stayed in the paw");
    }, "Crafting"],
  ];
};
