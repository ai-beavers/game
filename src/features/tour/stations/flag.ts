// Burn the Flag (a viewer's wish): the Flag with the AI beavers logo on its pole beside the building site. By the pole
// with empty paws E offers "Set the Flag alight"; the fire climbs the cloth for about eight seconds and leaves a charred
// rag that E cannot light again; a fresh Flag is raised at the next dawn. Live, the beaver burns it when it is whole and
// never sets the clock: the rag stays until the day's own dawn.
import { BURN_SECONDS, DAWN, type FlagState } from "../../flag/state.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the flag feature puts on window for tools (src/features/flag/index.ts); only the part the tour needs. */
interface FlagDebug { state: FlagState; pole: { x: number; z: number } }

export const flag = (kit: Kit): Station[] => {
  const { player, live, until, tap, expect, after, reach, wait, sky } = kit;
  return [
    ["Burn the flag", async () => {
      const flag = (window as { flag?: FlagDebug }).flag ?? skip("no flag feature");
      if (live && flag.state !== "whole") return skip(`the Flag is ${flag.state}; a fresh one comes at dawn`);
      const s = sky(), hour = s.hour, running = s.running;
      try {
        if (!live) { s.running = false; s.setHour(13); } // any hour does; held, so no dawn comes while it burns
        expect(flag.state === "whole", `the Flag is ${flag.state} before it is lit, not whole`);
        expect(!player.carrying, "wanted to start with empty paws, a stick in them");
        // 1. Up to the pole, from the south (the side the logo reads from).
        const { pole } = flag;
        await reach("use", (attempt) => ({ x: pole.x + (attempt % 2 ? 0.45 : -0.45), z: pole.z - 0.7 }), true);
        expect(player.offer()?.text === "Set the Flag alight", `by the pole E would "${player.offer()?.text}", not "Set the Flag alight"`);
        // 2. E: it catches fire.
        const lit = after("flagLit"), burnt = after("flagBurnt");
        await tap("act");
        await until(lit, 2, "pressed E at the pole, the Flag never caught fire");
        expect(flag.state === "burning", `lit, the Flag is ${flag.state}, not burning`);
        expect(!player.offer() || player.offer()?.text !== "Set the Flag alight", "a burning Flag is offered to light again");
        // 3. About eight seconds later: a charred rag.
        await until(burnt, BURN_SECONDS + 2, `the Flag still burns ${BURN_SECONDS + 2} s after it was lit`);
        expect(flag.state === "charred", `burnt down, the Flag is ${flag.state}, not charred`);
        // 4. E again does not light the rag.
        expect(player.offer()?.text !== "Set the Flag alight", "the charred Flag is offered to light again");
        await tap("act");
        await wait(0.5);
        expect(flag.state === "charred", `E at the charred Flag made it ${flag.state}`);
        if (live) return;
        // 5. The next dawn raises a fresh one.
        s.setHour(DAWN.from - 0.3);
        await wait(0.2);
        expect(flag.state === "charred", `before dawn (${s.hour.toFixed(1)} h) the Flag is ${flag.state}, not still charred`);
        s.setHour(DAWN.from + 0.5);
        await until(() => flag.state === "whole", 1, `at dawn (${s.hour.toFixed(1)} h) the Flag is still ${flag.state}`);
      } finally {
        if (!live) { s.setHour(hour); s.running = running; }
      }
    }, "Burn the flag"],
  ];
};
