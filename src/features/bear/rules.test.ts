// The Bear's rules as a player meets them: where it goes for a beaver and where not, how a fight runs, what a tail
// slap does, and when it gives up or is driven off.
import { expect, test } from "bun:test";
import { RUN_SPEED } from "../../contracts.ts";
import { SLAP_COOLDOWN, SLAP_HIT, SLAP_TIME } from "../../player/state.ts";
import { placeAll, SPAWN } from "../../world/place.ts";
import { POND, SITE, sunsetGap } from "../../world/terrain.ts";
import { deerHours } from "../life/brain.ts";
import { HIDING } from "../mrs-beaver/rules.ts";
import { PLACE as OLD_BEAVER } from "../old-beaver/rules.ts";
import { SHOP } from "../shop/place.ts";
import { POST } from "../trade/place.ts";
import {
  after, arrive, CHARGE, comesOut, DAYLIGHT, DEN, entry, FLINCH, HEALTH, INNER, leave, newBear, NOTICE, onGround, OUTER, PAUSE, QUIET, REAR, REAR_AT,
  RUN, slap, SLAP_DAMAGE, SLAP_REACH, STAY, step, SULK, SWIPE_REACH, SWIPES, type Bear, type Happening,
} from "./rules.ts";

const dt = 1 / 60, random = () => 0.5;
const trunks = placeAll().tree.map(({ x, z }) => ({ x, z }));
/** A bear out at x, z, as when it has come and stopped there; and the kinds of what happens over `seconds` with the
 *  beaver where `beaver` says. */
const out = (x: number, z: number): Bear => ({ ...newBear(), state: "roam", x, z, goal: { x, z } });
function run(b: Bear, seconds: number, beaver: () => { x: number; z: number; land: boolean }, until?: (h: Happening) => boolean, among = trunks) {
  const seen: Happening[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const now = step(b, beaver(), among, dt, random);
    seen.push(...now);
    if (until && now.some(until)) break;
  }
  return seen;
}
const kinds = (seen: Happening[]) => seen.map((h) => h.kind);
/** Steps until the bear rears for a Swipe at the beaver (10 s at most). */
function untilRears(b: Bear, beaver: { x: number; z: number; land: boolean }) {
  for (let t = 0; t < 10 && b.state !== "rear"; t += dt) step(b, beaver, [], dt, random);
  expect(b.state).toBe("rear");
}

test("everything with a place near the pond is safe ground; the outer meadow is the bear's, but for the Old Beaver's corner", () => {
  for (const safe of [SPAWN, POND, SITE, SHOP, POST, ...HIDING]) expect(onGround(safe.x, safe.z), JSON.stringify(safe)).toBe(false);
  expect(onGround(0, 24)).toBe(true);
  expect(onGround(0, OUTER + 1)).toBe(false);
  expect(onGround(OLD_BEAVER.x + 3, OLD_BEAVER.z - 3)).toBe(false);
  // Trees to fell stand on its ground: a reason to go there.
  expect(trunks.filter((t) => onGround(t.x, t.z)).length).toBeGreaterThan(20);
});

test("it comes out once a Day, in full daylight, never with the deer and not as a visit begins", () => {
  expect(comesOut(40, QUIET, false)).toBe(true);
  expect(comesOut(40, QUIET - 1, false)).toBe(false);
  expect(comesOut(40, QUIET, true)).toBe(false);
  expect(comesOut(DAYLIGHT, QUIET, false)).toBe(false);
  for (let height = -20; height <= 90; height++) expect(comesOut(height, QUIET, false) && deerHours(height), `sun at ${height}°`).toBe(false);
});

test("it comes running from deep in the far forest, never through the open sunset gap, to its ground a way round from the beaver", () => {
  for (const beaver of [{ x: 0, z: 0 }, { x: 0, z: 24 }, { x: -20, z: 10 }, { x: 24, z: 7 }, OLD_BEAVER]) for (const r of [0, 0.3, 0.7, 0.99]) {
    const at = entry(beaver, () => r), b = newBear();
    expect(onGround(at.x, at.z)).toBe(true);
    expect(Math.hypot(at.x - beaver.x, at.z - beaver.z)).toBeGreaterThan(NOTICE);
    arrive(b, at.x, at.z);
    expect(Math.hypot(b.x, b.z)).toBeCloseTo(DEN, 5);
    expect(sunsetGap(b.x, b.z)).toBe(0);
    // With the beaver at home it runs in, in a few seconds, and then is about on its ground.
    let t = 0, fastest = 0;
    for (; t < 15 && b.state === "arrive"; t += dt) { step(b, { x: 0, z: 0, land: true }, trunks, dt, random); fastest = Math.max(fastest, b.speed); }
    expect(b.state).toBe("roam");
    expect(fastest).toBe(RUN);
    expect(onGround(b.x, b.z)).toBe(true);
    expect(Math.hypot(b.x - at.x, b.z - at.z)).toBeLessThan(1.5);
  }
});

