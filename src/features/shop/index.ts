// The Shop: a small disco-like hut on dry ground in the Clearing, HOUSE OF AI on the sign in front, a café inside.
// Players earn Experience, one for each stick they build in (the dam, the lodge, the food cache); all ever earned
// gives their level on the player card (rules.ts levelOf), and spending does not lower it. The Shopkeeper
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
// · shop.place (where it stands, for the HUD's map) · shop.calendar: the Calendar board's week as drawn (week.ts), the
// House of AI events it was given and give(events) to hand it others (the tour), front(d, along) a spot d m
// in front of it, toBoard(p) a point in its frame (z out of its face).
//
// The Calendar board (calendar.ts) beside the shop shows the real week of the browser's own local date, not the
// Clearing's Day; it is checked about once a minute and redrawn only when the date has changed. The House of AI events
// on it come from the game's own server (EVENTS_PATH, ADR 0006), asked as the game starts and then hourly; a failed
// ask changes nothing. The tour as a test plays without the network: it asks nothing and gives the board its own events;
// the live tour asks like a player, so the stream shows the real ones.
import type { CreateFeature } from "../../game.ts";
import type { Actor, Offer } from "../../player/index.ts";
import { buildShop, COUNTER, KEEPER_Z } from "./building.ts";
import { shopkeeper, workers } from "./creatures.ts";
import { EVENTS_PATH } from "../net/protocol.ts";
import { calendarBoard } from "./calendar.ts";
import { readEvents, type HouseEvent } from "./feed.ts";
import { shopHud } from "./panel.ts";
import { buy, earn, load, outfit, wear, type OutfitId, type ShopState } from "./rules.ts";
import { RADIUS, SHOP, SIGN } from "./place.ts";

export { SHOP };

const PARAMS = new URLSearchParams(location.search);
const KEY = PARAMS.has("tour") ? "beaver.shop.tour" : "beaver.shop";
/** The tour as a test plays without the network and gives the board its own events; the live tour (the stream, as
 *  tour/kit.ts tells it: live and no named station) asks the server like a player. */
const OFFLINE = PARAMS.has("tour") && !(PARAMS.get("tour") === "live" && !PARAMS.has("station"));
const ASK_EVENTS = 3_600_000; // ms between asking the server for the House of AI events
const FACING = Math.atan2(0 - SHOP.x, 2 - SHOP.z);
const NEAR = 28; // m: within this the creatures move and the screens scroll
// Cost per frame: the bulbs' and lamps' colours and the ball's turn (a few numbers); a canvas texture uploaded a few
// times a second, the mirror ball's (at night) and each laptop screen's (near). settings.quality low uploads none.

export const create: CreateFeature = async (game) => {
  const { stage, world, player, beaver, events, settings } = game;
  let lively = true;
  stage.scene.onDisposeObservable.add(settings.on(({ quality }) => { lively = quality !== "low"; }));
  const shop = buildShop(stage, world, { ...SHOP, facing: FACING });
  const crowd = workers(stage, shop.root);
  const calendar = calendarBoard(stage, shop, new Date());
  let checked = Date.now(), asked = -Infinity;
  const askEvents = () => {
    asked = Date.now();
    void fetch(EVENTS_PATH).then((r) => (r.ok ? r.json() : undefined)).then((json) => {
      const events = readEvents(json);
      if (events) calendar.give(events);
    }).catch(() => { /* offline or no server: the board keeps what it has */ });
  };
  let state: ShopState = load(localStorage.getItem(KEY));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* not kept, still played */ } };
  const dress = () => { const o = outfit(state.wearing); beaver.look = { shirt: [...o.shirt], hat: [...o.hat] }; };
  dress();
  const hud = shopHud(stage, {
    buy(id: OutfitId) { if (buy(state, id)) { save(); dress(); hud.show(state); } },
    wear(id: OutfitId) { if (wear(state, id)) { save(); dress(); hud.show(state); } },
    close: () => hud.close(),
  }, () => settings.values.name);
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
      sign: () => shop.toWorld(SIGN.x, 1.5, SIGN.z),
      calendar: {
        get week() { return calendar.week; },
        get events() { return calendar.events; },
        give: (events: HouseEvent[]) => calendar.give(events),
        front: calendar.front, toBoard: calendar.toBoard,
      },
    },
  });

  return {
    update(dt) {
      const moving = stage.paused ? 0 : dt, feet = player.feet, inside = shop.inside(feet);
      shop.update(moving, game.sky?.dark ?? 0, inside, lively);
      calendar.update(game.sky?.dark ?? 0);
      // The real clock, not the game's: a new local date turns the board to it (and on a Monday to the new week).
      if (Date.now() - checked > 60_000) { checked = Date.now(); calendar.show(new Date()); }
      if (!OFFLINE && Date.now() - asked > ASK_EVENTS) askEvents();
      if (Math.hypot(feet.x - SHOP.x, feet.z - SHOP.z) < NEAR) { crowd.update(moving, lively); keeper?.update(moving); }
      if (hud.isOpen && !atCounter()) hud.close(); // walked away
      hud.update(dt);
    },
  };
};
