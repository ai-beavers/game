// A headless Chrome of its own, driven over the DevTools protocol: what tools/shot.ts and tools/tour.ts share.
//
//   const page = await openChrome(1280, 720);       one tab, its own empty profile, sound off
//   page.on("Runtime.consoleAPICalled", (params) => …);
//   await page.send("Page.navigate", { url });   await page.evaluate("document.title");   await page.close();
//   page.failed                                      true once a DevTools call came back with an error
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export interface Page {
  send(method: string, params?: object): Promise<any>;
  /** The value of an expression in the page (awaited when it is a promise). */
  evaluate(code: string): Promise<any>;
  /** Listens to a DevTools event (Runtime and Page are enabled). */
  on(method: string, listener: (params: any) => void): void;
  failed: boolean;
  /** Stops Chrome and removes its profile. */
  close(): Promise<void>;
}

export async function openChrome(width: number, height: number): Promise<Page> {
  const profile = mkdtempSync(join(tmpdir(), "beaver-chrome-"));
  const chrome = Bun.spawn([CHROME, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
    "--enable-unsafe-webgpu", "--hide-scrollbars", "--mute-audio", "about:blank"], { stderr: "pipe", stdout: "ignore" });
  let closing = false;
  const close = async () => {
    closing = true;
    socket?.close();
    chrome.kill();
    await chrome.exited;
    rmSync(profile, { recursive: true, force: true });
  };
  let socket: WebSocket | undefined;
  try {
    let endpoint = "", log = "";
    const reader = chrome.stderr.getReader(), decoder = new TextDecoder();
    while (!endpoint) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`Chrome did not start: ${log}`);
      log += decoder.decode(value);
      endpoint = log.match(/DevTools listening on (ws:\S+)/)?.[1] ?? "";
    }
    void (async () => { while (!(await reader.read()).done); })(); // drained, so a chatty Chrome never blocks on a full pipe
    socket = new WebSocket(endpoint);
    await new Promise((open, error) => { socket!.onopen = open; socket!.onerror = error; });
    let id = 0, session: string | undefined;
    const pending = new Map<number, (result: any) => void>(), listeners = new Map<string, ((params: any) => void)[]>();
    const page: Page = {
      failed: false,
      send: (method, params = {}) => new Promise<any>((done) => {
        pending.set(++id, done);
        socket!.send(JSON.stringify({ id, method, params, sessionId: session }));
      }),
      evaluate: async (code) => (await page.send("Runtime.evaluate", { expression: code, returnByValue: true, awaitPromise: true })).result?.value,
      on: (method, listener) => void listeners.set(method, [...listeners.get(method) ?? [], listener]),
      close,
    };
    // Chrome went away under us (killed, crashed): nothing that waits for an answer would ever get one.
    socket.onclose = () => {
      if (closing) return;
      console.error("[chrome] the browser went away");
      rmSync(profile, { recursive: true, force: true });
      process.exit(1);
    };
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id) {
        if (message.error) { page.failed = true; console.error("devtools:", message.error.message); }
        pending.get(message.id)?.(message.result ?? {});
        pending.delete(message.id);
      } else for (const listener of listeners.get(message.method) ?? []) listener(message.params);
    };
    const { targetId } = await page.send("Target.createTarget", { url: "about:blank" });
    session = (await page.send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
    await page.send("Runtime.enable");
    await page.send("Page.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    return page;
  } catch (error) {
    await close();
    throw error;
  }
}
