// The messages players and server.ts exchange over the WebSocket at /net, and the checks the server runs on every
// message a player sends. Pure, no browser and no Bun: server.ts, the client (index.ts), bot.ts and the tests share it.
//
//   const message = parseClient(text);      undefined: unknown, too big, out of range; the server drops it
//   hostOf(players)                         who simulates the loose things: the one who has been in longest
//   admit(world, change)                    the server's check of one build change against its world
//   changesOf(state) · replay(changes)      a build state as the changes that make it, and back
//   compact(work)                           the server's log shortened to the present world
//
// Every message is JSON with a type `t`. The server never takes a player id from a client: it adds the sender's own.
import type { Action, Motion } from "../../contracts.ts";
import { apply, BITES_TO_SPLIT, bitesToFell, live, newState, REGROW, STICKS, type BuildChange, type BuildState, type TreeState } from "../build/rules.ts";

export const PATH = "/net", INFO_PATH = "/net/info";
export const MAX_PLAYERS = 16;
/** Sockets one client address may hold (a household or class behind one router), and how long a new socket has to
 *  say hello before it is closed: the browser says it the moment the socket opens. */
export const PER_ADDRESS = 4, HELLO_TIME = 5000;
export const MAX_MESSAGE = 32 * 1024; // bytes; a whole world's build changes are about 12 KB at most
export const NAME_LENGTH = 20, CHAT_LENGTH = 140;
export const SEND_RATE = 20; // states and things per second

// ---- loose things: one id for the same thing in every browser ------------------------------------------------------

/** Trees the server takes changes for (the world has 13). */
export const MAX_TREES = 32;
/** Ids: the world's own sticks from 0, the crates from CRATES, the wood of tree i from WOOD + i * PIECES (one id per
 *  piece of woodFrom, src/features/build/rules.ts, at most 2 logs and 6 sticks). */
export const CRATES = 64, WOOD = 128, PIECES = 8;
export const MAX_THINGS = WOOD + MAX_TREES * PIECES;
export const woodId = (tree: number, piece: number) => WOOD + tree * PIECES + piece;
/** The id of a stick the build feature names ("w3": the world's fourth stick, "t2:1": piece 1 of tree 2's wood). */
export function stickId(name: string): number | undefined {
  const world = /^w(\d+)$/.exec(name), wood = /^t(\d+):(\d+)$/.exec(name);
  if (world && +world[1]! < CRATES) return +world[1]!;
  if (wood && +wood[1]! < MAX_TREES && +wood[2]! < PIECES) return woodId(+wood[1]!, +wood[2]!);
  return undefined;
}

// ---- the Motion, as a flat list of numbers ----------------------------------------------------------------------

export const ACTIONS: Action[] = ["none", "pickup", "drop", "gnaw", "build"];
const BIG = 1e7; // s or m: more than any session reaches
/** How low the beaver is (Motion.low), as its index: 0 standing (left out), 1 sitting, 2 crawling. */
export const LOWS = [undefined, "sit", "crawl"] as const;
/** Field, lowest, highest; booleans travel as 0 / 1, the action as its index in ACTIONS, low as its index in LOWS. */
const MOTION: [keyof Motion, number, number][] = [
  ["speed", 0, 30], ["distance", -BIG, BIG], ["turning", -100, 100], ["grounded", 0, 1], ["vertical", -100, 100],
  ["airTime", 0, BIG], ["sinceLanding", 0, BIG], ["landingSpeed", 0, 100], ["swimming", 0, 1],
  ["action", 0, ACTIONS.length - 1], ["actionProgress", 0, 1], ["carrying", 0, 1], ["anger", 0, 1], ["time", 0, BIG],
  ["low", 0, LOWS.length - 1],
];

const LOW_AT = MOTION.findIndex(([key]) => key === "low");

export function packMotion(m: Motion): number[] {
  return MOTION.map(([key]) => {
    const v = m[key];
    if (key === "action") return ACTIONS.indexOf(v as Action);
    if (key === "low") return LOWS.indexOf(v as Motion["low"]);
    if (typeof v === "boolean") return v ? 1 : 0;
    return Math.round((v as number) * 1000) / 1000;
  });
}

