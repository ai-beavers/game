// The game for everyone on the local network: serves the game (/), bundled by Bun with live reload, and the
// WebSocket at /net through which the players see each other (src/features/net).
//
//   bun server.ts                    port 5180, or PORT=5192 bun server.ts
//   NODE_ENV=production bun server.ts   no live reload
//
// It prints the addresses to open on other devices. It listens on all interfaces: anyone on the network can join.
// The world's rules are the room's (src/features/net/room.ts), which is the trust boundary and runs on Cloudflare too
// (worker.ts); this file gives it Bun's sockets and a file.
//
// The room keeps the world's work (the build feature's changes: trees gnawed and felled, wood, the dam) in order, as long
// as it runs (with WORLD_FILE over restarts too), checked by admit() against its own copy of the world; a joiner gets the list,
// kept as short as the present world (compact). A player whose change it refuses gets the whole world again. While its world is still
// empty, the first player with a saved world brings it. It keeps the day too: 16:00 when it starts, one day every 720 s,
// told to each player in welcome (not saved). Type `reset` and Enter in its terminal to start the world
// afresh: every player's saved world is forgotten too.
//
// On the internet (all optional; without them it behaves as on a LAN):
//   PUBLIC_URL=https://beaver.example/   the address players are told to share, instead of this machine's; pages
//                                        from there may open the socket too (else only those from the Host asked)
//   TRUST_PROXY=cloudflare | fly         the client's address comes from that proxy's header (for the per-address limit)
//   WORLD_FILE=/data/world.json          keeps the world's work there over restarts
//   GIT_SHA=<commit>                     the build; a page from another build reloads once when it reconnects
// GET /net/info answers 200 with JSON while the server runs: it is the health check too. Its changes come only with
// ?build (the page asks once as it loads).
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { networkInterfaces, hostname } from "node:os";
import index from "./index.html";
import { clientAddress, INFO_PATH, MAX_MESSAGE, PATH, PROXY_HEADERS } from "./src/features/net/protocol.ts";
import { newRoom, type Conn } from "./src/features/net/room.ts";
import type { Built } from "./tools/build.ts";

const PORT = Number(process.env.PORT ?? 5180);
const VERSION = process.env.GIT_SHA ?? "", WORLD_FILE = process.env.WORLD_FILE || undefined;
const TRUST = process.env.TRUST_PROXY || undefined, PROXY_HEADER = TRUST && PROXY_HEADERS[TRUST];
if (TRUST && !PROXY_HEADER) throw new Error(`TRUST_PROXY must be one of ${Object.keys(PROXY_HEADERS).join(", ")}, not ${TRUST}`);

// ---- addresses ------------------------------------------------------------------------------------------------

function localName() {
  if (process.platform === "darwin") {
    const scutil = Bun.spawnSync(["scutil", "--get", "LocalHostName"]);
    const name = scutil.stdout.toString().trim();
    if (scutil.exitCode === 0 && name) return `${name}.local`;
  }
  const name = hostname();
  return name.includes(".") ? name : `${name}.local`;
}
const lan = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a!.address);
// With live reload on, Bun answers only to hosts it knows (localhost and plain addresses) and blocks the .local
// name ("Host header does not match the dev server"): it is offered only without live reload.
const hosts = process.env.NODE_ENV === "production" ? [localName(), ...lan] : lan;
const addresses = process.env.PUBLIC_URL ? [process.env.PUBLIC_URL] : hosts.map((host) => `http://${host}:${PORT}/`);

// ---- pages --------------------------------------------------------------------------------------------------------

// Live reload: Bun bundles index.html itself. Production: our own bundle (tools/build.ts), because Bun's static routes
// compress nothing and the game is ~12 MB of compressible code, wasm and models for viewers on phones. Files are
// served from memory as brotli or gzip, whichever the browser takes (plain http on the LAN gets gzip: browsers
// offer br only on https and localhost); hashed names are cached for a year, the page itself is always asked again.
// It starts with quick brotli (quality 5) and swaps in the ~10% smaller quality 11 once that is done (~15 s).
const routes: Record<string, Bun.HTMLBundle | ((req: Request) => Response)> = process.env.NODE_ENV === "production" ? await bundle() : { "/": index };

