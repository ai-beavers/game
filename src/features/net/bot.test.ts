// Working bots (bot.ts) against the real server on a free port: alone in a world whose own sticks are all in the dam
// already, one fells a tree, gnaws it into wood and lays a stick of it into the dam; in a world whose dam and lodge
// are full, one fetches a stick and dives it down into the food cache. The server took every change they sent.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { live, LODGE, SLOTS, type BuildChange } from "../build/rules.ts";
import { replay } from "./protocol.ts";

const root = join(import.meta.dir, "../../..");
const running: Bun.Subprocess[] = [];
afterEach(async () => { for (const p of running.splice(0)) { p.kill("SIGTERM"); await p.exited; } });

/** Starts a process and collects what it prints; resolves once a line matches `ready`. */
async function spawn(cmd: string[], env: Record<string, string>, ready: RegExp) {
  const p = Bun.spawn(cmd, { cwd: root, env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "inherit" });
  running.push(p);
  let out = "";
  const reader = p.stdout.getReader(), decoder = new TextDecoder();
  const drained = (async () => { for (let r = await reader.read(); !r.done; r = await reader.read()) out += decoder.decode(r.value); })();
  while (!ready.test(out)) if (await Promise.race([drained.then(() => true), Bun.sleep(20).then(() => false)])) throw new Error(`${cmd.join(" ")} ended: ${out}`);
  return () => out;
}

test("a bot alone fells a tree, makes wood and lays a stick of it, and the server's world shows it", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "beaver-")), "world.json");
  const sticks: BuildChange[] = Array.from({ length: 20 }, (_, i) => ({ type: "place", slot: i, stick: `w${i}` }));
  writeFileSync(file, JSON.stringify({ epoch: "bots1", build: [{ type: "find" }, ...sticks] }));
  const server = await spawn(["bun", "server.ts"], { NODE_ENV: "production", PORT: "0", WORLD_FILE: file }, /port \d+/);
  const port = /port (\d+)/.exec(server())![1];
  const bot = await spawn(["bun", "src/features/net/bot.ts", `ws://localhost:${port}/net`, "--quiet"], {}, /bot\(s\) on/);

  let build: BuildChange[] = [];
  for (let t = 0; t < 120 && !build.some((c) => c.type === "place" && c.stick.startsWith("t")); t++) {
    await Bun.sleep(1000);
    build = (await (await fetch(`http://localhost:${port}/net/info?build`)).json()).build;
  }
  const world = replay(build), tree = Object.keys(world.trees).map(Number).find((i) => world.trees[i]!.split)!;
  expect(tree).toBeDefined();
  expect(live(world.trees[tree])).toBeUndefined(); // only the stump stands there now
  expect(world.dam.length).toBe(21);
  expect(world.dam[20]).toStartWith(`t${tree}:`);
  // In order and nothing refused: the bites, the fall, where it lay, the bites into wood, the split, the stick.
  expect(build.slice(21).map((c) => c.type).join(" ")).toMatch(/^(bite )+fell rest (bite ){4}split place$/);
  expect(bot()).not.toContain("refused");
}, 150_000);

test("a bot dives a stick down into the food cache once the dam and the lodge are full", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "beaver-")), "world.json");
  const sticks: BuildChange[] = Array.from({ length: SLOTS + LODGE }, (_, i) => ({ type: "place", slot: i, stick: `d${i}` }));
  writeFileSync(file, JSON.stringify({ epoch: "bots2", build: [{ type: "find" }, ...sticks] }));
  const server = await spawn(["bun", "server.ts"], { NODE_ENV: "production", PORT: "0", WORLD_FILE: file }, /port \d+/);
  const port = /port (\d+)/.exec(server())![1];
  const bot = await spawn(["bun", "src/features/net/bot.ts", `ws://localhost:${port}/net`, "--quiet"], {}, /bot\(s\) on/);

  let build: BuildChange[] = [];
  for (let t = 0; t < 120 && build.length <= 1 + SLOTS + LODGE; t++) {
    await Bun.sleep(1000);
    build = (await (await fetch(`http://localhost:${port}/net/info?build`)).json()).build;
  }
  expect(build.slice(1 + SLOTS + LODGE)).toEqual([{ type: "place", slot: SLOTS + LODGE, stick: expect.stringMatching(/^w\d+$/) }]);
  expect(bot()).toContain("wedged");
  expect(bot()).not.toContain("refused");
}, 150_000);