export function unpackMotion(list: number[], into: Motion): Motion {
  MOTION.forEach(([key], i) => {
    const v = list[i]!;
    if (key === "low") { const low = LOWS[Math.round(v)]; if (low) into.low = low; else delete into.low; return; }
    (into as unknown as Record<string, unknown>)[key] = key === "action" ? ACTIONS[v] : key === "grounded" || key === "carrying" ? v > 0.5 : v;
  });
  return into;
}

// ---- messages ---------------------------------------------------------------------------------------------------

/** Where a thing is: id (index into the loose things, see things.ts), position, rotation as a quaternion. */
export type Place = [id: number, x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number];

export type ClientMessage =
  /** The first message. bot: it has no world to simulate (bot.ts), so it is never host. epoch and have: the
   *  server's world it already holds, and how many of its changes (to get only the rest). */
  | { t: "hello"; name: string; bot?: boolean; epoch?: string; have?: number }
  | { t: "name"; name: string }
  /** p feet, f facing (radians), m packed Motion, c the stick carried or -1, u a crate it pushes: id, direction, speed. */
  | { t: "state"; p: [number, number, number]; f: number; m: number[]; c: number; u?: [number, number, number, number] }
  | { t: "chat"; text: string }
  /** The tab is hidden or the game paused: its physics stands still, so it should not be host. */
  | { t: "away"; away: boolean }
  /** Host only: where loose things are. */
  | { t: "things"; l: Place[] }
  /** The stick the sender carried, let go here with this velocity. */
  | { t: "drop"; s: Place; v: [number, number, number] }
  /** Changes the sender made to the build feature's world, in order. */
  | { t: "build"; c: BuildChange[] }
  /** The sender's whole saved world, for a server whose world is still empty. */
  | { t: "bring"; c: BuildChange[] };

export interface PlayerInfo { id: number; name: string }

export type ServerMessage =
  /** epoch: names the server's world (new at each reset); build: its changes from number `from` on. version: the
   *  server's build (GIT_SHA), "" in development. */
  | { t: "welcome"; id: number; host: number; players: PlayerInfo[]; addresses: string[]; carried: [player: number, stick: number][];
      epoch: string; from: number; build: BuildChange[]; version: string }
  /** No room: the server closes the socket after this one; try again much later. */
  | { t: "full"; players: number; max: number }
  | { t: "join"; id: number; name: string }
  | { t: "leave"; id: number }
  | { t: "name"; id: number; name: string }
  | { t: "host"; id: number }
  | ({ id: number } & Extract<ClientMessage, { t: "state" }>)
  | { t: "chat"; id: number; text: string }
  | { t: "things"; l: Place[] }
  | ({ id: number } & Extract<ClientMessage, { t: "drop" }>)
  /** Someone else holds this stick: let it go. */
  | { t: "deny"; s: number }
  /** To the host: someone joined, send every thing. */
  | { t: "need" }
  /** Build changes the server took, numbered from n in its list; to everyone, the sender (id) too. */
  | { t: "build"; id: number; n: number; c: BuildChange[] }
  /** The server's whole world, to a player whose "bring" came too late or whose change it refused: take this one. */
  | { t: "world"; epoch: string; build: BuildChange[] }
  /** The server shortened its list (compact): the same world, from now on n changes long under this epoch. */
  | { t: "epoch"; epoch: string; n: number }
  /** The world was reset on the server: forget yours. */
  | { t: "reset" };

// ---- checks -----------------------------------------------------------------------------------------------------

const WORLD = 500, LOW = -100, HIGH = 200; // m: far beyond the walls round the world

const num = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo: number, hi: number): v is number => num(v, lo, hi) && Number.isInteger(v);
const list = (v: unknown, length: number): v is unknown[] => Array.isArray(v) && v.length === length;
const point = (v: unknown) => list(v, 3) && num(v[0], -WORLD, WORLD) && num(v[1], LOW, HIGH) && num(v[2], -WORLD, WORLD);
const place = (v: unknown): v is Place => list(v, 8) && int(v[0], 0, MAX_THINGS - 1) && point(v.slice(1, 4))
  && v.slice(4).every((q) => num(q, -1.01, 1.01));

/** Changes a message may hold: more than a whole world needs (a tree grown back and felled again about 34, the
 *  world's 13 trees about 520 with the STICKS of dam, lodge and cache and the find). */
