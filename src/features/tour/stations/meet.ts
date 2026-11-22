// Meeting another beaver: a visitor, a Bot (../visitor.ts), joins the Tour's world over the network as any client
// does and stands on the land near the building site. The beaver walks up to it as a player who spots someone. On
// the way the visitor is a Remote with its name tag; Tab's Players list names it; when the beaver is within a few
// metres the visitor turns to it and says hello, in a bubble over its head and in the chat log. Then it leaves, and
// its Remote, tag and place in the list go. Two tours share the Tour's world, so the station looks only at its own
// visitor, by its id and the name the server gave it; it never counts Remotes nor expects the last line of the log.
// What it checks is what the page shows (HUD controls by name), and where the Remote is drawn (window.net.drawn).
import { POND } from "../../../world/terrain.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";
import { visit } from "../visitor.ts";

/** What the net feature puts on window for tools (src/features/net/index.ts); only the part the tour needs. */
interface NetDebug {
  connected: boolean;
  me: number;
  remotes: Map<number, { name: string }>;
  drawn(id: number): { x: number; z: number; facing: number; faces: number } | undefined;
}

/** Where a visitor stands, by its id: on the land between the spawn and the building site, off the dam and the shop. */
const SPOTS = [{ x: 0.3, z: 2.3 }, { x: -0.5, z: 1.9 }, { x: 1.0, z: 2.9 }];
const NAME = "Visitor", HELLO = "Hello!";
const GREET = 3.5; // m: the beaver this near, the visitor greets it
const STOP = 2; // m short of the visitor the beaver stops
const FACES = 0.3; // rad the drawn Remote may be off the beaver when it faces it

export const meeting = (kit: Kit): Station[] => {
  const { player, world, stage, live, wait, until, walkTo, expect, hudText, press, frame } = kit;
  const shown = (name: string) => !!stage.hud.getControlByName(name)?.isVisible;
  const players = () => hudText("players-list").split("\n");
  /** The Players list while Tab is held. */
  const listed = async () => {
    press("Tab", "keydown");
    try { await frame(); await frame(); return players(); } finally { press("Tab", "keyup"); }
  };
  return [
    ["Meet a beaver", async () => {
      const net = (window as { net?: NetDebug }).net;
      if (!net?.connected) return skip("no connection to a server");
      if (!stage.hud.getControlByName("players-list")) return skip("no HUD");
      const visitor = await visit(NAME);
      const { id, name } = visitor, tag = `name-${id}`, bubble = `said-${id}`;
      try {
        const spot = SPOTS[id % SPOTS.length]!, at = { ...spot, y: world.heightAt(spot.x, spot.z) };
        visitor.stand(at, Math.atan2(POND.x - at.x, POND.z - at.z)); // looking out over the pond
        await until(() => !!net.drawn(id), 5, `the visitor (${name}, id ${id}) never appeared as a Remote`);
        expect(net.remotes.get(id)?.name === name, `the visitor's Remote is named "${net.remotes.get(id)?.name}", not "${name}"`);

        // Up to it from where the beaver stands, the last metres walked.
        const dx = at.x - player.feet.x, dz = at.z - player.feet.z, d = Math.hypot(dx, dz);
        const stop = { x: at.x - (dx / d) * STOP, z: at.z - (dz / d) * STOP };
        await walkTo(stop.x, stop.z, { near: 0.4, limit: 40, hop: true });
        await until(() => shown(tag) && hudText(tag) === name, 3, () => `near the visitor its tag reads "${hudText(tag)}" (${shown(tag) ? "shown" : "hidden"}), not "${name}"`);

        const list = await listed();
        expect(list.includes(name), `Tab held, the Players list reads "${list.join(" / ")}", without "${name}"`);

        // The visitor sees the beaver come near from its state messages, as any client would; then it turns and greets.
        const near = () => { const b = visitor.seen(net.me); return b && Math.hypot(b.x - at.x, b.z - at.z) < GREET ? b : undefined; };
        await until(() => !!near(), 3, () => `the beaver stands ${Math.hypot(player.feet.x - at.x, player.feet.z - at.z).toFixed(1)} m from the visitor, and the visitor never heard it come near`);
        const beaver = near()!;
        visitor.face(Math.atan2(beaver.x - at.x, beaver.z - at.z));
        visitor.say(HELLO);
        await until(() => (net.drawn(id)?.faces ?? Infinity) < FACES, 4, () => `the visitor stays turned ${net.drawn(id)?.faces.toFixed(2)} rad away from the beaver`);
        await until(() => shown(bubble) && hudText(bubble) === HELLO, 3, () => `the visitor's bubble reads "${hudText(bubble)}" (${shown(bubble) ? "shown" : "hidden"}), not "${HELLO}"`);
        const line = `${name}: ${HELLO}`;
        await until(() => hudText("chat-log").split("\n").includes(line), 2, () => `the chat log reads "${hudText("chat-log").split("\n").slice(-3).join(" / ")}", without "${line}"`);
        if (live) await wait(4); // the stream reads the bubble before the visitor goes
      } finally { visitor.close(); }

      await until(() => !net.remotes.has(id) && !stage.hud.getControlByName(tag), 5, () => `the visitor left, and its ${net.remotes.has(id) ? "Remote" : `tag "${hudText(tag)}"`} stays`);
      // Another visitor of the same name may have come in since (another tour): only those still here may be listed.
      const after = await listed(), still = [...net.remotes.values()].filter((r) => r.name === name).length;
      expect(after.filter((n) => n === name).length <= still, `the visitor left, and the Players list still reads "${after.join(" / ")}"`);
    }],
  ];
};
