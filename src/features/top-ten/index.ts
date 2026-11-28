// The Top-ten board (a viewer's wish): a board at the edge of the building site that ranks the ten players who have
// built the most sticks into the dam, the lodge and the cache since the world began, each by the name they built
// under, with their count (board.ts, place.ts). The room counts them, never a page (docs/adr/0012): this feature only
// draws the rows src/features/net hands it (the topTen event), on joining and whenever anyone's stick changed them.
// Without a server the page has no tally, and the board says nobody has built yet.
//
//   import { create as topTen } from "./features/top-ten/index.ts";
//
// Debug, for bun shot --eval (window.topTen): topTen.rows (what the board last drew) · topTen.place (where it stands)
// · topTen.at() stands in front of it, facing it.
import type { CreateFeature } from "../../game.ts";
import { createBoard } from "./board.ts";
import { BOARD, FRONT, READ_AT } from "./place.ts";
import { sameRows, type TopRow } from "./rules.ts";

export const create: CreateFeature = (game) => {
  const { stage, world, player, events } = game;
  const board = createBoard(stage, world);
  let rows: readonly TopRow[] = [];
  board.show(rows);
  events.on("topTen", ({ rows: next }) => {
    if (sameRows(rows, next)) return;
    rows = next;
    board.show(rows);
  });

  Object.assign(window, {
    topTen: {
      get rows() { return rows; },
      place: { x: BOARD.x, z: BOARD.z },
      at() {
        const x = BOARD.x + FRONT.x * READ_AT, z = BOARD.z + FRONT.z * READ_AT, facing = BOARD.yaw + Math.PI;
        player.teleport(x, world.heightAt(x, z), z, facing);
        player.camera.yaw = facing + Math.PI;
        return { at: [+x.toFixed(2), +z.toFixed(2)] };
      },
    },
  });

  return { update() { board.light(game.sky?.dark ?? 0); } };
};
