// The trade feature's ledger as plain logic: the goods the trading post holds, the sticks paid towards each (its
// pile), and the goods in the backpack. One player's own, kept in their browser (docs/adr/0003): nothing of it goes
// over the network.
//
//   const l = load(localStorage.getItem(KEY));
//   pay(l, "feather")      → { good, paid, bought, count }: one stick onto its pile; at the price the pile empties into
//                            one good more (undefined: no such good)
//   offerText(l, "feather") "Trade for feather, 1/2" · backpackLine(l) "Pinecone ×2   Feather ×1"
//
// The goods are data: a later good (one made by combining others) is one more entry, not a special case.

export interface Good {
  id: string;
  /** In words, as the prompt says it ("Trade for feather"). */
  name: string;
  /** Sticks it costs. */
  price: number;
}

/** What lies on the trading post, in the order of its spots. */
export const GOODS: readonly Good[] = [
  { id: "pinecone", name: "pinecone", price: 1 },
  { id: "feather", name: "feather", price: 2 },
  { id: "shell", name: "shell", price: 3 },
];
export const goodOf = (id: string) => GOODS.find((g) => g.id === id);

export interface Ledger {
  version: 1;
  /** Sticks on each good's pile, by good id; left out: none. */
  paid: Record<string, number>;
  /** Goods in the backpack, by good id; left out: none. */
  owned: Record<string, number>;
}

export const newLedger = (): Ledger => ({ version: 1, paid: {}, owned: {} });

/** One stick onto a good's pile. At the price, the pile empties and the backpack holds one more of it. */
export function pay(l: Ledger, id: string): { good: string; paid: number; bought: boolean; count: number } | undefined {
  const good = goodOf(id);
  if (!good) return undefined;
  const paid = (l.paid[id] ?? 0) + 1, bought = paid >= good.price;
  if (bought) { delete l.paid[id]; l.owned[id] = (l.owned[id] ?? 0) + 1; } else l.paid[id] = paid;
  return { good: id, paid: l.paid[id] ?? 0, bought, count: l.owned[id] ?? 0 };
}

/** What E says at a good's spot with a stick in hand: the good and the sticks paid towards it so far. */
export const offerText = (l: Ledger, id: string) => `Trade for ${goodOf(id)!.name}, ${l.paid[id] ?? 0}/${goodOf(id)!.price}`;

const title = (name: string) => name[0]!.toUpperCase() + name.slice(1);
/** The backpack row: each good owned, with its count; "" while there are none. */
export const backpackLine = (l: Ledger) =>
  GOODS.filter((g) => (l.owned[g.id] ?? 0) > 0).map((g) => `${title(g.name)} ×${l.owned[g.id]}`).join("   ");

const counts = (v: unknown, most: (id: string) => number) => {
  const out: Record<string, number> = {};
  if (v && typeof v === "object" && !Array.isArray(v))
    for (const [id, n] of Object.entries(v)) if (goodOf(id) && Number.isInteger(n) && (n as number) > 0) out[id] = Math.min(n as number, most(id));
  return out;
};

/** Reads a saved ledger; anything broken gives a fresh one, counts that make no sense are left out. */
export function load(text: string | null): Ledger {
  try {
    const l = JSON.parse(text ?? "");
    if (l?.version !== 1 || typeof l.paid !== "object" || typeof l.owned !== "object" || Array.isArray(l.paid)) return newLedger();
    return { version: 1, paid: counts(l.paid, (id) => goodOf(id)!.price - 1), owned: counts(l.owned, () => Infinity) };
  } catch { return newLedger(); }
}
