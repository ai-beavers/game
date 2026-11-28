// Dam work: fell a tree, gnaw it into wood, watch it grow back, carry a stick, build the dam, the lodge, the food cache.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { LODGE, moundHeight, REGROW, SLOTS, SPROUT, STICKS } from "../../build/rules.ts";
import { DAWN } from "../../flag/state.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the droppings feature puts on window for tools (src/features/droppings/index.ts); the part the tour needs. */
interface DroppingsDebug { count: number; most: number; text: string }

const BATCH = 3; // sticks built per visit, live and plain; fast builds to the next half of the dam, then the lodge

export const dam = (kit: Kit): Station[] => {
  const { player, world, fast, live, requested, wait, until, walkTo, tap, expect, after, last, needBuild, standingTrees, fell, split, fetchStick, buildUpTo, stockUpTo, regrowing, reach, sky } = kit;
  let felled = -1;
  return [
    ["Fell a tree", async () => {
      const i = standingTrees(needBuild())[0] ?? skip("no tree left");
      await fell(i);
      felled = i;
    }, "Dam work"],
    ["Gnaw it into wood", async () => {
      if (felled < 0) return skip("no tree felled this round");
      await split(felled);
      felled = -1;
    }, "Dam work"],
    // Live: time is real, so the beaver comes back to the stumps as they grow: it looks at a sapling, or fells the
    // tree grown back and gnaws it into wood. Otherwise the tree just gone into wood grows back, its clock wound on
    // (build.age): a sapling, half grown, the tree; then it is gnawed down again and its wood, the same pieces,
    // gathered where it lies.
    ["Regrow a tree", async () => {
      const b = needBuild();
      if (live) {
        const r = regrowing() ?? skip("nothing grows back yet");
        const tree = world.trees![r.i]!, out = new Vector3(-tree.place.x, 0, -tree.place.z).normalize(), back = tree.place.add(out.scale(2.5));
        if (r.what === "sapling") {
          await walkTo(back.x, back.z, { near: 0.6, limit: 60 });
          expect(b.saplings.has(r.i), `no sapling on stump ${r.i} any more, and no tree`);
          return wait(8); // a look at it growing
        }
        if (r.what === "stands") await fell(r.i);
        return split(r.i);
      }
      const i = last.treeSplits?.tree, t = () => b.state.trees[i!];
      if (i === undefined || !t()?.split || t()!.grown) return skip("no tree went into wood this round");
      const tree = world.trees![i]!, toAge = (seconds: number) => b.age(i, Math.max(0, seconds - (b.age(i, 0) || 0)));
      // A few steps back on the clearing's side, so the camera over the shoulder sees the stump.
      const out = new Vector3(-tree.place.x, 0, -tree.place.z).normalize(), back = tree.place.add(out.scale(3)), facing = Math.atan2(-out.x, -out.z);
      player.teleport(back.x, world.heightAt(back.x, back.z), back.z, facing);
      player.camera.yaw = facing + Math.PI + 0.5;
      for (const age of [SPROUT + 10, (SPROUT + REGROW) / 2]) {
        toAge(age);
        await wait(3);
        expect(b.saplings.has(i), `no sapling on stump ${i} ${age} s after its wood went`);
      }
      toAge(REGROW + 10);
      await until(() => !!t()?.grown, 3, `tree ${i} never grew back`);
      await wait(3);
      await fell(i);
      await until(() => !!t()?.grown?.rest, 10, `tree ${i} never came to rest again`);
      const splits = after("treeSplits");
      b.split(i);
      expect(splits() && last.treeSplits!.logs + last.treeSplits!.sticks > 0 && !t()?.grown, `tree ${i} grown back gave no wood`);
    }, "Regrowth"],
    ["Carry a stick", () => player.carrying ? skip("a stick is in the hand already") : fetchStick(), "Dam work"],
    // A few sticks a visit (fast: up to half the dam, then the rest), so the dam grows across rounds; the kept world
    // lives on, so the lodge follows it.
    ["Build the dam", async () => {
      const n = needBuild().state.dam.length;
      if (n >= SLOTS) return skip("the dam is full");
      await buildUpTo(Math.min(SLOTS, fast ? (n * 2 < SLOTS ? SLOTS / 2 : SLOTS) : n + BATCH), false);
    }, "Dam work"],
    // A joke on one's own dam (a viewer's wish): by its land side with empty paws, once its mud shows, E offers "Leave
    // a dropping"; the beaver sits with its back to it, a dropping lands on the crest and the tail pats it flat. Not
    // live it fills the dam's five, sees the offer go, and rolls the sky to dawn, which washes them off. Run alone
    // (station=Leave a dropping) it builds the tour's own dam up to its mud first.
    ["Leave a dropping", async () => {
      const droppings = (window as { droppings?: DroppingsDebug }).droppings ?? skip("no droppings feature");
      const b = needBuild();
      if (!(moundHeight(Math.min(SLOTS, b.state.dam.length)) > 0)) {
        if (!requested.includes("Leave a dropping")) return skip("the dam's mud does not show yet");
        b.fill(5);
      }
      if (droppings.count >= droppings.most) return skip(`${droppings.most} droppings lie on the dam already; the dawn washes them off`);
      if (player.carrying) {
        if (!player.putDown()) return skip("a stick in the paws, and it cannot be set down here");
        await until(() => !player.carrying, 2, "set the stick down, it is still in the paws");
      }
      const offers = () => player.offer()?.text === droppings.text;
      const { origin, across } = b.dam.frame, along = { x: -across.z, z: across.x };
      // 1. To the dam's land side, beside its crest.
      await reach("use", (attempt) => {
        const side = [0, 0.35, -0.35][attempt]!;
        return { x: origin.x - across.x * 0.85 + along.x * side, z: origin.z - across.z * 0.85 + along.z * side };
      }, true);
      expect(offers(), `by the dam's land side E would "${player.offer()?.text}", not "${droppings.text}"`);
      // 2. E: it sits with its back to the dam, one lands, the tail pats it.
      const leave = async () => {
        const before = droppings.count, left = after("droppingLeft"), slapped = after("tailSlap");
        await tap("act");
        await until(left, 3, `pressed E by the dam, no dropping was left`);
        expect(droppings.count === before + 1, `${droppings.count} droppings lie on the dam, not ${before + 1}`);
        await until(slapped, 2, "a dropping landed, the tail never patted it");
        await until(() => !player.sitting, 3, "the beaver never got up after leaving a dropping");
      };
      await leave();
      if (live) return;
      const s = sky(), hour = s.hour, running = s.running;
      try {
        s.running = false; s.setHour(13); // held, so no dawn comes while it fills them
        // 3. Up to five, then no more offered.
        while (droppings.count < droppings.most) {
          await until(offers, 3, `with ${droppings.count} droppings on the dam E would "${player.offer()?.text}", not "${droppings.text}"`);
          await leave();
        }
        await wait(0.3);
        expect(!offers(), `${droppings.count} droppings on the dam, and E still offers another`);
        // 4. The next dawn washes them off.
        const washed = after("droppingsWashed");
        s.setHour(DAWN.from - 0.3);
        await wait(0.2);
        expect(droppings.count === droppings.most, `before dawn (${s.hour.toFixed(1)} h) ${droppings.count} droppings lie there, not ${droppings.most}`);
        s.setHour(DAWN.from + 0.5);
        await until(washed, 1, `at dawn (${s.hour.toFixed(1)} h) the droppings were not washed off`);
        expect(droppings.count === 0, `washed off at dawn, ${droppings.count} droppings still lie there`);
        // The last one's tail may not slap again yet (it offers none until then), so wait for the offer.
        await until(offers, 3, `the dam washed clean, E would "${player.offer()?.text}", not "${droppings.text}"`);
      } finally {
        s.setHour(hour); s.running = running;
      }
    }, "Dam work"],
    // After the dam: swim sticks out to the lodge. Run alone (station=Build the lodge) it finishes the tour's own dam
    // first, so the lodge is there; in the whole tour it waits for a full dam.
    ["Build the lodge", async () => {
      const b = needBuild();
      if (b.state.dam.length < SLOTS) {
        if (!requested.includes("Build the lodge")) return skip("the dam is not finished yet");
        b.fill(SLOTS);
      }
      const n = b.state.dam.length;
      if (n >= SLOTS + LODGE) return skip("the lodge is finished");
      await buildUpTo(fast ? SLOTS + LODGE : Math.min(SLOTS + LODGE, n + BATCH), true);
      if (live && b.state.dam.length >= SLOTS + LODGE) await wait(10); // the lodge standing, a moment to look at it
    }, "Dam work"],
    // Once the lodge stands: a stick swum out over the food cache, a dive down to the pile beside the lodge, E there to
    // wedge it in; the goals count it. Run alone (station=Stock the cache) it finishes the tour's own dam and lodge
    // first; in the whole tour it waits for the lodge.
    ["Stock the cache", async () => {
      const b = needBuild();
      if (b.state.dam.length < SLOTS + LODGE) {
        if (!requested.includes("Stock the cache")) return skip("the lodge does not stand yet");
        b.fill(SLOTS + LODGE);
      }
      const n = b.state.dam.length;
      if (n >= STICKS) return skip("the cache is stocked");
      await stockUpTo(fast ? STICKS : Math.min(STICKS, n + BATCH));
      if (live && b.state.dam.length >= STICKS) await wait(10); // the cache stocked, before the world starts anew
    }, "Dam work"],
  ];
};
