// The production bundle: what `bun run build` writes to dist/ and what `NODE_ENV=production bun server.ts` serves
// from memory. Viewers open the game from a stream link, many on phones: every byte before the first frame counts.
//
//   bun tools/build.ts           dist/, each compressible file beside its .br and .gz
//   const files = await build()   path → bytes (and their compressed forms), for server.ts
//
// Two things the plain `bun build ./index.html` gets wrong for us:
// - @dimforge/rapier3d-compat inlines its 3 MB wasm as 4.2 MB of base64 (half the bundle, compresses badly, and the
//   page must parse it as a string). Here the base64 is swapped for the real .wasm, fetched next to the bundle and
//   compiled while it streams. Tests and Bun itself still import the package unchanged.
// - Babylon's materials import their WGSL (WebGPU) shaders as well as the GLSL ones; without code splitting Bun
//   inlines both. The game runs only on the WebGL Engine (src/engine.ts), so the WGSL half (550 KB) is left out.
//   Should the game ever use the WebGPU engine, drop that plugin.
// Code splitting itself was tried and dropped: ~190 chunks, which the shader stores then fetch one by one.
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { brotliCompress, constants } from "node:zlib";
import type { BunPlugin } from "bun";

const root = join(import.meta.dir, "..");

const rapierWasm: BunPlugin = {
  name: "rapier wasm as a file",
  setup(build) {
    build.onLoad({ filter: /rapier3d-compat[\\/]dist[\\/]rapier\.mjs$/ }, async ({ path }) => {
      const code = await Bun.file(path).text();
      // The one call that hands the base64 to wasm-bindgen's init, which also takes a promised Response.
      const base64 = /[\w$]+\.toByteArray\("AGFzbQ[A-Za-z0-9+/=]*"\)(\.buffer)?/;
      if (!base64.test(code)) throw new Error("rapier.mjs changed: its inlined wasm was not found (tools/build.ts)");
      const wasm = JSON.stringify(join(dirname(path), "rapier_wasm3d_bg.wasm"));
      return { loader: "js", contents: `import rapierWasmUrl from ${wasm} with { type: "file" };\n${code.replace(base64, "fetch(rapierWasmUrl)")}` };
    });
  },
};

const noWgsl: BunPlugin = {
  name: "no WebGPU shaders",
  setup(build) {
    build.onResolve({ filter: /[\\/]ShadersWGSL[\\/]/ }, ({ path }) => ({ path, namespace: "no-wgsl" }));
    build.onLoad({ filter: /.*/, namespace: "no-wgsl" }, () => ({ loader: "js", contents: "export {};" }));
  },
};

const COMPRESS = /\.(js|html|css|wasm|glb|json|svg)$/; // png/jpg are compressed already

export interface Built { type: string; raw: Uint8Array; br?: Uint8Array; gz?: Uint8Array }

/** Bundles index.html; every output by its address ("/index.html", "/chunk-….js", …), compressed with brotli of the
 *  given quality: 11 is 8-10% smaller than 5 but takes ~30 s for all files, 5 takes well under one. */
export async function build(quality = 11) {
  const result = await Bun.build({ entrypoints: [join(root, "index.html")], minify: true, plugins: [rapierWasm, noWgsl] });
  if (!result.success) throw new AggregateError(result.logs, "build failed");
  // index.html's loading screen fetches these itself, to show their bytes arriving.
  const big = result.outputs.filter((o) => /\.(glb|wasm)$/.test(o.path)).map((o) => [`./${o.path.replace(/^.*\//, "")}`, o.size]);
  return new Map(await Promise.all(result.outputs.map(async (output): Promise<[string, Built]> => {
    let raw = new Uint8Array(await output.arrayBuffer());
    const path = output.path.replace(/^\.?\/?/, "/");
    if (path === "/index.html") {
      const page = new TextDecoder().decode(raw);
      if (!page.includes("[/* files */]")) throw new Error("index.html lost its loading list (tools/build.ts)");
      raw = new TextEncoder().encode(page.replace("[/* files */]", JSON.stringify(big)));
    }
    return [path, { type: output.type, raw, ...COMPRESS.test(path) && { gz: Bun.gzipSync(raw, { level: 9 }), br: await brotli(raw, quality) } }];
  })));
}

/** On zlib's own threads: the server keeps answering while it compresses. */
export const brotli = (raw: Uint8Array, quality: number) => new Promise<Uint8Array>((done, fail) =>
  brotliCompress(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } },
    (error, out) => error ? fail(error) : done(out)));

if (import.meta.main) {
  const dist = join(root, "dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist);
  for (const [path, file] of await build()) {
    await Bun.write(join(dist, path), file.raw);
    if (file.br) await Bun.write(join(dist, `${path}.br`), file.br);
    if (file.gz) await Bun.write(join(dist, `${path}.gz`), file.gz);
    console.log(`${path.padEnd(28)} ${String(file.raw.length).padStart(9)}${file.br ? `  br ${String(file.br.length).padStart(9)}  gz ${String(file.gz!.length).padStart(9)}` : ""}`);
  }
}
