// Tests for the trade feature's ledger: paying fills a pile, the price empties it and adds one good, and the counts
// survive a save and a load. Run: bun test src/features/trade
import { describe, expect, test } from "bun:test";
import { GOODS, goodOf, label, load, newLedger, offerText, pay, POST_GOODS } from "./ledger.ts";
import { shelf } from "./hold.ts";

describe("the ledger", () => {
  test("the goods, in order, with their prices in sticks", () => {
    expect(GOODS.map((g) => [g.id, g.price])).toEqual([["pinecone", 1], ["feather", 2], ["shell", 3], ["loaf", 3]]);
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
  test("counts survive a save and a load; anything broken loads as a fresh ledger", () => {
    const l = newLedger();
    pay(l, "shell"); pay(l, "pinecone");
    expect(load(JSON.stringify(l))).toEqual(l);
    for (const bad of [null, "", "{", "[]", '{"version":2}', '{"version":1,"paid":3,"owned":{}}']) expect(load(bad)).toEqual(newLedger());
    expect(load('{"version":1,"paid":{"shell":-4,"hat":2},"owned":{"feather":1.5,"pinecone":3}}')).toEqual({ ...newLedger(), owned: { pinecone: 3 } });
  });
});

describe("the loaf, baked at the bakery from the same ledger", () => {
  test("three sticks bake one loaf and clear its paid count; the prompt counts n/3", () => {
    const l = newLedger();
    expect(offerText(l, "loaf")).toBe("Bake a loaf, 0/3");
    expect(pay(l, "loaf")).toEqual({ good: "loaf", paid: 1, bought: false, count: 0 });
    expect(offerText(l, "loaf")).toBe("Bake a loaf, 1/3");
    pay(l, "loaf");
    expect(offerText(l, "loaf")).toBe("Bake a loaf, 2/3");
    expect(pay(l, "loaf")).toEqual({ good: "loaf", paid: 0, bought: true, count: 1 });
    expect(l.paid.loaf).toBeUndefined();
    expect(offerText(l, "loaf")).toBe("Bake a loaf, 0/3");
  });
  test("the trading post lays out its own goods, never the loaf", () => {
    expect(POST_GOODS.map((g) => g.id)).toEqual(["pinecone", "feather", "shell"]);
    expect(goodOf("loaf")?.at).toBe("bakery");
  });
  test("the backpack row lists Loaf ×n next to the post's goods", () => {
    const l = newLedger();
    pay(l, "pinecone"); pay(l, "pinecone");
    for (let k = 0; k < 6; k++) pay(l, "loaf");
    expect(shelf(l).map((id) => label(id, l.owned[id]!))).toEqual(["Pinecone ×2", "Loaf ×2"]);
  });
  test("an old ledger without loaves loads; a broken loaf count is dropped", () => {
    expect(load('{"version":1,"paid":{"feather":1},"owned":{"shell":2}}')).toEqual({ version: 1, paid: { feather: 1 }, owned: { shell: 2 } });
    expect(load('{"version":1,"paid":{"loaf":7},"owned":{"loaf":"many","pinecone":1}}')).toEqual({ version: 1, paid: { loaf: 2 }, owned: { pinecone: 1 } });
    expect(load('{"version":1,"paid":{"loaf":-1},"owned":{"loaf":2.5}}')).toEqual(newLedger());
  });
});
