// The tour (src/features/tour) as a test that never ends: one headless Chrome plays it round after round, and only
// what goes wrong is kept.
//
//   bun run tour                 tests what is committed: HEAD checked out on its own (a git worktree in the temp
//                                folder), served without live reload; a new commit is checked out and played anew
//   bun run tour --here          tests the files as they are now (served once, not followed)
//   --port 5193                  where its server listens      --speed real     the tour in real time (default fast)
//   bun run tour --once [--station Name ...] [--here]
//                                a check that ends: one whole round (or the named stations, in that order), one line
//                                per station, exit 0 when none failed, else 1. The tour's world is kept between
//                                runs: its server keeps it in a file (recordings/tour-world.json.tour, -<port> off
//                                the default port), so run after run the dam grows and then the lodge; a world left
//                                by another build (commit and diff) is thrown away, not continued.
//   bun run tour --once --here --repeat 30 [--beside]
//                                the soak: that many --once runs one after the other, a line each (fresh or continued
//                                world, what failed), exit 1 when any failed; --beside keeps a second, endless tour
//                                running on port + 1 meanwhile, as load.
//
// Prints one line per station and round, nothing else. Each station's result goes as a line of JSON into
// recordings/tour.jsonl (with the commit). A station that fails leaves recordings/tour-<station>.jpg, a picture of
// the moment; nothing is filmed. A page that says nothing for QUIET seconds while its game clock stands still, or
// crashes, is opened anew. Ctrl-C stops Chrome and the server and removes the checkout.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Subprocess } from "bun";
import { openChrome, type Page } from "./chrome.ts";

const QUIET = 90; // s without a word from the tour and without its game clock moving: it hangs
const WIDTH = 640, HEIGHT = 360; // small: a picture is only kept when something failed

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => { const at = args.indexOf(`--${name}`); return at < 0 ? fallback : args[at + 1]!; };
const port = Number(option("port", "5193")), here = args.includes("--here"), speed = option("speed", "fast"), once = args.includes("--once");
const named = args.flatMap((a, i) => a === "--station" && args[i + 1] ? [args[i + 1]!] : []);
const root = process.cwd(), tree = here ? root : join(tmpdir(), `beaver-tour-${port}`);
const url = `http://localhost:${port}/?play&tour=${speed === "fast" ? "fast" : ""}${named.map((n) => `&station=${encodeURIComponent(n)}`).join("")}`;
// --once: where the server keeps its worlds (WORLD_FILE; the tour's in KEPT, as server.ts names it), and beside it the
// build that wrote them
const WORLD_FILE = join(root, "recordings", `tour-world${port === 5193 ? "" : `-${port}`}.json`), KEPT = `${WORLD_FILE}.tour`, BUILD = `${WORLD_FILE}.build`;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const git = (cwd: string, ...a: string[]) => {
  const run = Bun.spawnSync(["git", ...a], { cwd });
  if (run.exitCode !== 0) throw new Error(`git ${a.join(" ")}: ${run.stderr.toString().trim()}`);
  return run.stdout.toString().trim();
};

// ---- the soak: --repeat N runs of --once, each a process of its own like a merge check ----
const repeat = Number(option("repeat", "0"));
if (repeat > 0) {
  mkdirSync("recordings", { recursive: true });
  const pass = args.filter((a, i) => a !== "--repeat" && args[i - 1] !== "--repeat" && a !== "--beside" && a !== "--once");
  const beside = args.includes("--beside")
    ? Bun.spawn(["bun", import.meta.path, ...(here ? ["--here"] : []), "--speed", speed, "--port", String(port + 1)], { stdin: "ignore", stdout: Bun.file("recordings/soak-beside.log"), stderr: "ignore" })
    : undefined;
  let run: Subprocess | undefined;
  const quit = async () => { run?.kill(); beside?.kill(); await Promise.all([run?.exited, beside?.exited]); process.exit(130); };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  let failed = 0;
  for (let i = 1; i <= repeat; i++) {
    const child = run = Bun.spawn(["bun", import.meta.path, "--once", ...pass], { stdin: "ignore", stdout: "pipe", stderr: "inherit" });
    const out = await new Response(child.stdout).text(), code = await child.exited;
    const fails = out.split("\n").filter((l) => l.startsWith("[tour] FAIL") || l.startsWith("[runner] the page")).map((l) => l.replace(/^\[\w+\] /, ""));
    if (code !== 0) failed++;
    const save = out.includes("[runner] a fresh world") ? "fresh" : "continued", round = /\[tour\] round \d+: (\S+ ok)/.exec(out)?.[1] ?? "";
    console.log(`[soak] run ${i}/${repeat}, ${save} world${beside ? ", a second tour beside" : ""}: ${code === 0 ? `ok, ${round}` : fails.join("; ") || `exit ${code}`}`);
    appendFileSync("recordings/soak.log", `---- run ${i}/${repeat} ${new Date().toISOString()} exit ${code}\n${out}`); // every line, for a failure
  }
  beside?.kill();
  await beside?.exited;
  console.log(`[soak] ${failed} of ${repeat} runs failed`);
  process.exit(failed ? 1 : 0);
}

// ---- what is tested: HEAD in a checkout of its own ----
let sha = here ? "here" : "";
function checkout() {
  sha = git(root, "rev-parse", "HEAD");
  if (!existsSync(join(tree, ".git"))) {
    rmSync(tree, { recursive: true, force: true });
    git(root, "worktree", "prune");
    git(root, "worktree", "add", "--detach", "--force", tree, sha);
    symlinkSync(join(root, "node_modules"), join(tree, "node_modules"));
  } else git(tree, "checkout", "--detach", "--force", sha);
}

