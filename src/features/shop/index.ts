// The Shop: a small disco-like hut on dry ground in the Clearing, HOUSE OF AI on the sign in front, a café inside.
// Players earn Experience, one for each stick they build in (the dam, the lodge, the food cache), and the Shopkeeper
// behind the counter sells Outfits for it: walk in, press Use (E / X / the Use button) at the counter, buy one and the
// beaver wears it at once. Bought Outfits are kept; switching between them, or back to the default look, is free.
//
//   import { create as shop } from "./features/shop/index.ts";     after build in FEATURES (it shares the Use key)
//
// Experience comes from the build feature's event "buildChange": each "place" made here (remote false) is one; other
// players' sticks earn nothing on this browser. The state (rules.ts) is kept in localStorage ("beaver.shop", the
// tour's own "beaver.shop.tour"), beside the build feature's saved game. Remotes keep the default look.
//
// Debug, for bun shot --eval (window.shop): shop.at() stands at the counter · shop.give(n) · shop.state · shop.reset()
// · shop.place (where it stands, for the HUD's map).
import type { CreateFeature } from "../../game.ts";
import type { Actor, Offer } from "../../player/index.ts";
import { buildShop, COUNTER, KEEPER_Z, RADIUS } from "./building.ts";
import { shopkeeper, workers } from "./creatures.ts";
import { shopHud } from "./panel.ts";
import { buy, earn, load, outfit, wear, type OutfitId, type ShopState } from "./rules.ts";

const KEY = new URLSearchParams(location.search).has("tour") ? "beaver.shop.tour" : "beaver.shop";
/** Where the Shop stands: on flat dry ground near the bank, north-west of the building site, its doorway towards
 *  the middle of the Clearing (clear of the Pond, the site and the ways between them and the spawn). */
export const SHOP = { x: -9.5, z: 8.5 };
const FACING = Math.atan2(0 - SHOP.x, 2 - SHOP.z);
const NEAR = 28; // m: within this the creatures move and the screens scroll

export const create: CreateFeature = async (game) => {
  const { stage, world, player, beaver, events } = game;
  const shop = buildShop(stage, world, { ...SHOP, facing: FACING });
  const crowd = workers(stage, shop.root);
  let state: ShopState = load(localStorage.getItem(KEY));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* not kept, still played */ } };
  const dress = () => { const o = outfit(state.wearing); beaver.look = { shirt: [...o.shirt], hat: [...o.hat] }; };
  dress();
  const hud = shopHud(stage, {
    buy(id: OutfitId) { if (buy(state, id)) { save(); dress(); hud.show(state); } },
    wear(id: OutfitId) { if (wear(state, id)) { save(); dress(); hud.show(state); } },
    close: () => hud.close(),
  });
  hud.show(state);
  events.on("buildChange", ({ change, remote }) => {
    if (remote || change.type !== "place") return;
    earn(state, 1);
    save();
    hud.show(state);
  });
  // The Shopkeeper loads her beaver while the game starts; until then the counter stands empty.
  let keeper: Awaited<ReturnType<typeof shopkeeper>> | undefined;
  void shopkeeper(stage, shop.root, KEEPER_Z).then((k) => { keeper = k; });

  /** At the counter, in front of it, inside: where the Shopkeeper can be talked to. */
  const atCounter = () => {
    const p = shop.local(player.feet);
    return shop.inside(player.feet) && Math.abs(p.x) < COUNTER.width / 2 && p.z > COUNTER.z - 0.1 && p.z < COUNTER.z + 1 && !player.afloat;
  };
  // The Use key: the Shopkeeper's, at the counter with free paws; anywhere else whatever the actor before had.
  const before = player.actor;
  const talk: Offer = { action: "use", text: "Talk to the Shopkeeper" };
  const actor: Actor = {
    begin(carrying) {
      if (!carrying && atCounter()) { if (hud.isOpen) hud.close(); else hud.open(); return undefined; }
      return before?.begin(carrying);
    },
    offer(carrying) { return !carrying && atCounter() ? talk : before?.offer?.(carrying); },
    step(dt, held) { return before?.step(dt, held); },
  };
  player.actor = actor;

  Object.assign(window, {
    shop: {
      place: { x: SHOP.x, z: SHOP.z },
      get state() { return state; },
      /** Stands at the counter facing the Shopkeeper. */
      at() {
        const p = shop.toWorld(0, 0, COUNTER.z + 0.5), face = FACING + Math.PI;
        player.teleport(p.x, world.heightAt(p.x, p.z), p.z, face);
        player.camera.yaw = face + Math.PI;
      },
      give(n: number) { earn(state, n); save(); hud.show(state); return state.experience; },
      reset() { state = load(null); save(); dress(); hud.show(state); return state; },
      /** Where the doorway is, outside, and the counter, inside, in the world (for the tour). */
      door: (out = 1.2) => shop.toWorld(0, 0, RADIUS + out),
      counter: () => shop.toWorld(0, 0, COUNTER.z + 0.55),
      sign: () => shop.toWorld(1.6, 1.5, RADIUS + 1.6),
    },
  });

  return {
    update(dt) {
      const moving = stage.paused ? 0 : dt, feet = player.feet, inside = shop.inside(feet);
      shop.update(moving, game.sky?.dark ?? 0, inside);
      if (Math.hypot(feet.x - SHOP.x, feet.z - SHOP.z) < NEAR) { crowd.update(moving); keeper?.update(moving); }
      if (hud.isOpen && !atCounter()) hud.close(); // walked away
      hud.update(dt);
    },
  };
};
