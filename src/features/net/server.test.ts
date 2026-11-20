// Tests for the rules the room keeps toward strangers, against both servers that run it, each on a free port: the Bun
// server (server.ts) and the Worker (worker.ts) in wrangler's local runtime, which needs no account and no network.
// Sockets per client address, the hello timeout, a full server, the same hour, the world kept over a restart, the
// build id, the origin of a socket, the tour's world beside the players'. Only server.ts has a file to break or to
// age; only the Worker has /net/reset.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { apply, REGROW, type BuildChange } from "../build/rules.ts";
import { DAY_SECONDS, EVENTS_PATH, HELLO_TIME, MAX_PLAYERS, PER_ADDRESS, replay, RESET_PATH, sameWorld, START, type Place, type ServerMessage } from "./protocol.ts";
import { SAVE_AFTER } from "./room.ts";

const root = join(import.meta.dir, "../../..");
let running: Bun.Subprocess | undefined;

/** Starts server.ts with these environment variables; resolves with its port once it listens. */
async function startBun(env: Record<string, string>) {
  const server = running = Bun.spawn(["bun", "server.ts"], {
    cwd: root, env: { ...process.env, NODE_ENV: "production", PORT: "0", ...env }, stdin: "ignore", stdout: "pipe", stderr: "inherit",
  });
  let out = "", port: string | undefined;
  const reader = server.stdout.getReader(), decoder = new TextDecoder();
  const read = async () => { for (let r = await reader.read(); !r.done; r = await reader.read()) out += decoder.decode(r.value); };
  const drained = read(); // goes on reading after the port, so its pipe never fills
  while (!(port = /port (\d+)/.exec(out)?.[1])) {
    if (await Promise.race([drained.then(() => true), Bun.sleep(20).then(() => false)])) throw new Error(`server.ts did not start: ${out}`);
  }
  return { port: +port, out: () => out };
}
/** Starts worker.ts with `wrangler dev`; resolves with its port once it answers. Of the variables it takes GIT_SHA
 *  and RESET_TOKEN; its storage is a folder beside WORLD_FILE, so the same variable keeps a world over a restart. */
async function startWorker(env: Record<string, string>) {
  mkdirSync(join(root, "dist"), { recursive: true }); // wrangler wants the folder of the game's files; these tests ask for none
  const free = Bun.serve({ port: 0, fetch: () => new Response() }), port = free.port!;
  await free.stop(true);
  const vars = ["GIT_SHA", "RESET_TOKEN", "HOUSE_OF_AI_FEED"].flatMap((key) => env[key] ? ["--var", `${key}:${env[key]}`] : []);
  const kept = env.WORLD_FILE ? dirname(env.WORLD_FILE) : mkdtempSync(join(tmpdir(), "beaver-"));
  const server = running = Bun.spawn(["bun", "x", "wrangler", "dev", "--port", String(port), "--inspector-port", "0", "--persist-to", kept, ...vars], {
    cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdin: "ignore", stdout: "ignore", stderr: "inherit",
  });
  for (let i = 0; i < 300; i++, await Bun.sleep(100)) {
    if (server.exitCode !== null) break;
    if (await fetch(`http://localhost:${port}/net/info`).then((r) => r.ok, () => false)) return { port, out: () => "" };
  }
  throw new Error("worker.ts did not start (wrangler dev)");
}
async function stop() {
  running?.kill("SIGTERM");
  await running?.exited;
  running = undefined;
}
afterEach(stop);

/** A raw client: from `ip` (as Fly would say, for TRUST_PROXY=fly, and as Cloudflare says to the Worker), its
 *  messages, and how it ended. world: "?world=tour" for the tour's. */
