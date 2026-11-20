// Levels: a stick built into the dam (or onto the lodge) earns one Experience, and the player card shows it: the bar's
// "x / y XP" one further, or the next level ("LV n") with the bar empty again. Played as a player would; the expected
// numbers come from the shop's rules (levelOf), the card's text from the screen.
import { LODGE, SLOTS } from "../../build/rules.ts";
import { levelOf, type ShopState } from "../../shop/rules.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

export const levels = (kit: Kit): Station[] => {
  const { until, expect, hudText, needBuild, buildUpTo } = kit;
  const card = () => `${hudText("player-level")} · ${hudText("player-xp")}`;
  const reads = (earned: number) => { const l = levelOf(earned); return `LV ${l.level} · ${l.into} / ${l.need} XP`; };
  return [
    ["Earn Experience", async () => {
      const shop = (window as { shop?: { state: ShopState } }).shop ?? skip("no shop feature");
      const b = needBuild(), n = b.state.dam.length;
      if (n >= SLOTS + LODGE) return skip("the dam and the lodge stand: nothing to build here");
      const earned = shop.state.earned, spend = shop.state.experience;
      await until(() => card() === reads(earned), 2, `the player card reads "${card()}", the player has earned ${earned} Experience`);
      await buildUpTo(n + 1, n >= SLOTS);
      expect(shop.state.earned === earned + 1 && shop.state.experience === spend + 1,
        `one stick built in: Experience went ${spend} → ${shop.state.experience}, all earned ${earned} → ${shop.state.earned}`);
      await until(() => card() === reads(earned + 1), 2, `a stick built in, the player card reads "${card()}", not "${reads(earned + 1)}"`);
    }, "Dam work"],
  ];
};
