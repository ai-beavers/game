// The Shop: walk to it, in through the doorway, Use at the counter, buy the cheapest Outfit there is and wear it,
// then put the default look back on. Played through input as a person would; only the Experience to pay with is
// given to the tour's own saved game (building enough sticks first is too slow for the fast tour).
// Pick a class: at the same counter, Swimmer, then a swim across the pond timed; Gnawer, then a tree gnawed down with
// its bites timed and counted; then back to no class.
// The Calendar board beside it: walk up the path to it, read the week it shows with Build Fridays and the House of AI
// events the tour gives it (as a test it plays without the network; live, the real ones), and find it solid over its
// whole width.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Look } from "../../../contracts.ts";
import { BITE_TIME, bitesToFell, live as standing } from "../../build/rules.ts";
import { measure } from "../../build/tree.ts";
import { beaverClass, DEFAULT, OUTFITS, type ShopState } from "../../shop/rules.ts";
import { SWIM_SPEED } from "../../../player/state.ts";
import type { HouseEvent } from "../../shop/feed.ts";
import { BUILD_FRIDAYS, dayKey, span, type CalendarEntry, type CalendarWeek } from "../../shop/week.ts";
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
  calendar: {
    week: CalendarWeek; events: readonly HouseEvent[]; give(events: HouseEvent[]): boolean;
    front(d: number, along?: number): Vector3; toBoard(p: { x: number; z: number }): { x: number; z: number };
  };
}

const same = (a: Look, b: Look) => [...a.shirt, ...a.hat].every((v, i) => Math.abs(v - [...b.shirt, ...b.hat][i]!) < 1e-3);

