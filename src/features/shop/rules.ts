// The Shop's rules as plain logic, apart from rendering, so they can be tested alone: how much Experience the player
// has, which Outfits they own and which one they wear, and the named changes that alone change that.
//
//   const state = load(localStorage.getItem(KEY));    any stored text, broken or missing: a valid state
//   earn(state, 1)                                    one Experience for a stick built in
//   buy(state, "moss")                                true: paid and worn; false: owned already, or too dear
//   wear(state, "classic")                            true: now worn; false: not owned
//
// The state is plain JSON, kept in localStorage beside the build feature's saved game.

export type OutfitId = "classic" | "moss" | "sunset" | "disco";
/** An Outfit: a matching shirt colour and hat colour, linear RGB 0 … 1, and its price in Experience. */
export interface Outfit { id: OutfitId; name: string; price: number; shirt: [number, number, number]; hat: [number, number, number] }

/** The look every beaver has before it buys anything: free, always owned. Its colours are the beaver's own
 *  (src/beaver: the cream shirt as printed, the charcoal felt hat). */
export const DEFAULT: OutfitId = "classic";
export const OUTFITS: readonly Outfit[] = [
  { id: "classic", name: "Classic", price: 0, shirt: [1, 1, 1], hat: [0.075, 0.062, 0.058] },
  { id: "moss", name: "Moss", price: 10, shirt: [0.3, 0.55, 0.26], hat: [0.12, 0.26, 0.1] },
  { id: "sunset", name: "Sunset", price: 25, shirt: [1, 0.42, 0.12], hat: [0.5, 0.1, 0.06] },
  { id: "disco", name: "Disco", price: 50, shirt: [0.85, 0.2, 0.75], hat: [0.95, 0.68, 0.12] },
];
export const outfit = (id: OutfitId) => OUTFITS.find((o) => o.id === id)!;

export interface ShopState { experience: number; owned: OutfitId[]; wearing: OutfitId }

const known = (id: unknown): id is OutfitId => OUTFITS.some((o) => o.id === id);

/** A valid state from whatever was stored: nothing, broken JSON, an older or tampered state. The default is always owned. */
export function load(stored: string | null | undefined): ShopState {
  let raw: Partial<Record<keyof ShopState, unknown>> = {};
  try { const parsed = JSON.parse(stored ?? "null"); if (parsed && typeof parsed === "object") raw = parsed; } catch { /* a new state */ }
  const experience = typeof raw.experience === "number" && Number.isFinite(raw.experience) ? Math.max(0, Math.floor(raw.experience)) : 0;
  const owned = OUTFITS.map((o) => o.id).filter((id) => id === DEFAULT || (Array.isArray(raw.owned) && raw.owned.includes(id)));
  const wearing = known(raw.wearing) && owned.includes(raw.wearing) ? raw.wearing : DEFAULT;
  return { experience, owned, wearing };
}

/** n Experience earned (one per stick built in). */
export function earn(s: ShopState, n: number) {
  if (Number.isFinite(n) && n > 0) s.experience += Math.floor(n);
}

/** Pays for an Outfit and puts it on. Refused (false, nothing changes) when it is owned already or costs more than the
 *  Experience there is. */
export function buy(s: ShopState, id: OutfitId): boolean {
  if (!known(id) || s.owned.includes(id) || outfit(id).price > s.experience) return false;
  s.experience -= outfit(id).price;
  s.owned = OUTFITS.map((o) => o.id).filter((o) => o === id || s.owned.includes(o));
  s.wearing = id;
  return true;
}

/** Puts on an owned Outfit (or the default), for free. False: not owned. */
export function wear(s: ShopState, id: OutfitId): boolean {
  if (!s.owned.includes(id)) return false;
  s.wearing = id;
  return true;
}
