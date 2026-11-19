// One shared world's rules, without a transport: who is in, what each may say, the world's work and the day. The Bun
// server (server.ts) and the Durable Object on Cloudflare (worker.ts) both run this, so they cannot drift apart. It
// knows neither: each gives it sockets, what it kept of the world, and a way to keep it.
//
//   const room = newRoom({ version, saved, keep });   saved: the text keep() was last given, if any
//   room.refuse(origin, host, address)                a Response when a new socket may not open, else undefined
//   const conn = room.open(socket, addresses, address)
//   room.receive(conn, text) · room.close(conn)       each message of that socket, and its end
//   room.info(addresses, withBuild)                   what GET /net/info answers
//   room.reset() · room.save()                        the world afresh; the world kept now (before the process ends)
//
// The room is the trust boundary: every message is checked by parseClient (protocol.ts), each socket is rate limited,
// a player only ever speaks as itself, and only the host may move the loose things.
import { newState, type BuildChange } from "../build/rules.ts";
import {
  admit, bucket, compact, HELLO_TIME, hostOf, hourAt, MAX_PLAYERS, newEpoch, parseClient, PER_ADDRESS, restore, sameOrigin, START, uniqueName,
  type PlayerInfo, type ServerMessage, type Work,
} from "./protocol.ts";

const RATE = 60, BURST = 120, CHAT_RATE = 1, CHAT_BURST = 4; // messages a second
const RESEND_RATE = 0.5, RESEND_BURST = 3; // whole worlds a second to one player whose changes are refused
const STRIKES = 600; // messages dropped for rate before the socket is closed
const MAX_SOCKETS = 2 * MAX_PLAYERS; // players, and room for those still saying hello or being told it is full
/** How long a change may wait before it is kept: at most this much work is lost when the process ends unasked. */
export const SAVE_AFTER = 2000; // ms

/** What the room needs of a WebSocket. send on a closed socket must not throw. */
export interface Socket { send(text: string): unknown; close(code: number, reason: string): void }

interface Peer { id: number; name: string; joined: number; carry: number; bot: boolean; away: boolean }
/** One socket in the room. addresses: what it is told to share; address: what the per-address limit counts it under
 *  (undefined: not limited); listening: it said hello and hears what everyone is told; hello: the timer that closes
 *  it unless it says hello. */
export interface Conn {
  socket: Socket; addresses: string[]; address?: string; peer?: Peer; listening: boolean;
  rate: ReturnType<typeof bucket>; chat: ReturnType<typeof bucket>; resend: ReturnType<typeof bucket>; strikes: number;
  hello?: ReturnType<typeof setTimeout>;
}

/** version: the build (a commit), "" in development. publicUrl: pages from there may open the socket too. saved and
 *  keep: the world's work over restarts; without keep nothing is kept. */
export interface Home { version: string; publicUrl?: string; saved?: string; keep?: (text: string) => void }

