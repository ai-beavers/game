// Tests for where the trading post stands: on flat open ground, clear of the building site and of everything placed,
// and each spot paid at only from in front of it. Run: bun test src/features/trade
import { expect, test } from "bun:test";
import { heightAt, SITE } from "../../world/terrain.ts";
import { placeAll } from "../../world/place.ts";
import { POST, spotAt, spotFor, standAt } from "./place.ts";

test("the trading post stands on flat ground, away from the building site, clear of what the world placed", () => {
  const ends = [-1, 1].map((k) => ({ x: POST.x + (spotAt(2).x - spotAt(0).x) / 2 * k * 1.6, z: POST.z + (spotAt(2).z - spotAt(0).z) / 2 * k * 1.6 }));
  const heights = [...ends, POST, ...[0, 1, 2].map(standAt)].map((p) => heightAt(p.x, p.z));
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.06);
  expect(Math.hypot(POST.x - SITE.x, POST.z - SITE.z)).toBeGreaterThan(SITE.radius + 3);
  const layout = placeAll();
  for (const s of [...layout.tree, ...layout.rock, ...layout.stump, ...layout.log, ...layout.crate, ...layout.bush])
    expect(Math.hypot(s.x - POST.x, s.z - POST.z), `something at ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`).toBeGreaterThan(POST.length / 2 + 0.8);
});

test("each spot is paid at from in front of it, the nearest one, never from behind the counter", () => {
  for (const i of [0, 1, 2]) expect(spotFor(standAt(i).x, standAt(i).z)).toBe(i);
  const behind = { x: 2 * POST.x - standAt(1).x, z: 2 * POST.z - standAt(1).z };
  expect(spotFor(behind.x, behind.z)).toBeUndefined();
  expect(spotFor(POST.x + 5, POST.z)).toBeUndefined();
});
