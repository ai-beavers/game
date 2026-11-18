// The rules of the build feature as plain logic, independent of rendering and physics so they can be tested alone: the
// world state (which trees are gnawed, felled, lying, broken into wood; which sticks are in the dam), the named
// changes that alone change it, and what follows from it (bites a tree takes, wood it yields, where each stick of
// the dam goes, the goals). A tree whose wood is gone grows back on its stump (REGROW) and can be felled again.
//
//   const state = newState();
//   apply(state, { type: "bite", tree: 4 });          true when it changed something; the only way to change state
//   used(state, "w3")                                 the stick left the world: in the dam, lodge, cache, or traded
//   live(state.trees[4])                              the tree standing or lying there now (undefined: only a stump)
//   bitesToFell(radius) · woodFrom(tree, trunk) · damPlan() · moundHeight(placed) · goals(state) · pondRise(placed)
//   pondLevel(full, placed): where the pond's surface stands with this many sticks in the dam
//   lodgeGrow(placed): how far the lodge stands out of the pond (after the dam's SLOTS sticks come LODGE onto it)
//   cachePlan(): where the CACHE sticks of the food cache go, on the pond's bed at CACHE_AT (after the lodge's)
//
// The state is plain JSON: it is kept in localStorage and the changes can be sent to other players as they are.
import { seeded } from "../../world/noise.ts";

/** Sticks in a finished dam. */
export const SLOTS = 30;
/** Sticks the beaver builds onto the lodge after the dam, swimming them out to it. They follow the dam's in
 *  BuildState.dam (slots SLOTS … SLOTS + LODGE - 1), so whatever counts the sticks gone from the world counts them too. */
export const LODGE = 10;
/** Sticks the beaver wedges into the food cache once the lodge stands, diving them down to the pile on the bed beside
 *  it. They follow the lodge's in BuildState.dam (slots SLOTS + LODGE …), counted as theirs are. */
export const CACHE = 12;
/** Every stick the world takes: the dam, the lodge, the cache. */
export const STICKS = SLOTS + LODGE + CACHE;
/** Seconds of gnawing per bite. */
export const BITE_TIME = 0.6;
/** Bites that break a lying tree into wood. */
export const BITES_TO_SPLIT = 4;
/** How much the pond rises with the finished dam, m. It starts this far below the world's water level (a low pond
 *  with reeds on mud) and the finished dam fills it to that level, which the world is laid out for: so nothing that
 *  must stay dry floods. The meadow round the pond lies only 5 to 15 cm above that level: higher would spill. */
export const POND_RISE = 0.25;

// The forest grows back. The rule: a tree whose wood is gone (split) stands again REGROW seconds later, by the
// server's clock, and only through a "grow" change, which the server admits no earlier (net/protocol.ts admit, from
// the time it stamped on the split, kept in its log and file, so a restart with WORLD_FILE does not reset the count).
// apply() never looks at a clock: a copy takes the grow it is told of. Each copy counts from when it learned of the
// split by its own clock (state.trees[i].gone), so clocks that differ do not matter, only the message's way there;
// whoever's count runs out first (plus a few seconds' grace, build/index.ts) asks. One who joined later counts from
// joining: it asks late, never early. From SPROUT on a sapling shows on the stump, growing to the full tree.
/** Seconds from a tree's wood going to a tree standing there again: 10 minutes, so felling one matters, and a
 *  stream sees the clearing fill again within a session. */
export const REGROW = 600;
/** Seconds after the wood went when the sapling shows. */
export const SPROUT = 60;
/** How far the sapling has grown, 0 … 1 (0: none yet), this many seconds after the wood went. */
export const growth = (age: number) => Math.max(0, Math.min(1, (age - SPROUT) / (REGROW - SPROUT)));

export interface TreeState {
  /** Bites into the standing trunk. */
  bites: number;
  /** Fallen, this way (radians about y, 0 = +z, as the beaver's facing). */
  fell?: number;
  /** Where it came to rest: the body's place and turn [x, y, z, w]. */
  rest?: { at: [number, number, number]; turn: [number, number, number, number] };
  /** Bites into the lying tree. */
  splitBites: number;
  split?: boolean;
  /** When its wood went (split), ms on the clock of whoever keeps this copy (Date.now()). */
  gone?: number;
  /** The tree grown back on the stump once its wood went (a "grow" change), as a tree of its own: bitten, felled,
   *  lying. When it is split in turn, its fall and rest move up here (its wood lies where it lay) and it is gone. */
  grown?: TreeState;
}

