// Playing together on the local network: everyone who opens the game served by server.ts is in the same world,
// sees the others' beavers with their names, the sticks they carry and the crates they push, and can chat (Enter).
// The world's work is shared too: trees gnawed and felled, the wood they give, the dam.
//
//   createGame(canvas, [..., net])     nothing else to call; window.net holds the state for tools and tests
//
// Opened without server.ts (plain `bun ./index.html`) it finds no /net/info and only keeps the place over a reload.
// It needs a name (settings.name): the HUD's start screen asks for it; without the HUD its own dialog
// (name.ts) does. Then it connects to /net and, about 20 times a second, sends where the beaver is, which way it faces
// and its Motion; the others rebuild it from that (remote.ts), as a solid beaver. The loose things are simulated by
// one player, the host (the one in longest), and followed by the rest (things.ts). When the connection drops it says
// so quietly, plays on alone, and tries again; a full server says so and is tried only every 30 s. When the server
// runs another build than the one that served this page (deployed since), the page reloads once on reconnecting.
//
// The world's work (src/features/build) is a list of changes the server keeps in order, and the server's world is
// the only one: this page keeps none. Before any feature is made, this module asks the server for its world and hands
// it to the build feature to start in (build `start`). After that, every change made here (buildChange, remote false)
// goes to the server, which checks it and passes it on to all; those from others come back as buildChange with remote
// true. When the server's world is another than the one here (it started again, or refused a change), the page loads
// again and starts in the server's. Without a server the game is played alone in a fresh world that ends with the page.
//
// With ?tour the page plays in the tour's own world (protocol.ts TOUR_WORLD), which the server keeps beside the
// players': there the tour may start the world afresh (window.net.reset()).
//
// The day is the server's too: on every welcome the sky follows the hour it sends (game.sky.follow), and when the
// connection drops it goes on alone. A page opened with ?hour, ?clock or ?speed keeps its own day, for pictures; so does the
// tour, whose sky stations set the hour.
//
// The place (feet, facing, camera) is kept in sessionStorage, so a reload (the dev server's live reload, or the
// player's) comes back where it was.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { STEP } from "../../engine.ts";
import type { CreateFeature } from "../../game.ts";
import { HEIGHT, RADIUS } from "../../player/index.ts";
import { buildOf, start } from "../build/index.ts";
import type { BuildChange } from "../build/rules.ts";
import { askName } from "./name.ts";
import {
  INFO_PATH, packMotion, PATH, replay, sameWorld, SEND_RATE, shouldReload, stickId, TOUR_WORLD, type ClientMessage, type Place, type ServerMessage,
} from "./protocol.ts";
import { remoteLanterns } from "../lantern/remote.ts";
import { VOICE_RATE } from "../old-beaver/rules.ts";
import { createRemote, type Remote } from "./remote.ts";
import { createThings } from "./things.ts";
import { createUi } from "./ui.ts";
import { enable, GROUND, isEnabled, SOLID } from "../../physics.ts";

const RETRY = [1000, 2000, 4000, 8000], FULL_RETRY = 30_000; // ms between tries to connect again
const FULL_EVERY = 2; // s: the host sends every thing this often, moving or not
const PUSH_FOR = 0.2; // s a guest's push counts after its last state
const PLACES = 120; // things per message
const HEAD = 0.9; // m over the feet: where a name tag is looked for behind walls
// The world this page plays in: the tour's own with ?tour (it never touches a game someone plays), else the players'.
const WORLD = new URLSearchParams(location.search).has("tour") ? `world=${TOUR_WORLD}` : "";
// A page that keeps its own day: one opened for a picture, and the tour, whose sky stations set the hour.
const OWN_DAY = ["hour", "clock", "speed", "tour"].some((key) => new URLSearchParams(location.search).has(key));
const PLACE_KEY = "beaver.place", VERSION_KEY = "beaver.reloadedFor";

