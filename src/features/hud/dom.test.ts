// Everything a player sees is drawn by Babylon (docs/agents/rendering.md); only overlay.ts creates the transparent
// native counterparts of controls. This test keeps other files from growing a DOM interface.
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { join } from "node:path";

const SRC = join(import.meta.dir, "../..");
/** Elements nobody sees as interface: textures, a download, text for screen readers, the clipboard. */
const INVISIBLE: Record<string, string[]> = {
  "beaver/index.ts": ["canvas"],
  "features/hud/index.ts": ["output", "textarea"],
  "features/hud/map-display.ts": ["canvas"],
  "features/hud/map.ts": ["canvas"],
  "features/net/ui.ts": ["output"],
  "features/post/photo.ts": ["a"],
};
const MAKES_DOM = /createElement\(\s*["'`]?([\w-]*)|\b(innerHTML|outerHTML|insertAdjacentHTML)\b/g;

test("only the overlay creates DOM elements", async () => {
  const found: string[] = [];
  for await (const file of new Glob("**/*.ts").scan(SRC)) {
    if (file === "features/hud/overlay.ts" || file.endsWith(".test.ts")) continue;
    for (const [, tag, html] of (await Bun.file(join(SRC, file)).text()).matchAll(MAKES_DOM)) {
      if (!tag || !INVISIBLE[file]?.includes(tag)) found.push(`${file}: ${tag || html || "createElement(<not a literal>)"}`);
    }
  }
  // Visible UI: Babylon GUI on stage.hud through Overlay. An element nobody sees: add it to INVISIBLE above.
  expect(found).toEqual([]);
});
