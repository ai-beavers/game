// The game for everyone on the local network: serves the game (/), bundled by Bun with live reload, and the
// WebSocket at /net through which the players see each other (src/features/net).
//
//   bun server.ts                    port 5180, or PORT=5192 bun server.ts
//   NODE_ENV=production bun server.ts   no live reload
//
// It prints the addresses to open on other devices. It listens on all interfaces: anyone on the network can join.
// The server is the trust boundary: every message is checked by parseClient (src/features/net/protocol.ts), each
// socket is rate limited, a player only ever speaks as itself, and only the host may move the loose things.
//
// It keeps the world's work (the build feature's changes: trees gnawed and felled, wood, the dam) in order, as long
// as it runs (with WORLD_FILE over restarts too), checked by admit() against its own copy of the world; a joiner gets the list. While its world is still
// empty, the first player with a saved world brings it. Type `reset` and Enter in its terminal to start the world
// afresh: every player's saved world is forgotten too.
//
// On the internet (all optional; without them it behaves as on a LAN):
//   PUBLIC_URL=https://beaver.example/   the address players are told to share, instead of this machine's
//   TRUST_PROXY=cloudflare | fly         the client's address comes from that proxy's header (for the per-address limit)
//   WORLD_FILE=/data/world.json          keeps the world's work there over restarts
//   GIT_SHA=<commit>                     the build; a page from another build reloads once when it reconnects
// GET /net/info answers 200 with JSON while the server runs: it is the health check too.
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { networkInterfaces, hostname } from "node:os";
import index from "./index.html";
import {
  admit, bucket, clientAddress, HELLO_TIME, hostOf, INFO_PATH, MAX_MESSAGE, MAX_PLAYERS, parseClient, PATH, PER_ADDRESS,
  PROXY_HEADERS, restore, type PlayerInfo, type ServerMessage,
} from "./src/features/net/protocol.ts";
import { newState, type BuildChange } from "./src/features/build/rules.ts";

const PORT = Number(process.env.PORT ?? 5180);
const RATE = 60, BURST = 120, CHAT_RATE = 1, CHAT_BURST = 4; // messages a second
const STRIKES = 600; // messages dropped for rate before the socket is closed
const MAX_SOCKETS = 2 * MAX_PLAYERS; // players, and room for those still saying hello or being told it is full
const VERSION = process.env.GIT_SHA ?? "", WORLD_FILE = process.env.WORLD_FILE || undefined, SAVE_AFTER = 2000; // ms
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

const routes: Record<string, Bun.HTMLBundle> = { "/": index };

// ---- the world's work ---------------------------------------------------------------------------------------------

const newEpoch = () => Math.random().toString(36).slice(2, 10);
let epoch = newEpoch(), world = newState(), log: BuildChange[] = [];

// With WORLD_FILE, the world comes back after a restart, with its epoch: returning players hold it already and send
// only what they made meanwhile. It is read through the same checks as live changes; a file that is no world at all
// is kept aside as .bad and the server starts afresh.
if (WORLD_FILE && existsSync(WORLD_FILE)) {
  const saved = restore(readFileSync(WORLD_FILE, "utf8"));
  if (saved) {
    ({ world, log } = saved);
    epoch = saved.whole ? saved.epoch : newEpoch();
    console.log(`The world from ${WORLD_FILE}: ${log.length} changes${saved.whole ? "" : ", some left out"}.`);
  } else {
    copyFileSync(WORLD_FILE, `${WORLD_FILE}.bad`);
    console.warn(`${WORLD_FILE} holds no world (kept as ${WORLD_FILE}.bad): starting afresh.`);
  }
}
let saving: ReturnType<typeof setTimeout> | undefined;
/** Writes the world now: to a new file first, so a crash mid-write leaves the old one whole. */
function save() {
  clearTimeout(saving);
  saving = undefined;
  if (!WORLD_FILE) return;
  try {
    writeFileSync(`${WORLD_FILE}.new`, JSON.stringify({ epoch, build: log }));
    renameSync(`${WORLD_FILE}.new`, WORLD_FILE);
  } catch (error) { console.error(`Could not keep the world in ${WORLD_FILE}:`, error); }
}
// At most one write per SAVE_AFTER while players build, the first change of a quiet world written SAVE_AFTER later.
const changed = () => { if (WORLD_FILE) saving ??= setTimeout(save, SAVE_AFTER); };
if (WORLD_FILE) for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { save(); process.exit(0); });