export const MAX_CHANGES = 600;
const EPOCH = /^[a-z0-9]{1,16}$/;
const STICK = /^(w\d{1,2}|t\d{1,2}:\d|d\d{1,2}|x[0-9a-z]{1,12})$/; // the names src/features/build gives sticks
const turn = (v: unknown) => list(v, 4) && v.every((q) => num(q, -1.01, 1.01));

/** One build change, checked and copied field by field; undefined when it is not one. */
export function parseChange(v: unknown): BuildChange | undefined {
  if (!v || typeof v !== "object") return;
  const c = v as Record<string, unknown>, tree = c.tree;
  if (c.type === "find") return { type: "find" };
  if (c.type === "place") return int(c.slot, 0, STICKS - 1) && typeof c.stick === "string" && STICK.test(c.stick) ? { type: "place", slot: c.slot, stick: c.stick } : undefined;
  if (!int(tree, 0, MAX_TREES - 1)) return;
  switch (c.type) {
    case "bite": case "grow": return { type: c.type, tree };
    case "split": return num(c.at, 0, 1e14) ? { type: "split", tree, at: c.at } : { type: "split", tree };
    case "fell": return num(c.direction, -10, 10) ? { type: "fell", tree, direction: c.direction } : undefined;
    case "rest": {
      const at = c.at as number[], q = c.turn as number[];
      return point(at) && turn(q) ? { type: "rest", tree, at: [at[0]!, at[1]!, at[2]!], turn: [q[0]!, q[1]!, q[2]!, q[3]!] } : undefined;
    }
  }
}

/** Plain text for a name or a chat line: no control characters, no runs of spaces, at most `length` characters. */
export function clean(text: unknown, length: number): string {
  if (typeof text !== "string") return "";
  // At most 3 marks on a letter: enough for any script, too few for "zalgo" text that covers the lines around it.
  const plain = text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/(\p{M}{3})\p{M}+/gu, "$1").replace(/\s+/g, " ").trim();
  return [...plain].slice(0, length).join("").trim();
}

/** A message from a player, checked; undefined when it is not one we take. Names and chat come back cleaned. */
export function parseClient(text: unknown): ClientMessage | undefined {
  if (typeof text !== "string" || text.length > MAX_MESSAGE) return;
  let m: Record<string, unknown>;
  try { m = JSON.parse(text); } catch { return; }
  if (!m || typeof m !== "object" || Array.isArray(m)) return;
  switch (m.t) {
    case "hello": case "name": {
      const name = clean(m.name, NAME_LENGTH);
      if (!name) return;
      if (m.t === "name") return { t: "name", name };
      return {
        t: "hello", name, ...(m.bot === true ? { bot: true } : {}),
        ...(typeof m.epoch === "string" && EPOCH.test(m.epoch) && int(m.have, 0, 1e6) ? { epoch: m.epoch, have: m.have } : {}),
      };
    }
    case "away": return typeof m.away === "boolean" ? { t: "away", away: m.away } : undefined;
    case "chat": {
      const chat = clean(m.text, CHAT_LENGTH);
      return chat ? { t: "chat", text: chat } : undefined;
    }
    case "state": {
      const { p, f, c, u } = m, motion = m.m;
      if (!point(p) || !num(f, -1e4, 1e4) || !int(c, -1, MAX_THINGS - 1)) return;
      if (!list(motion, MOTION.length) || !MOTION.every(([, lo, hi], i) => num(motion[i], lo, hi))) return;
      if (!int(motion[9], 0, ACTIONS.length - 1) || !int(motion[LOW_AT], 0, LOWS.length - 1)) return;
      if (u !== undefined && !(list(u, 4) && int(u[0], 0, MAX_THINGS - 1) && num(u[1], -1, 1) && num(u[2], -1, 1) && num(u[3], 0, 5))) return;
      return { t: "state", p: p as [number, number, number], f, m: motion as number[], c, ...(u ? { u: u as [number, number, number, number] } : {}) };
    }
    case "things": {
      const l = m.l;
      if (!Array.isArray(l) || l.length > MAX_THINGS || !l.every(place)) return;
      return { t: "things", l };
    }
    case "drop": {
      const v = m.v;
      if (!place(m.s) || !(list(v, 3) && v.every((x) => num(x, -30, 30)))) return;
      return { t: "drop", s: m.s, v: v as [number, number, number] };
    }
    case "build": case "bring": {
      // Each change checked alone: the good ones of a list pass, the rest are left out.
      if (!Array.isArray(m.c) || m.c.length > MAX_CHANGES) return;
      const c = m.c.map(parseChange).filter((x) => x !== undefined);
      return c.length ? { t: m.t, c } : undefined;
    }
  }
}

