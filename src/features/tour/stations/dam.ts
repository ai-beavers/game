// Dam work: fell a tree, gnaw it into wood, watch it grow back, carry a stick, build the dam, the lodge, the food cache.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { CACHE, LODGE, REGROW, SLOTS, SPROUT, STICKS } from "../../build/rules.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

const BATCH = 3; // sticks built per visit, live and plain; fast builds to the next half of the dam, then the lodge

export const dam = (kit: Kit): Station[] => {
  const { player, world, fast, live, requested, want, wait, until, walkTo, tap, expect, after, last, hudText, needBuild, standingTrees, fell, split, fetchStick, buildUpTo, regrowing } = kit;
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
    // A few sticks a visit (fast: up to half the dam, then the rest), so the dam grows across rounds; the saved game
    // lives on, so the lodge follows it.
    ["Build the dam", async () => {
      const n = needBuild().state.dam.length;
      if (n >= SLOTS) return skip("the dam is full");
      await buildUpTo(Math.min(SLOTS, fast ? (n * 2 < SLOTS ? SLOTS / 2 : SLOTS) : n + BATCH), false);
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
      const n = b.state.dam.length, depth = () => (player.waterLevel ?? 0) - player.feet.y;
      if (n >= STICKS) return skip("the cache is stocked");
      for (const upTo = fast ? STICKS : Math.min(STICKS, n + BATCH); b.state.dam.length < upTo;) {
        await fetchStick();
        const at = b.dam.cacheAt;
        await walkTo(at.x, at.z, { near: 0.5, limit: 40, hop: true });
        expect(player.afloat && !!player.carrying, "swam out over the cache, yet not afloat with a stick");
        const placed = after("stickPlaced"), k = b.state.dam.length + 1;
        want.dive = true;
        try {
          await until(() => player.offer()?.action === "build", 8, `dived by the cache (${depth().toFixed(1)} m deep), E would ${player.offer()?.action ?? "do nothing"}`);
          expect(player.offer()!.text === "Wedge into cache", `E offers "${player.offer()!.text}" by the cache`);
          await tap("act");
          await until(placed, 3, "pressed E by the cache, no stick wedged in");
        } finally { want.dive = false; }
        expect(b.state.dam.length === k && last.stickPlaced!.place.y < (player.waterLevel ?? 0) - 2, `the cache holds ${b.state.dam.length - SLOTS - LODGE} sticks, not ${k - SLOTS - LODGE}, or not on the bed`);
        const line = `Stock the food cache: ${k - SLOTS - LODGE} of ${CACHE}`;
        await until(() => hudText("goals").includes(line), 2, `the goals do not say "${line}"`);
        if (k === STICKS) await until(() => hudText("announcement").startsWith("The cache is stocked!"), 2, "the cache's last stick went in, no \"The cache is stocked!\" on screen");
        await until(() => !player.diving && depth() < 0.45, 6, "let go of C, it never came up");
      }
      if (live && b.state.dam.length >= STICKS) await wait(10); // the cache stocked, before the world starts anew
    }, "Dam work"],
  ];
};