/** Takes the changes that fit the world, in order, and tells everyone (the sender too, so it can count them). */
function build(id: number, changes: BuildChange[]) {
  const taken = changes.filter((c) => admit(world, c));
  if (!taken.length) return;
  const n = log.length;
  log.push(...taken);
  everyone({ t: "build", id, n, c: taken });
  changed();
}

function reset() {
  epoch = newEpoch(); world = newState(); log = [];
  everyone({ t: "reset" });
  changed();
  console.log("The world is reset.");
}

// ---- players ------------------------------------------------------------------------------------------------------

interface Peer { id: number; name: string; joined: number; carry: number; bot: boolean; away: boolean }
/** address: what the per-address limit counts it under (undefined: not limited); hello: the timer that closes it
 *  unless it says hello. */
interface Data {
  peer?: Peer; rate: ReturnType<typeof bucket>; chat: ReturnType<typeof bucket>; strikes: number; address?: string;
  hello?: ReturnType<typeof setTimeout>;
}
type Socket = Bun.ServerWebSocket<Data>;

const sockets = new Set<Socket>(), peers = new Map<Socket, Peer>(), perAddress = new Map<string, number>();
let nextId = 1, joins = 0, host: Socket | undefined;

const send = (ws: Socket, m: ServerMessage) => void ws.send(JSON.stringify(m));
const others = (ws: Socket, m: ServerMessage) => void ws.publish("all", JSON.stringify(m)); // everyone but ws
const everyone = (m: ServerMessage) => void server.publish("all", JSON.stringify(m));

/** Picks the host again; tells everyone when it changed. */
function elect() {
  const id = hostOf(peers.values());
  const next = [...peers].find(([, p]) => p.id === id)?.[0];
  if (next === host) return;
  host = next;
  everyone({ t: "host", id: next ? peers.get(next)!.id : -1 });
}

function receive(ws: Socket, text: string) {
  const data = ws.data;
  if (!data.rate.take()) {
    if (++data.strikes > STRIKES) ws.close(1008, "too many messages");
    return;
  }
  const m = parseClient(text), peer = data.peer;
  if (!m) return;
  if (!peer) {
    if (m.t !== "hello") return;
    clearTimeout(data.hello);
    if (peers.size >= MAX_PLAYERS) {
      send(ws, { t: "full", players: peers.size, max: MAX_PLAYERS });
      ws.close(1013, "full"); // "try again later"
      return;
    }
    const me: Peer = { id: nextId++, name: m.name, joined: joins++, carry: -1, bot: !!m.bot, away: false };
    data.peer = me;
    peers.set(ws, me);
    const players: PlayerInfo[] = [...peers.values()].filter((p) => p !== me).map(({ id, name }) => ({ id, name }));
    const carried = [...peers.values()].filter((p) => p.carry >= 0).map((p) => [p.id, p.carry] as [number, number]);
    elect();
    const from = m.epoch === epoch && m.have! <= log.length ? m.have! : 0;
    send(ws, { t: "welcome", id: me.id, host: host ? peers.get(host)!.id : -1, players, addresses, carried, epoch, from, build: log.slice(from), version: VERSION });
    others(ws, { t: "join", id: me.id, name: me.name });
    ws.subscribe("all");
    if (host && host !== ws) send(host, { t: "need" });
    console.log(`${me.name} joined (${peers.size} in)`);
    return;
  }
  switch (m.t) {
    case "hello": case "name":
      if (!data.chat.take()) return; // each shows as a line in everyone's chat: under the chat's rate
      peer.name = m.name;
      others(ws, { t: "name", id: peer.id, name: m.name });
      return;
    case "away":
      peer.away = m.away;
      elect();
      return;
    case "chat":
      if (data.chat.take()) others(ws, { t: "chat", id: peer.id, text: m.text });
      return;
    case "state": {
      // A stick goes to whoever claims it first; a later claim is refused and the claimer must let go.
      if (m.c >= 0 && m.c !== peer.carry) {
        if ([...peers.values()].some((p) => p !== peer && p.carry === m.c)) { send(ws, { t: "deny", s: m.c }); m.c = -1; }
      }
      peer.carry = m.c;
      others(ws, { ...m, id: peer.id });
      return;
    }
    case "drop":
      if (peer.carry !== m.s[0]) return;
      peer.carry = -1;
      others(ws, { ...m, id: peer.id });
      return;
    case "things":
      if (ws === host) others(ws, m);
      return;
    case "build":
      build(peer.id, m.c);
      return;
    case "bring":
      // Only into an empty world; one that came too late gets the world there is.
      if (log.length) send(ws, { t: "world", epoch, build: log });
      else build(peer.id, m.c);
      return;
  }
}

