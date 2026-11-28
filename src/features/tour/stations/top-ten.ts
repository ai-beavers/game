// The Top-ten board (a viewer's wish): the board at the edge of the building site ranks who built the most sticks
// into the dam, the lodge and the cache, counted by the server. The beaver notes its own row, builds one stick in
// where the world needs it next (the dam, the lodge or the cache), and sees its name on the board with one more. It
// plays in the tour's own world, whose tally is its own: nothing here counts on the players' board.
import { LODGE, SLOTS, STICKS } from "../../build/rules.ts";
import { BOARD, FRONT } from "../../top-ten/place.ts";
import type { TopRow } from "../../top-ten/rules.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the top-ten and net features put on window for tools (src/features/top-ten/index.ts, net/index.ts). */
interface TopTenDebug { rows: readonly TopRow[] }
interface NetDebug { connected: boolean; name: string }

export const topTen = (kit: Kit): Station[] => {
  const { player, live, until, walkTo, wait, expect, needBuild, buildUpTo, stockUpTo } = kit;
  /** To the board's front, the last steps towards it, and the camera turned to it, as a player looks to read it. */
  const lookAtBoard = async () => {
    await walkTo(BOARD.x + FRONT.x * 2.6, BOARD.z + FRONT.z * 2.6, { near: 0.5, hop: true, limit: 60 });
    await walkTo(BOARD.x + FRONT.x * 1.7, BOARD.z + FRONT.z * 1.7, { near: 0.3, limit: 15 });
    player.camera.yaw = BOARD.yaw; // from behind the beaver, looking at the face
  };
  return [
    ["Top ten", async () => {
      const board = (window as { topTen?: TopTenDebug }).topTen ?? skip("no Top-ten board");
      const net = (window as { net?: NetDebug }).net ?? skip("no server: nobody counts the sticks");
      await until(() => net.connected && !!net.name, 10, "never joined the server, so no tally");
      const b = needBuild(), n = b.state.dam.length;
      if (n >= STICKS) return skip("the dam, the lodge and the cache are full");
      const mine = () => board.rows.find((r) => r.name.toLowerCase() === net.name.toLowerCase());
      // 1. Its row as the board shows it now (none: not on it yet).
      if (live) { await lookAtBoard(); await wait(3); }
      const before = mine()?.sticks ?? 0;
      // 2. One stick in, where the world needs it next.
      if (n < SLOTS + LODGE) await buildUpTo(n + 1, n >= SLOTS);
      else await stockUpTo(n + 1);
      // 3. Its name on the board, with one more.
      await until(() => mine()?.sticks === before + 1, 5, () => `built a stick in as "${net.name}", the board shows ${mine() ? `${mine()!.sticks} for it` : "no row for it"}, not ${before + 1}`);
      await lookAtBoard();
      expect(mine()?.sticks === before + 1, `walked to the board, it shows ${mine()?.sticks ?? "no row"} for "${net.name}", not ${before + 1}`);
      await wait(live ? 6 : 0.5); // live: a while in front of it, for the stream to read it
    }, "Dam work"],
  ];
};