// ---- its own server, without live reload, so an edit elsewhere never restarts a round ----
let server: Subprocess | undefined;
async function serve() {
  server?.kill();
  await server?.exited;
  if (once) console.log(keptWorld() ? "[runner] the tour's world goes on" : "[runner] a fresh world");
  const env = { ...process.env, NODE_ENV: "production", PORT: String(port), ...(once ? { WORLD_FILE } : {}) };
  server = Bun.spawn(["bun", "server.ts"], { cwd: tree, env, stdin: "ignore", stdout: "ignore", stderr: "inherit" });
  for (let i = 0; i < 150; i++) {
    if (await fetch(`http://localhost:${port}/`).then((r) => r.ok, () => false)) return;
    await sleep(200);
  }
  throw new Error(`the server on port ${port} did not start`);
}

// ---- the page: tour lines out ----
let page: Page | undefined, heard = Date.now(), failures = 0;
const kept: Promise<void>[] = [];
async function open() {
  await page?.close();
  const p = page = await openChrome(WIDTH, HEIGHT);
  p.on("Runtime.consoleAPICalled", (e) => {
    const text = e.args.map((a: any) => a.value ?? a.description ?? a.type).join(" ");
    if (!text.startsWith("[tour]")) return;
    heard = Date.now();
    console.log(text);
    if (text.startsWith("[tour] FAIL")) failures++;
    if (/^\[tour\] (ok|FAIL|skipped) /.test(text)) kept.push(keep(p, text.startsWith("[tour] FAIL")));
    if (once && text.startsWith("[tour] round ")) void done();
  });
  p.on("Runtime.exceptionThrown", (e) => console.log("[exception]", e.exceptionDetails.exception?.description ?? e.exceptionDetails.text));
  p.on("Inspector.targetCrashed", () => { console.log("[runner] the page crashed"); heard = 0; });
  await p.send("Inspector.enable");
  await p.send("Page.navigate", { url });
  for (let t = 0; !/\bready\b/i.test(String(await p.evaluate("document.title"))); t += 200) {
    if (t > 60_000) { console.log("[runner] the page never got ready"); if (once) await stop(1); break; }
    await sleep(200);
  }
  // The checks do not need a fine picture; the profile is thrown away with Chrome, so this stays here.
  await p.evaluate(`window.game?.settings.set({ quality: "low", effects: false })`);
  heard = Date.now();
}

/** A station's result into recordings/tour.jsonl; a failure also as a picture of the moment. */
async function keep(p: Page, failed: boolean) {
  const result = await p.evaluate("window.tour?.results.at(-1)");
  if (!result) return;
  mkdirSync("recordings", { recursive: true });
  appendFileSync("recordings/tour.jsonl", `${JSON.stringify({ at: new Date().toISOString(), sha, speed, ...result })}\n`);
  if (!failed) return;
  const picture = `recordings/tour-${String(result.station).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.jpg`; // the last failure of this station
  const { data } = await p.send("Page.captureScreenshot", { format: "jpeg", quality: 80 }); // the tour holds still a second for it
  await Bun.write(picture, Buffer.from(data, "base64"));
  console.log(`[runner] ${picture}`);
}

/** Which game is played: the commit, and with --here a hash of the changes on top of it. A kept world is only
 *  continued by the build that wrote it; another's rules (or world) may not be able to go on from it. */
function buildId() {
  if (!here) return sha;
  try { return `${git(root, "rev-parse", "HEAD")}+${Bun.hash(git(root, "diff", "HEAD")).toString(36)}`; } catch { return "here"; }
}

/** --once, before the server starts: whether it will find the tour's world of the last run, with something in it. One
 *  that another build wrote is thrown away first. */
function keptWorld(): boolean {
  mkdirSync(dirname(WORLD_FILE), { recursive: true });
  const wrote = existsSync(BUILD) ? readFileSync(BUILD, "utf8") : "";
  if (wrote !== buildId()) {
    if (existsSync(KEPT)) console.log("[runner] the tour's world is from another build: thrown away");
    rmSync(KEPT, { force: true });
    writeFileSync(BUILD, buildId());
  }
  try { return JSON.parse(readFileSync(KEPT, "utf8")).build.length > 0; } catch { return false; } // none yet, or broken
}

/** --once: the round is through. The server keeps the tour's world as it ends (empty when the tour started it anew). */
async function done() {
  await Promise.all(kept);
  await stop(failures ? 1 : 0);
}

async function stop(code = 0) {
  await page?.close();
  server?.kill();
  await server?.exited;
  if (!here) { try { git(root, "worktree", "remove", "--force", tree); } catch { /* already gone */ } }
  process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

if (!here) checkout();
await serve();
await open();
console.log(`[runner] ${here ? "the files as they are" : `commit ${sha.slice(0, 7)}`} on ${url}`);
let clock: unknown;
for (;;) {
  await sleep(5000);
  // A page slowed by other work plays on in game time (every limit of the tour counts it): while its clock moves, it
  // is slow, not hung.
  const now = await Promise.race([page?.evaluate("window.tour?.clock").catch(() => undefined), sleep(5000)]);
  if (typeof now === "number" && now !== clock) { clock = now; heard = Date.now(); }
  if (once) {
    if (Date.now() - heard > QUIET * 1000) { console.log("[runner] the page went quiet: the round did not end"); await stop(1); }
  } else if (!here && git(root, "rev-parse", "HEAD") !== sha) {
    checkout();
    await serve();
    await open();
    console.log(`[runner] new commit ${sha.slice(0, 7)}: the tour starts over`);
  } else if (Date.now() - heard > QUIET * 1000) {
    console.log("[runner] the page went quiet: opening it anew");
    await open();
  }
}