function client(port: number, ip?: string, world = "") {
  const options = ip ? { headers: { "Fly-Client-IP": ip, "CF-Connecting-IP": ip } } : undefined; // Bun's WebSocket takes headers; the DOM type does not say so
  const ws = new WebSocket(`ws://localhost:${port}/net${world}`, options as unknown as string[]);
  const messages: ServerMessage[] = [];
  const opened = new Promise<boolean>((resolve) => { ws.onopen = () => resolve(true); ws.onerror = () => resolve(false); });
  const closed = new Promise<number>((resolve) => { ws.onclose = (e) => resolve(e.code); });
  ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
  const next = async (t: string) => { for (let i = 0; i < 100; i++) { const m = messages.find((x) => x.t === t); if (m) return m; await Bun.sleep(20); } };
  const hello = () => ws.send(JSON.stringify({ t: "hello", name: "Tester" }));
  return { ws, messages, opened, closed, next, hello };
}
/** What /net/info answers, without its clock (`now`), so two answers of an unchanged world are equal. */
const info = async (port: number, query = "?build") => {
  const { now, ...rest } = await (await fetch(`http://localhost:${port}/net/info${query}`)).json();
  return rest;
};

/** A stand-in for Luma's iCal feed on a free port: one House of AI event two days from now, or (down) an error.
 *  Counts how often it is asked. */
function feedFixture(down = false) {
  const at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString().replace(/[-:]|\.\d+/g, "");
  const text = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", `DTSTART:${at(48)}`, `DTEND:${at(50)}`, "SUMMARY:Community Lunch",
    "END:VEVENT", "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261121", "SUMMARY:All day", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const fixture = { asked: 0, url: "", stop: () => server.stop(true) };
  const server = Bun.serve({ port: 0, fetch: () => { fixture.asked++; return down ? new Response("oops", { status: 503 }) : new Response(text, { headers: { "Content-Type": "text/calendar" } }); } });
  fixture.url = `http://localhost:${server.port}/ics`;
  return fixture;
}

