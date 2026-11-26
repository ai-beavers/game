// The Old Beaver's telling for a whole world, as the room runs it: one telling and one voice however many players
// stand before him, the murmur where there is no voice, and how often ElevenLabs may be asked. And the talk with
// ElevenLabs itself (voice.ts), against a stand-in on this machine.
import { afterEach, expect, test } from "bun:test";
import { CLOSING_LINE, EARSHOT, LORES, nearOf, NEARS, BREAK, PAUSE, START, VOICE_RATE, whereOf, type Told } from "./rules.ts";
import { newTelling } from "./telling.ts";
import { voiceWith, type Speak } from "./voice.ts";

const [FAR, AFLOAT, HEARD, AROUND, CLOSE] = NEARS.map((_, i) => i) as [number, number, number, number, number];
/** The microtasks of a voice that has answered already. */
const settle = () => Bun.sleep(0);

/** A world with a voice that answers at once with `seconds` of sound (undefined: none), and what it was asked. */
function world(seconds?: number) {
  const told: Told[] = [], asked: string[] = [], sounds: Uint8Array[] = [];
  const speak: Speak = async (text, sound) => { asked.push(text); if (seconds !== undefined) sound(new Uint8Array(4)); return seconds; };
  return { told, asked, sounds, telling: newTelling({ tell: (t) => told.push(t), sound: (pcm) => sounds.push(pcm), speak }) };
}

test("a page's nearness: far out of earshot, heard beyond the leaving distance, afloat within it, around on land, close within the start distance", () => {
  expect([nearOf(EARSHOT + 1, true), nearOf(BREAK + 1, true), nearOf(BREAK + 1, false), nearOf(3, false), nearOf(START + 1, true), nearOf(START - 1, true)]).toEqual([FAR, HEARD, HEARD, AFLOAT, AROUND, CLOSE]);
  expect(whereOf([AFLOAT, HEARD])).toEqual({ distance: EARSHOT, land: true }); // one dived in beside him, one still listens from afar: he goes on
  expect(whereOf([])).toEqual({ distance: Infinity, land: true });
  expect(whereOf([FAR, AFLOAT])).toEqual({ distance: 0, land: false }); // only a swimmer near him: he tells nothing
  expect(whereOf([AFLOAT, AROUND]).distance).toBeGreaterThan(START); // someone in earshot on land: he goes on, begins nothing
  expect(whereOf([AFLOAT, AROUND]).distance).toBeLessThanOrEqual(BREAK);
  expect(whereOf([AROUND, CLOSE, FAR])).toEqual({ distance: 0, land: true });
});

test("three players before him hear one telling: each line is asked of ElevenLabs once, and its sound goes out once", async () => {
  const { telling, told, asked, sounds } = world(2);
  for (const player of ["a", "b", "c"]) { telling.near(player, CLOSE); telling.step(0); }
  await settle();
  expect(asked).toEqual([LORES[0]![0]!]);
  expect(told).toEqual([{ state: "telling", lore: 0, say: 0, voice: true }]);
  expect(sounds.length).toBe(1);
  // The line lasts as long as its voice, and a pause: then the next, asked once again.
  telling.step(2 + PAUSE - 0.1);
  expect(asked.length).toBe(1);
  telling.step(0.2);
  await settle();
  expect(asked).toEqual([LORES[0]![0]!, LORES[0]![1]!]);
  expect(told.at(-1)).toEqual({ state: "telling", lore: 0, say: 1, voice: true });
});

test("one of two walking off changes nothing; the last one walking out of earshot mid-lore gets his closing word, which ElevenLabs is not asked for", async () => {
  const { telling, told, asked } = world(2);
  telling.near("a", CLOSE); telling.near("b", CLOSE); telling.step(0);
  await settle();
  telling.near("a", FAR); telling.step(0.1);
  expect(told.length).toBe(1);
  telling.near("b", HEARD); telling.step(0.1); // walking off, still in earshot: he tells on
  expect(told.length).toBe(1);
  telling.near("b", FAR);
  expect(telling.step(0.1)).toBe(false); // nobody near, nothing told: no need to step on
  await settle();
  expect(told.at(-1)).toEqual({ state: "idle", lore: 0, say: CLOSING_LINE }); // out of earshot no voice carries: shown and murmured
  expect(asked).toEqual([LORES[0]![0]!]);
  // Coming back, the next lore, for whoever comes.
  telling.near("c", CLOSE); telling.step(0);
  expect(told.at(-1)).toMatchObject({ state: "telling", lore: 1, say: 0 });
});