test("a beaver out on its ground it has seen from the forest: it runs straight for it and rears up once it is near", () => {
  const b = newBear(), beaver = { x: 0, z: 24, land: true };
  arrive(b, 12, 26);
  expect(kinds(run(b, 15, () => beaver, (h) => h.kind === "notices"))).toEqual(["notices"]);
  expect(onGround(b.x, b.z)).toBe(true);
  const far = Math.hypot(b.x - beaver.x, b.z - beaver.z);
  expect(far).toBeLessThan(NOTICE);
  expect(far).toBeGreaterThan(SWIPE_REACH);
});

test("between two ambles it stops and noses in the ground, looks about or sits, each for its while", () => {
  for (const [r, doing] of [[0.1, "forage"], [0.6, "look"], [0.9, "sit"]] as const) {
    const b = out(0, 24), home = { x: 0, z: 0, land: true };
    step(b, home, [], dt, () => r);
    expect(b.doing).toBe(doing);
    run(b, PAUSE[doing] - 0.5, () => home, undefined, []);
    expect([b.doing, b.speed, b.x, b.z]).toEqual([doing, 0, 0, 24]);
    for (let t = 0; t < 1; t += dt) step(b, home, [], dt, () => 0.9); // its next goal: a way off
    expect(b.doing).toBe("amble");
    expect(b.speed).toBeGreaterThan(0);
    // A beaver coming near ends it at once.
    const busy = out(0, 24);
    step(busy, home, [], dt, () => r);
    expect(kinds(run(busy, 1, () => ({ x: 0, z: 20, land: true }), undefined, []))).toEqual(["notices"]);
    expect(busy.doing).toBe("amble");
  }
});

test("ambling for its whole stay it keeps to its ground and off the trunks, then goes back into the forest", () => {
  const b = out(0, OUTER - 2);
  let n = 0;
  const rand = () => (n = (n * 9301 + 49297) % 233280) / 233280;
  for (let t = 0; t < STAY; t += dt) {
    step(b, { x: 0, z: 0, land: true }, trunks, dt, rand);
    expect(onGround(b.x, b.z), `at ${b.x.toFixed(1)}, ${b.z.toFixed(1)} after ${t.toFixed(0)} s`).toBe(true);
    for (const tr of trunks) expect(Math.hypot(tr.x - b.x, tr.z - b.z)).toBeGreaterThan(0.5);
  }
  expect(kinds(run(b, 30, () => ({ x: 0, z: 0, land: true })))).toEqual(["gone"]);
  expect(b.state).toBe("away");
  expect(Math.hypot(b.x, b.z)).toBeGreaterThan(DEN - 1.5);
  expect(step(b, { x: 0, z: 24, land: true }, trunks, dt, random)).toEqual([]);
});

test("a beaver on land on its ground within sight: it rears and growls, charges faster than a beaver runs, and swipes", () => {
  const b = out(0, 28), beaver = { x: 0, z: 20, land: true };
  expect(kinds(run(b, 1, () => beaver, (h) => h.kind === "notices"))).toEqual(["notices"]);
  expect(b.state).toBe("warn");
  expect(after(b)).toBe(true);
  expect(CHARGE).toBeGreaterThan(RUN_SPEED);
  const seen = run(b, 10, () => beaver, (h) => h.kind === "swipes", []);
  expect(seen).toEqual([{ kind: "swipes", hit: true }]);
  expect(Math.hypot(b.x - beaver.x, b.z - beaver.z)).toBeLessThanOrEqual(REAR_AT + 0.05);
  // Further off than it notices, in the water or in the safe ground, it lets the beaver be.
  for (const other of [{ x: 0, z: 28 - NOTICE - 1, land: true }, { x: 0, z: 22, land: false }, { x: 0, z: INNER - 1, land: true }]) {
    const calm = out(0, 28);
    expect(kinds(run(calm, 5, () => other))).toEqual([]);
  }
});

test("running out of reach while it rears dodges the Swipe", () => {
  const b = out(0, 24), beaver = { x: 0, z: 22.4, land: true };
  untilRears(b, beaver);
  const seen = run(b, REAR + 0.1, () => { beaver.z -= RUN_SPEED * dt; return beaver; }, (h) => h.kind === "swipes", []);
  expect(seen).toEqual([{ kind: "swipes", hit: false }]);
  expect(REAR_AT + RUN_SPEED * REAR).toBeGreaterThan(SWIPE_REACH);
});

