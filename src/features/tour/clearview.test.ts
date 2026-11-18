import { expect, test } from "bun:test";
import { isTrunk } from "./clearview.ts";

test("a gnawed tree's bark and its Bite count as trunk, so the clear view never fades them; crowns still fade", () => {
  expect(isTrunk("tree_3_wood")).toBe(true);
  expect(isTrunk("cut tree_3_wood")).toBe(true); // the bark above and below the Bite (build/tree.ts)
  expect(isTrunk("gnawed wood")).toBe(true);
  expect(isTrunk("tree_3_leaves")).toBe(false);
  expect(isTrunk("bush_1")).toBe(false);
});
