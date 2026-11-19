// The game on Cloudflare: this Worker answers /net and below (/net/events, the House of AI events, itself; the rest
// through the World); every other address is a file of dist/, which
// Cloudflare serves without running this (wrangler.jsonc). One Durable Object, World, is the shared world: it runs
// the same room as server.ts (src/features/net/room.ts) on Cloudflare's WebSockets and keeps the world's work in its
// own storage.
//
//   bun run build && bunx wrangler dev      the Worker on this machine, port 8787 (no account needed)
//   bunx wrangler deploy                    what the deploy job of .github/workflows/check.yml runs on main
//
// Set at deploy:
//   GIT_SHA       (--var) the build; a page from another build reloads once when it reconnects
//   RESET_TOKEN   (secret, `bunx wrangler secret put RESET_TOKEN`) lets its holder start the world afresh:
//                 curl -X POST -H "Authorization: Bearer $RESET_TOKEN" https://<address>/net/reset
//                 Without the secret, or with another token, that address answers 404 like any unknown one.
//
// A deploy ends the object without warning: every player reconnects, and work of the last SAVE_AFTER ms can be lost.
import { DurableObject } from "cloudflare:workers";
import { clientAddress, EVENTS_PATH, INFO_PATH, PATH, PROXY_HEADERS, RESET_PATH } from "./src/features/net/protocol.ts";
import { newRoom, type Socket } from "./src/features/net/room.ts";
import { houseOfAiEvents } from "./src/features/shop/events.ts";

/** HOUSE_OF_AI_FEED (--var): another iCal address for the House of AI events than Luma's (the tests' fixture). */
interface Env { WORLD: DurableObjectNamespace<World>; GIT_SHA?: string; RESET_TOKEN?: string; HOUSE_OF_AI_FEED?: string }

const KEPT = "world"; // the key the world's work is kept under, as the text server.ts keeps in WORLD_FILE
const NOT_FOUND = () => new Response("not found", { status: 404 });
// shortcut: the copy of the events is kept per isolate, so Cloudflare may hold a few; move it into World if Luma minds.
let events: ReturnType<typeof houseOfAiEvents> | undefined;

export default {
  fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (pathname === EVENTS_PATH) return (events ??= houseOfAiEvents(env.HOUSE_OF_AI_FEED || undefined))();
    if (pathname !== PATH && pathname !== INFO_PATH && pathname !== RESET_PATH) return NOT_FOUND();
    // One world for everyone: the same object by its fixed name, placed in western Europe when it is first made.
    return env.WORLD.get(env.WORLD.idFromName("world"), { locationHint: "weur" }).fetch(req);
  },
} satisfies ExportedHandler<Env>;

export class World extends DurableObject<Env> {
  private room: ReturnType<typeof newRoom>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const saved = ctx.storage.kv.get<string>(KEPT);
    this.room = newRoom({ version: env.GIT_SHA ?? "", saved, keep: (text) => ctx.storage.kv.put(KEPT, text) });
    if (this.room.broken) ctx.storage.kv.put(`${KEPT}.bad`, saved); // kept aside, as server.ts keeps a broken file
  }

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url), addresses = [`${url.origin}/`]; // players share the address they came to
    if (url.pathname === INFO_PATH) return Response.json(this.room.info(addresses, url.searchParams.has("build")));
    if (url.pathname === RESET_PATH) {
      if (req.method !== "POST" || !(await holdsToken(req.headers.get("authorization"), this.env.RESET_TOKEN))) return NOT_FOUND();
      this.room.reset();
      return new Response("The world is reset.\n");
    }
    // Cloudflare writes the client's address into its header itself: nobody else can.
    const address = clientAddress(req.headers, undefined, PROXY_HEADERS.cloudflare);
    const refused = this.room.refuse(req.headers.get("origin"), req.headers.get("host"), address);
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
      send: (text) => { try { ws.send(text); } catch { /* closed meanwhile: its close event takes it out */ } },
      close: (code, reason) => { try { ws.close(code, reason); } catch { /* closed already */ } },
    };
    const conn = this.room.open(socket, addresses, address);
    ws.addEventListener("message", (event) => this.room.receive(conn, typeof event.data === "string" ? event.data : ""));
    const ended = () => { socket.close(1000, ""); this.room.close(conn); };
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