test("it never follows into the safe ground: it stops at the edge of its own and gives up", () => {
  const b = out(0, INNER + 6), beaver = { x: 0, z: INNER + 0.5, land: true };
  run(b, 1.5, () => beaver, undefined, []);
  expect(b.state).toBe("charge");
  beaver.z = INNER - 3; // home
  expect(kinds(run(b, 3, () => beaver, undefined, []))).toEqual(["gaveUp"]);
  expect(b.state).toBe("roam");
  expect(b.z).toBeGreaterThanOrEqual(INNER);
});

test("three Swipes with no tail slap between, and it gives up and ignores the beaver for a while", () => {
  const b = out(0, 24), beaver = { x: 0, z: 22, land: true };
  const seen = kinds(run(b, 30, () => beaver, (h) => h.kind === "gaveUp", []));
  expect(seen).toEqual(["notices", ...Array(SWIPES).fill("swipes"), "gaveUp"]);
  expect(after(b)).toBe(false);
  expect(kinds(run(b, SULK - 1, () => ({ x: b.x, z: b.z - 3, land: true }), undefined, []))).toEqual([]);
  expect(kinds(run(b, 3, () => ({ x: b.x, z: b.z - 3, land: true }), undefined, []))).toContain("notices");
});

test("a tail slap lands only within reach: it takes health, breaks the Swipe it rears for, and the fifth drives it off", () => {
  const b = out(0, 24), beaver = { x: 0, z: 22.3, land: true };
  expect(slap(b, { x: 0, z: 24 - SLAP_REACH - 0.1 })).toBeUndefined();
  expect(b.health).toBe(HEALTH);
  untilRears(b, beaver);
  expect(slap(b, beaver)).toBe("hurt");
  expect(b.health).toBe(HEALTH - SLAP_DAMAGE);
  expect(b.state).toBe("flinch");
  expect(kinds(run(b, FLINCH - 0.05, () => beaver, undefined, []))).toEqual([]); // no Swipe: the slap broke it
  for (let i = 2; i < HEALTH / SLAP_DAMAGE; i++) expect(slap(b, beaver)).toBe("hurt");
  expect(slap(b, beaver)).toBe("drivenOff");
  expect(b.health).toBe(0);
  expect(after(b)).toBe(false);
  expect(slap(b, beaver)).toBeUndefined(); // running off, it takes no more
  // It runs all the way back into the far forest, faster than it charged, and is gone only there.
  const seen = run(b, 4, () => beaver, undefined, []);
  expect([seen, b.state, b.speed]).toEqual([[], "leave", RUN]);
  expect(Math.hypot(b.x, b.z)).toBeGreaterThan(OUTER + 5);
  expect(kinds(run(b, 10, () => beaver, undefined, []))).toEqual(["gone"]);
  expect(Math.hypot(b.x, b.z)).toBeGreaterThan(DEN - 1.5);
  // Out again another Day, it has all its health.
  arrive(b, 0, 28);
  expect(b.health).toBe(HEALTH);
  // Sent home with health left (its time is over), it lopes off and lets the beaver be.
  const home = out(0, 24);
  leave(home);
  expect(kinds(run(home, 20, () => beaver, undefined, []))).toEqual(["gone"]);
});

test("a beaver that slaps as soon as it can lands every slap before the Swipe it would break, and wins trading blows", () => {
  // The slap strikes SLAP_HIT of SLAP_TIME after the key; pressed as the bear comes into reach, that is before the Swipe.
  expect(SLAP_REACH).toBeGreaterThan(REAR_AT);
  expect(SLAP_HIT * SLAP_TIME).toBeLessThan(REAR);
  const b = out(-4, 24), beaver = { x: 0, z: 24, land: true };
  let wait = 0, strike = -1, swipes = 0, t = 0;
  for (; t < 120 && b.state !== "leave"; t += dt) {
    for (const h of step(b, beaver, [], dt, random)) if (h.kind === "swipes") { swipes++; if (h.hit) beaver.x += 2.5; } // tossed away from it, along its ground
    wait -= dt;
    if (strike < 0 && wait <= 0 && Math.hypot(b.x - beaver.x, b.z - beaver.z) <= SLAP_REACH) { strike = SLAP_HIT * SLAP_TIME; wait = SLAP_COOLDOWN; }
    if (strike >= 0 && (strike -= dt) < 0) slap(b, beaver);
  }
  expect(b.state).toBe("leave");
  expect(t).toBeLessThan(40);
  expect(swipes).toBeLessThan(HEALTH / SLAP_DAMAGE);
});