const read = (key: string) => { try { return sessionStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { sessionStorage.setItem(key, value); } catch { /* not kept */ } };

async function serverInfo(): Promise<{ addresses: string[]; epoch: string; build: BuildChange[]; now?: number; version?: string } | undefined> {
  try {
    const response = await fetch(`${INFO_PATH}?build&${WORLD}`, { signal: AbortSignal.timeout(2000), cache: "no-store" });
    if (!response.ok || !response.headers.get("content-type")?.includes("json")) return;
    const info = await response.json();
    return Array.isArray(info?.addresses) && Array.isArray(info.build) && typeof info.epoch === "string" ? info : undefined;
  } catch { return; }
}

// ---- before any feature is made: the server's world is the one the build feature starts in --------------------------
const info = await serverInfo();
/** The server's world this page holds: its epoch, and how many of its changes. */
const shared = { epoch: info?.epoch ?? "", have: info?.build.length ?? 0 };
if (info) {
  // When wood went is the server's time: counted on from here by this page's clock, which may be set otherwise.
  const ahead = Date.now() - (info.now ?? Date.now());
  start.changes = info.build.map((c) => c.type === "split" && c.at !== undefined ? { ...c, at: c.at + ahead } : c);
}

export const create: CreateFeature = (game) => {
  const { stage, player, settings, world, events } = game;

  // ---- the place, kept over a reload ----
  const kept = JSON.parse(read(PLACE_KEY) ?? "null") as number[] | null;
  if (Array.isArray(kept) && kept.length === 6 && kept.every(Number.isFinite)) {
    const [x, y, z, facing, yaw, pitch] = kept as [number, number, number, number, number, number];
    player.teleport(x, Math.max(y, world.heightAt(x, z) - 0.5), z, facing);
    player.camera.yaw = yaw;
    player.camera.pitch = pitch;
  }
  const keepPlace = () => {
    const f = player.feet, r = (v: number) => Math.round(v * 1000) / 1000;
    write(PLACE_KEY, JSON.stringify([f.x, f.y, f.z, player.facing, player.camera.yaw, player.camera.pitch].map(r)));
  };
  setInterval(keepPlace, 1000);
  addEventListener("pagehide", keepPlace);
  const reload = () => { keepPlace(); location.reload(); };

  if (!info) return {};
  const built = buildOf(stage.scene)?.state, building = !!built; // the build feature runs (it is made before this one)
  const things = createThings(game, built);
  const remotes = new Map<number, Remote & { holding: number; push?: { u: [number, number, number, number]; at: number } }>();
  let socket: WebSocket | undefined, me = -1, host = -1, tries = 0, connected = false, askingName = false, named = "";
  let carried = -1, pushing: [number, number, number, number] | undefined, sendAll = true, sinceFull = 0, time = 0;
  let address = info.addresses[0] ?? location.href, full = ""; // full: what the server said when it had no room
  const pending: BuildChange[] = []; // made here and not yet sent: at once, or while not connected on the next welcome

  const send = (m: ClientMessage) => { if (connected && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m)); };
  /** Changes made in one go (a tree's last bite, its fall and its rest) leave as one message. */
  const flush = () => { if (connected && socket?.readyState === WebSocket.OPEN && pending.length) send({ t: "build", c: pending.splice(0) }); };
  const nameOf = (id: number) => remotes.get(id)?.name ?? "Someone";

  const ui = createUi(stage, {
    send(text) { send({ t: "chat", text }); ui.say("me", settings.values.name, text); },
    rename: () => void rename(),
    canChat: () => connected,
  });
  ui.tag("me", "", player.node);
  ui.address(`Others join at ${address}`);
  // The name comes from the HUD's start screen or from the dialog; whoever sets it, the server hears it.
  settings.on((values) => {
    ui.me(values.name);
    if (!values.name || values.name === named) return;
    if (connected) { send({ t: "name", name: values.name }); named = values.name; } else connect();
  });

  async function rename() {
    if (askingName) return;
    askingName = true;
    const name = await askName(stage, settings.values.name, address);
    askingName = false;
    if (name !== settings.values.name) settings.set({ name });
  }

  // ---- other players ----
  const lanterns = remoteLanterns(game);
  const addRemote = (id: number, name: string) => {
    if (remotes.has(id) || id === me) return;
    const remote = Object.assign(createRemote(stage, id, name, lanterns), { holding: -1 });
    remotes.set(id, remote);
    ui.tag(id, name, remote.node);
  };
  const removeRemote = (id: number) => {
    const remote = remotes.get(id);
    if (!remote) return;
    if (remote.holding >= 0) { const place = things.placeInHand(remote.holding); if (place) things.release(place); }
    remote.dispose();
    remotes.delete(id);
    ui.untag(id);
  };
  const role = () => things.setMode(!connected ? "alone" : host === me ? "host" : "guest");

  // ---- the world's work ----
  /** After a stick may have left the world (into the dam): forget it, out of every hand that held it. */
  const sync = () => {
    const gone = things.sync();
    if (gone.length) for (const r of remotes.values()) if (gone.includes(r.holding)) r.holding = -1;
    // shortcut: a stick the local player holds can only go into the dam from here (the server gives each stick to
    // one hand), but should another player's change take it anyway, it leaves this hand too.
    if (player.carrying && !world.sticks.includes(player.carrying)) player.handOver();
  };
  /** A change from another player: a stick going into the dam leaves that player's hand first, into the dam. */
  const fromOthers = (c: BuildChange) => {
    if (c.type === "place" || c.type === "trade") { const id = stickId(c.stick); if (id !== undefined) things.letGo(id); }
    events.emit("buildChange", { change: c, remote: true });
    sync();
  };
  if (building) {
    events.on("buildChange", ({ change, remote }) => {
      if (!remote && pending.push(change) === 1) queueMicrotask(flush);
    });
    events.on("treeSplits", ({ tree }) => things.split(tree, built));
  }
  /** Takes the server's world: nothing to do when it is the one here, otherwise the page starts again in it. */
  const adopt = (build: BuildChange[]) => {
    if (!built || sameWorld(built, replay(build))) { shared.have = build.length; return; }
    reload(); // the module above asks the server again and hands the build feature its world
  };
  /** On welcome: catch up with the server's world, or take it whole when it is another than the one here. */
  const join = (m: Extract<ServerMessage, { t: "welcome" }>) => {
    const same = m.epoch === shared.epoch && m.from === shared.have;
    shared.epoch = m.epoch;
    if (same) {
      for (const c of m.build) if (building) fromOthers(c);
      shared.have = m.from + m.build.length;
      flush();
      return;
    }
    pending.length = 0; // made in a world the server does not hold
    adopt(m.build);
  };

  // The Old Beaver tells once for the whole world: the room hears how near this player is to him.
  events.on("oldBeaverNear", ({ near }) => send({ t: "near", near }));

  const history: string[] = []; // joins, leaves and host changes, for tests (window.net.history)
  function receive(m: ServerMessage) {
    if (m.t === "welcome" || m.t === "join" || m.t === "leave" || m.t === "host") history.push(`${Math.round(performance.now())} ${m.t} ${m.id}${m.t === "welcome" ? ` host ${m.host}` : ""}`);
    switch (m.t) {
      case "welcome":
        // The server was deployed again since this page loaded (its build differs): load the new page, once.
        if (shouldReload(info?.version ?? "", m.version ?? "", read(VERSION_KEY))) { write(VERSION_KEY, m.version); reload(); return; }
        me = m.id; host = m.host; connected = true; tries = 0; sendAll = true; away = false;
        if (!OWN_DAY && Number.isFinite(m.hour)) game.sky?.follow(m.hour);
        for (const p of m.players) addRemote(p.id, p.name);
        for (const [id, stick] of m.carried) { const r = remotes.get(id); if (r) r.carry = stick; }
        address = m.addresses[0] ?? address;
        ui.address(`Others join at ${address}`);
        ui.status();
        role();
        join(m);
        if (named !== settings.values.name) { send({ t: "name", name: settings.values.name }); named = settings.values.name; }
        return;
      case "join": addRemote(m.id, m.name); ui.line(`${m.name} joined`); return;
      case "leave": { const name = nameOf(m.id); removeRemote(m.id); ui.line(`${name} left`); return; }
      case "name": {
        if (m.id === me) { ui.me(m.name); return; } // someone else had the name: the server added a number
        const r = remotes.get(m.id);
        if (r && r.name !== m.name) { ui.line(`${r.name} is now ${m.name}`); r.name = m.name; ui.rename(m.id, m.name); }
        return;
      }
      case "host": host = m.id; sendAll = true; role(); return;
      case "state": {
        const r = remotes.get(m.id);
        if (!r) return;
        r.receive(m.p, m.f, m.m);
        r.carry = m.c;
        if (m.u) r.push = { u: m.u, at: time };
        return;
      }
      case "chat": ui.say(m.id, nameOf(m.id), m.text); return;
      case "things": things.receive(m.l); return;
      case "drop": {
        const r = remotes.get(m.id);
        if (r) { r.holding = r.carry = -1; }
        things.release(m.s, m.v);
        return;
      }
      case "deny": if (things.idOf(player.carrying) === m.s) player.drop(); return;
      case "need": sendAll = true; return;
      case "build":
        if (m.id !== me && building) for (const c of m.c) fromOthers(c);
        shared.have = m.n + m.c.length;
        return;
      case "world": shared.epoch = m.epoch; adopt(m.build); return;
      case "epoch": shared.epoch = m.epoch; shared.have = m.n; return; // the same world, its changes numbered anew
      case "lore": events.emit("oldBeaverTold", { told: m }); return;
      case "full": full = `Server full (${m.players}/${m.max}), playing alone`; return;
      case "reset": if (building) reload(); return;
    }
  }

  function connect() {
    if (!settings.values.name || socket) return;
    const ws = socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${PATH}?${WORLD}`);
    ws.binaryType = "arraybuffer"; // the one binary message: a piece of the Old Beaver's voice
    ws.onopen = () => {
      named = settings.values.name;
      ws.send(JSON.stringify({ t: "hello", name: named, ...(shared.epoch ? { epoch: shared.epoch, have: shared.have } : {}) } satisfies ClientMessage));
    };
    ws.onmessage = (e) => {
      try {
        if (typeof e.data === "string") receive(JSON.parse(e.data));
        else events.emit("oldBeaverVoice", { pcm: e.data, rate: VOICE_RATE });
      } catch (error) { console.warn("net:", error); }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = undefined;
      const was = connected;
      connected = false;
      events.emit("oldBeaverTold", {}); // the room's Old Beaver is gone with it: he tells this player alone
      if (!OWN_DAY) game.sky?.alone();
      for (const id of [...remotes.keys()]) removeRemote(id);
      role();
      me = host = -1;
      ui.status(full || (was ? "Connection lost. Playing alone, trying again…" : "Can't reach the server. Trying again…"));
      setTimeout(connect, full ? FULL_RETRY : RETRY[Math.min(tries++, RETRY.length - 1)]);
      full = "";
    };
  }

  // The state goes out on a timer, not per frame, so it keeps going while the game is paused or the tab is hidden.
  let away = false;
  setInterval(() => {
    if (!connected) return;
    if (away !== (document.hidden || stage.paused)) send({ t: "away", away: away = !away });
    const at = player.node.position, r = (v: number) => Math.round(v * 1000) / 1000;
    send({ t: "state", p: [r(at.x), r(at.y), r(at.z)], f: r(player.node.rotation.y), m: packMotion(player.motion), c: carried, ...(pushing ? { u: pushing } : {}) });
    pushing = undefined;
    if (things.mode === "host") {
      const all = sendAll || sinceFull > FULL_EVERY;
      const l: Place[] = things.places(all);
      if (all) { sendAll = false; sinceFull = 0; }
      for (let i = 0; i < l.length; i += PLACES) send({ t: "things", l: l.slice(i, i + PLACES) });
    }
  }, 1000 / SEND_RATE);

  let started = false;
  const collision = new Vector3(), eye = new Vector3();
  Object.assign(window, { net: {
    things, remotes, history, shared, get me() { return me; }, get host() { return host; }, get connected() { return connected; }, ui,
    /** The tour's world only: starts it afresh for everyone in it (the server tells every page to load again). False: not connected. */
    reset() { send({ t: "reset" }); return connected; },
  } });

  return {
    step(dt) {
      time += dt;
      sinceFull += dt;
      sync();
      // What the local beaver carries: a drop goes out at once, with where the stick was let go.
      const now = things.idOf(player.carrying);
      if (now !== carried) {
        // Only a stick really put down (body back in the world); one built into the dam left the world (sync forgot
        // it), and the others see it go from the hand into the dam with the build change.
        const thing = things.get(carried);
        if (carried >= 0 && now < 0 && connected && thing && isEnabled(thing.body)) {
          const node = thing.body.transformNode, at = node.position, q = node.rotationQuaternion!, v = player.velocity;
          const place: Place = [carried, at.x, at.y, at.z, q.x, q.y, q.z, q.w];
          send({ t: "drop", s: place, v: [v.x, 0, v.z] });
          if (things.mode === "guest") things.release(place);
        }
        carried = now;
      }
      // A guest walking into a crate or a log: it is only a copy here, so the push goes to the host.
      if (things.mode === "guest") {
        for (const hit of player.collisions) {
          const id = things.idOfBody(hit.body);
          if (id < 0) continue;
          const speed = collision.set(hit.wish.x, 0, hit.wish.z).length() / STEP, n = Math.hypot(hit.normal.x, hit.normal.z);
          if (speed > 0.05 && n > 0.3) pushing = [id, -hit.normal.x / n, -hit.normal.z / n, Math.min(5, speed)];
        }
      }
      // The host pushes crates for the guests.
      if (things.mode === "host") for (const r of remotes.values()) {
        if (r.push && time - r.push.at < PUSH_FOR) things.push(r.push.u[0], r.push.u[1], r.push.u[2], r.push.u[3], r.feet);
      }
    },
    update(dt) {
      if (!started) {
        started = true; // after every feature is made: the HUD's start screen asks for the name when it is there
        if (!settings.values.name && !document.getElementById("beaver-hud")) void rename();
      }
      const moving = stage.paused ? 0 : dt;
      eye.copyFrom(stage.camera.position);
      for (const r of remotes.values()) {
        r.update(moving);
        // The stick in its hand, as its last state says.
        if (r.carry !== r.holding && r.beaver) {
          if (r.holding >= 0) { const place = things.placeInHand(r.holding); if (place) things.release(place); }
          r.holding = -1;
          if (r.carry >= 0 && !things.isHeld(r.carry) && things.get(r.carry) !== player.carrying && things.has(r.carry)) {
            things.hold(r.carry, { hand: r.beaver.hand, node: r.node });
            r.holding = r.carry;
          }
        }
        // Solid, except while it overlaps the local beaver (both just came in at the spawn, or it jumped into it):
        // then it lets it walk out instead of shoving it.
        const feet = player.feet, at = r.feet;
        const solid = !(Math.hypot(at.x - feet.x, at.z - feet.z) < 2 * RADIUS && Math.abs(at.y - feet.y) < HEIGHT);
        if (r.body && isEnabled(r.body) !== solid) enable(r.body, solid);
        // Its name fades while something solid (ground, trunk, rock) stands between it and the camera.
        const to = r.node.position, dx = to.x - eye.x, dy = to.y + HEAD - eye.y, dz = to.z - eye.z, length = Math.hypot(dx, dy, dz);
        ui.behind(r.id, length > 0.5 && !!stage.physics.ray(eye, { x: dx / length, y: dy / length, z: dz / length }, length - 0.3, GROUND | SOLID));
        ui.doing(r.id, r.doing);
      }
      things.update();
      ui.update();
    },
  };
};
