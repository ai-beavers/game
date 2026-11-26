// The tune that composes itself, as pure logic: a slow random walk over D major pentatonic, with rests and a
// long note at the end of each phrase. mix.ts plays it.
//
//   const next = composer();  next() → { degree, length, rest }    pitch(degree) → Hz
export interface Note { degree: number; length: number; rest: boolean }

const ROOT = 293.66; // D4
const PENTATONIC = [0, 2, 4, 7, 9];
export const LOWEST = 0, HIGHEST = 8;

/** Degree 0 is D4, 5 is D5; any whole number works. */
export function pitch(degree: number) {
  const octave = Math.floor(degree / 5), step = PENTATONIC[degree - octave * 5]!;
  return ROOT * 2 ** (octave + step / 12);
}

export function composer(random = Math.random) {
  let degree = 2, count = 0;
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!;
  return (): Note => {
    count++;
    // A phrase ends every 8 notes, held long on a calm note.
    if (count % 8 === 0) { degree = pick([0, 2, 4, 5]); return { degree, length: 4.2, rest: false }; }
    degree += pick([-2, -1, -1, 0, 1, 1, 2]);
    if (degree < LOWEST) degree = LOWEST + 1;
    if (degree > HIGHEST) degree = HIGHEST - 1;
    return { degree, length: pick([1.4, 2.1, 2.1, 2.8]), rest: random() < 0.2 };
  };
}