export interface BuildState {
  version: 1;
  /** By index in World.trees; trees never touched are left out. */
  trees: Record<number, TreeState>;
  /** The sticks in the dam, slot by slot: their names ("w3" the world's fourth stick, "t2:1" the second stick of
   *  tree 2's wood); after the first SLOTS, those on the lodge, then those in the cache. */
  dam: string[];
  /** Has picked up a stick once. */
  found: boolean;
  /** The sticks paid in at the trading post (src/features/trade), by name: gone from the world, like those in the dam.
   *  Those of a tree's wood come back when the tree grows back ("grow" clears them); the world's own ("w3") never do.
   *  Saved games from before the trading post have none. */
  traded: string[];
}

export type BuildChange =
  | { type: "find" }
  | { type: "bite"; tree: number }
  | { type: "fell"; tree: number; direction: number }
  | { type: "rest"; tree: number; at: [number, number, number]; turn: [number, number, number, number] }
  /** at: the server's clock (ms) when it took the split; only the server stamps it (protocol.ts admit). */
  | { type: "split"; tree: number; at?: number }
  | { type: "grow"; tree: number }
  | { type: "place"; slot: number; stick: string }
  /** A stick paid in at the trading post: it leaves the world for everyone (the goods it buys are the payer's own). */
  | { type: "trade"; stick: string };

export const newState = (): BuildState => ({ version: 1, trees: {}, dam: [], found: false, traded: [] });

/** The stick of this name has left the world: built into the dam, lodge or cache, or traded. */
export const used = (s: BuildState, stick: string) => s.dam.includes(stick) || s.traded.includes(stick);

const tree = (s: BuildState, i: number) => (s.trees[i] ??= { bites: 0, splitBites: 0 });

/** The tree that stands or lies on this spot now: the first until its wood is gone, then the one grown back;
 *  undefined while there is only the stump (and perhaps a sapling). An untouched tree reads as a fresh one. */
export const live = (t: TreeState | undefined): TreeState | undefined => !t ? { bites: 0, splitBites: 0 } : t.split ? t.grown : t;

/** Applies one change to the state in place. False when it does not fit the state (already done, out of order, a
 *  stick already used): then nothing changed, so a change that arrives twice does no harm. now: this copy's clock,
 *  for when a tree's wood went. */
export function apply(s: BuildState, c: BuildChange, now = Date.now()): boolean {
  switch (c.type) {
    case "find":
      if (s.found) return false;
      s.found = true;
      return true;
    case "bite": {
      const t = live(tree(s, c.tree));
      if (t?.fell === undefined) { if (!t) return false; t.bites++; }
      else if (t.rest) t.splitBites++;
      else return false;
      return true;
    }
    case "fell": {
      const t = live(tree(s, c.tree));
      if (!t || t.fell !== undefined) return false;
      t.fell = c.direction;
      return true;
    }
    case "rest": {
      const t = live(tree(s, c.tree));
      if (t?.fell === undefined || t.rest) return false;
      t.rest = { at: c.at, turn: c.turn };
      return true;
    }
    case "split": {
      const first = tree(s, c.tree), t = live(first);
      if (!t?.rest) return false;
      if (t !== first) { Object.assign(first, { bites: t.bites, fell: t.fell, rest: t.rest, splitBites: t.splitBites }); delete first.grown; }
      first.split = true;
      first.gone = now;
      return true;
    }
    case "grow": {
      const t = tree(s, c.tree);
      if (!t.split || t.grown) return false;
      t.grown = { bites: 0, splitBites: 0 };
      s.traded = s.traded.filter((stick) => !stick.startsWith(`t${c.tree}:`)); // its wood comes back with it
      return true;
    }
    case "trade":
      if (used(s, c.stick)) return false;
      s.traded.push(c.stick);
      return true;
    case "place":
      if (s.dam.length >= STICKS || used(s, c.stick)) return false;
      s.dam.push(c.stick); // the next free slot, whatever slot the sender saw: two players placing at once both fit
      return true;
  }
}

