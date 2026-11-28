// The Top-ten board's tally: how many sticks each name has built into the dam, the lodge and the cache, and the ten
// rows the board shows. Pure, no browser, Bun or Babylon: the room (src/features/net/room.ts) counts with it, the
// page draws what it is told, and the tests share it. docs/adr/0012 says why the server counts, by name.
//
//   const tally = newTally();           or readTally(kept) for what keep(tally) gave, kept with the world's work
//   add(tally, name)                    one stick in for that name; true when the top ten changed with it
//   top(tally)                          at most ROWS rows: { place, name, sticks }, most sticks first
//
// A name counts without regard to upper and lower case and shows as it was last written. Of two with the same count,
// the one that reached it first stands higher.
import { clean, NAME_LENGTH } from "../net/protocol.ts";

export const ROWS = 10;

/** One row of the board: its place from 1, the name built under, its sticks. */
export interface TopRow { place: number; name: string; sticks: number }

/** reached: the tally's count of all sticks when this name reached its own, so earlier is smaller. */
interface Entry { name: string; sticks: number; reached: number }
export interface Tally { names: Map<string, Entry>; total: number }

export const newTally = (): Tally => ({ names: new Map(), total: 0 });

const key = (name: string) => name.toLowerCase();

// shortcut: sorts every name for each stick; fine for the hundreds of names a world meets, keep the ten apart for more.
export function top(tally: Tally, n = ROWS): TopRow[] {
  return [...tally.names.values()].sort((a, b) => b.sticks - a.sticks || a.reached - b.reached).slice(0, n)
    .map((e, i) => ({ place: i + 1, name: e.name, sticks: e.sticks }));
}

/** Whether two lists of rows are the same board. */
export const sameRows = (a: readonly TopRow[], b: readonly TopRow[]) => JSON.stringify(a) === JSON.stringify(b);

export function add(tally: Tally, name: string): boolean {
  const before = top(tally), k = key(name), e = tally.names.get(k) ?? { name, sticks: 0, reached: 0 };
  e.name = name; e.sticks++; e.reached = ++tally.total;
  tally.names.set(k, e);
  return !sameRows(before, top(tally));
}

/** The tally as the world's kept JSON holds it: [name, sticks, reached] for each name. */
export const keep = (tally: Tally): [string, number, number][] => [...tally.names.values()].map((e) => [e.name, e.sticks, e.reached]);

const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1e9;

/** What keep() gave, read back from the kept world's text (its `top`): names cleaned as names are, entries that are
 *  not one left out. No tally there, or text that is no JSON: an empty tally. */
export function readTally(text: string | undefined): Tally {
  const tally = newTally();
  let saved: { top?: unknown };
  try { saved = JSON.parse(text ?? ""); } catch { return tally; }
  if (!saved || !Array.isArray(saved.top)) return tally;
  for (const row of saved.top) {
    if (!Array.isArray(row)) continue;
    const [raw, sticks, reached] = row as unknown[], name = clean(raw, NAME_LENGTH);
    if (!name || !count(sticks) || !count(reached) || tally.names.has(key(name))) continue;
    tally.names.set(key(name), { name, sticks, reached });
    tally.total = Math.max(tally.total, reached);
  }
  return tally;
}
