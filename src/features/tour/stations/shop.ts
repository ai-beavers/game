// The Shop: walk to it, in through the doorway, Use at the counter, buy the cheapest Outfit there is and wear it,
// then put the default look back on. Played through input as a person would; only the Experience to pay with is
// given to the tour's own saved game (building enough sticks first is too slow for the fast tour).
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Look } from "../../../contracts.ts";
import { DEFAULT, OUTFITS, type ShopState } from "../../shop/rules.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the shop feature puts on window for tools (src/features/shop/index.ts); only the part the tour needs. */
interface ShopDebug {
  state: ShopState;
  give(n: number): number;
  reset(): ShopState;
  door(out?: number): Vector3;
  counter(): Vector3;
  sign(): Vector3;
}

const same = (a: Look, b: Look) => [...a.shirt, ...a.hat].every((v, i) => Math.abs(v - [...b.shirt, ...b.hat][i]!) < 1e-3);

export const shopping = (kit: Kit): Station[] => {
  const { beaver, live, wait, until, walkTo, reach, tap, key, expect, hudText } = kit;
  const panel = () => document.querySelector<HTMLDialogElement>("dialog#shop-panel");
  const button = (label: string) => panel()?.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`) ?? null;
  const experience = () => Number(/(\d+) Experience/.exec(hudText("experience"))?.[1] ?? NaN);
  return [
    ["Buy an outfit", async () => {
      const shop = (window as { shop?: ShopDebug }).shop ?? skip("no shop feature");
      // The cheapest Outfit not owned yet; with all bought, the tour's saved game starts its wardrobe anew.
      if (OUTFITS.every((o) => shop.state.owned.includes(o.id))) shop.reset();
      const pick = OUTFITS.filter((o) => !shop.state.owned.includes(o.id)).sort((a, b) => a.price - b.price)[0]!;
      if (shop.state.experience < pick.price) shop.give(pick.price - shop.state.experience);
      const had = shop.state.experience, wearing = shop.state.wearing, lookBefore = beaver.look;

      // Over land to the doorway (hopped over in the fast tour); live, a look at the sign on the way in.
      const door = shop.door(1.6);
      kit.subject = () => shop.sign();
      await walkTo(door.x, door.z, { near: 0.5, limit: 90, hop: true });
      if (live) await wait(3);
      kit.subject = () => shop.counter();
      const inside = shop.door(-1.5);
      await walkTo(inside.x, inside.z, { near: 0.5, limit: 20 });
      await reach("use", () => shop.counter());
      expect(!panel()?.open, "the shop panel is open before Use was pressed");
      await tap("act");
      await until(() => !!panel()?.open, 2, "pressed Use at the counter, no shop panel opened");
      if (live) await wait(2);
      expect(experience() === had, `the HUD shows ${experience()} Experience, the player has ${had}`);

      const buy = button(`Buy ${pick.name}`);
      expect(!!buy && !buy.disabled, `no button to buy ${pick.name} in the panel (or it is greyed out)`);
      buy!.click();
      await until(() => experience() === had - pick.price, 2, `bought ${pick.name} for ${pick.price}: Experience went from ${had} to ${experience()}`);
      expect(shop.state.owned.includes(pick.id) && shop.state.wearing === pick.id, `${pick.name} is not owned and worn after buying it`);
      expect(!!button(`Wearing ${pick.name}`), `the panel does not say ${pick.name} is worn`);
      const look = beaver.look;
      expect(same(look, { shirt: pick.shirt, hat: pick.hat }) && !same(look, lookBefore), `the beaver's shirt and hat did not change to ${pick.name}'s colours`);
      if (live) await wait(3);

      // Back to the default look, for free.
      const classic = OUTFITS.find((o) => o.id === DEFAULT)!;
      button(`Wear ${classic.name}`)?.click();
      await until(() => same(beaver.look, { shirt: classic.shirt, hat: classic.hat }), 2, "Wear on the default look did not bring its colours back");
      expect(experience() === had - pick.price, "wearing the default look cost Experience");
      expect(wearing === DEFAULT || shop.state.wearing === DEFAULT, "the default is not worn after choosing it");
      key("Escape");
      await until(() => !panel()?.open, 2, "Escape did not close the shop panel");
      expect(!kit.stage.paused, "Escape on the shop panel opened the pause menu as well");
      kit.subject = undefined;
      if (live) {
        const out = shop.door(2.5);
        await walkTo(out.x, out.z, { near: 0.6, limit: 20 });
      }
    }, "Shopping"],
  ];
};