/** Reads a saved state; anything broken or of another version gives a fresh one. */
export function load(text: string | null): BuildState {
  try {
    const s = JSON.parse(text ?? "") as BuildState;
    if (s?.version === 1 && Array.isArray(s.dam) && typeof s.trees === "object" && (s.traded === undefined || Array.isArray(s.traded))) {
      // Saved before trees grew back: their count starts now.
      for (const t of Object.values(s.trees)) if (t?.split && typeof t.gone !== "number") t.gone = Date.now();
      return { ...newState(), ...s };
    }
  } catch { /* fresh */ }
  return newState();
}

// ---- trees -------------------------------------------------------------------------------------------------------

/** Bites a standing trunk of this radius (m) takes: 6 for a thin one, up to 10 for a thick one, 0.6 s each. */
export const bitesToFell = (radius: number) => Math.round(6 + Math.max(0, Math.min(1, (radius - 0.12) / 0.3)) * 4);

/** One piece of wood from a fallen tree, in the lying tree's own frame: `along` m from the cut up the trunk, `side`
 *  m across it; length and thickness in m; turn about y relative to the trunk. */
export interface Piece { kind: "log" | "stick"; along: number; side: number; length: number; thickness: number; turn: number; variant: number }

/** What a fallen tree breaks into: one or two logs from the trunk (length m below the crown, radius m) and four to
 *  six sticks along its upper half and where the crown was. The same for the same tree every time. */
export function woodFrom(index: number, trunk: number, radius: number): Piece[] {
  const random = seeded(1000 + index), out: Piece[] = [];
  const logs = trunk > 2.4 ? 2 : 1, each = Math.min(1.8, (trunk / logs) * 0.85);
  for (let k = 0; k < logs; k++)
    out.push({ kind: "log", along: (k + 0.5) * (trunk / logs), side: 0, length: each, thickness: radius * 1.8, turn: (random() - 0.5) * 0.2, variant: k });
  const sticks = 4 + Math.min(2, Math.floor(trunk / 1.6));
  for (let k = 0; k < sticks; k++)
    out.push({
      kind: "stick", along: trunk * 0.5 + random() * (trunk * 0.5 + 1), side: (k % 2 ? 1 : -1) * (0.25 + random() * 0.7),
      length: 0.5 + random() * 0.3, thickness: 0.03 + random() * 0.02, turn: (random() - 0.5) * 2.4, variant: Math.floor(random() * 3),
    });
  return out;
}

// ---- the dam -----------------------------------------------------------------------------------------------------

/** The dam's shape, in its own frame: x across (+x towards the water), z along it, metres. */
export const DAM = { length: 2.2, top: 0.2, base: 0.65, height: 0.32 };

/** 0 … 1: how much of the mound's height stands at (x, z): full on the crest, falling evenly to 0 at the foot.
 *  Crest and foot are ellipses: the foot 2·base across and `length` long, the crest top/base as large. */
export function profile(x: number, z: number) {
  const d = Math.hypot(x / DAM.base, z / (DAM.length / 2)), crest = DAM.top / DAM.base;
  return Math.max(0, Math.min(1, (1 - d) / (1 - crest)));
}

/** Height of the mud mound's crest with this many sticks placed: none for the first few, then up to just under the
 *  top layer of sticks. */
export const moundHeight = (placed: number) => DAM.height * 0.85 * Math.max(0, Math.min(1, (placed - 4) / (SLOTS - 4))) ** 0.8;

/** Height of the crest the beaver walks on (the collider): the mud, or the sticks on it, whichever is higher. */
export const crestHeight = (placed: number) => placed ? Math.max(moundHeight(placed), Math.min(DAM.height, slotLift(placed - 1) + 0.03)) : 0;

const LAYERS = [10, 8, 7, 5]; // sticks per layer, bottom up: SLOTS in all

/** Height of the middle of the stick in slot i above the ground. */
const slotLift = (i: number) => {
  let layer = 0;
  for (let n = LAYERS[0]!; i >= n && layer < LAYERS.length - 1; n += LAYERS[++layer]!);
  return 0.035 + layer * 0.085;
};

/** Where one stick of the dam goes, in the dam's frame: its middle at (x, y above ground, z), turned yaw about y
 *  (0: along the dam), its end tilted up by pitch. */
export interface Slot { x: number; y: number; z: number; yaw: number; pitch: number }

/** The plan: SLOTS places, layer on layer, each layer from the middle out, sticks crossing at angles so it reads
 *  as woven, the upper layers narrower. The same every time. */
