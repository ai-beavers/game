// Mrs. Beaver: rescued in a quest, played through input as a person would. The checklist with three steps unticked;
// her pen found first, where Use offers nothing and nothing ticks; her flower picked up on the way; her pen again, where
// the find step ticks; the pen gnawed open by holding Use, a slip of the key keeping what is gnawed; the pen fallen into
// loose sticks, her flower back behind her ear, and her walk home to the building site. Only the reset (a new quest,
// at a hiding place picked anew) and where the pen and the flower are come from the feature's debug handle.
import { FIND, FLOWER_REACH, HIDING, REACH, type Step, type XZ } from "../../mrs-beaver/rules.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the feature puts on window for tools (src/features/mrs-beaver/index.ts); only the part the tour needs. */
interface MrsBeaverDebug {
  pen: XZ;
  flower: XZ;
  step: Step;
  gnawed: number;
  state: "missing" | "freed";
  home: XZ;
  wears: boolean;
  dropped: boolean;
  her(): XZ | undefined;
  stand(): XZ;
  reset(at?: number): unknown;
}

const PICK = "Pick up the flower", GNAW = "Gnaw the pen open";
const STEPS = ["Find her flower", "Find Mrs. Beaver", "Gnaw the pen open"];

export const mrsBeaver = (kit: Kit): Station[] => {
  const { player, world, live, wait, until, walkTo, reach, tap, expect, hudText, pickUp, want, stage } = kit;
  const title = () => hudText("mrs-beaver"), line = (i: number) => hudText(`mrs-beaver-step-${i}`);
  const lines = () => STEPS.map((_, i) => line(i));
  /** The list as it should read with `done` steps ticked. */
  const reads = (done: number) => STEPS.every((s, i) => line(i) === (i < done ? "✓ " : i === done ? "› " : "· ") + s);
  const near = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);
  /** A point d m from p, on the side towards q. */
  const off = (p: XZ, q: XZ, d: number) => { const n = near(p, q) || 1; return { x: p.x + ((q.x - p.x) / n) * d, z: p.z + ((q.z - p.z) / n) * d }; };
  return [
    ["Find Mrs. Beaver", async () => {
      const her = (window as { mrsBeaver?: MrsBeaverDebug }).mrsBeaver ?? skip("no Mrs. Beaver feature");
      her.reset();
      expect(her.step === "flower", `after a reset the quest is on the step "${her.step}", not "flower"`);
      await until(() => title() === "Find Mrs. Beaver" && reads(0), 2, `the checklist reads "${title()}" / ${lines().join(" / ")}, not three steps from the first`);
      await until(() => !!her.her(), 20, "her beaver never loaded");
      expect(!her.wears, "she wears her flower while she is missing");
      expect(her.dropped, "her flower does not lie on the ground");
      const pen = her.pen, flower = her.flower;

      // Her pen first, before the flower: Use offers nothing there, and nothing ticks.
      const stand = her.stand(), approach = off(stand, { x: 2 * stand.x - pen.x, z: 2 * stand.z - pen.z }, 1.5);
      await walkTo(approach.x, approach.z, { near: 0.5, limit: 90, hop: true });
      await walkTo(stand.x, stand.z, { near: 0.25, limit: 15 });
      expect(near(player.feet, pen) <= REACH, `stood ${near(player.feet, pen).toFixed(2)} m from the pen, not within reach`);
      const early = player.offer();
      expect(!early, `at the pen without her flower, Use would "${early?.text}", not nothing`);
      await tap("act");
      await wait(0.5);
      expect(her.step === "flower" && reads(0), `at the pen without her flower the quest went on: ${her.step}, ${lines().join(" / ")}`);
      if (live) await wait(2);

      // Her flower, on the way between the building site and her: Use picks it up, the paws stay free.
      const way = off(flower, her.home, 3);
      await walkTo(way.x, way.z, { near: 0.6, limit: 60, hop: true });
      await reach("use", (attempt) => attempt ? flower : off(flower, her.home, 0.5));
      const offer = player.offer();
      expect(offer?.action === "use" && offer.text === PICK, `at her flower, Use would "${offer?.text}", not "${PICK}"`);
      expect(near(player.feet, flower) <= FLOWER_REACH, `Use offers her flower ${near(player.feet, flower).toFixed(2)} m from it`);
      await tap("act");
      await until(() => her.step === "find", 2, `pressed Use at her flower, the quest is on "${her.step}"`);
      await until(() => reads(1), 2, `with her flower the checklist reads ${lines().join(" / ")}`);
      expect(!her.dropped, "her flower still lies on the ground once picked up");
      expect(!player.carrying, "picking up her flower filled the paws");
      if (live) await wait(2);

      // Back to her pen: within a few metres of it she is found.
      const toward = off(pen, flower, FIND + 2);
      await walkTo(toward.x, toward.z, { near: 0.6, limit: 60, hop: true });
      expect(her.step === "find", `${near(player.feet, pen).toFixed(1)} m from the pen she counts as found already`);
      await walkTo(stand.x, stand.z, { near: 0.25, limit: 20, arrived: () => her.step === "gnaw" });
      await until(() => reads(2), 2, `at her pen the checklist reads ${lines().join(" / ")}`);
      await reach("use", () => her.stand());
      const gnawOffer = player.offer();
      expect(gnawOffer?.action === "use" && gnawOffer.text === GNAW, `at the pen once she is found, Use would "${gnawOffer?.text}", not "${GNAW}"`);

      // Use held a moment and let go: she is still shut in, and what is gnawed stays.
      await tap("act", 1);
      await until(() => player.motion.action === "none", 2, "let go of Use, the beaver goes on gnawing");
      const gnawed = her.gnawed;
      expect(her.state === "missing" && gnawed > 0.5, `held Use 1 s at the pen: she is ${her.state}, ${gnawed.toFixed(2)} s gnawed`);
      await wait(0.5);
      expect(her.gnawed === gnawed, `let go of Use, what was gnawed went from ${gnawed.toFixed(2)} to ${her.gnawed.toFixed(2)} s`);

      // Held to the end, with the gnaw motion: the pen falls into loose sticks, she is free, and the list says so.
      const before = world.sticks.filter((s) => near(s.body.translation(), pen) < 1.4).length;
      want.act = true;
      try {
        await until(() => player.motion.action === "gnaw", 1, "held Use at the pen, the beaver does not gnaw");
        await until(() => her.state === "freed", 5, `held Use at the pen, she is still shut in (${her.gnawed.toFixed(2)} s gnawed)`);
      } finally { want.act = false; }
      const fallen = world.sticks.filter((s) => near(s.body.translation(), pen) < 1.4).length - before;
      expect(fallen >= 4, `the pen fell into ${fallen} loose sticks, not at least 4`);
      await until(() => title() === "Mrs. Beaver found" && STEPS.every((_, i) => !stage.hud.getControlByName(`mrs-beaver-step-${i}`)?.isVisible), 2,
        `the checklist reads "${title()}" / ${lines().join(" / ")}, not only "Mrs. Beaver found"`);
      expect(her.wears, "freed, she does not wear her flower");
      expect(player.offer()?.text !== GNAW, "Use still offers to gnaw the pen once she is freed");
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
      expect(near(player.feet, her.pen) < REACH, `stood ${near(player.feet, her.pen).toFixed(2)} m from the pen with a stick`);
      const offered = player.offer();
      expect(offered?.action === "drop", `with a stick in the paws at the pen, Use would "${offered?.text}", not drop it`);
      await tap("act");
      await until(() => !player.carrying, 2, "pressed Use with a stick near the pen, the stick stayed in the paws");
      expect(her.state === "missing" && her.step === "flower", "dropping a stick at the pen moved her quest on");
    }, "Find Mrs. Beaver"],
  ];
};
