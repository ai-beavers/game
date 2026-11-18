// Measures the game's sound without ears: renders every one-shot recipe and typical full-mix scenes offline in a
// headless Chrome (the game's own code in src/features/audio, via tools/listen-page.ts), writes WAV files and
// spectrograms, and prints a table of what can be measured.
//
//   bun tools/listen.ts [--out /tmp/soundcheck] [--only bite,rain] [--no-pictures]
//                       [--volume 0.7]  the player's volume (the default's 0.7)
//                       [--bypass]   the master limiter does nothing: shows what reaches it (peaks over its
//                                    threshold, src/features/audio/mix.ts, are what it squeezes)
//
// Columns: length s; peak dBFS (sample peak); LUFS integrated (BS.1770: K-weighted, gated) and LUFS M max (the
// loudest 400 ms, how loud a one-shot sounds); crest dB (peak over RMS); DC; clipped samples (|x| ≥ 1); centroid
// Hz; share of energy below 80 Hz and above 8 kHz; silence at the start (a recipe starts at 0.1 s) and end (below
// -60 dBFS), s; repeat: the correlation of the sound with itself 2 s later (a looping noise bed shows near 1).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openChrome } from "./chrome.ts";

export interface Rendered { rate: number; left: Float32Array; right: Float32Array }

/** Renders recipes and scenes in one headless Chrome. */
export async function render(jobs: { kind: "recipe" | "scene"; name: string }[], options: { bypass?: boolean; volume?: number } = {}) {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "listen-page.ts")], target: "browser", format: "iife" });
  if (!built.success) throw new Error(built.logs.join("\n"));
  const code = await built.outputs[0]!.text();
  const page = await openChrome(320, 200);
  try {
    page.on("Runtime.exceptionThrown", (p) => console.error("[page]", p.exceptionDetails.exception?.description ?? p.exceptionDetails.text));
    const loaded = await page.send("Runtime.evaluate", { expression: code });
    if (loaded.exceptionDetails) throw new Error(`listen-page.ts: ${loaded.exceptionDetails.exception?.description}`);
    await page.evaluate(`Object.assign(listen.options, ${JSON.stringify(options)})`);
    const out = new Map<string, Rendered>();
    for (const job of jobs) {
      const r = await page.evaluate(`listen.${job.kind}(${JSON.stringify(job.name)})`);
      if (!r) throw new Error(`${job.kind} ${job.name} did not render`);
      const decode = (b64: string) => new Float32Array(new Uint8Array(Buffer.from(b64, "base64")).buffer);
      out.set(`${job.kind}:${job.name}`, { rate: r.rate, left: decode(r.left), right: decode(r.right) });
    }
    return { out, names: await page.evaluate("({ recipes: listen.recipes, scenes: listen.scenes })") as { recipes: string[]; scenes: string[] } };
  } finally {
    await page.close();
  }
}

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** BS.1770 K-weighting at 48 kHz: a high shelf, then a high-pass. */
function kWeight(x: Float32Array) {
  const stages = [
    [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585],
    [1, -2, 1, -1.99004745483398, 0.99007225036621],
  ];
  let input: Float32Array = x;
  for (const [b0, b1, b2, a1, a2] of stages as number[][]) {
    const y = new Float32Array(input.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < input.length; i++) {
      const v = input[i]!, o = b0! * v + b1! * x1 + b2! * x2 - a1! * y1 - a2! * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o;
    }
    input = y;
  }
  return input;
}

/** Integrated loudness (gated, LUFS) and the loudest momentary block (400 ms), of a stereo signal at 48 kHz. */
export function loudness({ rate, left, right }: Rendered) {
  if (rate !== 48000) throw new Error("loudness() is tuned for 48 kHz");
  const l = kWeight(left), r = kWeight(right), block = Math.round(0.4 * rate), hop = Math.round(0.1 * rate), blocks: number[] = [];
  for (let start = 0; start + block <= l.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + block; i++) sum += l[i]! * l[i]! + r[i]! * r[i]!;
    blocks.push(sum / block);
  }
  const lufs = (power: number) => -0.691 + 10 * Math.log10(power);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const loud = blocks.filter((p) => lufs(p) > -70);
  const max = blocks.length ? lufs(Math.max(...blocks)) : -Infinity;
  if (!loud.length) return { integrated: -Infinity, max };
  const relative = lufs(mean(loud)) - 10;
  const gated = loud.filter((p) => lufs(p) > relative);
  return { integrated: lufs(mean(gated)), max };
}

/** Power spectrum of the mono sum, summed over Hann-windowed frames: the centroid and the low and high shares. */
export function spectrum({ rate, left, right }: Rendered, size = 4096) {
  const power = new Float64Array(size / 2), re = new Float64Array(size), im = new Float64Array(size);
  for (let start = 0; start + size <= left.length; start += size / 2) {
    for (let i = 0; i < size; i++) { re[i] = (left[start + i]! + right[start + i]!) * 0.5 * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)); im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) power[k]! += re[k]! * re[k]! + im[k]! * im[k]!;
  }
  let total = 0, weighted = 0, low = 0, high = 0;
  for (let k = 1; k < size / 2; k++) {
    const f = (k * rate) / size, p = power[k]!;
    total += p; weighted += f * p;
    if (f < 80) low += p;
    if (f > 8000) high += p;
  }
  return total ? { centroid: weighted / total, low: low / total, high: high / total } : { centroid: 0, low: 0, high: 0 };
}

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b]! * cr - im[b]! * ci, ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a]! += tr; im[a]! += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