// ---- the build feature's world, kept by the server -------------------------------------------------------------------

/** Bites the thickest trunk takes, and the most a standing tree may get: more would only make the list grow. */
export const MAX_BITES = bitesToFell(Infinity);

/** The server's check of a change against its world: it must fit the world as it is (rules.ts apply: in order, not
 *  twice, a stick not used twice), no tree takes more bites than any tree needs, and a tree grows back only REGROW
 *  s after its wood went by `now`, the server's clock (rules.ts, the rule). Applies it when it passes; a split it
 *  takes is stamped with now (change.at, whatever the sender wrote), so the log and its file keep when. The log
 *  stays bounded as trees grow back because the server compacts it. */
export function admit(world: BuildState, change: BuildChange, now = Date.now()): boolean {
  const t = "tree" in change ? world.trees[change.tree] : undefined;
  if (change.type === "bite") {
    const a = live(t);
    if (a && (a.fell === undefined ? a.bites >= MAX_BITES : a.splitBites >= BITES_TO_SPLIT)) return false;
  }
  if (change.type === "grow" && !(t?.split && now >= (t.gone ?? Infinity) + REGROW * 1000)) return false;
  if (!apply(world, change, now)) return false;
  if (change.type === "split") change.at = now;
  return true;
}

/** A state as the changes that make it from nothing: replay(changesOf(s)) is s again (but for when wood went, which
 *  each copy counts on its own clock). */
export function changesOf(s: BuildState): BuildChange[] {
  const out: BuildChange[] = s.found ? [{ type: "find" }] : [];
  const felling = (tree: number, t: TreeState) => {
    for (let k = 0; k < Math.min(t.bites, MAX_BITES); k++) out.push({ type: "bite", tree }); // a broken save does not loop
    if (t.fell === undefined) return;
    out.push({ type: "fell", tree, direction: t.fell });
    if (!t.rest) return;
    out.push({ type: "rest", tree, at: t.rest.at, turn: t.rest.turn });
    for (let k = 0; k < Math.min(t.splitBites, BITES_TO_SPLIT); k++) out.push({ type: "bite", tree });
  };
  for (const [key, t] of Object.entries(s.trees)) {
    felling(+key, t);
    if (!t.split || !t.rest) continue;
    out.push({ type: "split", tree: +key });
    if (t.grown) { out.push({ type: "grow", tree: +key }); felling(+key, t.grown); }
  }
  s.dam.forEach((stick, slot) => out.push({ type: "place", slot, stick }));
  return out;
}

export function replay(changes: BuildChange[], now = Date.now()): BuildState {
  const s = newState();
  for (const c of changes) apply(s, c, now);
  return s;
}

/** The world's work as server.ts keeps it in its file ({ epoch, build }), read back through the same checks as live
 *  changes: undefined when it is not that. Changes that do not fit (a broken file, or rules.ts changed since) are
 *  left out; whole false then, and the server takes a new epoch, since the players' copies of the old one differ. */
export function restore(text: string): { epoch: string; world: BuildState; log: BuildChange[]; whole: boolean } | undefined {
  let saved: { epoch?: unknown; build?: unknown };
  try { saved = JSON.parse(text); } catch { return; }
  if (!saved || typeof saved.epoch !== "string" || !EPOCH.test(saved.epoch) || !Array.isArray(saved.build)) return;
  // A split keeps the time it was taken (none in a file from before trees grew back: from now), a grow is checked now.
  const world = newState(), at = (c: BuildChange) => Math.min(Date.now(), c.type === "split" ? c.at ?? Infinity : Infinity);
  const log = saved.build.map(parseChange).filter((c): c is BuildChange => !!c && admit(world, c, at(c)));
  return { epoch: saved.epoch, world, log, whole: log.length === saved.build.length };
}

export const newEpoch = () => Math.random().toString(36).slice(2, 10);

