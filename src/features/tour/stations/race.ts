// A race: in the canoe across the start line off its bank, round every buoy in order for three laps, and across the
// line again; the race card shows the lap and the time, and at the finish the time and the best time. Out of the canoe
// the race card is gone.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { LAPS } from "../../race/rules.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

type P = { x: number; z: number };
/** What the canoe and race features put on window for tools (src/features/canoe, src/features/race); only the part
 *  the tour needs. */
interface CanoeDebug { place: P & { heading: number }; riding: boolean }
interface RaceDebug {
  course: { buoys: P[]; start: { a: P; b: P; middle: P; forward: P } };
  state: { kind: "idle" | "racing" | "finished"; lap?: number; next?: number };
  best?: number;
}

export const racing = (kit: Kit): Station[] => {
  const { player, world, game, want, frame, until, tap, expect, after, last, pond, walkTo, reach, hudText, stage } = kit;
  const shown = () => !!stage.hud.getControlByName("race-card")?.isVisible;
  return [
    ["Race the canoe", async () => {
      if (!pond) return skip("no pond");
      const canoe = (window as { canoe?: CanoeDebug }).canoe ?? skip("no canoe feature");
      const race = (window as { race?: RaceDebug }).race ?? skip("no race feature");
      const { buoys, start } = race.course, n = buoys.length;
      if (player.afloat) await walkTo(world.spawn.x, world.spawn.z, { arrived: () => !player.afloat, limit: 40 });
      expect(!player.carrying, "wanted to start with empty paws, a stick in them");
      expect(!shown(), "the race card is up before any race");
      // 1. Into the canoe, beside its stern, as the "Paddle a canoe" station does.
      const place = canoe.place, f = { x: Math.sin(place.heading), z: Math.cos(place.heading) };
      const beside = (side: number) => ({ x: place.x - f.x * 0.6 + f.z * 0.65 * side, z: place.z - f.z * 0.6 - f.x * 0.65 * side });
      await reach("use", (attempt) => beside(attempt % 2 ? -1 : 1), true);
      const sat = after("canoeIn");
      await tap("act");
      await until(sat, 2, "pressed E at the canoe, the beaver never got in");

      // Every buoy and lap as it comes; never in the water, never abandoned.
      const passed: number[] = [], laps: number[] = [];
      const off = [game.events.on("buoyPassed", (e) => passed.push(e.index)), game.events.on("lap", (e) => laps.push(e.lap))];
      const wet = after("enterWater"), abandoned = after("raceAbandon"), started = after("raceStart"), finished = after("raceFinish");
      let t = 0;
      /** Paddles to p until within near m, or done() says so. */
      const paddle = async (p: P, near: number, done = () => false) => {
        want.to = new Vector3(p.x, 0, p.z);
        try {
          while (Math.hypot(p.x - player.feet.x, p.z - player.feet.z) > near && !done()) {
            t += await frame();
            expect(t < 240, `raced for 240 s: at ${player.feet.x.toFixed(1)}, ${player.feet.z.toFixed(1)} on the way to ${p.x.toFixed(1)}, ${p.z.toFixed(1)} (${JSON.stringify(race.state)})`);
            expect(player.riding, "fell out of the canoe on the way");
            expect(!wet(), "swam on the way: the canoe was left behind");
            expect(!abandoned(), "the race was abandoned in the canoe");
          }
        } finally { want.to = undefined; }
      };
      const pond3 = { x: pond.x, z: pond.z }, angle = (p: P) => Math.atan2(p.z - pond3.z, p.x - pond3.x);
      const ring = Math.hypot(start.middle.x - pond3.x, start.middle.z - pond3.z), on = (a: number) => ({ x: pond3.x + Math.cos(a) * ring, z: pond3.z + Math.sin(a) * ring });
      const behind = { x: start.middle.x - start.forward.x, z: start.middle.z - start.forward.z };
      try {
        // 2. Out onto the ring, back round it (against the way of the race, so the line is crossed only backwards) to
        // just behind the start line, and across it.
        const out = angle(player.feet), home = angle(behind);
        await paddle(on(out), 0.6);
        const back = ((out - home) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); // the way round from here to home, backwards
        for (let a = out - 0.6; a > out - back; a -= 0.6) await paddle(on(a), 0.6);
        await paddle(behind, 0.4);
        await paddle({ x: start.middle.x + start.forward.x * 0.5, z: start.middle.z + start.forward.z * 0.5 }, 0.3, started);
        await until(started, 3, `crossed the start line, no race started (${JSON.stringify(race.state)})`);
        expect(race.state.kind === "racing" && race.state.lap === 1, `the race started, but it is ${JSON.stringify(race.state)}`);
        await until(shown, 1, "racing, but the race card is not up");
        expect(hudText("race-lap") === `Lap 1/${LAPS}`, `the race card says "${hudText("race-lap")}", not "Lap 1/${LAPS}"`);
        // 3. Three laps: to each next buoy in turn, then across the line again.
        const past = { x: start.middle.x + start.forward.x * 0.6, z: start.middle.z + start.forward.z * 0.6 };
        for (let lap = 1; lap <= LAPS; lap++) {
          for (let i = 0; i < n; i++) {
            const was = passed.length;
            await paddle(buoys[i]!, 0.3, () => passed.length > was);
            expect(passed.at(-1) === i, `paddled to buoy ${i}, but passed ${JSON.stringify(passed.slice(was))}`);
          }
          const lapped = laps.length;
          await paddle(past, 0.3, () => laps.length > lapped);
          await until(() => laps.length > lapped, 3, `crossed the line after lap ${lap}'s buoys, no lap counted (${JSON.stringify(race.state)})`);
          if (lap < LAPS) expect(hudText("race-lap") === `Lap ${lap + 1}/${LAPS}`, `on lap ${lap + 1}, the race card says "${hudText("race-lap")}"`);
        }
      } finally { off.forEach((f) => f()); }
      expect(JSON.stringify(passed) === JSON.stringify(Array.from({ length: LAPS }).flatMap(() => buoys.map((_, i) => i))), `the buoys were passed in this order: ${passed.join(" ")}`);
      expect(JSON.stringify(laps) === JSON.stringify(Array.from({ length: LAPS }, (_, i) => i + 1)), `laps counted: ${laps.join(" ")}`);
      // 4. The finish: a time, the best no slower, the card showing it.
      await until(finished, 2, "three laps, but the race never finished");
      const { time, best } = last.raceFinish!;
      expect(time > 0, `finished in ${time} s`);
      expect(best <= time, `the best time ${best} is slower than this race's ${time}`);
      expect(race.state.kind === "finished" && race.best === best, `finished, but the race is ${JSON.stringify(race.state)}, best ${race.best}`);
      expect(shown(), "finished, but the race card is not up");
      // 5. Out of the canoe: no race, no card.
      const out = after("canoeOut");
      await tap("act");
      await until(out, 2, "pressed E in the canoe, the beaver never got out");
      await until(() => race.state.kind === "idle", 1, `out of the canoe, the race is ${JSON.stringify(race.state)}`);
      await until(() => !shown(), 1, "out of the canoe, the race card is still up");
      expect(!abandoned(), "a finished race was abandoned on getting out");
    }, "Canoe race"],
  ];
};
