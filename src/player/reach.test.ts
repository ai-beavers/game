// The beaver's reach upwards: a jump and a Double jump at its top stay under the walls that keep it out (the shop's).
import { expect, test } from "bun:test";
import { DOUBLE_JUMP_HEIGHT, JUMP_HEIGHT, WALL_SOLID } from "./index.ts";

test("a jump and a Double jump stay under the walls' colliders", () => {
  expect(DOUBLE_JUMP_HEIGHT).toBeGreaterThan(0);
  expect(JUMP_HEIGHT + DOUBLE_JUMP_HEIGHT).toBeLessThan(WALL_SOLID - 0.05);
});