async function bundle() {
  const { build, brotli } = await import("./tools/build.ts");
  const files = await build(5);
  void Promise.all([...files.values()].map(async (file) => { if (file.br) file.br = await brotli(file.raw, 11); }));
  const serve = (file: Built, cache: string) => (req: Request) => {
    const accept = req.headers.get("accept-encoding") ?? "";
    const [body, encoding] = file.br && /\bbr\b/.test(accept) ? [file.br, "br"] : file.gz && /\bgzip\b/.test(accept) ? [file.gz, "gzip"] : [file.raw, ""];
    const headers: Record<string, string> = { "Content-Type": file.type, "Cache-Control": cache, Vary: "Accept-Encoding" };
    if (encoding) headers["Content-Encoding"] = encoding;
    return new Response(body, { headers });
  };
  return Object.fromEntries([...files].map(([path, file]) => path === "/index.html"
    ? ["/", serve(file, "no-cache")] : [path, serve(file, "public, max-age=31536000, immutable")]));
}

// ---- the world ----------------------------------------------------------------------------------------------------

/** Writes the world: to a new file first, so a crash mid-write leaves the old one whole. */
function keep(text: string) {
  try {
    writeFileSync(`${WORLD_FILE}.new`, text);
    renameSync(`${WORLD_FILE}.new`, WORLD_FILE!);
  } catch (error) { console.error(`Could not keep the world in ${WORLD_FILE}:`, error); }
}
// With WORLD_FILE, the world comes back after a restart; a file that is no world at all is kept aside as .bad.
const room = newRoom({
  version: VERSION, publicUrl: process.env.PUBLIC_URL,
  saved: WORLD_FILE && existsSync(WORLD_FILE) ? readFileSync(WORLD_FILE, "utf8") : undefined, keep: WORLD_FILE ? keep : undefined,
});
if (room.broken) {
  copyFileSync(WORLD_FILE!, `${WORLD_FILE}.bad`);
  console.warn(`${WORLD_FILE} holds no world (kept as ${WORLD_FILE}.bad): starting afresh.`);
}
if (WORLD_FILE) for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { room.save(); process.exit(0); });

/** address: what the per-address limit counts the socket under; conn: the room's side of it, once it is open. */
interface Data { address?: string; conn?: Conn }

const server = Bun.serve<Data>({
  port: PORT,
  hostname: "0.0.0.0",
  development: process.env.NODE_ENV !== "production",
  routes,
  fetch(req, server) {
    const url = new URL(req.url);
    // Not rate limited, since it costs less than the page itself.
    if (url.pathname === INFO_PATH) return Response.json(room.info(addresses, url.searchParams.has("build")));
    if (url.pathname === PATH) {
      const address = clientAddress(req.headers, server.requestIP(req)?.address, PROXY_HEADER);
      const refused = room.refuse(req.headers.get("origin"), req.headers.get("host"), address);
      if (refused) return refused;
      return server.upgrade(req, { data: { address } }) ? undefined : new Response("WebSocket only", { status: 400 });
    }
    return new Response("not found", { status: 404 });
  },
  websocket: {
    maxPayloadLength: MAX_MESSAGE,
    idleTimeout: 30, // s; Bun pings idle sockets and every client answers, so only a dead one is closed
    // A client that does not read what it is sent is closed before its queue eats the server's memory (16 MB each by
    // default); 1 MB is many seconds of a full world's traffic.
    backpressureLimit: 1024 * 1024,
    closeOnBackpressureLimit: true,
    open(ws) { ws.data.conn = room.open(ws, addresses, ws.data.address); },
    message(ws, text) { room.receive(ws.data.conn!, typeof text === "string" ? text : ""); },
    close(ws) { room.close(ws.data.conn!); },
  },
});

console.log(`Beaver on port ${server.port}. Open on this network:\n${addresses.map((a) => `  ${a}`).join("\n")}`);
console.log("Type reset and Enter to start the world afresh.");
for await (const line of console) if (line.trim() === "reset") room.reset();