/** The server's world: its epoch, its state and the changes that made it, in order (what a joiner replays). */
export interface Work { epoch: string; world: BuildState; log: BuildChange[] }

/** Shortens the log to the present world (changesOf, each split with the time the server took it) when it holds
 *  more: a tree grown back and broken into wood again leaves the changes of its earlier life behind. Under a new
 *  epoch, since the changes are numbered anew. True when it did. */
export function compact(work: Work): boolean {
  const present = changesOf(work.world).map((c) => c.type === "split" ? { ...c, at: work.world.trees[c.tree]!.gone } : c);
  if (present.length >= work.log.length) return false;
  work.log = present;
  work.epoch = newEpoch();
  return true;
}

/** Whether two states hold the same world (trees touched without effect do not count). */
export const sameWorld = (a: BuildState, b: BuildState) => JSON.stringify(changesOf(a)) === JSON.stringify(changesOf(b));

// ---- who is host -------------------------------------------------------------------------------------------------

/** The host for loose things: of the players whose game runs (not away), the one who joined first (lowest join
 *  number); when all are away, the first of those. Bots never. Undefined when nobody can be. */
export function hostOf(players: Iterable<{ id: number; joined: number; bot?: boolean; away?: boolean }>): number | undefined {
  let best: { id: number; joined: number; away?: boolean } | undefined;
  for (const p of players) {
    if (p.bot) continue;
    if (!best || (best.away && !p.away) || (!!best.away === !!p.away && p.joined < best.joined)) best = p;
  }
  return best?.id;
}

// ---- who is asking -------------------------------------------------------------------------------------------------

/** The header a proxy in front puts the client's address in (TRUST_PROXY); anyone else could write it. */
export const PROXY_HEADERS: Record<string, string> = { cloudflare: "cf-connecting-ip", fly: "fly-client-ip" };

/** What the per-address limit counts a socket under: the proxy's header when the server sits behind that proxy
 *  (`header`), else the socket's own address. An IPv6 address counts by its /64, which one home or phone gets whole.
 *  Undefined: not limited, this machine itself (bots and test browsers on the host, as on a LAN). */
export function clientAddress(headers: Headers, socket: string | undefined, header?: string): string | undefined {
  const forwarded = header ? headers.get(header)?.trim().slice(0, 64) : undefined, ip = (forwarded || socket || "").replace(/%.*$/, "");
  if (!forwarded && /^(127\.|::1$|::ffff:127\.)/.test(ip)) return;
  if (!ip.includes(":") || ip.includes(".")) return ip.replace(/^::ffff:/, ""); // IPv4, maybe written as IPv6
  const [head = "", tail = ""] = ip.split("::"), h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(":")}::/64`;
}

/** Whether a socket may open from this page (its Origin header): only from the server's own pages, by the Host they
 *  were asked under or the public address (PUBLIC_URL, for a proxy that changes the Host), so another website cannot
 *  drive a visitor's socket. No Origin: not a browser (bots, tools), which no website can drive. */
export function sameOrigin(origin: string | null, host: string | null, publicUrl?: string): boolean {
  if (origin === null) return true;
  try {
    const page = new URL(origin);
    return page.host === host || (!!publicUrl && page.origin === new URL(publicUrl).origin);
  } catch { return false; }
}

/** The name, or with a number appended (" 2", " 3", …, still within NAME_LENGTH) when someone else already holds it. */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const held = new Set([...taken].map((n) => n.toLowerCase()));
  let out = name;
  for (let k = 2; held.has(out.toLowerCase()); k++) out = `${[...name].slice(0, NAME_LENGTH - 1 - String(k).length).join("").trim()} ${k}`;
  return out;
}

/** Whether a page should reload for the server's build: only when both are known and differ, and not again for a
 *  build it already reloaded for (a cached page, or a server that keeps changing, never loops). */
export const shouldReload = (mine: string, server: string, reloadedFor: string | null) => !!mine && !!server && mine !== server && reloadedFor !== server;

// ---- rate ----------------------------------------------------------------------------------------------------------

/** A token bucket: `rate` messages a second, up to `burst` at once. take() says whether this one may pass. */
export function bucket(rate: number, burst: number, now = () => performance.now()) {
  let tokens = burst, last = now();
  return {
    take() {
      const t = now();
      tokens = Math.min(burst, tokens + (t - last) / 1000 * rate);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
