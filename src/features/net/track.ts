// Smooth movement between network updates: keeps the last few samples of a list of numbers and gives the values
// for any moment between them. Independent of rendering.
//
//   const track = new Track({ angles: [3], steps: [6, 7] });   index 3 wraps round 2π, 6 and 7 jump (booleans)
//   track.push(performance.now(), values);                      on every update
//   track.at(performance.now() - DELAY, out);                   once a frame, a little in the past
//
// Showing a little in the past (DELAY) means there is nearly always a sample on both sides to blend between.
// Quaternions: pass `quaternion: i` and the four values from i on keep the sign of the previous sample, so the blend
// takes the short way round.
export const DELAY = 110; // ms: two updates at 20 a second, and some jitter

export interface TrackOptions { angles?: number[]; steps?: number[]; quaternion?: number }

export class Track {
  samples: { t: number; v: number[] }[] = [];
  constructor(private options: TrackOptions = {}) {}

  push(t: number, values: number[]) {
    const v = values.slice(), last = this.samples.at(-1);
    if (last) {
      for (const i of this.options.angles ?? []) v[i] = last.v[i]! + Math.atan2(Math.sin(v[i]! - last.v[i]!), Math.cos(v[i]! - last.v[i]!));
      const q = this.options.quaternion;
      if (q !== undefined) {
        let dot = 0;
        for (let k = 0; k < 4; k++) dot += v[q + k]! * last.v[q + k]!;
        if (dot < 0) for (let k = 0; k < 4; k++) v[q + k] = -v[q + k]!;
      }
      if (t <= last.t) t = last.t + 1e-3;
    }
    this.samples.push({ t, v });
    if (this.samples.length > 12) this.samples.shift();
  }

  /** The values at time t into out: blended between the samples around t, the first before them, the last after. */
  at(t: number, out: number[] = []): number[] {
    const s = this.samples;
    if (!s.length) return out;
    let i = 0;
    while (i < s.length - 1 && s[i + 1]!.t <= t) i++;
    const a = s[i]!, b = s[Math.min(i + 1, s.length - 1)]!;
    const k = b === a ? 0 : Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
    const steps = this.options.steps ?? [];
    for (let j = 0; j < a.v.length; j++) out[j] = steps.includes(j) ? a.v[j]! : a.v[j]! + (b.v[j]! - a.v[j]!) * k;
    const q = this.options.quaternion;
    if (q !== undefined) {
      const length = Math.hypot(out[q]!, out[q + 1]!, out[q + 2]!, out[q + 3]!) || 1;
      for (let j = q; j < q + 4; j++) out[j] = out[j]! / length;
    }
    return out;
  }

  /** Forget everything: the next push starts afresh (after a jump in place, say). */
  clear() { this.samples.length = 0; }
}
