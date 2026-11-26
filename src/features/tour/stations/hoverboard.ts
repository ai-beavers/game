// Hoverboarding: the Hoverboard beside the path near the spawn. With empty paws beside it E offers "Step on"; on it,
// the move keys glide it along the path faster than the beaver runs, its feet a hand's width over the ground, and
// straight at the pond it stops at the shore on dry ground. E steps it off beside the board, which stays there.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { RUN_SPEED } from "../../../contracts.ts";
import { PATH } from "../../../world/terrain.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the hoverboard feature puts on window for tools (src/features/hoverboard/index.ts); only the part the tour needs. */
interface BoardDebug { place: { x: number; z: number; heading: number }; home: { x: number; z: number }; hover: number; riding: boolean }

/** m the feet may be off the hover height over the ground: the ground's colliders are finer than heightAt. */
const OFF = 0.07;
/** m of the path to glide along, at least: up it to the building site, then back down to its south end. */
const ALONG = 12;
const [SOUTH, NORTH] = [PATH[0], PATH[3]].map(([x, z]) => new Vector3(x, 0, z)) as [Vector3, Vector3];

export const hoverboarding = (kit: Kit): Station[] => {
  const { player, world, want, frame, until, tap, expect, after, last, pond, walkTo, reach } = kit;
  return [
    ["Ride the hoverboard", async () => {
      const board = (window as { hoverboard?: BoardDebug }).hoverboard ?? skip("no hoverboard feature");
      if (player.afloat) await walkTo(world.spawn.x, world.spawn.z, { arrived: () => !player.afloat, limit: 40 });
      expect(!player.carrying, "wanted to start with empty paws, a stick in them");
      // 1. Up to the board, beside its middle, where it lies now.
      const place = board.place, f = { x: Math.sin(place.heading), z: Math.cos(place.heading) };
      const beside = (side: number) => ({ x: place.x + f.z * 0.6 * side, z: place.z - f.x * 0.6 * side });
      await reach("use", (attempt) => beside(attempt % 2 ? -1 : 1), true); // one side, else the other
      expect(player.offer()?.text === "Step on", `beside the hoverboard E would "${player.offer()?.text}", not "Step on"`);
      // 2. On it.
      const on = after("boardOn");
      await tap("act");
      await until(on, 2, "pressed E at the hoverboard, the beaver never stepped on");
      expect(player.riding && board.riding, "stepped onto the hoverboard, but the player does not ride");
      expect(player.offer()?.text === "Step off", `on the hoverboard E would "${player.offer()?.text}", not "Step off"`);
      // 3. Along the path, up it to the building site, then back down to its south end; 4. straight at the pond, until it stops at the shore.
      const wet = after("enterWater"), knocked = after("boardOff");
      let low = "", top = 0, hover = [Infinity, -Infinity], along = 0, t = 0, still = 0;
      const legs: [Vector3 | undefined, string][] = [[NORTH, "path"], [SOUTH, "path"], [pond ? new Vector3(pond.x, 0, pond.z) : undefined, "pond"]];
      try {
        for (const [to, leg] of legs) {
          if (!to) break;
          want.to = to;
          for (still = 0; ;) {
            const was = player.feet.clone(), dt = await frame();
            t += dt;
            expect(t < 40, `glided for 40 s, still at ${player.feet.x.toFixed(1)}, ${player.feet.z.toFixed(1)}`);
            expect(player.riding && !knocked(), "fell off the hoverboard on the way");
            const step = Math.hypot(player.feet.x - was.x, player.feet.z - was.z);
            if (leg === "path") along += step;
            if (dt > 0) top = Math.max(top, step / dt);
            const over = player.feet.y - world.heightAt(player.feet.x, player.feet.z);
            if (over < hover[0]!) low = `${player.feet.x.toFixed(2)}, ${player.feet.z.toFixed(2)} at ${t.toFixed(2)} s on the ${leg}, ${player.motion.grounded ? "on" : "off"} the ground`;
            hover = [Math.min(hover[0]!, over), Math.max(hover[1]!, over)];
            still = step < 0.002 ? still + dt : 0;
            if (leg === "path" && Math.hypot(to.x - player.feet.x, to.z - player.feet.z) < 1.5) break;
            if (leg === "pond" && still > 0.6) break; // at the shore: it stops there
          }
          if (leg === "path") expect(!wet(), "went into the water gliding along the path");
        }
      } finally { want.to = undefined; }
      expect(along > ALONG, `glided ${along.toFixed(1)} m along the path, not about 15`);
      expect(top > RUN_SPEED, `glided at ${top.toFixed(2)} m/s at most, no faster than running (${RUN_SPEED} m/s)`);
      expect(hover[0]! > board.hover - OFF && hover[1]! < board.hover + OFF, `the feet were ${hover[0]!.toFixed(2)} … ${hover[1]!.toFixed(2)} m over the ground (lowest at ${low}), not about ${board.hover}`);
      if (pond) {
        const level = player.waterLevel ?? -Infinity, ahead = { x: player.feet.x + Math.sin(player.facing), z: player.feet.z + Math.cos(player.facing) };
        expect(!wet() && !player.afloat, "glided into the pond: the hoverboard went over the water");
        expect(world.heightAt(player.feet.x, player.feet.z) > level, "stopped, but over the water");
        expect(world.heightAt(ahead.x, ahead.z) < level, `stopped at ${player.feet.x.toFixed(1)}, ${player.feet.z.toFixed(1)}, not at the shore`);
      }
      // 5. Off it, beside the board, which stays there.
      const stoppedAt = player.feet.clone(), off = after("boardOff");
      await tap("act");
      await until(off, 2, "pressed E on the hoverboard, the beaver never stepped off");
      expect(last.boardOff!.outcome === "step", `stepping off with E it came off "${last.boardOff!.outcome}"`);
      expect(!player.riding && !board.riding, "stepped off, but the player still rides");
      await until(() => player.motion.grounded && !player.afloat, 1.5, `off the hoverboard, but not standing on dry ground (afloat: ${player.afloat})`);
      const left = board.place;
      expect(Math.hypot(left.x - stoppedAt.x, left.z - stoppedAt.z) < 0.3, `the hoverboard lies at ${left.x.toFixed(1)}, ${left.z.toFixed(1)}, not where it was left (${stoppedAt.x.toFixed(1)}, ${stoppedAt.z.toFixed(1)})`);
      expect(Math.hypot(left.x - board.home.x, left.z - board.home.z) > 3, "the hoverboard went back by the spawn");
    }, "Hoverboarding"],
  ];
};
