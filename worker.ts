// The game on Cloudflare: this Worker answers /net and below (/net/events, the House of AI events, itself from Workers
// KV, which a daily Cron Trigger renews from Luma's feed; the rest through the World); every other address is a file
// of dist/, which Cloudflare serves without running this (wrangler.jsonc). One Durable Object, World, is the shared
// world: it runs the same room as server.ts (src/features/net/room.ts) on Cloudflare's WebSockets and keeps the
// world's work in its own storage. A second object of the same class is the tour's world (?world=tour, protocol.ts TOUR_WORLD).
//
//   bun run build && bunx wrangler dev      the Worker on this machine, port 8787 (no account needed)
//   bunx wrangler deploy                    what the deploy job of .github/workflows/check.yml runs on main
//
// Set at deploy:
//   GIT_SHA       (--var) the build; a page from another build reloads once when it reconnects
//   RESET_TOKEN   (secret, `bunx wrangler secret put RESET_TOKEN`) lets its holder start the world afresh:
//                 curl -X POST -H "Authorization: Bearer $RESET_TOKEN" https://<address>/net/reset
//                 Without the secret, or with another token, that address answers 404 like any unknown one.
//   ELEVENLABS_API_KEY (secret, `bunx wrangler secret put ELEVENLABS_API_KEY`) the Old Beaver says his lores in his
//                 voice (src/features/old-beaver/voice.ts); without it he murmurs. Every talk with ElevenLabs is in
//                 the Worker's logs.
//
// A deploy ends the object without warning: every player reconnects, and work of the last SAVE_AFTER ms can be lost.
import { DurableObject } from "cloudflare:workers";
import { clientAddress, EVENTS_PATH, INFO_PATH, PATH, PROXY_HEADERS, RESET_PATH, TOUR_WORLD, worldOf } from "./src/features/net/protocol.ts";
import { newRoom, type Socket } from "./src/features/net/room.ts";
import { voiceWith } from "./src/features/old-beaver/voice.ts";
import { kvEvents } from "./src/features/shop/events.ts";

/** EVENTS: the Workers KV namespace holding the one copy of the House of AI events (wrangler.jsonc).
 *  HOUSE_OF_AI_FEED (--var): another iCal address for the House of AI events than Luma's (the tests' fixture). */
interface Env { WORLD: DurableObjectNamespace<World>; EVENTS: KVNamespace; GIT_SHA?: string; RESET_TOKEN?: string; HOUSE_OF_AI_FEED?: string; ELEVENLABS_API_KEY?: string }

const KEPT = "world"; // the key the world's work is kept under, as the text server.ts keeps in WORLD_FILE
const NOT_FOUND = () => new Response("not found", { status: 404 });
/** The House of AI events in KV; made at the first call, which brings the environment. */
let events: ReturnType<typeof kvEvents> | undefined;
const eventsOf = (env: Env) => events ??= kvEvents(env.EVENTS, { feed: env.HOUSE_OF_AI_FEED || undefined });

export default {
  fetch(req, env, ctx) {
    const { pathname, searchParams } = new URL(req.url);
    if (pathname === EVENTS_PATH) return eventsOf(env).answer((work) => ctx.waitUntil(work));
    if (pathname !== PATH && pathname !== INFO_PATH && pathname !== RESET_PATH) return NOT_FOUND();
    // One world for everyone, and the tour's beside it: each the same object by its fixed name, placed in western
    // Europe when it is first made.
    return env.WORLD.get(env.WORLD.idFromName(worldOf(searchParams) || "world"), { locationHint: "weur" }).fetch(req);
  },
  /** The daily Cron Trigger (wrangler.jsonc): the only regular asker of Luma's feed. */
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(eventsOf(env).renew());
  },
} satisfies ExportedHandler<Env>;

export class World extends DurableObject<Env> {
  private made?: ReturnType<typeof newRoom>;

  /** The room, made at the first request: only its address says which world this object is. */
  private roomOf(url: URL) {
    if (this.made) return this.made;
    const { ctx, env } = this, saved = ctx.storage.kv.get<string>(KEPT);
    this.made = newRoom({
      version: env.GIT_SHA ?? "", saved, keep: (text) => ctx.storage.kv.put(KEPT, text), sandbox: worldOf(url.searchParams) === TOUR_WORLD,
      speak: voiceWith(env.ELEVENLABS_API_KEY || undefined),
    });
    if (this.made.broken) ctx.storage.kv.put(`${KEPT}.bad`, saved); // kept aside, as server.ts keeps a broken file
    return this.made;
  }

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url), addresses = [`${url.origin}/`]; // players share the address they came to
    const room = this.roomOf(url);
    if (url.pathname === INFO_PATH) return Response.json(room.info(addresses, url.searchParams.has("build")));
    if (url.pathname === RESET_PATH) {
      if (req.method !== "POST" || !(await holdsToken(req.headers.get("authorization"), this.env.RESET_TOKEN))) return NOT_FOUND();
      room.reset();
      return new Response("The world is reset.\n");
    }
    // Cloudflare writes the client's address into its header itself: nobody else can.
    const address = clientAddress(req.headers, undefined, PROXY_HEADERS.cloudflare);
    const refused = room.refuse(req.headers.get("origin"), req.headers.get("host"), address);
    if (refused) return refused;
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket only", { status: 400 });

    // shortcut: plain WebSockets, not the Hibernation API, so the room's state per socket stays in memory as in
    // server.ts. A connected tab keeps the object awake and billed even when it sends nothing; players send 20
    // states a second, so that only matters for idle tabs. Change it for several worlds or idle tabs in numbers.
    const { 0: client, 1: ws } = new WebSocketPair();
    ws.accept();
    // What Bun's sockets do and these do not: there is no limit on what waits to be sent to a client that does not
    // read (the object's 128 MB of memory bounds it: beyond, Cloudflare restarts the object and everyone reconnects)
    // and no ping, so a socket whose client vanished stays until Cloudflare's edge notices. Both are bounded by the
    // room's limit of sockets, per address and in all. A message over MAX_MESSAGE is dropped by parseClient, not
    // closed for.
    const socket: Socket = {
      send: (data) => { try { ws.send(data); } catch { /* closed meanwhile: its close event takes it out */ } },
      close: (code, reason) => { try { ws.close(code, reason); } catch { /* closed already */ } },
    };
    const conn = room.open(socket, addresses, address);
    ws.addEventListener("message", (event) => room.receive(conn, typeof event.data === "string" ? event.data : ""));
    const ended = () => { socket.close(1000, ""); room.close(conn); };
    ws.addEventListener("close", ended);
    ws.addEventListener("error", ended);
    return new Response(null, { status: 101, webSocket: client });
  }
}

/** Whether the Authorization header holds the reset token. Both are hashed first, so the comparison takes the same
 *  time whatever was sent and however long it is. */
async function holdsToken(header: string | null, token: string | undefined): Promise<boolean> {
  if (!header || !token) return false;
  const hash = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const given = await hash(header), wanted = await hash(`Bearer ${token}`);
  let differ = 0;
  for (let i = 0; i < wanted.length; i++) differ |= given[i]! ^ wanted[i]!;
  return differ === 0;
}
