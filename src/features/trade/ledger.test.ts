// Tests for the trade feature's ledger: paying fills a pile, the price empties it and adds one good, and the counts
// survive a save and a load. Run: bun test src/features/trade
import { describe, expect, test } from "bun:test";
import { backpackLine, GOODS, goodOf, load, newLedger, offerText, pay } from "./ledger.ts";

describe("the ledger", () => {
  test("the goods, in order, with their prices in sticks", () => {
    expect(GOODS.map((g) => [g.id, g.price])).toEqual([["pinecone", 1], ["feather", 2], ["shell", 3]]);
    expect(goodOf("shell")?.name).toBe("shell");
    expect(goodOf("hat")).toBeUndefined();
  });
  test("paying fills a pile; the price empties it and adds one good, again and again", () => {
    const l = newLedger();
    expect(offerText(l, "feather")).toBe("Trade for feather, 0/2");
    expect(pay(l, "feather")).toEqual({ good: "feather", paid: 1, bought: false, count: 0 });
    expect(offerText(l, "feather")).toBe("Trade for feather, 1/2");
    expect(pay(l, "feather")).toEqual({ good: "feather", paid: 0, bought: true, count: 1 });
    expect(pay(l, "pinecone")).toEqual({ good: "pinecone", paid: 0, bought: true, count: 1 });
    expect(pay(l, "pinecone")).toMatchObject({ bought: true, count: 2 });
    expect(pay(l, "hat")).toBeUndefined();
    expect(l.owned).toEqual({ pinecone: 2, feather: 1 });
  });
  test("the backpack row lists the goods owned, counting those owned more than once", () => {
    const l = newLedger();
    expect(backpackLine(l)).toBe("");
    pay(l, "pinecone"); pay(l, "pinecone"); pay(l, "shell"); pay(l, "shell"); pay(l, "shell");
    expect(backpackLine(l)).toBe("Pinecone ×2   Shell");
  });
  test("counts survive a save and a load; anything broken loads as a fresh ledger", () => {
    const l = newLedger();
    pay(l, "shell"); pay(l, "pinecone");
    expect(load(JSON.stringify(l))).toEqual(l);
    for (const bad of [null, "", "{", "[]", '{"version":2}', '{"version":1,"paid":3,"owned":{}}']) expect(load(bad)).toEqual(newLedger());
    expect(load('{"version":1,"paid":{"shell":-4,"hat":2},"owned":{"feather":1.5,"pinecone":3}}')).toEqual({ ...newLedger(), owned: { pinecone: 3 } });
  });
});
