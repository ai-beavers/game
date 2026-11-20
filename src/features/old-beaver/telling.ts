// The Old Beaver's telling for a whole world, without a transport: one visit for everyone, driven by how near each
// player's page says it is. The room runs it (src/features/net/room.ts), so both servers tell the same way. However
// many players stand before him, each line is asked of ElevenLabs once and its sound goes to everyone (docs/adr/0010).
//
//   const telling = newTelling({ tell, sound, speak });   tell(told): to every page; sound(pcm): his voice, to every page
//   telling.near(who, near)                               a page says how near its player is (rules.ts NEARS); 0: gone
//   telling.step(dt)                                      s since the last step; false: nobody near and nothing told, no need to step
//   telling.told()                                        what a page that has just come in is told
//
// Without speak (no key, or a server not told to speak) every line is murmured by the pages, timed by its words.
import { bucket } from "../net/protocol.ts";
import { CLOSING_LINE, LORES, newVisit, tell, whereOf, type Told } from "./rules.ts";
import type { Speak } from "./voice.ts";

/** Lines a second ElevenLabs is asked for, and how many at once: a whole lore in one go, and lore after
 *  lore as fast as players can walk off and come back. Beyond that he murmurs, so a flood of pages coming and going
 *  costs no more than a telling that never stops. */
const LINES = 0.25, AT_ONCE = 5;

export interface TellingHome { tell: (told: Told) => void; sound: (pcm: Uint8Array) => void; speak?: Speak }

export function newTelling({ tell: say, sound, speak }: TellingHome) {
  const visit = newVisit(), nears = new Map<unknown, number>(), budget = bucket(LINES, AT_ONCE);
  let state = visit.state; // as the pages were last told
  /** The line being said in his voice: until its first sound comes the visit waits; cut when another line begins. */
  let voiced: { cut: AbortController; waiting: boolean } | undefined;

  const told = (): Told => ({ state: visit.state, lore: visit.lore });
  /** Tells every page his state, and the line he begins now when he begins one. */
  const all = (line?: { say: number; voice?: boolean }) => { state = visit.state; say({ ...told(), ...line }); };
  const hush = () => { voiced?.cut.abort(); voiced = undefined; };
  /** He begins a line of a lore: told to every page at once, then said in his voice where there is one. */
  function begin(line: number) {
    hush();
    if (!speak || !budget.take()) { all({ say: line }); return; }
    const mine: NonNullable<typeof voiced> = voiced = { cut: new AbortController(), waiting: true };
    all({ say: line, voice: true });
    void speak(LORES[visit.lore]![line]!, (pcm) => {
      if (voiced !== mine) return;
      if (mine.waiting) { mine.waiting = false; visit.time = 0; } // the line's time counts from its first sound
      sound(pcm);
    }, mine.cut.signal).then((seconds) => {
      if (voiced !== mine) return;
      // No voice came: the pages murmur the line, from now. One came: the line lasts as long as it does.
      if (seconds === undefined) { voiced = undefined; visit.time = 0; all({ say: line }); }
      else visit.spoken = seconds;
    });
  }

  return {
    told,
    near(who: unknown, near: number) { if (near) nears.set(who, near); else nears.delete(who); },
    step(dt: number) {
      const where = whereOf(nears.values());
      for (const h of tell(visit, where, voiced?.waiting ? 0 : dt)) {
        if (h.kind === "line") begin(h.line);
        // Walked off, his closing word; gone into the water near him, he only falls quiet. The closing word is
        // never asked of ElevenLabs: he says it to a listener who has just gone out of earshot, where no voice
        // carries (audio mix.ts carried), so it would be paid for and not heard. The pages show and murmur it.
        else if (h.kind === "broke" && where.land) { hush(); all({ say: CLOSING_LINE }); }
        else if (h.kind !== "lore") { hush(); all(); }
      }
      if (state !== visit.state) all(); // away to idle: nothing is said, but the pages follow his state
      return nears.size > 0 || visit.state !== "idle"; // whether there is anything to step for
    },
  };
}
