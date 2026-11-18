// The rules for what floats over the beavers (ui.ts draws them): where each label goes on screen so none lies on
// another, how a chat line wraps into a bubble, and what a beaver is busy with as its Motion tells.
//
//   place(labels, width, height)            top-left corners, in the order given (nearest beaver first)
//   wrap(text, width, measure, lines)       the text cut into lines no wider than width, at most `lines`
//   doing(motion, still)                    "gnawing", "carrying", …, or "" for nothing worth saying
import type { Motion } from "../../contracts.ts";

/** Wants to sit centred over x with its bottom edge on y (the point over the head), w × h px. */
export interface Label { x: number; y: number; w: number; h: number }
export const GAP = 3, MARGIN = 4; // px between labels, and to the screen's edges

/** Each label where it wants to be, unless one before it in the list is there: then it goes up, above that one, until
 *  it is free. Labels only ever move up, so none covers the beaver under it; one pushed past the top stays at the top. */
export function place(labels: Label[], width: number, height: number): { x: number; y: number }[] {
  const done: { x: number; y: number; w: number; h: number }[] = [];
  for (const l of labels) {
    const x = Math.max(MARGIN, Math.min(width - l.w - MARGIN, l.x - l.w / 2));
    let y = Math.min(height - l.h - MARGIN, l.y - l.h);
    for (let moved = true; moved;) {
      moved = false;
      for (const d of done) {
        if (x < d.x + d.w + GAP && d.x < x + l.w + GAP && y < d.y + d.h + GAP && d.y < y + l.h + GAP) { y = d.y - GAP - l.h; moved = true; }
      }
    }
    done.push({ x, y, w: l.w, h: l.h });
  }
  return done.map((d) => ({ x: d.x, y: Math.max(MARGIN, d.y) }));
}

/** Words into lines of at most `width` px; a word wider than a line is broken. What does not fit in `lines` ends in "…". */
export function wrap(text: string, width: number, measure: (s: string) => number, lines = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean).flatMap((word) => {
    const parts: string[] = [];
    while (measure(word) > width && word.length > 1) { // too long for any line: as many letters as fit, then the rest
      let n = word.length - 1;
      while (n > 1 && measure(word.slice(0, n)) > width) n--;
      parts.push(word.slice(0, n)); word = word.slice(n);
    }
    return [...parts, word];
  });
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (!line || measure(next) <= width) line = next; else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  if (out.length <= lines) return out;
  let last = out[lines - 1]!;
  while (last && measure(last + "…") > width) last = last.slice(0, -1).trimEnd();
  return [...out.slice(0, lines - 1), last + "…"];
}

/** What it is busy with. still: ms since its Motion's clock last moved (it stops while that player's game is paused or
 *  hidden, or when nothing arrives). */
export function doing(m: Pick<Motion, "action" | "carrying" | "swimming">, still: number): string {
  if (still > AWAY) return "away";
  if (m.action === "gnaw") return "gnawing";
  if (m.action === "build") return "building";
  if (m.carrying) return "carrying";
  return m.swimming >= 0.5 ? "swimming" : "";
}
export const AWAY = 2500;
