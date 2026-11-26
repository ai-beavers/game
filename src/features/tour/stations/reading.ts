// The Reading: once Mrs. Beaver is home, the beaver walks to the Campfire beside her waiting spot and sits (C held, as
// the Sit station does). She reads the first line over her head, the beaver the next over its own; letting go of
// Sit hides the line, and sitting again shows the line it stopped at, not the story's first. Live it sits about 20 s,
// so viewers see the lines go back and forth. It plays last in "Find Mrs. Beaver": in the live tour the rescue ends
// with her walk home, and the two of them reading by the fire. Only where the fire and the seat are, and the line
// shown now, come from the feature's debug handle; if an earlier station left her shut in again (the fast tour's
// rescue ends with a reset), she is put home freed through it too.
import { LINE } from "../../mrs-beaver/reading.ts";
import type { XZ } from "../../mrs-beaver/rules.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the feature puts on window for tools (src/features/mrs-beaver/index.ts); only the part the Reading needs. */
interface ReadingDebug {
  state: "missing" | "freed";
  home: XZ;
  her(): XZ | undefined;
  free(): void;
  fire: XZ;
  seat: XZ & { face: number };
  reading: boolean;
  said: { text: string; reader: "her" | "player" } | undefined;
  story: number;
  line: number;
}

export const reading = (kit: Kit): Station[] => {
  const { player, live, wait, until, walkTo, expect, hudText, want, stage } = kit;
  const near = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);
  const shown = () => !!stage.hud.getControlByName("mrs-beaver-reading")?.isVisible && hudText("mrs-beaver-reading");
  return [
    ["Story by the fire", async () => {
      const her = (window as { mrsBeaver?: ReadingDebug }).mrsBeaver ?? skip("no Mrs. Beaver feature");
      await until(() => !!her.her(), 20, "her beaver never loaded");
      if (her.state !== "freed") her.free();
      await until(() => near(her.her()!, her.home) < 0.3, 40, `she did not get home: ${near(her.her()!, her.home).toFixed(1)} m from it`);

      // Up to the seat from behind it, so the beaver ends facing the fire and her beside it.
      const seat = her.seat, behind = { x: seat.x - Math.sin(seat.face) * 1.5, z: seat.z - Math.cos(seat.face) * 1.5 };
      await walkTo(behind.x, behind.z, { near: 0.5, limit: 90, hop: true });
      await walkTo(seat.x, seat.z, { near: 0.25, limit: 15 });
      expect(near(player.feet, her.fire) < 2, `stood ${near(player.feet, her.fire).toFixed(2)} m from the fire, not beside it`);
      expect(!her.reading, "standing by the fire, a Reading runs already");
      if (live) await wait(1);

      want.dive = true;
      let stopped: { story: number; line: number; text: string };
      try {
        await until(() => player.motion.low === "sit", 2, "held C by the fire, the beaver does not sit");
        await until(() => her.said?.reader === "her", 2, `sat by the fire with her home, the line is ${JSON.stringify(her.said)}, not one she reads`);
        const first = her.said!.text;
        await until(() => shown() === first, 1, `her line "${first}" is not over her head: the HUD shows "${shown()}"`);
        await until(() => her.said?.text !== first, LINE + 1, `her line "${first}" stayed up past ${LINE + 1} s`);
        expect(her.said?.reader === "player", `the line after hers is read by ${her.said?.reader}, not the player`);
        await until(() => shown() === her.said!.text, 1, `the player's line is not shown: the HUD shows "${shown()}"`);
        if (live) await wait(20 - LINE); // live: several lines back and forth
        await wait(1); // a moment into the line
        stopped = { story: her.story, line: her.line, text: her.said!.text };
      } finally { want.dive = false; }

      // Standing up: the line is gone at once.
      await until(() => !her.reading && !shown(), 1, `stood up, the line "${shown()}" still shows`);
      await until(() => player.motion.low === undefined, 1.5, "let go of C, the beaver stays sitting");
      await wait(live ? 2 : LINE + 0.5); // longer than a line: standing moves nothing on

      // Sitting again: the same line, not the story's first.
      want.dive = true;
      try {
        await until(() => her.reading, 2, "sat by the fire again, no Reading runs");
        expect(her.story === stopped.story && her.line === stopped.line && her.said?.text === stopped.text,
          `sat again at story ${her.story} line ${her.line} ("${her.said?.text}"), not where it stopped: story ${stopped.story} line ${stopped.line}`);
        expect(stopped.line > 0, "stopped at a story's first line: no proof it goes on where it stopped");
        await until(() => shown() === stopped.text, 1, `sat again, the HUD shows "${shown()}", not "${stopped.text}"`);
        if (live) await wait(LINE * 2);
      } finally { want.dive = false; }
      await until(() => !shown(), 1.5, "stood up at the end, the line still shows");
    }, "Find Mrs. Beaver"],
  ];
};
