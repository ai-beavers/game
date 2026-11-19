// Mushrooms: eaten as a person would. With free paws the beaver walks to the mushrooms at the foot of a tree, where
// Use offers "Eat the mushroom"; it eats three close together, each one gone once munched, the first two leaving the
// view clear; the third makes the view dizzy, full strength within a few seconds, and the view clears again. Only
// where the mushrooms grow, how dizzy the view is, and dawn (when too few are left) come from the debug handle.
import { REACH, type XZ } from "../../mushrooms/rules.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the feature puts on window for tools (src/features/mushrooms/index.ts); only the part the tour needs. */
interface MushroomsDebug {
  spots: XZ[];
  eaten: boolean[];
  appetite: number;
  dizzy: number;
  on: boolean;
  shown(i: number): boolean;
  dawn(): void;
}

const EAT = "Eat the mushroom";
/** The three spots close together the station eats, in order. */
const NEARBY = [0, 1, 2];
const STAND = 0.6; // m from a spot towards the meadow's middle, where the beaver stands to eat

export const mushrooms = (kit: Kit): Station[] => {
  const { player, live, wait, until, walkTo, reach, tap, expect } = kit;
  const near = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);
  /** Where to stand at a spot: on its meadow side, away from the tree. */
  const stand = (s: XZ, d = STAND) => { const r = Math.hypot(s.x, s.z) || 1; return { x: s.x - (s.x / r) * d, z: s.z - (s.z / r) * d }; };
  return [
    ["Eat mushrooms", async () => {
      const m = (window as { mushrooms?: MushroomsDebug }).mushrooms ?? skip("no mushrooms feature");
      expect(!player.carrying, "the station starts with a stick in the paws");
      // A view still dizzy from before clears first; too few left to eat grow back.
      await until(() => m.dizzy === 0, 40, `the view is still dizzy from before (${m.dizzy.toFixed(2)})`);
      if (NEARBY.some((i) => m.eaten[i])) m.dawn();
      await until(() => m.appetite === 0, 130, `the appetite never drained (${m.appetite})`);

      for (const [n, i] of NEARBY.entries()) {
        const s = m.spots[i]!, far = stand(s, 3);
        expect(m.shown(i), `the mushrooms at spot ${i} are not drawn before they are eaten`);
        await walkTo(far.x, far.z, { near: 0.6, limit: 60, hop: true });
        await reach("use", (attempt) => attempt ? stand(s, 0.3) : stand(s));
        const offer = player.offer();
        expect(offer?.text === EAT, `beside the mushrooms at spot ${i}, Use would "${offer?.text}", not "${EAT}"`);
        expect(near(player.feet, s) <= REACH, `Use offers to eat ${near(player.feet, s).toFixed(2)} m from the mushrooms`);
        await tap("act");
        await until(() => player.motion.action !== "none", 1, "pressed Use at the mushrooms, the beaver does not bend down to munch");
        await until(() => player.motion.action === "none", 3, "the beaver never stopped munching");
        expect(m.eaten[i]!, `munched at spot ${i}, its mushrooms count as not eaten`);
        expect(!m.shown(i), `munched at spot ${i}, its mushrooms are still drawn`);
        expect(!player.offer() || player.offer()!.text !== EAT, `spot ${i} eaten, Use still offers to eat it`);
        if (n < NEARBY.length - 1) {
          await wait(0.5);
          expect(m.dizzy === 0 && !m.on, `after ${n + 1} mushroom(s) the view is dizzy already (${m.dizzy.toFixed(2)})`);
        }
        if (live) await wait(1.5);
      }

      // The third: dizzy, full strength within a few seconds, then clear again.
      await until(() => m.dizzy > 0 && m.on, 2, `three mushrooms in a row, the view is not dizzy (${m.dizzy.toFixed(2)})`);
      await until(() => m.dizzy === 1, 4, `the dizzy view never got to full strength (${m.dizzy.toFixed(2)})`);
      if (live) {
        // Look round a little while dizzy: walk a few steps on the meadow, steering as always.
        const s = m.spots[NEARBY.at(-1)!]!, out = stand(s, 4);
        await walkTo(out.x, out.z, { near: 0.6, limit: 20 });
      }
      await until(() => m.dizzy === 0 && !m.on, 40, `the dizzy view never cleared (${m.dizzy.toFixed(2)})`);
      if (live) await wait(2);
    }, "Mushrooms"],
  ];
};
