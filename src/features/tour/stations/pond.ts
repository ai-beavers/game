// The pond: swimming across, the tail slap on land and on the water, diving, the school in the deep basin, the animals.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { centre, spread, type Deep } from "../../life/deep.ts";
import { BASIN } from "../../../world/terrain.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

export const pondPatrol = (kit: Kit): Station[] => {
  const { player, world, stage, live, want, frame, wait, until, walkTo, tap, expect, after, last, pond, clear } = kit;
  return [
    ["Swim", async () => {
      if (!pond) return skip("no pond");
      if (player.afloat) await walkTo(world.spawn.x, world.spawn.z, { arrived: () => !player.afloat, limit: 40 }); // out first, from the lodge
      const wet = after("enterWater");
      await walkTo(pond.x, pond.z - clear(), { arrived: wet, limit: 30 });
      expect(wet(), "walked into the pond, never afloat");
      const dry = after("leaveWater");
      await walkTo(pond.x + pond.radius + 1.5, pond.z, { arrived: dry, limit: 40 });
      expect(dry(), "swam across, never out again");
    }, "Pond patrol"],
    // On land Q thumps the tail on the ground: a tail slap, not on the water.
    ["Tail slap on land", async () => {
      if (player.afloat) await walkTo(world.spawn.x, world.spawn.z, { arrived: () => !player.afloat, limit: 40 });
      await wait(0.6);
      expect(!player.afloat, "wanted to slap on land, still afloat");
      const slapped = after("tailSlap");
      await tap("slap");
      await until(slapped, 2, "pressed Q on land, the tail never came down");
      expect(!last.tailSlap!.water, "slapped on land, but it came down on water");
      await wait(2);
    }, "Tail slap"],
    // Out on the pond, the alarm: Q slaps the tail; the crack (tailSlap) must send at least one animal off (startled).
    ["Tail slap", async () => {
      if (!pond) return skip("no pond");
      await walkTo(pond.x - 0.5, pond.z - clear(), { near: 0.8, limit: 40 });
      expect(player.afloat, "out in the pond, yet not afloat");
      await wait(0.4);
      const slapped = after("tailSlap"), startled = after("startled");
      await tap("slap");
      await until(slapped, 2, "pressed Q afloat, the tail never came down");
      expect(last.tailSlap!.water, "slapped in the pond, but not on the water");
      await until(startled, 1, "the tail came down, no animal heard it");
      expect(last.startled!.count > 0, "the tail came down, no animal fled");
      await wait(4); // the ducks circle, the fish dart off: something to see
    }, "Tail slap"],
    // Out in the middle, C held takes the beaver under: below the surface with the under-water picture (live, the
    // stream's camera stays above and watches it go down); a swim down there, then let go and up again.
    ["Dive", async () => {
      if (!pond) return skip("no pond");
      const look = () => (stage.scene.metadata.underwater as { on: boolean } | undefined)?.on, depth = () => (player.waterLevel ?? 0) - player.feet.y;
      // Beside the lodge: south-east of it, where the camera behind has room to go under (by the basin's south wall it has not)
      await walkTo(pond.x + clear(), pond.z - clear(), { near: 0.5, limit: 40 });
      expect(player.afloat, "out in the pond, yet not afloat");
      want.dive = true;
      try {
        await until(() => player.diving && depth() > 0.6, 4, `held C afloat, never went under (${depth().toFixed(2)} m deep)`);
        if (!live && look() !== undefined) await until(() => !!look(), 3, "the beaver is under, the picture is not");
        want.to = new Vector3(pond.x + 1.2, 0, pond.z - clear() + 0.4); // a look round down there
        await wait(2.5);
        want.to = undefined;
        expect(depth() > 0.6 && player.diving, `swimming under, it came up (${depth().toFixed(2)} m deep)`);
      } finally { want.dive = false; want.to = undefined; }
      await until(() => !player.diving && depth() < 0.45, 4, "let go of C, it never came up");
      if (!live && look() !== undefined) await until(() => !look(), 3, "up again, the picture stays under water");
    }, "Pond patrol"],
    // Down into the deep basin: the school is there and parts round the beaver as it swims into it (C held while above
    // the school's depth, let go below it, so it stays level with them); up again, the school gathers, a tail slap
    // scatters it.
    ["Life in the deep", async () => {
      if (!pond) return skip("no pond");
      const deep = (window as { life?: { animals: { deep?: Deep } } }).life?.animals.deep ?? skip("no life in the deep");
      const fish = () => deep.school.fish, depth = () => (player.waterLevel ?? 0) - player.feet.y;
      const body = () => ({ x: player.feet.x, y: player.feet.y + 0.25, z: player.feet.z });
      expect(fish().length > 0, "no school in the deep basin");
      await walkTo(BASIN.x, BASIN.z, { near: 0.6, limit: 40, hop: true });
      expect(player.afloat, "over the deep basin, yet not afloat");
      let met = 0, closest = Infinity;
      try {
        want.dive = true;
        await until(() => player.diving && depth() > 1, 6, `held C over the basin, never went down (${depth().toFixed(2)} m deep)`);
        for (let t = 0; t < 15 && met < 3;) {
          const c = centre(fish()), b = body();
          want.dive = b.y > c.y - 0.1;
          want.to = new Vector3(c.x, 0, c.z);
          const dt = await frame();
          t += dt;
          if (Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z) < 0.6) {
            met += dt;
            closest = Math.min(closest, ...fish().map((f) => Math.hypot(f.x - b.x, f.y - b.y, f.z - b.z)));
          }
        }
        expect(met > 0, "swam after the school for 15 s, never got into it");
        expect(closest > 0.25, `in the school, a fish swam ${closest.toFixed(2)} m from the beaver: it did not part`);
      } finally { want.dive = false; want.to = undefined; }
      await until(() => !player.diving && depth() < 0.45, 6, "let go of C, it never came up");
      // Off to one side, out of the school's way (it parts round a beaver floating over it too), until it is one school
      // again: the scatter is measured from that, not from the hole the beaver left.
      const c = centre(fish()), away = Math.hypot(BASIN.x - c.x, BASIN.z - c.z), ux = away > 0.3 ? (BASIN.x - c.x) / away : 1, uz = away > 0.3 ? (BASIN.z - c.z) / away : 0;
      const apart = () => fish().every((f) => Math.hypot(f.x - player.feet.x, f.z - player.feet.z) > 1.2);
      await walkTo(c.x + ux * 1.5, c.z + uz * 1.5, { near: 0.6, arrived: apart, limit: 20 });
      await until(() => spread(fish()) < 0.4, 10, "up again and off to one side, the school never gathered");
      const before = spread(fish()), slapped = after("tailSlap");
      await tap("slap");
      await until(slapped, 2, "pressed Q over the basin, the tail never came down");
      let most = 0;
      for (let t = 0; t < 1;) { t += await frame(); most = Math.max(most, spread(fish())); }
      expect(most > before * 1.5, `slapped, the school stayed together (${before.toFixed(2)} → at most ${most.toFixed(2)} m)`);
      await wait(3); // it gathers again
    }, "Pond patrol"],
    ["Animals at the pond", async () => {
      if (!pond) return skip("no pond");
      expect(stage.scene.meshes.some((o) => o.name.startsWith("life-")), "no animals in the scene");
      for (const angle of [0.6, 1.3, 2.0]) {
        const r = pond.radius + 1.6;
        await walkTo(pond.x + Math.cos(angle) * r, pond.z + Math.sin(angle) * r, { near: 0.6 });
      }
    }, "Pond patrol"],
  ];
};
