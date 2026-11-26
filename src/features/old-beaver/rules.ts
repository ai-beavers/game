// The Old Beaver's rules as plain logic, apart from drawing and sound, so they can be tested alone: where he sits, how
// close a player must come for a Lore, which lores he tells, and one visit's telling, line by line.
//
//   const visit = newVisit();                                  idle, the first lore next
//   tell(visit, { distance, land }, dt)                        what happened: a lore began, a line began, it broke off, it ended
//   lineTime(line)                                             s a murmured line stays up: one syllable per word and a pause
//   nearOf(distance, land) · whereOf(nears)                    how near one player is, as a page tells the room; all of them as one
//
// Each update says what happened, so whoever drives the visit acts on each change exactly once. The room drives one
// visit for its whole world (telling.ts); a page without a server drives its own. Nothing here is kept: the lore
// counter starts at the first lore whenever the room or the page starts.

export interface XZ { x: number; z: number }
/** Where he sits: at the foot of the bank west-north-west, among the outer ring's trees and in front of the thicket,
 *  on dry flat land clear of everything that has a place (rules.test.ts checks it). */
export const PLACE: XZ = { x: -27.2, z: 14.3 };
/** Radians he faces at rest (as Player.facing: atan2(x, z)): towards the middle of the Clearing, so a player coming
 *  from there meets his face. */
export const REST = Math.atan2(-PLACE.x, -PLACE.z);
/** m: the radius of the small fixed collider round him, which players and bots walk round. */
export const COLLIDER = 0.35;
/** m on the ground from his place to the player's feet within which he begins a lore. */
export const START = 4;
/** m beyond which a player has left him: a new lore begins only once the player has been this far since the last
 *  one, and going into the water nearer than this mid-lore, he falls quiet. */
export const BREAK = 8;
/** m beyond which a player no longer hears him: he tells on while a listener walks off, and breaks off here. About as
 *  far as a talking voice carries over a clearing's wind and water; the audio feature's fall with distance fits it. */
export const EARSHOT = 20;

/** The lores, each a few lines, about this Clearing's own past, in the game's words. Each states only what is true
 *  in the game as it is: change the lore when what it tells changes. */
export const LORES: readonly (readonly string[])[] = [
  [
    "Long ago this clearing was small. The bank stood close.",
    "Then the bank drew back, and the meadow grew wide.",
    "Where the first bank stood, there is open grass now.",
  ],
  [
    "The pond is only as deep as the dam lets it be.",
    "Every stick in the dam holds back a little more water.",
    "Build it well, and the pond will rise to meet you.",
  ],
  [
    "Each time you come, your Mrs. Beaver is gone again.",
    "Carried off, shut in a pen of sticks, out in the meadow.",
    "Her flower lies on the way. Follow it, and gnaw her free.",
  ],
  [
    "Beside the Shop stands a big board: the Calendar board.",
    "It counts no days of our sun. It counts your own week.",
  ],
  [
    "On Fridays, from four until eleven by your own clock,",
    "beavers come together to build. Build Fridays, they say.",
    "The Calendar board marks them. I have seen many.",
  ],
];

/** The most characters a lore's line has: one or two rows of the speech box on the smallest screen. */
export const LINE_MAX = 60;

/** What he says when a player walks off mid-lore. */
export const CLOSING = "Hm. Another time, then.";

/** One visit's telling: idle (ready for the next lore), telling (a lore, a line of it, s spent on that line), or away
 *  (a lore ended, or broke off with the player afloat near him; the next waits until the player has been beyond BREAK). next: the lore told next.
 *  spoken: s the line told now takes to say; a murmur's until whoever drives the visit knows his voice's (telling.ts). */
export interface Visit { state: "idle" | "telling" | "away"; lore: number; line: number; time: number; next: number; spoken: number }
/** What a telling update did, in order. */
export type Happening =
  | { kind: "lore"; lore: number }
  | { kind: "line"; lore: number; line: number; text: string; words: number }
  | { kind: "broke"; lore: number }
  | { kind: "ended"; lore: number };

