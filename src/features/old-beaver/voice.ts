// The Old Beaver's voice: one line said by ElevenLabs, as sound that arrives while it is made. Run by the servers only
// (server.ts, worker.ts), which hold the key; a page never sees it. Uses nothing but fetch, so it knows neither Bun nor
// Cloudflare. Nothing is kept: the same line said twice is made twice (docs/adr/0010).
//
//   const speak = voiceWith(key);            undefined without a key: he murmurs
//   const s = await speak(text, (pcm) => send(pcm), signal);
//                                            pcm: whole 16-bit samples at VOICE_RATE, one channel, as they arrive;
//                                            s: seconds of sound that came, undefined when none did
//
// Every talk with ElevenLabs is logged: what was asked, how long the first sound took, and how it ended.
import { VOICE_RATE } from "./rules.ts";

/** Jessie, from ElevenLabs' voice library; and the model made for speech that has to start at once. */
const VOICE = "KgUSWQPFmuiZ5ycRbnty", MODEL = "eleven_v4_turbo";
const ADDRESS = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/stream?output_format=pcm_${VOICE_RATE}`;
/** ms the first sound may take before he murmurs the line instead. A voice not used for a while takes one to two
 *  seconds; after that, a few tenths. */
export const WAIT = 3000;

export type Speak = (text: string, sound: (pcm: Uint8Array) => void, signal: AbortSignal) => Promise<number | undefined>;

/** address: where ElevenLabs is asked; the tests give a stand-in. */
export function voiceWith(key: string | undefined, address = ADDRESS): Speak | undefined {
  if (!key) return;
  return async (text, sound, signal) => {
    const asked = performance.now(), since = () => `${Math.round(performance.now() - asked)} ms`;
    console.log(`ElevenLabs: asked to say "${text}" (${text.length} characters)`);
    const own = new AbortController(), cut = () => own.abort();
    signal.addEventListener("abort", cut);
    if (signal.aborted) cut(); // cut off before it was asked: the listener would never hear of it
    const late = setTimeout(cut, WAIT);
    let bytes = 0;
    try {
      const response = await fetch(address, {
        method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ text, model_id: MODEL }), signal: own.signal,
      });
      if (!response.ok || !response.body) {
        console.warn(`ElevenLabs: no voice, it answered ${response.status} after ${since()}: ${(await response.text()).slice(0, 200)}`);
        return;
      }
      // A chunk may end in the middle of a sample: the odd byte waits for the next chunk.
      let odd: number | undefined;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        if (!chunk.length) continue;
        if (!bytes) { clearTimeout(late); console.log(`ElevenLabs: first sound after ${since()}`); }
        let all = chunk;
        if (odd !== undefined) { all = new Uint8Array(chunk.length + 1); all[0] = odd; all.set(chunk, 1); }
        const whole = all.length & ~1;
        odd = whole < all.length ? all[whole] : undefined;
        bytes += whole;
        if (whole) sound(all.subarray(0, whole));
      }
      console.log(`ElevenLabs: ${(bytes / 2 / VOICE_RATE).toFixed(1)} s of sound in ${since()}`);
    } catch (error) {
      const why = signal.aborted ? "he was cut off" : own.signal.aborted ? `no sound within ${WAIT} ms` : String(error);
      console.warn(`ElevenLabs: ${bytes ? "the voice stopped" : "no voice"} after ${since()}: ${why}`);
    } finally {
      clearTimeout(late);
      signal.removeEventListener("abort", cut);
    }
    return bytes ? bytes / 2 / VOICE_RATE : undefined;
  };
}
