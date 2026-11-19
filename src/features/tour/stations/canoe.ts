// Canoeing: the canoe on the pond's bank near the spawn. With empty paws beside it E offers "Get in"; in it, the move
// keys paddle it over the pond (never swimming, always at the water's level) round the lodge to the far bank, where E
// gets the beaver out onto dry ground.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the canoe feature puts on window for tools (src/features/canoe/index.ts); only the part the tour needs. */
interface CanoeDebug { place: { x: number; z: number; heading: number }; bank: { x: number; z: number } }

export const canoeing = (kit: Kit): Station[] => {
  const { player, world, want, frame, until, tap, expect, after, last, pond, walkTo, reach, build } = kit;
  return [
    ["Paddle a canoe", async () => {
      if (!pond) return skip("no pond");
      const canoe = (window as { canoe?: CanoeDebug }).canoe ?? skip("no canoe feature");
      if (player.afloat) await walkTo(world.spawn.x, world.spawn.z, { arrived: () => !player.afloat, limit: 40 });
      expect(!player.carrying, "wanted to start with empty paws, a stick in them");
      // 1. Up to the canoe, beside its stern (on the bank where it lies after a reload).
      const place = canoe.place, f = { x: Math.sin(place.heading), z: Math.cos(place.heading) };
      const beside = (side: number) => ({ x: place.x - f.x * 0.6 + f.z * 0.65 * side, z: place.z - f.z * 0.6 - f.x * 0.65 * side });
      await reach("use", (attempt) => beside(attempt % 2 ? -1 : 1), true); // its left, else its right
      // 2. E offers "Get in"; in it goes.
      expect(player.offer()?.text === "Get in", `beside the canoe E would "${player.offer()?.text}", not "Get in"`);
      const sat = after("canoeIn");
      await tap("act");
      await until(sat, 2, "pressed E at the canoe, the beaver never got in");
      expect(player.riding, "got into the canoe, but the player does not ride");
      expect(player.offer()?.text === "Get out", `in the canoe E would "${player.offer()?.text}", not "Get out"`);
      // 3. Paddle round the lodge in the middle to the far bank: across from the bank it lies on after a reload, or back
      // there when it was left across (a round before).
      const start = player.feet.clone(), wet = after("enterWater"), centre = new Vector3(pond.x, 0, pond.z);
      const home = new Vector3(canoe.bank.x, 0, canoe.bank.z), atHome = Vector3.Distance(home, new Vector3(place.x, 0, place.z)) < pond.radius;
      const away = centre.subtract(home).normalize(), aside = new Vector3(-away.z, 0, away.x);
      const middle = build()?.dam.lodgeAt ?? centre, via = middle.add(aside.scale(2));
      const far = atHome ? centre.add(away.scale(pond.radius + 1.5)) : home;
      let off = 0, still = 0, t = 0;
      try {
        for (const [to, last] of [[via, false], [far, true]] as const) {
          want.to = to;
          for (still = 0; ;) {
            const dt = await frame();
            t += dt;
            expect(t < 60, `paddled for 60 s, still at ${player.feet.x.toFixed(1)}, ${player.feet.z.toFixed(1)}`);
            expect(player.riding, "fell out of the canoe on the way");
            off = Math.max(off, Math.abs(player.feet.y - (player.waterLevel ?? 0)));
            const speed = Math.hypot(player.velocity.x, player.velocity.z);
            still = speed < 0.03 ? still + dt : 0;
            if (!last && Math.hypot(to.x - player.feet.x, to.z - player.feet.z) < 0.8) break;
            if (last && still > 0.6 && t > 2) break; // at the shore: the canoe stops there
          }
        }
      } finally { want.to = undefined; }
      const went = Math.hypot(player.feet.x - start.x, player.feet.z - start.z);
      expect(went > pond.radius, `paddled ${went.toFixed(1)} m, not across the pond (${pond.radius} m)`);
      expect(!wet(), "swam on the way: the canoe was left behind");
      expect(off < 0.15, `left the water's level by ${off.toFixed(2)} m on the way`);
      // 4. E by the far bank: out onto dry ground.
      const out = after("canoeOut");
      await tap("act");
      await until(out, 2, "pressed E in the canoe, the beaver never got out");
      expect(last.canoeOut!.outcome === "bank", `by the bank it got out into the ${last.canoeOut!.outcome}`);
      expect(!player.riding, "got out, but the player still rides");
      await until(() => player.motion.grounded && !player.afloat, 1.5, `out on the bank, but not standing on dry ground (afloat: ${player.afloat}; feet ${player.feet.x.toFixed(2)}, ${player.feet.y.toFixed(2)}, ${player.feet.z.toFixed(2)}, ground ${world.heightAt(player.feet.x, player.feet.z).toFixed(2)}, canoe ${canoe.place.x.toFixed(2)}, ${canoe.place.z.toFixed(2)})`);
    }, "Canoeing"],
  ];
};
