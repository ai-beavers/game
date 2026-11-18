// Tests for the rules server.ts keeps toward strangers, against the real server on a free port: sockets per client
// address, the hello timeout, a full server, the world kept over a restart (and a broken file), the build id.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HELLO_TIME, MAX_PLAYERS, PER_ADDRESS, type ServerMessage } from "./protocol.ts";

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
const info = async (port: number) => (await fetch(`http://localhost:${port}/net/info`)).json();

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

  test("keeps the world and its epoch over a restart; a broken file starts afresh, kept aside", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "beaver-")), "world.json"), env = { WORLD_FILE: file, GIT_SHA: "abc123" };
    let { port } = await start(env);
    const first = await info(port);
    expect(first.version).toBe("abc123");
    const p = client(port);
    await p.opened;
    p.hello();
    expect((await p.next("welcome")) as { version: string }).toMatchObject({ version: "abc123" });
    p.ws.send(JSON.stringify({ t: "build", c: [{ type: "find" }, { type: "bite", tree: 2 }] }));
    expect(await p.next("build")).toBeDefined();
    await stop(); // SIGTERM writes it at once
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ epoch: first.epoch, build: [{ type: "find" }, { type: "bite", tree: 2 }] });

    ({ port } = await start(env));
    expect(await info(port)).toMatchObject({ epoch: first.epoch, build: [{ type: "find" }, { type: "bite", tree: 2 }] });
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

  test("without the new variables: no build id, no file, every local socket", async () => {
    const { port, out } = await start();
    expect((await info(port)).version).toBe("");
    const local = Array.from({ length: PER_ADDRESS + 2 }, () => client(port)); // bots and browsers on this machine
    expect(await Promise.all(local.map((c) => c.opened))).toEqual(Array(PER_ADDRESS + 2).fill(true));
    expect(out()).toContain("http://");
  });
});
