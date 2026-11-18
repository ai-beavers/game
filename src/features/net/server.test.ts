// Tests for the rules server.ts keeps toward strangers, against the real server on a free port: sockets per client
// address, the hello timeout, a full server, the world kept over a restart (and a broken file), the build id.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, REGROW, type BuildChange } from "../build/rules.ts";
import { DAY_SECONDS, HELLO_TIME, MAX_PLAYERS, PER_ADDRESS, replay, sameWorld, START, type ServerMessage } from "./protocol.ts";

const root = join(import.meta.dir, "../../..");
let running: Bun.Subprocess | undefined;

/** Starts server.ts with these environment variables; resolves with its port once it listens. */
async function start(env: Record<string, string> = {}) {
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
async function stop() {
  running?.kill("SIGTERM");
  await running?.exited;
  running = undefined;
}
afterEach(stop);

/** A raw client: from `ip` (as Fly would say, for TRUST_PROXY=fly), its messages, and how it ended. */
function client(port: number, ip?: string) {
  const options = ip ? { headers: { "Fly-Client-IP": ip } } : undefined; // Bun's WebSocket takes headers; the DOM type does not say so
  const ws = new WebSocket(`ws://localhost:${port}/net`, options as unknown as string[]);
  const messages: ServerMessage[] = [];
  const opened = new Promise<boolean>((resolve) => { ws.onopen = () => resolve(true); ws.onerror = () => resolve(false); });
  const closed = new Promise<number>((resolve) => { ws.onclose = (e) => resolve(e.code); });
  ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
  const next = async (t: string) => { for (let i = 0; i < 100; i++) { const m = messages.find((x) => x.t === t); if (m) return m; await Bun.sleep(20); } };
  const hello = () => ws.send(JSON.stringify({ t: "hello", name: "Tester" }));
  return { ws, messages, opened, closed, next, hello };
}
const info = async (port: number, query = "?build") => (await fetch(`http://localhost:${port}/net/info${query}`)).json();

describe("server.ts", () => {
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
  }, HELLO_TIME + 5000);

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
  }, 15000);

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
  });

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
    await stop(); // SIGTERM writes it at once
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ epoch: first.epoch, build: work });

    ({ port } = await start(env));
    expect(await info(port)).toMatchObject({ epoch: first.epoch, build: work });
    await stop();

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
  }, 30000);

  test("compacts the log over regrow cycles; a joiner gets the live world, a refused change the whole world", async () => {
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
    expect((await from("https://beaver.example")).status).not.toBe(403);
  });

  test("without the new variables: no build id, no file, every local socket", async () => {
    const { port, out } = await start();
    expect((await info(port)).version).toBe("");
    const local = Array.from({ length: PER_ADDRESS + 2 }, () => client(port)); // bots and browsers on this machine
    expect(await Promise.all(local.map((c) => c.opened))).toEqual(Array(PER_ADDRESS + 2).fill(true));
    expect(out()).toContain("http://");
  });
});
