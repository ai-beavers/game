// Looks at a page of the game without a desktop: opens it in a headless Chrome of its own, waits until the page
// calls itself ready (document.title holds the word "ready"), optionally holds keys, then saves a screenshot and
// prints what the page logged.
//
//   bun shot <url> [--out shots/name.png] [--size 1280x720] [--wait 500] [--keys "KeyW:1500 Space:80"] [--eval "expr"]
//                 [--until "expr"]   waits until the expression is true in the page (at most --wait ms, default 120000;
//                                    exit code 1 if it never is) instead of a fixed time. The whole tour as one check:
//   bun shot "http://localhost:5180/?play&tour=fast" --until "tour.round > 1" --eval "tour.results.filter(r => r.ok !== true)"
//
// --keys holds one key after the other for the given milliseconds ("KeyW+ShiftLeft:1000" holds both); codes are
// KeyboardEvent.code values. --eval prints the value of an expression in the page after the keys, as JSON.
// Nothing is filmed or kept but the screenshot. Exit code 1: the page never got ready or threw.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openChrome } from "./chrome.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args.splice(at, 2)[1]!;
};
const out = option("out", "shots/shot.png"), [width, height] = option("size", "1280x720").split("x").map(Number);
const until = option("until", ""), wait = Number(option("wait", until ? "120000" : "500")), keys = option("keys", ""), expression = option("eval", "");
if (args.includes("--no-record")) args.splice(args.indexOf("--no-record"), 1); // from when runs were filmed: still accepted
const url = args[0];
if (!url) throw new Error("usage: bun shot <url> [--out file.png] [--size WxH] [--wait ms] [--keys ...] [--eval expr]");

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const page = await openChrome(width!, height!);
let failed = false;
try {
  page.on("Runtime.consoleAPICalled", (p) => console.log(`[${p.type}]`, ...p.args.map((a: any) => a.value ?? a.description ?? a.type)));
  page.on("Runtime.exceptionThrown", (p) => { failed = true; console.log("[exception]", p.exceptionDetails.exception?.description ?? p.exceptionDetails.text); });
  await page.send("Page.navigate", { url });
  const deadline = Date.now() + 40_000;
  while (!/\bready\b/i.test(String(await page.evaluate("document.title")))) {
    if (Date.now() > deadline) { failed = true; console.log("[shot] page never got ready, title:", await page.evaluate("document.title")); break; }
    await sleep(100);
  }
  for (const step of keys.split(" ").filter(Boolean)) {
    const [codes, hold] = step.split(":");
    const each = codes!.split("+").map((code) => ({ code, key: code.replace(/^Key|^Digit/, "").toLowerCase() }));
    for (const key of each) await page.send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
    await sleep(Number(hold ?? 100));
    for (const key of each) await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
  }
  if (until) { // done as soon as the page says so: no fixed wait to sit out
    for (const end = Date.now() + wait; !(await page.evaluate(`!!(${until})`));) {
      if (Date.now() > end) { failed = true; console.log(`[shot] never true within ${wait} ms: ${until}`); break; }
      await sleep(200);
    }
  } else await sleep(wait);
  if (expression) console.log("[eval]", JSON.stringify(await page.evaluate(expression)));
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  mkdirSync(dirname(out), { recursive: true });
  await Bun.write(out, Buffer.from(data, "base64"));
  console.log(`[shot] ${out} (${await page.evaluate("document.title")})`);
} finally {
  await page.close();
}
process.exit(failed || page.failed ? 1 : 0);