const server = Bun.serve<Data>({
  port: PORT,
  hostname: "0.0.0.0",
  development: process.env.NODE_ENV !== "production",
  routes,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === INFO_PATH) return Response.json({ addresses, players: peers.size, max: MAX_PLAYERS, epoch, build: log, version: VERSION });
    if (url.pathname === PATH) {
      // Full of players is told after hello (the browser cannot read why an upgrade failed); this only bounds sockets.
      const address = clientAddress(req.headers, server.requestIP(req)?.address, PROXY_HEADER);
      if (address && (perAddress.get(address) ?? 0) >= PER_ADDRESS) return new Response("too many from here", { status: 429 });
      if (sockets.size >= MAX_SOCKETS) return new Response("full", { status: 503 });
      const data: Data = { rate: bucket(RATE, BURST), chat: bucket(CHAT_RATE, CHAT_BURST), strikes: 0, address };
      return server.upgrade(req, { data }) ? undefined : new Response("WebSocket only", { status: 400 });
    }
    return new Response("not found", { status: 404 });
  },
  websocket: {
    maxPayloadLength: MAX_MESSAGE,
    idleTimeout: 30, // s; the client sends its state many times a second while it runs
    // A client that does not read what it is sent is closed before its queue eats the server's memory (16 MB each by
    // default); 1 MB is many seconds of a full world's traffic.
    backpressureLimit: 1024 * 1024,
    closeOnBackpressureLimit: true,
    open(ws) {
      sockets.add(ws);
      const { address } = ws.data;
      if (address) perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
      // Bun pings idle sockets and every client answers, so one that never says hello would hold its place forever.
      ws.data.hello = setTimeout(() => { if (!ws.data.peer) ws.close(1008, "no hello"); }, HELLO_TIME);
    },
    message(ws, text) { receive(ws, typeof text === "string" ? text : ""); },
    close(ws) {
      sockets.delete(ws);
      clearTimeout(ws.data.hello);
      const { address } = ws.data, n = address ? perAddress.get(address)! - 1 : 0;
      if (address) { if (n > 0) perAddress.set(address, n); else perAddress.delete(address); }
      const peer = peers.get(ws);
      if (!peer) return;
      peers.delete(ws);
      ws.unsubscribe("all");
      everyone({ t: "leave", id: peer.id });
      if (ws === host) host = undefined;
      elect();
      console.log(`${peer.name} left (${peers.size} in)`);
    },
  },
});

console.log(`Beaver on port ${server.port}. Open on this network:\n${addresses.map((a) => `  ${a}`).join("\n")}`);
console.log("Type reset and Enter to start the world afresh.");
for await (const line of console) if (line.trim() === "reset") reset();