/** Every number the table shows, for one rendered sound. */
export function measure(sound: Rendered) {
  const { rate, left, right } = sound, n = left.length;
  let peak = 0, sum = 0, square = 0, clipped = 0, first = -1, last = -1;
  const quiet = 10 ** (-60 / 20);
  for (let i = 0; i < n; i++) {
    const a = left[i]!, b = right[i]!, m = Math.max(Math.abs(a), Math.abs(b));
    if (m > peak) peak = m;
    if (m >= 1) clipped++;
    if (m > quiet) { if (first < 0) first = i; last = i; }
    sum += a + b; square += a * a + b * b;
  }
  const rms = Math.sqrt(square / (2 * n)), lag = 2 * rate;
  let xy = 0, xx = 0, yy = 0;
  for (let i = 0; i + lag < n; i++) { const x = left[i]!, y = left[i + lag]!; xy += x * y; xx += x * x; yy += y * y; }
  return {
    seconds: n / rate, peak: db(peak), ...loudness(sound), crest: db(peak) - db(rms), dc: sum / (2 * n), clipped,
    ...spectrum(sound), start: first < 0 ? n / rate : first / rate, end: last < 0 ? n / rate : (n - 1 - last) / rate,
    repeat: xx && yy ? xy / Math.sqrt(xx * yy) : 0,
  };
}
export type Measured = ReturnType<typeof measure>;

/** 16-bit stereo WAV (clamped: the table counts what went over). */
export function wav({ rate, left, right }: Rendered) {
  const n = left.length, data = new DataView(new ArrayBuffer(44 + n * 4)), text = (at: number, s: string) => { for (let i = 0; i < 4; i++) data.setUint8(at + i, s.charCodeAt(i)); };
  text(0, "RIFF"); data.setUint32(4, 36 + n * 4, true); text(8, "WAVE"); text(12, "fmt ");
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 2, true); data.setUint32(24, rate, true);
  data.setUint32(28, rate * 4, true); data.setUint16(32, 4, true); data.setUint16(34, 16, true); text(36, "data"); data.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) for (const [c, ch] of [left, right].entries()) data.setInt16(44 + i * 4 + c * 2, Math.round(Math.max(-1, Math.min(1, ch[i]!)) * 32767), true);
  return new Uint8Array(data.buffer);
}

export function table(rows: [string, Measured][]) {
  const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "-inf");
  const head = ["name", "len s", "peak", "LUFS I", "M max", "crest", "DC", "clip", "centroid", "<80Hz", ">8kHz", "lead s", "tail s", "repeat"];
  const body = rows.map(([name, m]) => [name, f(m.seconds), f(m.peak), f(m.integrated), f(m.max), f(m.crest), m.dc.toExponential(0), String(m.clipped),
    f(m.centroid, 0), `${f(m.low * 100, 0)}%`, `${f(m.high * 100, 0)}%`, f(m.start, 2), f(m.end, 2), f(m.repeat, 2)]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i]!.length)));
  return [head, ...body].map((r) => r.map((c, i) => (i ? c.padStart(widths[i]!) : c.padEnd(widths[i]!))).join("  ")).join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2), option = (name: string) => { const at = args.indexOf(`--${name}`); return at < 0 ? undefined : args[at + 1]; };
  const dir = option("out") ?? "/tmp/soundcheck", only = option("only")?.split(","), pictures = !args.includes("--no-pictures"), bypass = args.includes("--bypass"), volume = Number(option("volume") ?? 0.7);
  const { names } = await render([]);
  const pick = (list: string[]) => list.filter((n) => !only || only.includes(n));
  const jobs = [...pick(names.recipes).map((name) => ({ kind: "recipe" as const, name })), ...pick(names.scenes).map((name) => ({ kind: "scene" as const, name }))];
  const { out } = await render(jobs, { bypass, volume });
  for (const kind of ["recipe", "scene"] as const) {
    const rows: [string, Measured][] = [];
    mkdirSync(join(dir, kind), { recursive: true });
    for (const job of jobs.filter((j) => j.kind === kind)) {
      const sound = out.get(`${kind}:${job.name}`)!, file = join(dir, kind, `${job.name}.wav`);
      await Bun.write(file, wav(sound));
      if (pictures) Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-i", file, "-lavfi", "showspectrumpic=s=1024x384:legend=1:scale=log:fscale=lin", file.replace(/\.wav$/, ".png")]);
      rows.push([job.name, measure(sound)]);
    }
    if (rows.length) console.log(`\n${kind === "recipe" ? "One-shots, as heard at the camera" : "Full-mix scenes"} (${join(dir, kind)})\n${table(rows)}`);
  }
}