export const newVisit = (): Visit => ({ state: "idle", lore: 0, line: 0, time: 0, next: 0, spoken: 0 });

/** How many murmur syllables a line takes: one per word. */
export const words = (line: string) => line.split(/\s+/).filter(Boolean).length;

/** s of one murmur syllable, and of the pause after a line: slow, an old beaver's pace. */
export const SYLLABLE = 0.42, PAUSE = 1.8;
/** s a line stays up: one syllable a word as it is spoken, and a pause to finish reading it. */
export const lineTime = (line: string) => words(line) * SYLLABLE + PAUSE;

const lineOf = (visit: Visit): Happening => {
  const text = LORES[visit.lore]![visit.line]!;
  visit.spoken = words(text) * SYLLABLE;
  return { kind: "line", lore: visit.lore, line: visit.line, text, words: words(text) };
};

/** Advances a visit by dt s with the player distance m away on the ground (from the feet), on land or not (afloat,
 *  in the canoe): beyond EARSHOT mid-lore, or off the land within BREAK, he breaks off. Returns what happened. */
export function tell(visit: Visit, at: { distance: number; land: boolean }, dt: number): Happening[] {
  if (visit.state === "idle") {
    if (!at.land || at.distance > START) return [];
    Object.assign(visit, { state: "telling", lore: visit.next, line: 0, time: 0, next: (visit.next + 1) % LORES.length });
    return [{ kind: "lore", lore: visit.lore }, lineOf(visit)];
  }
  if (visit.state === "away") {
    if (at.distance > BREAK) visit.state = "idle";
    return [];
  }
  if (at.distance > EARSHOT) {
    visit.state = "idle";
    return [{ kind: "broke", lore: visit.lore }];
  }
  if (!at.land && at.distance <= BREAK) { // into the water or the canoe near him: he breaks off, and tells again only once the player has left
    visit.state = "away";
    return [{ kind: "broke", lore: visit.lore }];
  }
  const out: Happening[] = [], lines = LORES[visit.lore]!;
  visit.time += dt;
  while (visit.state === "telling" && visit.time >= visit.spoken + PAUSE) {
    visit.time -= visit.spoken + PAUSE;
    if (++visit.line < lines.length) out.push(lineOf(visit));
    else { visit.state = "away"; out.push({ kind: "ended", lore: visit.lore }); }
  }
  return out;
}

// ---- told once for a whole world ------------------------------------------------------------------------------------

/** How near one player is to him, as its page tells the room, by its index: far (beyond EARSHOT), afloat (within
 *  BREAK, swimming or in the canoe), heard (in earshot beyond BREAK, on land or not), around (on land within BREAK)
 *  or close (on land within START). */
export const NEARS = ["far", "afloat", "heard", "around", "close"] as const;
export const nearOf = (distance: number, land: boolean) => distance > EARSHOT ? 0 : distance > BREAK ? 2 : !land ? 1 : distance > START ? 3 : 4;
/** Everyone's nearness as the one place tell() asks for: he tells for whoever is closest on land, and on for
 *  whoever still hears him. */
export function whereOf(nears: Iterable<number>): { distance: number; land: boolean } {
  const most = Math.max(0, ...nears);
  return { distance: [Infinity, 0, EARSHOT, BREAK, 0][most]!, land: most !== 1 };
}

/** What he says, in place of a lore's line number, when he says his closing word. */
export const CLOSING_LINE = -1;
/** What the room tells every page whenever it changes: the visit's state and lore; say: the line he begins now
 *  (CLOSING_LINE: his closing word), absent when he begins none; voice: its sound follows from the server, in his
 *  voice, else the page murmurs it. */
export interface Told { state: Visit["state"]; lore: number; say?: number; voice?: boolean }
/** Hz of his voice as the server sends it: 16-bit samples, one channel. */
export const VOICE_RATE = 24000;
