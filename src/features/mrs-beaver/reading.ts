// The Reading's rules as plain logic, apart from rendering: the player sitting at the Campfire with Mrs. Beaver once
// she is home, the two of them taking turns reading a short story aloud, one line each. The stories, when a Reading
// can go on, who reads which line, and where the story stands.
//
//   const reading = begin();                      the first story, at its first line
//   canRead({ sitting, fire, home })              whether a Reading can go on now
//   step(reading, dt, can)                        once a picture: the line to show now ({ text, reader }), or undefined
//   reader(line)                                  who reads a story's line: "her" (even lines) or "player" (odd)
//
// A line stays up LINE s, then the next one comes; after a story's last line the next story begins, after the last
// story the first again. When the Reading can't go on nothing is shown and the line it stopped at is kept: sitting
// again shows that line afresh. Nothing here is kept: the Reading lives in memory for one visit (no localStorage, no
// network), and it is the player's alone.

import { HOME } from "./rules.ts";

/** Short stories about the Clearing, 6 to 8 lines each, every line short enough for one speech line (SHORT). */
export const STORIES: readonly (readonly string[])[] = [
  [
    "Long ago the pond was only a thin brook.",
    "It ran through the clearing, cold and quick.",
    "Two beavers came one spring with nothing but teeth.",
    "They cut one stick, then another, then a hundred.",
    "By autumn the brook had stopped to rest.",
    "It spread out wide and still, and became our pond.",
    "And the beavers stayed, because it was home.",
  ],
  [
    "The first dam fell down the very first night.",
    "The water pushed, and the sticks rolled away.",
    "So the beavers packed mud between every stick.",
    "The water pushed again, and the dam held.",
    "In the morning a frog sat on top of it, proud.",
    "As if he had built it himself.",
  ],
  [
    "Each spring three ducks land on our pond.",
    "They are loud, and they never knock first.",
    "One year the smallest duck lost her way in reeds.",
    "A beaver swam out and nudged her back to the others.",
    "Now the ducks quack twice when they fly over.",
    "Once for hello, and once for thank you.",
    "Or so the beavers like to think.",
  ],
  [
    "At dusk a deer steps out at the edge of the trees.",
    "She waits until the clearing is quiet.",
    "Then she walks down to the pond to drink.",
    "The beavers stop their work and keep very still.",
    "Her ears turn this way, then that way.",
    "She drinks, she looks at the dam, and she goes.",
    "Nobody knows why she always looks at the dam.",
    "Perhaps she thinks it is very well built.",
  ],
];
/** s each line stays up before the next one comes. */
export const LINE = 4;
/** m from the fire's middle to the player's feet within which sitting starts a Reading. */
export const SIT_REACH = 2.5;
/** Characters a line may have to fit one speech line. */
export const SHORT = 60;

export type Reader = "her" | "player";
export interface Line { text: string; reader: Reader }
export interface Reading { story: number; line: number; shown: number; on: boolean }

/** A Reading not yet begun: the first story, its first line. */
export const begin = (): Reading => ({ story: 0, line: 0, shown: 0, on: false });

/** Who reads a story's line: Mrs. Beaver the even ones (so every story begins with her), the player the odd. */
export const reader = (line: number): Reader => (line % 2 === 0 ? "her" : "player");

/** Whether a Reading can go on: the player sitting, within SIT_REACH m of the fire (fire: m from the feet), and Mrs.
 *  Beaver freed and at home. */
export const canRead = (at: { sitting: boolean; fire: number; home: boolean }) => at.sitting && at.home && at.fire <= SIT_REACH;

/** Moves the Reading on by dt s: the line to show now, or undefined when it can't go on (the line is kept). */
export function step(reading: Reading, dt: number, can: boolean): Line | undefined {
  if (!can) { reading.on = false; reading.shown = 0; return undefined; }
  if (!reading.on) { reading.on = true; reading.shown = 0; } // shown afresh, from where it stopped
  else reading.shown += Math.max(0, dt);
  for (; reading.shown >= LINE; reading.shown -= LINE) {
    if (++reading.line >= STORIES[reading.story]!.length) { reading.line = 0; reading.story = (reading.story + 1) % STORIES.length; }
  }
  return { text: STORIES[reading.story]![reading.line]!, reader: reader(reading.line) };
}

/** Where the Campfire stands: 1.5 m from Mrs. Beaver's waiting spot (rules.ts HOME), on the side away from the
 *  building site, clear of her ways home, the dam, the crates and the site (reading.test.ts checks it). */
export const FIRE = { x: -3.34, z: 1.06 };
/** Where the player sits to read: beside the fire on the side away from her, a little round it, so the camera
 *  behind the beaver facing the fire sees her beside it and not hidden behind the beaver: both beavers and the fire
 *  in the picture. */
export const SEAT = { x: -4.43, z: 0.94 };
/** Which way the player faces sitting at SEAT (radians, as Player.teleport: 0 is +z): towards the fire, turned most
 *  of the way to her, so the fire shows on one side of the beaver and she on the other. */
export const SEAT_FACING = (() => {
  const fire = Math.atan2(FIRE.x - SEAT.x, FIRE.z - SEAT.z), her = Math.atan2(HOME.x - SEAT.x, HOME.z - SEAT.z);
  return fire + Math.atan2(Math.sin(her - fire), Math.cos(her - fire)) * 0.7;
})();
/** The Campfire: radius of its ring of stones and of its collider, and the collider's height, m. */
export const CAMPFIRE = { ring: 0.36, solid: 0.42, height: 0.3 };
