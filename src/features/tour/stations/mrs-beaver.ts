// Mrs. Beaver: missing at a hiding place, found at the edge of the Clearing, freed with the Use key, the pen fallen
// into loose sticks, and her walk home to the building site. Played through input as a person would; only the reset
// (missing again, at a hiding place picked anew) and where the pen stands come from the feature's debug handle.
import { HIDING } from "../../mrs-beaver/rules.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

type XZ = { x: number; z: number };
/** What the feature puts on window for tools (src/features/mrs-beaver/index.ts); only the part the tour needs. */
interface MrsBeaverDebug {
  pen: XZ;
  state: "missing" | "freed";
  home: XZ;
  her(): XZ | undefined;
  stand(): XZ;
  reset(at?: number): unknown;
}

const FREE = "Free Mrs. Beaver";

export const mrsBeaver = (kit: Kit): Station[] => {
  const { player, world, live, wait, until, walkTo, reach, tap, expect, hudText, pickUp } = kit;
  const line = () => hudText("mrs-beaver");
  const near = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);
  return [
    ["Find Mrs. Beaver", async () => {
      const her = (window as { mrsBeaver?: MrsBeaverDebug }).mrsBeaver ?? skip("no Mrs. Beaver feature");
      her.reset();
      expect(her.state === "missing", `after a reset she is ${her.state}, not missing`);
      await until(() => line() === "Find Mrs. Beaver", 2, `the HUD line says "${line()}", not "Find Mrs. Beaver"`);
      await until(() => !!her.her(), 20, "her beaver never loaded");
      const pen = her.pen;

      // Over land to the edge of the Clearing where she is (hopped over in the fast tour), then up to the pen.
      const stand = her.stand(), approach = { x: stand.x + (stand.x - pen.x) * 1.5, z: stand.z + (stand.z - pen.z) * 1.5 };
      await walkTo(approach.x, approach.z, { near: 0.5, limit: 90, hop: true });
      if (live) await wait(3);
      await reach("use", () => her.stand());
      const offer = player.offer();
      expect(offer?.action === "use" && offer.text === FREE, `with free paws at the pen, Use would "${offer?.text}", not "${FREE}"`);
      expect(near(player.feet, pen) <= 1.3, `Use offers to free her ${near(player.feet, pen).toFixed(2)} m from the pen`);

      // Use: the pen falls into loose sticks, she is free, and the line says so.
      const before = world.sticks.filter((s) => near(s.body.translation(), pen) < 1.4).length;
      await tap("act");
      await until(() => her.state === "freed", 2, "pressed Use at the pen, she is still missing");
      const fallen = world.sticks.filter((s) => near(s.body.translation(), pen) < 1.4).length - before;
      expect(fallen >= 4, `the pen fell into ${fallen} loose sticks, not at least 4`);
      await until(() => line() === "Mrs. Beaver found", 2, `the HUD line says "${line()}", not "Mrs. Beaver found"`);
      expect(player.offer()?.text !== FREE, "Use still offers to free her once she is freed");
      if (live) await wait(3);

      // She walks home and waits beside the building site.
      await until(() => near(her.her()!, her.home) < 0.3, 40, `she did not get home: ${near(her.her()!, her.home).toFixed(1)} m from it`);
      if (live) await wait(3);

      if (live) return;
      // With a stick in the paws, Use near her pen does what it did: a pen's own stick, at a pen put back where it stood.
      await pickUp();
      await until(() => player.motion.action === "none", 2, "the paws never finished picking up the stick");
      her.reset(HIDING.findIndex((h) => near(h, pen) < 0.01));
      const back = her.stand();
      await walkTo(back.x, back.z, { near: 0.25, limit: 15 });
      expect(near(player.feet, her.pen) < 1.3, `stood ${near(player.feet, her.pen).toFixed(2)} m from the pen with a stick`);
      const offered = player.offer();
      expect(offered?.action === "drop", `with a stick in the paws at the pen, Use would "${offered?.text}", not drop it`);
      await tap("act");
      await until(() => !player.carrying, 2, "pressed Use with a stick near the pen, the stick stayed in the paws");
      expect(her.state === "missing", "dropping a stick at the pen freed her");
    }, "Find Mrs. Beaver"],
  ];
};