export const shopping = (kit: Kit): Station[] => {
  const { beaver, player, world, game, want, live, frame, wait, until, walkTo, reach, tap, key, expect, hudText, pond, clear, needBuild, standingTrees, fell } = kit;
  const panel = () => document.querySelector<HTMLDialogElement>("dialog#shop-panel");
  const button = (label: string) => panel()?.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`) ?? null;
  // The Experience there is to spend, as the Shopkeeper's panel shows it (the player card shows the level instead).
  const experience = () => Number(/(\d+) Experience/.exec(hudText("shop-experience"))?.[1] ?? NaN);
  /** Over land to the doorway (hopped over in the fast tour), in, and Use at the counter: the panel opens. */
  const toCounter = async (shop: ShopDebug) => {
    const door = shop.door(1.6);
    await walkTo(door.x, door.z, { near: 0.5, limit: 90, hop: true });
    if (live) await wait(3);
    const inside = shop.door(-1.5);
    await walkTo(inside.x, inside.z, { near: 0.5, limit: 20 });
    await reach("use", () => shop.counter());
    expect(!panel()?.open, "the shop panel is open before Use was pressed");
    await tap("act");
    await until(() => !!panel()?.open, 2, "pressed Use at the counter, no shop panel opened");
    if (live) await wait(2);
  };
  const closePanel = async () => {
    key("Escape");
    await until(() => !panel()?.open, 2, "Escape did not close the shop panel");
    expect(!kit.stage.paused, "Escape on the shop panel opened the pause menu as well");
  };
  /** Out of the shop the way it came in, through the doorway: straight from the counter it walks into the wall. */
  const leave = async (shop: ShopDebug) => {
    const inside = shop.door(-1.5), out = shop.door(2.5);
    await walkTo(inside.x, inside.z, { near: 0.5, limit: 20 });
    await walkTo(out.x, out.z, { near: 0.6, limit: 20 });
  };
  /** Presses the class's button in the open panel and sees it marked current, on the player card too, for free. */
  const pickClass = async (shop: ShopDebug, name: string) => {
    const had = experience(), choice = button(`Choose ${name}`);
    expect(!!choice && !choice.disabled, `no button to choose ${name} in the panel (or it is greyed out)`);
    choice!.click();
    await until(() => !!button(`Current: ${name}`), 2, `chose ${name}, the panel does not mark it current`);
    expect(!button(`Choose ${name}`), `${name} is still offered to choose after choosing it`);
    const level = () => hudText("player-level");
    const card = name === "No class" ? /^LV \d+$/ : new RegExp(`^LV \\d+ · ${name}$`);
    await until(() => card.test(level()), 2, () => `chose ${name}, the player card reads "${level()}"`);
    expect(experience() === had, `choosing ${name} changed the Experience from ${had} to ${experience()}`);
    expect((beaverClass(shop.state.class)?.name ?? "No class") === name, `chose ${name}, the saved class is ${shop.state.class}`);
    if (live) await wait(2);
  };
  /** Game seconds since started, counted frame by frame (the fast tour runs FAST times real time). */
  const clock = () => {
    const c = { t: 0, on: true };
    void (async () => { while (c.on) c.t += await frame(); })();
    return c;
  };
  return [
    ["Buy an outfit", async () => {
      const shop = (window as { shop?: ShopDebug }).shop ?? skip("no shop feature");
      // The cheapest Outfit not owned yet; with all bought, the tour's saved game starts its wardrobe anew.
      if (OUTFITS.every((o) => shop.state.owned.includes(o.id))) shop.reset();
      const pick = OUTFITS.filter((o) => !shop.state.owned.includes(o.id)).sort((a, b) => a.price - b.price)[0]!;
      if (shop.state.experience < pick.price) shop.give(pick.price - shop.state.experience);
      const had = shop.state.experience, lookBefore = beaver.look;

      // Over land to the doorway (hopped over in the fast tour); live, a pause there before going in.
      await toCounter(shop);
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
      expect(shop.state.wearing === DEFAULT && !!button(`Wearing ${classic.name}`), "the default is not worn after choosing it");
      expect(!!button(`Wear ${pick.name}`), `${pick.name} is not kept to wear again after taking it off`);
      await closePanel();
      if (live) {
        const out = shop.door(2.5);
        await walkTo(out.x, out.z, { near: 0.6, limit: 20 });
      }
    }, "Shopping"],
    ["Pick a class", async () => {
      const shop = (window as { shop?: ShopDebug }).shop ?? skip("no shop feature");
      if (!pond) return skip("no pond");
      if (shop.state.class !== null) shop.reset(); // a run cut short left one: start as every beaver does
      try {
        await toCounter(shop);
        await pickClass(shop, "Swimmer");
        await closePanel();
        await leave(shop);

        // Into the pond from its west shore and straight across, east: timed once it swims at full speed.
        const z = pond.z - clear(), west = pond.x - pond.radius - 1.2, east = pond.x + pond.radius + 2;
        await walkTo(west, z, { near: 0.6, limit: 60 });
        await walkTo(east, z, { arrived: () => player.afloat, limit: 20 });
        expect(player.afloat, "walked into the pond, never afloat");
        want.to = new Vector3(east, 0, z);
        const time = clock();
        let from: Vector3 | undefined, t0 = 0, swum = 0, took = 0;
        try {
          await until(() => time.t > 0.8, 3, "");
          from = player.feet.clone(); t0 = time.t;
          await until(() => time.t - t0 >= 2 || !player.afloat, 4, "");
          swum = Math.hypot(player.feet.x - from.x, player.feet.z - from.z); took = time.t - t0;
        } finally { want.to = undefined; time.on = false; }
        expect(took > 1.5, `swam only ${took.toFixed(2)} s before landing on the far shore`);
        const speed = swum / took, swimmer = beaverClass("swimmer")!.swimSpeed;
        expect(Math.abs(speed - swimmer) < 0.1, `a Swimmer swims at ${speed.toFixed(2)} m/s, not about ${swimmer} (no class: ${SWIM_SPEED})`);
        if (live) await wait(2);

        // Back at the counter, a Gnawer, and a tree no one has bitten gnawed down: each bite in 0.4 s, as many as ever.
        await walkTo(east, z, { arrived: () => !player.afloat, limit: 20 });
        await toCounter(shop);
        await pickClass(shop, "Gnawer");
        await closePanel();
        await leave(shop);
        const b = needBuild(), tree = standingTrees(b).find((i) => (standing(b.state.trees[i])?.bites ?? 0) === 0) ?? skip("no unbitten tree left");
        const bites: number[] = [], gnawed = clock();
        const off = game.events.on("gnaw", (e) => { if (e.tree === tree) bites.push(gnawed.t); });
        try { await fell(tree); } finally { off(); gnawed.on = false; }
        const need = bitesToFell(measure(world.trees![tree]!).radius);
        expect(bites.length === need, `tree ${tree} fell after ${bites.length} bites, it takes ${need} as without a class`);
        const gnawer = beaverClass("gnawer")!.biteTime, each = (bites.at(-1)! - bites[0]!) / (bites.length - 1);
        expect(Math.abs(each - gnawer) < 0.06, `a Gnawer bites every ${each.toFixed(2)} s, not about ${gnawer} (no class: ${BITE_TIME})`);

        // And back to no class: the card shows only the level, the beaver swims and bites as every beaver.
        await toCounter(shop);
        await pickClass(shop, "No class");
        expect(player.swimSpeed === SWIM_SPEED && game.classEffect?.biteTime === BITE_TIME, `with no class it swims at ${player.swimSpeed} m/s and bites in ${game.classEffect?.biteTime} s, not ${SWIM_SPEED} and ${BITE_TIME}`);
        await closePanel();
        if (live) await leave(shop);
      } finally {
        if (shop.state.class !== null) shop.reset();
      }
    }, "Shopping"],
    ["Read the calendar", async () => {
      const shop = (window as { shop?: ShopDebug }).shop ?? skip("no shop feature");
      const board = shop.calendar;
      // The tour as a test plays without the network: it gives the board House of AI events of this week, on the
      // browser's clock. Live, the board keeps the real ones the server gave it, for the stream.
      const now = new Date();
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7, 12);
      const at = (day: number, hour: number) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day, hour, Math.round((hour % 1) * 60)).toISOString();
      const given: HouseEvent[] = [
        { name: "Evening Talk", start: at(1, 18.5), end: at(1, 21) }, // Tuesday, at half past
        { name: "Night Hackathon", start: at(2, 20), end: at(3, 10) }, // Wednesday into Thursday
        { name: "Workshop", start: at(5, 10), end: at(5, 14) }, // Saturday, two that overlap
        { name: "Lunch Meetup", start: at(5, 12), end: at(5, 16) },
        { name: "build fridays hamburg - work on your startup", start: at(4, 16), end: at(4, 23) }, // Luma lists it too
      ];
      if (!live) board.give(given);

      // Along the path to the shop (hopped over in the fast tour), then up to the board, stopping facing it.
      const door = shop.door(3);
      await walkTo(door.x, door.z, { near: 0.6, limit: 90, hop: true });
      const stand = board.front(3.2), closer = board.front(2.6);
      await walkTo(stand.x, stand.z, { near: 0.4, limit: 20 });
      await walkTo(closer.x, closer.z, { near: 0.3, limit: 10 });
      if (live) await wait(5);

      // The board, 3.6 × 2.1 m.
      const face = kit.stage.scene.getMeshByName("shop-calendar-face");
      expect(!!face, "no Calendar board face in the scene");
      const box = face!.getBoundingInfo().boundingBox, wide = box.extendSize.x * 2 * face!.scaling.x, high = box.extendSize.y * 2 * face!.scaling.y;
      expect(Math.abs(wide - 3.6) < 0.01 && Math.abs(high - 2.1) < 0.01, `the Calendar board is ${wide.toFixed(2)} × ${high.toFixed(2)} m, not 3.6 × 2.1 m`);

      // The week of the browser's own today, Monday first, today marked once.
      const week = board.week, days = week.days;
      const keys = Array.from({ length: 7 }, (_, i) => dayKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i, 12)));
      expect(days.map((d) => d.key).join() === keys.join(), `the board shows ${days.map((d) => d.key).join(", ")}, not the week ${keys[0]} … ${keys[6]}`);
      expect(days[0]!.name === "Mon" && days[6]!.name === "Sun", `the board's week runs ${days[0]!.name} … ${days[6]!.name}, not Mon … Sun`);
      const marked = days.filter((d) => d.today);
      expect(marked.length === 1 && marked[0]!.key === dayKey(now), `today is marked on ${marked.map((d) => d.key).join(", ") || "no day"}, not ${dayKey(now)}`);
      // Build Fridays 16:00 – 23:00 on the Friday, once; each House of AI event on its day at its local time, side by side where they overlap.
      const said = (e: CalendarEntry) => `${e.name} ${span(e)}${e.lanes > 1 ? ` (${e.lane + 1} of ${e.lanes})` : ""}`;
      const fridays = `${BUILD_FRIDAYS.name} ${span(BUILD_FRIDAYS)}`;
      expect(fridays === "Build Fridays 16:00 – 23:00", `Build Fridays is ${fridays}, not 16:00 – 23:00`);
      const read = days.map((d) => d.entries.map(said));
      if (live) {
        // The real events, whatever they are: Build Fridays on the Friday once, and on no other day.
        expect(read.every((d, i) => d.filter((e) => e === fridays).length === (i === 4 ? 1 : 0)), `Build Fridays stands on ${days.map((d, i) => `${d.name} ×${read[i]!.filter((e) => e === fridays).length}`).join(" ")}, not once on Friday`);
      } else {
        expect(board.events.length === given.length, `the board holds ${board.events.length} House of AI events, ${given.length} were given`);
        const expected: string[][] = [[], ["Evening Talk 18:30 – 21:00"], ["Night Hackathon 20:00 – 24:00"], ["Night Hackathon 08:00 – 10:00"],
          [fridays], ["Workshop 10:00 – 14:00 (1 of 2)", "Lunch Meetup 12:00 – 16:00 (2 of 2)"], []];
        expect(read.every((d, i) => d.join("|") === expected[i]!.join("|")), `entries: ${days.map((d, i) => `${d.name} [${read[i]!.join(", ")}]`).join(" ")}; expected ${expected.map((d, i) => `${days[i]!.name} [${d.join(", ")}]`).join(" ")}`);
      }
      // The hours of the day, from morning to midnight, down the board's left.
      const hours = span(week.hours);
      expect(hours === "08:00 – 24:00", `the board shows the hours ${hours}, not 08:00 – 24:00`);
      expect(!!week.title, "the board has no month and year over its week");

      // Straight at it and on, at its middle and near both ends: it stops the beaver in front of its face.
      if (live) return;
      for (const along of [0, -1.5, 1.5]) {
        const before = board.front(2.2, along), behind = board.front(-1.5, along);
        await walkTo(before.x, before.z, { near: 0.3, limit: 15 });
        want.to = new Vector3(behind.x, 0, behind.z);
        try { await wait(4); } finally { want.to = undefined; }
        const p = board.toBoard(player.feet);
        expect(p.z > 0, `the beaver walked through the Calendar board ${along} m from its middle (${p.z.toFixed(2)} m behind its face)`);
        expect(p.z < 0.9 && Math.abs(p.x - along) < 0.6, `the beaver never got up to the Calendar board ${along} m from its middle (at ${p.x.toFixed(2)}, ${p.z.toFixed(2)} m)`);
      }
    }, "Shopping"],
  ];
};