export function newRoom({ version, publicUrl, saved, keep }: Home) {
  // ---- the world's work -------------------------------------------------------------------------------------------

  const work: Work = { epoch: newEpoch(), world: newState(), log: [] };
  const dayFrom = performance.now(); // ms: START o'clock of the shared day

  // What was kept comes back with its epoch: returning players hold it already and send only what they made
  // meanwhile. It is read through the same checks as live changes; text that is no world at all is `broken`, for
  // the caller to keep aside, and the room starts afresh.
  const kept = saved === undefined ? undefined : restore(saved), broken = saved !== undefined && !kept;
  if (kept) {
    Object.assign(work, { world: kept.world, log: kept.log, epoch: kept.whole ? kept.epoch : newEpoch() });
    console.log(`The kept world: ${work.log.length} changes${kept.whole ? "" : ", some left out"}.`);
    compact(work); // kept from before the room compacted
  }

  let saving: ReturnType<typeof setTimeout> | undefined;
  /** Keeps the world now. */
  function save() {
    clearTimeout(saving);
    saving = undefined;
    keep?.(JSON.stringify({ epoch: work.epoch, build: work.log }));
  }
  // At most one write per SAVE_AFTER while players build, the first change of a quiet world written SAVE_AFTER later.
  const changed = () => { if (keep) saving ??= setTimeout(save, SAVE_AFTER); };

  /** Takes the changes that fit the world, in order, and tells everyone (the sender too, so it can count them). One
   *  that does not fit was already applied by its sender (a grow asked too early, a tree felled by two at once): it
   *  gets the room's world again, to take that instead. */
  function build(conn: Conn, changes: BuildChange[]) {
    const taken = changes.filter((c) => admit(work.world, c)), n = work.log.length;
    if (taken.length) {
      work.log.push(...taken);
      everyone({ t: "build", id: conn.peer!.id, n, c: taken });
      if (compact(work)) everyone({ t: "epoch", epoch: work.epoch, n: work.log.length });
      changed();
    }
    if (taken.length < changes.length && conn.resend.take()) send(conn, { t: "world", epoch: work.epoch, build: work.log });
  }

  /** Starts the world afresh: every player's saved world is forgotten too. */
  function reset() {
    Object.assign(work, { epoch: newEpoch(), world: newState(), log: [] });
    everyone({ t: "reset" });
    changed();
    console.log("The world is reset.");
  }

  // ---- players ----------------------------------------------------------------------------------------------------

  const conns = new Set<Conn>(), peers = new Map<Conn, Peer>(), perAddress = new Map<string, number>();
  let nextId = 1, joins = 0, host: Conn | undefined;

  const send = (conn: Conn, m: ServerMessage) => void conn.socket.send(JSON.stringify(m));
  const tell = (m: ServerMessage, but?: Conn) => { const text = JSON.stringify(m); for (const c of conns) if (c.listening && c !== but) c.socket.send(text); };
  const others = (conn: Conn, m: ServerMessage) => tell(m, conn);
  const everyone = (m: ServerMessage) => tell(m);
  /** Closes a socket and takes it out at once, whenever its transport tells of the end. */
  const shut = (conn: Conn, code: number, reason: string) => { conn.socket.close(code, reason); close(conn); };

  /** Picks the host again; tells everyone when it changed. */
  function elect() {
    const id = hostOf(peers.values());
    const next = [...peers].find(([, p]) => p.id === id)?.[0];
    if (next === host) return;
    host = next;
    everyone({ t: "host", id: next ? peers.get(next)!.id : -1 });
  }

  function receive(conn: Conn, text: string) {
    if (!conns.has(conn)) return;
    if (!conn.rate.take()) {
      if (++conn.strikes > STRIKES) shut(conn, 1008, "too many messages");
      return;
    }
    const m = parseClient(text), peer = conn.peer;
    if (!m) return;
    if (!peer) {
      if (m.t !== "hello") return;
      clearTimeout(conn.hello);
      if (peers.size >= MAX_PLAYERS) {
        send(conn, { t: "full", players: peers.size, max: MAX_PLAYERS });
        shut(conn, 1013, "full"); // "try again later"
        return;
      }
      const name = uniqueName(m.name, [...peers.values()].map((p) => p.name));
      const me: Peer = { id: nextId++, name, joined: joins++, carry: -1, bot: !!m.bot, away: false };
      conn.peer = me;
      peers.set(conn, me);
      const players: PlayerInfo[] = [...peers.values()].filter((p) => p !== me).map(({ id, name }) => ({ id, name }));
      const carried = [...peers.values()].filter((p) => p.carry >= 0).map((p) => [p.id, p.carry] as [number, number]);
      elect(); // the others hear of a new host; this one reads it in its welcome
      const { epoch, log } = work, from = m.epoch === epoch && m.have! <= log.length ? m.have! : 0;
      send(conn, {
        t: "welcome", id: me.id, host: host ? peers.get(host)!.id : -1, players, addresses: conn.addresses, carried, epoch, from, build: log.slice(from), version,
        hour: hourAt(START, dayFrom, performance.now()),
      });
      if (name !== m.name) send(conn, { t: "name", id: me.id, name }); // the name it is known by
      others(conn, { t: "join", id: me.id, name: me.name });
      conn.listening = true;
      if (host && host !== conn) send(host, { t: "need" });
      console.log(`${me.name} joined (${peers.size} in)`);
      return;
    }
    switch (m.t) {
      case "hello": case "name":
        if (!conn.chat.take()) return; // each shows as a line in everyone's chat: under the chat's rate
        peer.name = uniqueName(m.name, [...peers.values()].filter((p) => p !== peer).map((p) => p.name));
        others(conn, { t: "name", id: peer.id, name: peer.name });
        if (peer.name !== m.name) send(conn, { t: "name", id: peer.id, name: peer.name });
        return;
      case "away":
        peer.away = m.away;
        elect();
        return;
      case "chat":
        if (conn.chat.take()) others(conn, { t: "chat", id: peer.id, text: m.text });
        return;
      case "state": {
        // A stick goes to whoever claims it first; a later claim is refused and the claimer must let go.
        if (m.c >= 0 && m.c !== peer.carry) {
          if ([...peers.values()].some((p) => p !== peer && p.carry === m.c)) { send(conn, { t: "deny", s: m.c }); m.c = -1; }
        }
        peer.carry = m.c;
        others(conn, { ...m, id: peer.id });
        return;
      }
      case "drop":
        if (peer.carry !== m.s[0]) return;
        peer.carry = -1;
        others(conn, { ...m, id: peer.id });
        return;
      case "things":
        if (conn === host) others(conn, m);
        return;
      case "build":
        build(conn, m.c);
        return;
      case "bring":
        // Only into an empty world; one that came too late gets the world there is.
        if (work.log.length) send(conn, { t: "world", epoch: work.epoch, build: work.log });
        else build(conn, m.c);
        return;
    }
  }

  /** Why a socket may not open from this page (its Origin and the Host asked) and client address, as the answer to
   *  give instead. Full of players is told after hello (the browser cannot read why an upgrade failed); this only
   *  bounds sockets. */
  function refuse(origin: string | null, hostHeader: string | null, address: string | undefined): Response | undefined {
    if (!sameOrigin(origin, hostHeader, publicUrl)) return new Response("not from here", { status: 403 });
    if (address && (perAddress.get(address) ?? 0) >= PER_ADDRESS) return new Response("too many from here", { status: 429 });
    if (conns.size >= MAX_SOCKETS) return new Response("full", { status: 503 });
  }

  function open(socket: Socket, addresses: string[], address?: string): Conn {
    const conn: Conn = { socket, addresses, address, listening: false, rate: bucket(RATE, BURST), chat: bucket(CHAT_RATE, CHAT_BURST), resend: bucket(RESEND_RATE, RESEND_BURST), strikes: 0 };
    conns.add(conn);
    if (address) perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
    // A socket that never says hello would hold its place for as long as it stays open.
    conn.hello = setTimeout(() => { if (!conn.peer) shut(conn, 1008, "no hello"); }, HELLO_TIME);
    return conn;
  }

  /** The socket ended. A second call for the same socket does nothing. */
  function close(conn: Conn) {
    if (!conns.delete(conn)) return;
    clearTimeout(conn.hello);
    const { address } = conn, n = address ? perAddress.get(address)! - 1 : 0;
    if (address) { if (n > 0) perAddress.set(address, n); else perAddress.delete(address); }
    const peer = peers.get(conn);
    if (peer) {
      peers.delete(conn);
      everyone({ t: "leave", id: peer.id });
      if (conn === host) host = undefined;
      elect();
      console.log(`${peer.name} left (${peers.size} in)`);
    }
    if (saving && !conns.size) save(); // nobody is left to keep the process awake until the timer
  }

  /** Small for health checks and the join screen; the changes only when asked (the page asks once as it loads). */
  function info(addresses: string[], withBuild: boolean) {
    const { epoch, log } = work, small = { addresses, players: peers.size, max: MAX_PLAYERS, epoch, changes: log.length, version };
    return withBuild ? { ...small, build: log } : small;
  }

  return { broken, refuse, open, receive, close, info, reset, save };
}
