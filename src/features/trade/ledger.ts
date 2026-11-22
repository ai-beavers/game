// The trade feature's ledger as plain logic: the goods (the trading post's and the bakery's loaf), the sticks paid
// towards each (its pile, or the loaf's sticks in the oven), and the goods in the backpack. One player's own, kept in their browser (docs/adr/0003): nothing of it goes
// over the network.
//
//   const l = load(localStorage.getItem(KEY));
//   pay(l, "feather")      → { good, paid, bought, count }: one stick onto its pile; at the price the pile empties into
//                            one good more (undefined: no such good)
//   offerText(l, "feather") "Trade for feather, 1/2"     · offerText(l, "loaf") "Bake a loaf, 1/3"
//   label("loaf", 1)        "Loaf ×1": a good in the backpack row as the HUD says it (the row itself: hold.ts shelf)
//   missing(l, "charm")     ["shell"]: the goods of its recipe not in the backpack ([]: it can be made)
//   craftText(l, "charm")   "Make a charm (feather + shell)" · "Needs a shell": what E says at the workbench
//   craft(l, "charm")       → { good, count }: one of each of its recipe's goods out of the backpack and one charm in,
//                            all at once (undefined: something is missing, nothing changed)
//
// The goods are data: a good made from others (the charm) is one more entry with its recipe, not a special case.

export interface Good {
  id: string;
  /** In words, as the prompt says it ("Trade for feather"). */
  name: string;
  /** Sticks it costs; 0 for a good made at the workbench, which takes no sticks. */
  price: number;
  /** Where it is got: on the trading post, baked in the bakery's oven, or made at the workbench. */
  at: "post" | "bakery" | "workbench";
  /** A good made at the workbench: the goods it uses up, one of each. */
  recipe?: readonly string[];
}

/** Every good, in the backpack's order: what lies on the trading post (in the order of its spots), the loaf, the
 *  charm. */
export const GOODS: readonly Good[] = [
  { id: "pinecone", name: "pinecone", price: 1, at: "post" },
  { id: "feather", name: "feather", price: 2, at: "post" },
  { id: "shell", name: "shell", price: 3, at: "post" },
  { id: "loaf", name: "loaf", price: 3, at: "bakery" },
  { id: "charm", name: "charm", price: 0, at: "workbench", recipe: ["feather", "shell"] },
];
/** What lies on the trading post, in the order of its spots. */
export const POST_GOODS: readonly Good[] = GOODS.filter((g) => g.at === "post");
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
  if (!good || good.at === "workbench") return undefined;
  const paid = (l.paid[id] ?? 0) + 1, bought = paid >= good.price;
  if (bought) { delete l.paid[id]; l.owned[id] = (l.owned[id] ?? 0) + 1; } else l.paid[id] = paid;
  return { good: id, paid: l.paid[id] ?? 0, bought, count: l.owned[id] ?? 0 };
}

/** What E says at a good's spot (or the bakery's oven) with a stick in hand: the good and the sticks paid so far. */
export function offerText(l: Ledger, id: string): string {
  const good = goodOf(id)!, paid = `${l.paid[id] ?? 0}/${good.price}`;
  return good.at === "bakery" ? `Bake a ${good.name}, ${paid}` : `Trade for ${good.name}, ${paid}`;
}

/** The goods of a recipe not in the backpack, in the recipe's order; [] when it can be made. */
export const missing = (l: Ledger, id: string): string[] => (goodOf(id)?.recipe ?? []).filter((g) => (l.owned[g] ?? 0) < 1);

const a = (id: string) => `a ${goodOf(id)!.name}`;
/** What E says at the workbench: what it makes and uses up, or what it still needs. */
export function craftText(l: Ledger, id: string): string {
  const good = goodOf(id)!, lack = missing(l, id);
  if (!lack.length) return `Make ${a(id)} (${good.recipe!.map((g) => goodOf(g)!.name).join(" + ")})`;
  return `Needs ${lack.length === 1 ? a(lack[0]!) : `${lack.slice(0, -1).map(a).join(", ")} and ${a(lack.at(-1)!)}`}`;
}

/** Makes a good at the workbench: one of each of its recipe's goods out of the backpack and one of it in, in one
 *  change. Refused (undefined, nothing changed) for a good with no recipe or with one of its goods missing. */
export function craft(l: Ledger, id: string): { good: string; count: number } | undefined {
  const recipe = goodOf(id)?.recipe;
  if (!recipe || missing(l, id).length) return undefined;
  for (const g of recipe) { const n = l.owned[g]! - 1; if (n > 0) l.owned[g] = n; else delete l.owned[g]; }
  l.owned[id] = (l.owned[id] ?? 0) + 1;
  return { good: id, count: l.owned[id] };
}

/** A good in the backpack as the HUD says it: "Loaf ×2". */
export const label = (id: string, count: number) => `${goodOf(id)!.name[0]!.toUpperCase()}${goodOf(id)!.name.slice(1)} ×${count}`;

const counts = (v: unknown, most: (id: string) => number) => {
  const out: Record<string, number> = {};
  if (v && typeof v === "object" && !Array.isArray(v))
    for (const [id, n] of Object.entries(v)) if (goodOf(id) && most(id) > 0 && Number.isInteger(n) && (n as number) > 0) out[id] = Math.min(n as number, most(id));
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