test("the last listener going into the water mid-lore: he falls quiet without a closing word, and nothing more is asked", async () => {
  const { telling, told, asked } = world(2);
  telling.near("a", CLOSE); telling.step(0);
  await settle();
  telling.near("a", AFLOAT); telling.step(0.1);
  expect(told.at(-1)).toEqual({ state: "away", lore: 0 });
  expect(asked.length).toBe(1);
});

test("when a lore has ended the pages are told, and again when everyone has left and he is ready for the next", async () => {
  const { telling, told } = world(1);
  telling.near("a", CLOSE); telling.step(0);
  for (let i = 0; i < 40 && told.at(-1)!.state === "telling"; i++) { await settle(); telling.step(1); }
  expect(told.at(-1)).toEqual({ state: "away", lore: 0 });
  telling.near("a", FAR); telling.step(0.1);
  expect(told.at(-1)).toEqual({ state: "idle", lore: 0 });
});

test("without a voice, and when ElevenLabs gives none, the pages are told to murmur the line, timed by its words", async () => {
  const told: Told[] = [], silent = newTelling({ tell: (t) => told.push(t), sound: () => {} });
  silent.near("a", CLOSE); silent.step(0);
  expect(told).toEqual([{ state: "telling", lore: 0, say: 0 }]);

  const failing = world(undefined);
  failing.telling.near("a", CLOSE); failing.telling.step(0);
  expect(failing.told).toEqual([{ state: "telling", lore: 0, say: 0, voice: true }]);
  failing.telling.step(60); // waiting for the first sound, the line does not run on
  expect(failing.told.length).toBe(1);
  await settle();
  expect(failing.told.at(-1)).toEqual({ state: "telling", lore: 0, say: 0 }); // the same line again, to murmur
  expect(failing.sounds).toEqual([]);
});

test("pages coming and going as fast as they can: ElevenLabs is asked for a few lines at once, then he murmurs", async () => {
  const { telling, told, asked } = world(2);
  for (let i = 0; i < 50; i++) {
    telling.near("a", CLOSE); telling.step(0);
    telling.near("a", FAR); telling.step(0);
    await settle();
  }
  expect(told.filter((t) => t.say !== undefined).length).toBe(100); // every line and closing word is still told
  expect(asked.length).toBeLessThanOrEqual(6);
});

// ---- the talk with ElevenLabs, against a stand-in ---------------------------------------------------------------

let standIn: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => { void standIn?.stop(true); standIn = undefined; });
/** A stand-in for ElevenLabs: answers each request with these pieces of sound, one after another. */
function elevenLabs(pieces: number[][], status = 200) {
  const requests: { key: string | null; body: { text: string; model_id: string } }[] = [];
  standIn = Bun.serve({
    port: 0,
    async fetch(req) {
      requests.push({ key: req.headers.get("xi-api-key"), body: await req.json() as { text: string; model_id: string } });
      if (status !== 200) return new Response("no", { status });
      return new Response(new ReadableStream({
        async start(controller) {
          for (const piece of pieces) { controller.enqueue(new Uint8Array(piece)); await Bun.sleep(5); }
          controller.close();
        },
      }));
    },
  });
  return { requests, address: `http://localhost:${standIn.port}/` };
}

test("a line goes to ElevenLabs with the server's key, and its sound comes back as whole samples, whatever the pieces", async () => {
  const { requests, address } = elevenLabs([[1, 2, 3], [4, 5], [6, 7, 8]]); // pieces that end mid-sample
  const speak = voiceWith("a made-up key", address)!, heard: number[][] = [];
  const seconds = await speak("Hm.", (pcm) => heard.push([...pcm]), new AbortController().signal);
  expect(requests).toEqual([{ key: "a made-up key", body: { text: "Hm.", model_id: expect.any(String) } }]);
  for (const piece of heard) expect(piece.length % 2).toBe(0);
  expect(heard.flat()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(seconds).toBeCloseTo(4 / VOICE_RATE, 9);
});

test("no key, no voice; an answer that is no sound, or a line cut off before any came, gives none either", async () => {
  expect(voiceWith(undefined)).toBeUndefined();
  const refused = elevenLabs([], 401);
  expect(await voiceWith("a made-up key", refused.address)!("Hm.", () => {}, new AbortController().signal)).toBeUndefined();
  const cut = new AbortController();
  cut.abort();
  expect(await voiceWith("a made-up key", refused.address)!("Hm.", () => {}, cut.signal)).toBeUndefined();
});
