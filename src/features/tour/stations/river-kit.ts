// The River kit (src/features/river-kit), as a player meets it: the beaver walks off over the meadow and its child
// comes after it and stops beside it; left standing there, the kit finds something of its own to do; and when the
// beaver runs, the kit runs to keep up; the beaver swims and the kit swims after it; the beaver stays where it is and the kit lies down and falls asleep, wakes
// when the beaver goes, and makes room when the beaver walks right up to it. Where the kit is and what it does come
// from the feature's debug handle: nothing on screen says them.
import { CLOSE, FAR, HURRY, IDLE, NEAR, PAUSE, TIRED, WALK, type Kit as RiverKit } from "../../river-kit/rules.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

export const riverKit = (tools: Kit): Station[] => {
  const { player, world, until, walkTo, expect, flat, sky } = tools;
  const need = () => (window as { riverKit?: RiverKit }).riverKit ?? skip("no river kit feature");
  /** A dry spot `far` m from the beaver, tried round the compass from where it faces (from the `from`-th try on). */
  const spot = (far: number, from = 0) => {
    for (let i = from; i < from + 16; i++) {
      const a = player.facing + i * Math.PI / 8, x = player.feet.x + Math.sin(a) * far, z = player.feet.z + Math.cos(a) * far;
      const dry = [0.25, 0.5, 0.75, 1].every((f) => world.heightAt(player.feet.x + (x - player.feet.x) * f, player.feet.z + (z - player.feet.z) * f) > world.waterLevel + 0.15);
      if (dry && Math.hypot(x, z) < 14) return { x, z };
    }
    return skip("no dry way for a walk from here");
  };
  /** Walks `far` m to a dry spot and waits there for the kit to come up beside the beaver. With something in the
   *  beaver's way, or in the kit's (it cannot follow over a felled tree or a dam), it walks on another way, as a
   *  player would. */
  const walk = async (kit: RiverKit, far: number, options: Parameters<typeof walkTo>[2] = {}, beside: () => void = () => {}) => {
    let stuck: unknown;
    for (let from = 0; from < 16; from += 4) {
      const to = spot(far, from);
      try {
        await walkTo(to.x, to.z, { near: 0.5, limit: 40, ...options });
        return await until(() => { beside(); return flat(kit.x, kit.z) < NEAR + 0.2 && kit.speed === 0; }, 12, `the beaver went ${far} m, the kit is ${flat(kit.x, kit.z).toFixed(1)} m behind (${kit.doing})`);
      } catch (e) { stuck = e; }
    }
    throw stuck;
  };
  /** The kit beside the beaver, to start from. A station starts at the spawn, wherever the last one left the kit: one
   *  left where it finds no way from (shut in behind what was built) is set down behind the beaver. */
  const together = (kit: RiverKit) => until(() => flat(kit.x, kit.z) < FAR + 0.3 && kit.speed === 0, 20, "").catch(() => {
    Object.assign(kit, { x: player.feet.x - Math.sin(player.facing) * 1.2, z: player.feet.z - Math.cos(player.facing) * 1.2, following: false, doing: "stand", time: 0, side: 0, stuck: 0 });
  });
  return [
    ["The kit follows", async () => {
      const kit = need();
      await together(kit);
      await walk(kit, 6);
      // Left standing, it finds something of its own to do.
      await until(() => kit.doing !== "stand", IDLE + 2, `left standing ${IDLE + 2} s, the kit still only stands`);
      // The beaver runs: the kit runs too, and is beside it again.
      let fastest = 0;
      const pace = () => { fastest = Math.max(fastest, kit.speed); };
      await walk(kit, 8, { run: 1, arrived: () => { pace(); return false; } }, pace);
      expect(fastest > WALK, `the beaver ran ${HURRY} m and more ahead, the kit never ran (its fastest: ${fastest} m/s)`);
    }, "Around the clearing"],
    // The beaver swims out into the pond: the kit swims after it, paddles beside it, and is on its feet again on the bank.
    ["The kit swims", async () => {
      const kit = need(), pond = tools.pond ?? skip("no pond");
      await together(kit);
      let swam = false;
      const swum = () => { swam ||= kit.afloat; return false; };
      await walkTo(pond.x, pond.z + tools.clear(), { near: 0.8, limit: 40 }); // out to the middle, where it is deep for the kit too
      expect(player.afloat, "walked out into the pond, yet the beaver does not swim");
      await until(() => kit.afloat && flat(kit.x, kit.z) < NEAR + 0.4 && kit.speed === 0, 20, `the beaver swims in the pond, the kit is ${flat(kit.x, kit.z).toFixed(1)} m off, ${kit.afloat ? "afloat" : "on land"}`);
      expect(kit.doing === "stand", `afloat the kit does not only paddle: it is at ${kit.doing}`);
      await walkTo(world.spawn.x, world.spawn.z, { arrived: () => { swum(); return !player.afloat && flat(world.spawn.x, world.spawn.z) < 1; }, limit: 40 });
      await until(() => { swum(); return !kit.afloat && flat(kit.x, kit.z) < NEAR + 0.4 && kit.speed === 0; }, 20, `the beaver is back on land, the kit is ${flat(kit.x, kit.z).toFixed(1)} m off, ${kit.afloat ? "afloat" : "on land"}`);
    }, "Around the clearing"],
    ["The kit sleeps", async () => {
      const kit = need();
      await together(kit);
      // The beaver stays where it is: the kit lies down, sooner in the dark, and falls asleep.
      const limit = (sky().dark > 0.5 ? TIRED.night : TIRED.day) + 2 * IDLE + PAUSE.sit + PAUSE.lie + 5;
      await until(() => kit.doing === "sleep", limit, `the beaver stood still ${limit} s, the kit never fell asleep (it is at: ${kit.doing})`);
      // The beaver goes: the kit wakes, gets up and is beside it again.
      await walk(kit, 6);
      // The beaver walks right up to where the kit stands: the kit makes room.
      await walkTo(kit.x, kit.z, { near: 0.15, limit: 10 });
      await until(() => flat(kit.x, kit.z) >= CLOSE - 0.02 && kit.speed === 0, 5, `the beaver walked up to the kit, the kit made no room: ${flat(kit.x, kit.z).toFixed(2)} m between them`);
    }, "Around the clearing"],
  ];
};
