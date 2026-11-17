// Looks at a page of the game without a desktop: opens it in a headless Chrome of its own, waits until the page
// calls itself ready (document.title holds the word "ready"), optionally holds keys, then saves a screenshot and
// prints what the page logged.
//
//   bun shot <url> [--out shots/name.png] [--size 1280x720] [--wait 500] [--keys "KeyW:1500 Space:80"] [--eval "expr"]
//
// --keys holds one key after the other for the given milliseconds ("KeyW+ShiftLeft:1000" holds both); codes are
// KeyboardEvent.code values. --eval prints the value of an expression in the page after the keys, as JSON.
// Every run is also filmed, from the moment the page is ready to the screenshot, and kept as
// recordings/<day>/<time>-<name>.mp4 with a .json beside it saying what was looked at (address, keys). --no-record
// leaves that out (filming costs a little frame time: use it when measuring speed).
// Exit code 1: the page never got ready or threw.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { clipPath, film, openChrome } from "./chrome.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args.splice(at, 2)[1]!;
};
const out = option("out", "shots/shot.png"), [width, height] = option("size", "1280x720").split("x").map(Number);
const wait = Number(option("wait", "500")), keys = option("keys", ""), expression = option("eval", "");
const record = !args.includes("--no-record");
if (!record) args.splice(args.indexOf("--no-record"), 1);
const url = args[0];
if (!url) throw new Error("usage: bun shot <url> [--out file.png] [--size WxH] [--wait ms] [--keys ...] [--eval expr]");

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const reel = record ? mkdtempSync(join(tmpdir(), "beaver-reel-")) : "", frames: { file: string; at: number }[] = [], written: Promise<unknown>[] = [];
const page = await openChrome(width!, height!);
let failed = false;
try {
  page.on("Runtime.consoleAPICalled", (p) => console.log(`[${p.type}]`, ...p.args.map((a: any) => a.value ?? a.description ?? a.type)));
  page.on("Runtime.exceptionThrown", (p) => { failed = true; console.log("[exception]", p.exceptionDetails.exception?.description ?? p.exceptionDetails.text); });
  page.on("Page.screencastFrame", (p) => {
    const file = join(reel, `${String(frames.length).padStart(6, "0")}.jpg`);
    frames.push({ file, at: p.metadata.timestamp });
    written.push(Bun.write(file, Buffer.from(p.data, "base64")));
    void page.send("Page.screencastFrameAck", { sessionId: p.sessionId });
  });
  await page.send("Page.navigate", { url });
  const deadline = Date.now() + 40_000;
  while (!/\bready\b/i.test(String(await page.evaluate("document.title")))) {
    if (Date.now() > deadline) { failed = true; console.log("[shot] page never got ready, title:", await page.evaluate("document.title")); break; }
    await sleep(100);
  }
  if (record) await page.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
  for (const step of keys.split(" ").filter(Boolean)) {
    const [codes, hold] = step.split(":");
    const each = codes!.split("+").map((code) => ({ code, key: code.replace(/^Key|^Digit/, "").toLowerCase() }));
    for (const key of each) await page.send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
    await sleep(Number(hold ?? 100));
    for (const key of each) await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
  }
  await sleep(wait);
  if (expression) console.log("[eval]", JSON.stringify(await page.evaluate(expression)));
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  mkdirSync(dirname(out), { recursive: true });
  await Bun.write(out, Buffer.from(data, "base64"));
  console.log(`[shot] ${out} (${await page.evaluate("document.title")})`);
  if (record) {
    await page.send("Page.stopScreencast");
    await Promise.all(written);
    const clip = clipPath(basename(out, ".png"));
    await film(frames, reel, clip, { url, keys, eval: expression, picture: out });
    if (frames.length > 1) console.log(`[shot] ${clip}.mp4`);
  }
} finally {
  await page.close();
}
process.exit(failed || page.failed ? 1 : 0);
