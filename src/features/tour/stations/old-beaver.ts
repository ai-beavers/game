// The Old Beaver: found at the foot of the bank and listened to, as a player would. The beaver walks the last metres
// up to him; within a few metres on land he begins a Lore: its first line under his name in the speech box, his
// murmur started (or, where the page's sound is still locked, the line sent to the audio feature), and he turns to
// face the beaver. Then the beaver walks off mid-lore: he breaks off with his closing word, and the speech box clears.
// Live, the beaver hears the whole lore out before it goes. Only the reset and where he sits come from the feature's
// debug handle.
import { BREAK, CLOSING, LORES, START, type XZ } from "../../old-beaver/rules.ts";
import { NAME } from "../../old-beaver/panel.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the feature puts on window for tools (src/features/old-beaver/index.ts); only the part the tour needs. */
interface OldBeaverDebug {
  place: XZ;
  state: "idle" | "telling" | "away";
  lore: number;
  line: number;
  said: string;
  loaded: boolean;
  faces(): number;
  reset(): void;
}

export const oldBeaver = (kit: Kit): Station[] => {
  const { game, player, live, wait, until, walkTo, expect, hudText, stage } = kit;
  const shown = (name: string) => !!stage.hud.getControlByName(name)?.isVisible;
  return [
    ["Hear a lore", async () => {
      const him = (window as { oldBeaver?: OldBeaverDebug }).oldBeaver ?? skip("no Old Beaver feature");
      him.reset();
      await until(() => him.loaded, 20, "the Old Beaver's beaver never loaded");
      expect(him.state === "idle" && !shown("old-beaver-line"), `after a reset he is ${him.state}, the speech box ${shown("old-beaver-line") ? "shown" : "hidden"}`);
      let heard = 0;
      const off = game.events.on("oldBeaverSpeaks", () => heard++);
      const murmurs = () => (window as { audio?: { played: Record<string, number> } }).audio?.played.murmur ?? 0, before = murmurs();
      try {
        // Towards him from the Clearing's middle, the way a player wandering out comes; the last metres walked.
        const p = him.place, r = Math.hypot(p.x, p.z), at = (d: number) => ({ x: p.x - (p.x / r) * d, z: p.z - (p.z / r) * d });
        const outside = at(START + 3), stand = at(START - 1.5);
        await walkTo(outside.x, outside.z, { near: 0.6, limit: 90, hop: true });
        expect(him.state === "idle", `${Math.hypot(player.feet.x - p.x, player.feet.z - p.z).toFixed(1)} m from him he began a lore already`);
        await walkTo(stand.x, stand.z, { near: 0.3, limit: 20, arrived: () => him.state === "telling" });
        await until(() => him.state === "telling", 2, `${Math.hypot(player.feet.x - p.x, player.feet.z - p.z).toFixed(1)} m from him on land, he tells nothing`);
        const lore = him.lore, first = LORES[lore]![0]!;
        await until(() => hudText("old-beaver-line") === first && shown("old-beaver-line"), 2, `the speech box reads "${hudText("old-beaver-line")}", not lore ${lore + 1}'s first line`);
        expect(hudText("old-beaver-name") === NAME && shown("old-beaver-name"), `the speech box is headed "${hudText("old-beaver-name")}", not "${NAME}"`);
        await until(() => murmurs() > before || heard > 0, 2, "he began a lore, but no murmur started and no line went to the audio feature");
        expect(heard > 0, "his murmur played without the oldBeaverSpeaks event");
        await until(() => him.faces() < 0.35, 4, `telling, he stays turned ${him.faces().toFixed(2)} rad away from the beaver`);

        if (live) await until(() => him.state === "away", 40, "he never finished his lore");
        else {
          // Off mid-lore, back towards the middle: his closing word, then the speech box clears.
          const leave = at(BREAK + 2);
          await walkTo(leave.x, leave.z, { near: 0.6, limit: 30, arrived: () => him.state !== "telling" });
          expect(him.state === "idle", `walked off mid-lore, he is ${him.state}, not ready for the next`);
          expect(him.said === CLOSING, `walked off mid-lore, he says "${him.said}", not his closing word`);
          await until(() => !shown("old-beaver-line") && !shown("old-beaver-back"), 6, `the speech box still reads "${hudText("old-beaver-line")}"`);
        }
        if (live) await wait(1);
      } finally { off(); }
    }, "Visit the Old Beaver"],
  ];
};