export function damPlan(): Slot[] {
  const random = seeded(77), out: Slot[] = [];
  LAYERS.forEach((count, layer) => {
    const half = DAM.length / 2 - 0.3 - layer * 0.13, wide = 0.38 - layer * 0.08;
    const zs = Array.from({ length: count }, (_, k) => -half + (2 * half * (k + 0.5)) / count).sort((a, b) => Math.abs(a) - Math.abs(b));
    zs.forEach((z, k) => {
      const side = (k + layer) % 2 ? 1 : -1;
      out.push({
        x: side * random() * wide, y: slotLift(out.length), z: z + (random() - 0.5) * 0.2,
        yaw: side * (0.35 + random() * 0.7) + (layer % 2 ? 0.25 : -0.25), pitch: (random() - 0.4) * 0.45,
      });
    });
  });
  return out;
}

/** How much higher the pond stands with this many sticks in the dam, m. */
export const pondRise = (placed: number) => POND_RISE * Math.min(1, placed / SLOTS);

/** Height of the pond's surface with this many sticks in the dam, given the world's (full) water level, m. */
export const pondLevel = (full: number, placed: number) => full - POND_RISE + pondRise(placed);

/** How far the lodge has risen out of the pond, 0 … 1, with this many sticks placed: not at all before the dam is
 *  finished, then its roof just out of the water, and fully up with the last of the LODGE sticks on it. */
export const lodgeGrow = (placed: number) => placed < SLOTS ? 0 : 0.4 + 0.6 * Math.min(1, (placed - SLOTS) / LODGE);

// ---- the food cache ----------------------------------------------------------------------------------------------

/** Where the food cache lies on the pond's bed, m: at the foot of the deep basin's north slope, about 2.7 m under the
 *  full pond, beside the lodge and clear of its base, the basin's rocks and the sunken log (world/place.ts; the test
 *  checks it against them). */
export const CACHE_AT = { x: 5, z: 3.5 };

/** Where each stick of the cache goes, around CACHE_AT: x, z in m from it, y its middle's height above the bed, yaw
 *  about y (0: along +z), pitch its end tilted up. A low ring pushed into the mud, then crossing layers above it, so it
 *  reads as a heap of branches. The same every time. */
export function cachePlan(): Slot[] {
  const random = seeded(31), out: Slot[] = [];
  [5, 4, 3].forEach((count, layer) => {
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + layer * 0.7 + (random() - 0.5) * 0.4, r = [0.22, 0.12, 0.04][layer]! + random() * 0.04;
      out.push({
        x: Math.cos(a) * r, z: Math.sin(a) * r, y: 0.06 + layer * 0.12,
        yaw: Math.PI / 2 - a + (layer % 2 ? 1.2 : 0.35) + (random() - 0.5) * 0.5, pitch: 0.12 + random() * 0.3,
      });
    }
  });
  return out;
}

// ---- goals -------------------------------------------------------------------------------------------------------

export interface Goal { id: "stick" | "fell" | "wood" | "dam" | "lodge" | "cache"; text: string; done: boolean }

/** The goals in the order they lead through the game, with what is done. Once the dam holds, the first steps are
 *  behind the player: the list is the dam and the lodge that follows it, and once the lodge stands, the cache. */
export function goals(s: BuildState): Goal[] {
  const trees = Object.values(s.trees);
  const dam: Goal = { id: "dam", text: `Build the dam: ${Math.min(SLOTS, s.dam.length)} of ${SLOTS}`, done: s.dam.length >= SLOTS };
  const lodge: Goal = { id: "lodge", text: `Build up the lodge: ${Math.min(LODGE, s.dam.length - SLOTS)} of ${LODGE}`, done: s.dam.length >= SLOTS + LODGE };
  if (lodge.done) return [dam, lodge, { id: "cache", text: `Stock the food cache: ${s.dam.length - SLOTS - LODGE} of ${CACHE}`, done: s.dam.length >= STICKS }];
  if (dam.done) return [dam, lodge];
  return [
    { id: "stick", text: "Find a stick and pick it up", done: s.found },
    { id: "fell", text: "Gnaw down a tree", done: trees.some((t) => t.fell !== undefined) },
    { id: "wood", text: "Gnaw the fallen tree into wood", done: trees.some((t) => t.split) },
    dam,
  ];
}