for (const kind of ["server.ts", "worker.ts"] as const) describe(kind, () => {
  const bun = kind === "server.ts", start = (env: Record<string, string> = {}) => bun ? startBun(env) : startWorker(env);

  test("answers the House of AI events from the calendar's feed as JSON, asking the feed once for many players", async () => {
    const feed = feedFixture();
    try {
      const { port } = await start({ HOUSE_OF_AI_FEED: feed.url });
      const ask = () => fetch(`http://localhost:${port}${EVENTS_PATH}`);
      const res = await ask();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toStartWith("application/json");
      const events = await res.json() as { name: string; start: string; end: string }[];
      expect(events.map((e) => e.name)).toEqual(["Community Lunch"]);
      expect(Date.parse(events[0]!.end) - Date.parse(events[0]!.start)).toBe(2 * 3600_000);
      await Promise.all([ask(), ask(), ask()]);
      expect(feed.asked).toBe(1);
    } finally { feed.stop(); }
  }, 60000);

  test("answers no House of AI events, not an error, when the feed is down", async () => {
    const feed = feedFixture(true);
    try {
      const { port } = await start({ HOUSE_OF_AI_FEED: feed.url });
      const res = await fetch(`http://localhost:${port}${EVENTS_PATH}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    } finally { feed.stop(); }
  }, 60000);

  test("lets one address hold only so many sockets, and closes those that never say hello", async () => {
    const { port } = await start({ TRUST_PROXY: "fly" });
    const mine = Array.from({ length: PER_ADDRESS }, () => client(port, "203.0.113.9"));
    expect(await Promise.all(mine.map((c) => c.opened))).toEqual(Array(PER_ADDRESS).fill(true));
    expect(await client(port, "203.0.113.9").opened).toBe(false); // one more from there
    const other = client(port, "198.51.100.1");
    expect(await other.opened).toBe(true);
    mine[0]!.hello();
    expect(await mine[0]!.next("welcome")).toBeDefined();
    // The others never said hello: closed in time, and their address may come in again.
    expect(await mine[1]!.closed).toBe(1008);
    expect(mine[0]!.ws.readyState).toBe(WebSocket.OPEN);
    expect(await client(port, "203.0.113.9").opened).toBe(true);
  }, HELLO_TIME + 30000);

  test("tells a player when it is full, and closes", async () => {
    const { port } = await start({ TRUST_PROXY: "fly" });
    const players = Array.from({ length: MAX_PLAYERS }, (_, i) => client(port, `10.1.0.${i}`));
    for (const p of players) { await p.opened; p.hello(); expect(await p.next("welcome")).toBeDefined(); }
    const late = client(port, "10.2.0.1");
    await late.opened;
    late.hello();
    expect(await late.next("full")).toEqual({ t: "full", players: MAX_PLAYERS, max: MAX_PLAYERS });
    expect(await late.closed).toBe(1013);
    expect((await info(port)).players).toBe(MAX_PLAYERS);
  }, 30000);

  test("gives everyone who joins the same hour of one day, which starts at 16:00 with the server", async () => {
    const { port } = await start();
    const hourOf = async () => {
      const p = client(port);
      await p.opened;
      p.hello();
      const welcome = await p.next("welcome") as Extract<ServerMessage, { t: "welcome" }>;
      return { hour: welcome.hour, at: performance.now() };
    };
    const first = await hourOf();
    expect(first.hour).toBeGreaterThanOrEqual(START);
    expect(first.hour).toBeLessThan(START + 0.2); // a few seconds of starting up at most
    await Bun.sleep(1500);
    const second = await hourOf();
    expect(second.hour).toBeGreaterThanOrEqual(0);
    expect(second.hour).toBeLessThan(24);
    const counted = first.hour + ((second.at - first.at) / 1000) * 24 / DAY_SECONDS;
    expect(Math.abs(second.hour - counted)).toBeLessThan(0.05); // within 1.5 s of play: what the two messages took
    expect(second.hour - first.hour).toBeGreaterThan(0.04); // the day went on between them: 1.5 s is 0.05 h
  }, 30000);

  test("holds the tour's world beside the players': a tree back before its time and a fresh start only there", async () => {
    const { port } = await start(), tour = client(port, undefined, "?world=tour"), player = client(port);
    const life: BuildChange[] = [...Array(8).fill({ type: "bite", tree: 2 }), { type: "fell", tree: 2, direction: 1 },
      { type: "rest", tree: 2, at: [1, 0, 1], turn: [0, 0, 0, 1] }, ...Array(4).fill({ type: "bite", tree: 2 }), { type: "split", tree: 2 }, { type: "grow", tree: 2 }];
    const built = async (world: string) => (await info(port, `?build${world}`)).build as BuildChange[];
    for (const c of [tour, player]) { await c.opened; c.hello(); await c.next("welcome"); }
    // The same work in both: the tour's tree grows back at once, the players' not before its time.
    tour.ws.send(JSON.stringify({ t: "build", c: life }));
    player.ws.send(JSON.stringify({ t: "build", c: life }));
    expect(await player.next("world")).toMatchObject({ build: life.slice(0, -1).map((c) => c.type === "split" ? { type: "split", tree: 2 } : c) });
    expect((await tour.next("build") as Extract<ServerMessage, { t: "build" }>).c.at(-1)).toEqual({ type: "grow", tree: 2 });
    expect([(await built("&world=tour")).length, (await built("")).length]).toEqual([life.length, life.length - 1]);
    // Afresh for the asking in the tour's world only; the players' world stays.
    player.ws.send(JSON.stringify({ t: "reset" }));
    tour.ws.send(JSON.stringify({ t: "reset" }));
    expect(await tour.next("reset")).toEqual({ t: "reset" });
    expect([(await built("&world=tour")).length, (await built("")).length, player.messages.some((m) => m.t === "reset")]).toEqual([0, life.length - 1, false]);
    // Where the loose wood lies, as the host said: told to the next who comes in as the first.
    const lying: Place = [200, 1, 0.5, -3, 0, 0.6, 0, 0.8];
    player.ws.send(JSON.stringify({ t: "things", l: [lying] }));
    player.ws.send(JSON.stringify({ t: "chat", text: "so the things are taken first" }));
    await Bun.sleep(100);
    player.ws.close();
    await player.closed;
    const next = client(port);
    await next.opened;
    next.hello();
    expect(await next.next("things")).toEqual({ t: "things", l: [lying] });
  }, 30000);

  test("keeps the world and its epoch over a restart; a broken file starts afresh, kept aside", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "beaver-")), "world.json"), env = { WORLD_FILE: file, GIT_SHA: "abc123" };
    let { port } = await start(env);
    const first = await info(port);
    expect(first.version).toBe("abc123");
    const p = client(port);
    await p.opened;
    p.hello();
    expect((await p.next("welcome")) as { version: string }).toMatchObject({ version: "abc123" });
    const work = [{ type: "find" }, { type: "bite", tree: 2 }, { type: "trade", stick: "w4" }];
    p.ws.send(JSON.stringify({ t: "build", c: [...work, { type: "trade", stick: "w4" }] })); // traded twice: once taken
    expect(await p.next("build")).toMatchObject({ c: work });
    // server.ts writes it at once on SIGTERM. Nothing tells the Worker that it ends: what is older than SAVE_AFTER is kept.
    if (!bun) await Bun.sleep(SAVE_AFTER + 500);
    await stop();
    if (bun) expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ epoch: first.epoch, build: work });

    ({ port } = await start(env));
    expect(await info(port)).toMatchObject({ epoch: first.epoch, build: work });
    await stop();
    if (!bun) return; // the rest breaks the file by hand

    // A change rules.ts no longer takes: left out, and a new epoch so nobody keeps its copy of the old world.
    writeFileSync(file, JSON.stringify({ epoch: first.epoch, build: [{ type: "find" }, { type: "split", tree: 4 }] }));
    ({ port } = await start(env));
    const changed = await info(port);
    expect(changed.build).toEqual([{ type: "find" }]);
    expect(changed.epoch).not.toBe(first.epoch);
    await stop();

    writeFileSync(file, '{"epoch": "abc", "build": [');
    ({ port } = await start(env));
    expect((await info(port)).build).toEqual([]);
    expect(existsSync(`${file}.bad`)).toBe(true);
  }, 60000);

  // Ages the kept world by hand between restarts, which only a file allows; the rules it checks are the room's.
  test.if(bun)("compacts the log over regrow cycles; a joiner gets the live world, a refused change the whole world", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "beaver-")), "world.json"), env = { WORLD_FILE: file };
    const life = (direction: number): BuildChange[] => [...Array(8).fill({ type: "bite", tree: 2 }), { type: "fell", tree: 2, direction },
      { type: "rest", tree: 2, at: [direction, 0, 1], turn: [0, 0, 0, 1] }, ...Array(4).fill({ type: "bite", tree: 2 }), { type: "split", tree: 2 }];
    /** The kept world with every split long ago, as if REGROW had passed while the server was down. */
    const age = () => {
      const kept = JSON.parse(readFileSync(file, "utf8")) as { epoch: string; build: BuildChange[] };
      for (const c of kept.build) if (c.type === "split") c.at = Date.now() - (REGROW + 60) * 1000;
      writeFileSync(file, JSON.stringify(kept));
      return kept;
    };
    writeFileSync(file, JSON.stringify({ epoch: "k3x9", build: [{ type: "find" }, ...life(0.5)] }));
    // The live one: a world built from every change it is told, counted as the browser does (index.ts).
    const live = { state: replay(age().build), epoch: "k3x9", have: 16 };
    for (let cycle = 1; cycle <= 3; cycle++) {
      const { port } = await start(env), a = client(port);
      await a.opened;
      a.ws.send(JSON.stringify({ t: "hello", name: "Tester", epoch: live.epoch, have: live.have }));
      let read = 0;
      const hear = async (until: (m: ServerMessage) => boolean) => {
        for (let i = 0; i < 200; i++, await Bun.sleep(10)) for (; read < a.messages.length;) {
          const m = a.messages[read++]!;
          if (m.t === "welcome") expect([m.epoch, m.from, m.build]).toEqual([live.epoch, live.have, []]); // holds it all already
          if (m.t === "build") { for (const c of m.c) apply(live.state, c); live.have = m.n + m.c.length; }
          if (m.t === "epoch") { live.epoch = m.epoch; live.have = m.n; }
          if (until(m)) return m;
        }
        throw new Error("not told");
      };
      await hear((m) => m.t === "welcome");
      const grow: BuildChange = { type: "grow", tree: 2 };
      apply(live.state, grow); // as the browser does: its own change applied, then sent
      a.ws.send(JSON.stringify({ t: "build", c: [grow] }));
      a.ws.send(JSON.stringify({ t: "build", c: life(cycle) }));
      expect(await hear((m) => m.t === "epoch")).toMatchObject({ n: 1 + 15 }); // the tree's earlier life left out
      // Asked again too soon (by a clock further along): refused, and told the whole world to take instead.
      a.ws.send(JSON.stringify({ t: "build", c: [grow] }));
      const world = await hear((m) => m.t === "world") as Extract<ServerMessage, { t: "world" }>;
      expect([world.epoch, world.build.length]).toEqual([live.epoch, live.have]);
      // A joiner now gets the present world, the same as the one who saw every change; its name already taken.
      const b = client(port);
      await b.opened;
      b.hello();
      const welcome = await b.next("welcome") as Extract<ServerMessage, { t: "welcome" }>;
      expect(welcome.build).toHaveLength(16);
      expect(sameWorld(replay(welcome.build), live.state)).toBe(true);
      expect(await b.next("name")).toMatchObject({ t: "name", id: welcome.id, name: "Tester 2" });
      // The health check is small; the page asks for the changes.
      const small = await info(port, ""), whole = await info(port);
      expect([small.build, small.changes, whole.build.length, whole.epoch]).toEqual([undefined, 16, 16, live.epoch]);
      await stop();
      age();
    }
  }, 30000);

  test("opens the socket only for pages from here", async () => {
    const { port } = await start({ PUBLIC_URL: "https://beaver.example/" });
    const from = (origin: string) => fetch(`http://localhost:${port}/net`, { headers: { Origin: origin, Upgrade: "websocket", Connection: "Upgrade" } });
    expect((await from("https://evil.example")).status).toBe(403);
    expect((await from(`http://localhost:${port}`)).status).not.toBe(403);
    if (bun) expect((await from("https://beaver.example")).status).not.toBe(403); // the Worker has no other public address
  }, 30000);

  test.if(bun)("without the new variables: no build id, no file, every local socket", async () => {
    const { port, out } = await start();
    expect((await info(port)).version).toBe("");
    const local = Array.from({ length: PER_ADDRESS + 2 }, () => client(port)); // bots and browsers on this machine
    expect(await Promise.all(local.map((c) => c.opened))).toEqual(Array(PER_ADDRESS + 2).fill(true));
    expect(out()).toContain("http://");
  }, 30000); // ms: ends a hang, says nothing about speed on a busy machine

  test.if(!bun)("starts the world afresh for the holder of the reset token only", async () => {
    const { port } = await start({ RESET_TOKEN: "only-the-maintainers-know" });
    const reset = (headers: Record<string, string> = {}, method = "POST") => fetch(`http://localhost:${port}${RESET_PATH}`, { method, headers });
    const p = client(port);
    await p.opened;
    p.hello();
    await p.next("welcome");
    p.ws.send(JSON.stringify({ t: "build", c: [{ type: "find" }] }));
    expect(await p.next("build")).toBeDefined();
    const before = await info(port);
    expect((await reset()).status).toBe(404);
    expect((await reset({ Authorization: "Bearer something-else" })).status).toBe(404);
    expect((await reset({ Authorization: "Bearer only-the-maintainers-know" }, "GET")).status).toBe(404);
    expect(await info(port)).toEqual(before);
    expect((await reset({ Authorization: "Bearer only-the-maintainers-know" })).status).toBe(200);
    expect(await p.next("reset")).toEqual({ t: "reset" });
    const after = await info(port);
    expect([after.build, after.epoch === before.epoch]).toEqual([[], false]);
  }, 30000);

  test.if(!bun)("answers the reset address like an unknown one when no token is set", async () => {
    const { port } = await start();
    expect((await fetch(`http://localhost:${port}${RESET_PATH}`, { method: "POST", headers: { Authorization: "Bearer " } })).status).toBe(404);
    expect((await fetch(`http://localhost:${port}${RESET_PATH}`, { method: "POST", headers: { Authorization: "Bearer undefined" } })).status).toBe(404);
  }, 30000);
});
