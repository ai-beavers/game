// The River kit's rules as a player meets them: it keeps up with the beaver, on land and swimming, and out of its
// way, goes round what it cannot cross, finds something to do when the beaver stands still, and sleeps when it stays
// (at every stop by night), squeaking in its sleep;
// it calls when it is left behind and when it has caught up, shakes itself dry after a swim, yawns as it wakes, and
// looks up at the beaver.
import { expect, test } from "bun:test";
import { RUN_SPEED, WALK_SPEED } from "../../contracts.ts";
import { CALM, CLOSE, DOZE, LIKES, REACH, FAR, GAZE, gazeAt, HURRY, IDLE, LAP, look, NEAR, newKit, PAUSE, QUIET, RISE, RUN, SHAKE, step, STIRS, TIRED, WALK, type Kit } from "./rules.ts";

const dt = 1 / 60, anywhere = (_x: number, _z: number) => true;
function run(k: Kit, seconds: number, beaver: () => { x: number; z: number; land: boolean }, free = anywhere, random = () => 0.5, night = false, afloat = false, deep?: number) {
  for (let t = 0; t < seconds; t += dt) step(k, beaver(), free, dt, random, night, afloat, deep);
}
const away = (k: Kit, b: { x: number; z: number }) => Math.hypot(k.x - b.x, k.z - b.z);

test("it stays where it is while the beaver is close, sets off when it is far and stops beside it", () => {
  const k = newKit(0, 0), beaver = { x: 0, z: FAR - 0.2, land: true };
  run(k, 2, () => beaver);
  expect([k.x, k.z, k.speed]).toEqual([0, 0, 0]);
  beaver.z = 8;
  step(k, beaver, anywhere, dt, () => 0.5);
  expect(k.speed).toBe(RUN); // further than HURRY: it runs
  run(k, 6, () => beaver);
  expect(away(k, beaver)).toBeLessThan(NEAR);
  expect(away(k, beaver)).toBeGreaterThan(NEAR - 0.1); // beside it, not on it
  expect(k.speed).toBe(0);
});

test("it keeps up with a beaver that walks, and with one that runs", () => {
  expect(WALK).toBeGreaterThan(WALK_SPEED);
  expect(RUN).toBeGreaterThan(RUN_SPEED);
  for (const pace of [WALK_SPEED, RUN_SPEED]) {
    const k = newKit(0, 0), beaver = { x: 0, z: 1, land: true };
    let furthest = 0;
    for (let t = 0; t < 30; t += dt) { beaver.z += pace * dt; step(k, beaver, anywhere, dt, () => 0.5); furthest = Math.max(furthest, away(k, beaver)); }
    expect(furthest).toBeLessThan(HURRY + 0.5);
  }
});

test("it goes round what it cannot cross: a rock 8 m wide in its way to a beaver beyond it", () => {
  const clear = (x: number, z: number) => Math.hypot(x, z - 10) > 4;
  const k = newKit(0, 0), beyond = { x: 0, z: 20, land: true };
  for (let t = 0; t < 30; t += dt) { step(k, beyond, clear, dt, () => 0.5); expect(clear(k.x, k.z)).toBe(true); }
  expect(away(k, beyond)).toBeLessThan(NEAR);
});

test("left standing again and again, it does one thing after another, never the same twice running, and all of them in time", () => {
  let seed = 3;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const k = newKit(0, 0), beaver = { x: 0, z: 1, land: true }, done: string[] = [];
  for (let frame = 0; frame < 200 / dt; frame++) {
    const was = k.doing;
    if (frame % Math.round(15 / dt) === 0) beaver.x = beaver.x ? 0 : 5; // every 15 s the beaver moves on a little: the kit never tires
    step(k, beaver, anywhere, dt, random);
    if (k.doing !== was && k.doing !== "stand" && k.doing !== "lie" && k.doing !== "sleep") done.push(k.doing);
  }
  expect(new Set(done)).toEqual(new Set(Object.keys(LIKES)));
  done.forEach((d, i) => { if (i) expect(d).not.toBe(done[i - 1]); });
});

test("with a thing right before it, a trunk or a rock, it stands up and leans its fore paws on it, or pats it", () => {
  const seen = new Set<string>();
  for (const r of [0.1, 0.3, 0.7, 0.9]) {
    const k = newKit(0, 0), beaver = { x: 1, z: 0, land: true }, trunk = (x: number, z: number) => Math.hypot(x, z - REACH) > 0.15;
    run(k, IDLE + 0.1, () => beaver, trunk, () => r);
    seen.add(k.doing);
  }
  expect(seen.has("lean") && seen.has("touch")).toBe(true);
  // Up tall on its feet, it looks up at the beaver as it does standing.
  expect(gazeAt({ ...newKit(0, 0), doing: "tall" }, { x: 1, z: 1 }).yaw).not.toBe(0);
});

test("it swims after a beaver in the water, and afloat it only paddles: nothing of what it does on land", () => {
  const k = newKit(0, 0), swimmer = { x: 0, z: 8, land: false };
  run(k, 6, () => swimmer, anywhere, () => 0.9, false, true);
  expect(away(k, swimmer)).toBeLessThan(NEAR); // beside the swimming beaver
  expect(k.afloat).toBe(true);
  run(k, IDLE + PAUSE.sit + 30, () => swimmer, anywhere, () => 0.9, true, true); // for long, at night
  expect([k.doing, k.speed]).toEqual(["stand", 0]);
  run(k, IDLE + 0.5, () => swimmer, anywhere, () => 0.9); // on the bank again
  expect(k.doing).not.toBe("stand"); // at something of its own on land
  // The beaver out on the bank, two metres off: on land the kit would stay where it is, afloat it comes out to it.
  const out = { x: 0, z: k.z + 2, land: true }, wet = newKit(k.x, k.z);
  run(wet, 3, () => out, anywhere, () => 0.9, false, true);
  expect(away(wet, out)).toBeLessThan(NEAR);
});

test("left standing it noses in the ground, looks about, sits up, stands up tall, grooms, pats the ground or sits, each for its while, and gets up and goes when the beaver goes", () => {
  for (const doing of Object.keys(LIKES) as (keyof typeof LIKES)[]) {
    const k = newKit(0, 0), beaver = { x: 0, z: 1, land: true }, r = 0.5;
    k.since[doing] = 1000; // what it has not done for longest
    run(k, IDLE + 0.1, () => beaver, anywhere, () => r);
    expect(k.doing).toBe(doing);
    run(k, PAUSE[doing] - 0.5, () => beaver, anywhere, () => r);
    expect(k.doing).toBe(doing);
    run(k, 0.6, () => beaver, anywhere, () => r);
    expect(k.doing).toBe("stand");
    k.since[doing] = 1000; // at it again
    run(k, IDLE + 0.1, () => beaver, anywhere, () => r);
    beaver.z = 9;
    step(k, beaver, anywhere, dt, () => r);
    expect([k.doing, k.speed]).toEqual(["stand", RISE[doing] ? 0 : RUN]); // from low down it gets up first,
    run(k, (RISE[doing] ?? 0) + 2 * dt, () => beaver, anywhere, () => r);
    expect(k.speed).toBe(RUN); // then off
  }
});

test("beside a beaver that stays it lies down and falls asleep, at every stop at night, and wakes and follows when the beaver goes", () => {
  for (const night of [false, true]) {
    const k = newKit(0, 0), beaver = { x: 0, z: 1, land: true };
    if (night) {
      // It dozes at every stop: down as soon as it is done standing, asleep DOZE s later.
      run(k, IDLE + 0.1, () => beaver, anywhere, () => 0.1, night);
      expect(k.doing).toBe("lie");
      run(k, DOZE, () => beaver, anywhere, () => 0.1, night);
    } else {
      run(k, TIRED.day, () => beaver, anywhere, () => 0.1, night);
      expect(["lie", "sleep"]).not.toContain(k.doing);
      // Done with what it was at, it lies down, and after PAUSE.lie falls asleep.
      let down = 0;
      for (; k.doing !== "lie" && down < Math.max(...Object.values(PAUSE)) + 2 * IDLE; down += dt) step(k, beaver, anywhere, dt, () => 0.1, night);
      expect(k.doing).toBe("lie");
      run(k, PAUSE.lie - 0.1, () => beaver, anywhere, () => 0.1, night);
      expect(k.doing).toBe("lie");
      run(k, 0.2, () => beaver, anywhere, () => 0.1, night);
    }
    expect(k.doing).toBe("sleep");
    run(k, 120, () => beaver, anywhere, () => 0.1, night);
    expect(k.doing).toBe("sleep"); // for as long as the beaver stays
    beaver.z = FAR + 1;
    run(k, RISE.sleep! - 0.2, () => beaver, anywhere, () => 0.1, night);
    expect([k.doing, k.z]).toEqual(["stand", 0]); // getting up
    run(k, 4, () => beaver, anywhere, () => 0.1, night);
    expect(away(k, beaver)).toBeLessThan(NEAR);
  }
});

test("waiting for a beaver it cannot follow, it sits by day and dozes off at night", () => {
  for (const night of [false, true]) {
    const k = newKit(0, 0), beaver = { x: 0, z: 6, land: true }, shut = () => false;
    run(k, IDLE + DOZE + 1, () => beaver, shut, () => 0.1, night);
    expect([k.following, k.doing]).toEqual([true, night ? "sleep" : "sit"]);
  }
});

test("asleep, it stirs now and then as a seal pup does, each stir in its own time, and squeaks softly, never awake", () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // a varied sleep
  const k = newKit(0, 0), beaver = { x: 0, z: 1, land: true };
  run(k, IDLE + 0.1 + DOZE, () => beaver, anywhere, random, true);
  expect([k.doing, k.stir]).toEqual(["sleep", ""]);
  const stirs: { stir: string; from: number; to: number }[] = [], squeaks: string[] = [], asleep = k.time;
  for (let t = 0; t < 120; t += dt) {
    const was = k.stir;
    step(k, beaver, anywhere, dt, random, true);
    if (k.stir && k.stir !== was) stirs.push({ stir: k.stir, from: t, to: t });
    if (k.stir) stirs.at(-1)!.to = t;
    if (k.call) { expect(k.call).toBe("doze"); squeaks.push(k.stir); }
    expect(k.doing).toBe("sleep");
  }
  // The first, once it has rolled over, is the rub, with a squeak; after it all four come, in no fixed order.
  expect(stirs[0]!.stir).toBe("rub");
  expect(asleep + stirs[0]!.from).toBeCloseTo(CALM.first, 1);
  expect(new Set(stirs.map((s) => s.stir))).toEqual(new Set(Object.keys(STIRS)));
  for (const [i, s] of stirs.entries()) {
    if (i < stirs.length - 1) expect(s.to - s.from).toBeCloseTo(STIRS[s.stir as keyof typeof STIRS], 1);
    const gap = i ? s.from - stirs[i - 1]!.to : asleep + s.from;
    expect(gap).toBeGreaterThan(CALM.least - 0.05);
    expect(gap).toBeLessThan(CALM.most + 0.05);
  }
  expect(squeaks[0]).toBe("rub");
  expect(squeaks.every((s) => s === "rub" || s === "peep")).toBe(true);
  expect(squeaks.filter((s) => s === "peep").length).toBe(stirs.filter((s) => s.stir === "peep").length);
  // Awake and about, it never stirs nor squeaks in its sleep.
  beaver.z = 8;
  run(k, RISE.sleep! + 0.1, () => beaver, anywhere, random, false);
  for (let t = 0; t < 30; t += dt) { step(k, beaver, anywhere, dt, random, false); expect([k.stir, k.call === "doze"]).toEqual(["", false]); }
});

test("out of a dead end it finds the way round: a house with its back to the beaver, a tree, and a beaver that walks on meanwhile", () => {
  // Walls 0.4 m thick: a back wall across z = 5 and two side walls from there to z = 1, open to the south.
  const house = (x: number, z: number) => !((Math.abs(x) < 3 && z > 4.6 && z < 5) || (Math.abs(x) > 2.6 && Math.abs(x) < 3 && z > 1 && z < 5));
  const k = newKit(0, 3), beaver = { x: 0, z: 10, land: true }; // the kit inside, the beaver behind the back wall
  for (let t = 0; t < 40 && away(k, beaver) >= NEAR; t += dt) { step(k, beaver, house, dt, () => 0.5); expect(house(k.x, k.z)).toBe(true); }
  expect(away(k, beaver)).toBeLessThan(NEAR);
  const tree = (x: number, z: number) => Math.hypot(x, z - 3) > 0.45, k2 = newKit(0, 0), walker = { x: 0, z: 6, land: true };
  let furthest = 0;
  for (let t = 0; t < 30; t += dt) { walker.z += WALK_SPEED * dt; step(k2, walker, tree, dt, () => 0.5); furthest = Math.max(furthest, away(k2, walker)); }
  expect(furthest).toBeLessThan(8); // it did not stay circling the tree
  expect(away(k2, walker)).toBeLessThan(HURRY + 0.5);
});

test("a beaver where it cannot follow it stops circling, sits and waits, and comes when the beaver is out again", () => {
  const fenced = (x: number, z: number) => { const d = Math.hypot(x, z - 10); return d < 1.5 || d > 2; }; // a fence round the beaver
  const k = newKit(0, 0), beaver = { x: 0, z: 10, land: true };
  run(k, 8 + LAP + IDLE + 1, () => beaver, fenced);
  expect([k.speed, k.doing]).toEqual([0, "sit"]);
  const waited = { x: k.x, z: k.z };
  run(k, 20, () => beaver, fenced);
  expect([k.x, k.z]).toEqual([waited.x, waited.z]);
  beaver.x = 6; // out, over the fence
  run(k, 10, () => beaver, fenced);
  expect(away(k, beaver)).toBeLessThan(NEAR);
});

test("it steps out of the way of a beaver that walks up to it, on land only", () => {
  const k = newKit(0, 0), beaver = { x: 0, z: CLOSE - 0.3, land: true };
  run(k, 2, () => beaver);
  expect(away(k, beaver)).toBeGreaterThanOrEqual(CLOSE);
  expect(away(k, beaver)).toBeLessThan(CLOSE + 0.1); // no further than it must
  expect(k.z).toBeLessThan(0); // away from the beaver
  const other = newKit(0, 0);
  run(other, 2, () => ({ ...beaver, land: false }));
  expect([other.x, other.z]).toEqual([0, 0]);
});

test("left behind it calls once as it starts to run, chirps once when it has caught up, and never chatters", () => {
  const k = newKit(0, 0), beaver = { x: 0, z: 1, land: true }, heard: string[] = [];
  const hear = (seconds: number) => { for (let t = 0; t < seconds; t += dt) { step(k, beaver, anywhere, dt, () => 0.5); if (k.call) heard.push(k.call); } };
  hear(1);
  beaver.z = FAR + 0.5; // a few steps off: it walks, and says nothing
  hear(4);
  expect([heard, away(k, beaver) < NEAR]).toEqual([[], true]);
  beaver.z += HURRY + 3; // left behind
  step(k, beaver, anywhere, dt, () => 0.5);
  expect([k.speed, k.call]).toEqual([RUN, "left"]);
  hear(5);
  expect(heard).toEqual(["caught"]); // on the way no more calls, beside the beaver the chirp
  expect(away(k, beaver)).toBeLessThan(NEAR);
  // A beaver that dashes off again and again: no call of a kind within QUIET s of the last.
  heard.length = 0;
  for (let i = 0; i < 4; i++) { beaver.z += HURRY + 1; hear(QUIET / 4); }
  expect(heard.filter((c) => c === "left").length).toBeLessThanOrEqual(1);
  expect(heard.filter((c) => c === "caught").length).toBeLessThanOrEqual(1);
  hear(QUIET);
  beaver.z += HURRY + 1;
  hear(4);
  expect(heard.slice(-2)).toEqual(["left", "caught"]); // after a quiet while it calls again
});

test("once after a swim, a moment after it has dry ground under it, it shakes itself much drier, and never in the water", () => {
  const k = newKit(0, 0), beaver = { x: 0, z: 1, land: false };
  run(k, 3, () => beaver, anywhere, () => 0.5, false, true); // swimming beside the beaver
  expect([k.wet, k.shaking]).toEqual([1, 0]);
  run(k, 3, () => beaver, anywhere, () => 0.5, false, false, 0.5); // wading in the shallows: still in the water
  expect([k.wet > 0.5, k.shaking]).toEqual([true, 0]);
  beaver.land = true;
  run(k, SHAKE.after - 0.1, () => beaver); // out on the bank
  expect(k.shaking).toBe(0);
  run(k, 0.2, () => beaver);
  expect(k.shaking).toBeGreaterThan(0);
  // The beaver runs off meanwhile: the kit shakes to the end where it stands, then catches up.
  beaver.z = 8;
  const wet = k.wet;
  run(k, SHAKE.lasts - 0.2, () => beaver);
  expect([k.z, k.shaking > 0]).toEqual([0, true]);
  run(k, 0.3, () => beaver);
  expect(k.shaking).toBeLessThanOrEqual(0);
  expect(k.wet).toBeLessThan(wet / 2); // in a second, what dripping alone takes most of DRY for
  run(k, 5, () => beaver);
  expect([away(k, beaver) < NEAR, k.shaking > 0]).toEqual([true, false]); // beside it again, and no second shake
  // A kit that never swam, only waded, does not shake.
  const wader = newKit(0, 0);
  run(wader, 2, () => beaver, anywhere, () => 0.5, false, false, 0.5);
  run(wader, 2, () => beaver);
  expect(wader.shaking).toBe(0);
});

test("it yawns and stretches as it gets up from its sleep, and from nothing else", () => {
  const k = newKit(0, 0), beaver = { x: 0, z: 1, land: true };
  k.since.sit = 1000;
  run(k, IDLE + 0.1, () => beaver, anywhere, () => 0.9); // sat down
  beaver.z = FAR + 1;
  run(k, 0.2, () => beaver);
  expect([k.rising > 0, k.waking]).toEqual([true, false]); // getting up from sitting: no yawn
  run(k, TIRED.day + PAUSE.lie + PAUSE.sit + 3 * IDLE, () => beaver, anywhere, () => 0.9);
  expect(k.doing).toBe("sleep");
  beaver.z += FAR + 1;
  run(k, 0.2, () => beaver);
  expect([k.doing, k.waking, k.rising]).toEqual(["stand", true, expect.closeTo(RISE.sleep! - 0.2, 1)]);
});

test("standing or sitting it looks up at the beaver, no further round than its neck turns, and busy its head is its own", () => {
  const k = newKit(0, 0);
  expect(gazeAt(k, { x: 0, z: 2 }).yaw).toBeCloseTo(0); // straight ahead
  expect(gazeAt(k, { x: 2, z: 2 }).yaw).toBeCloseTo(Math.PI / 4); // to its left (+x, facing +z)
  expect(gazeAt(k, { x: -2, z: 2 }).yaw).toBeCloseTo(-Math.PI / 4);
  expect(gazeAt(k, { x: 1, z: -2 }).yaw).toBe(GAZE.yaw); // behind it: as far round as it can
  k.heading = Math.PI / 2; // facing +x
  expect(gazeAt(k, { x: 2, z: 0 }).yaw).toBeCloseTo(0);
  // Up at a face GAZE.above m over its own: more the nearer the beaver stands, never more than GAZE.pitch.
  expect(gazeAt(k, { x: 2, z: 0 }).pitch).toBeCloseTo(Math.atan2(GAZE.above, 2));
  expect(gazeAt(k, { x: 0.3, z: 0 }).pitch).toBe(GAZE.pitch);
  for (const busy of [{ doing: "forage" }, { doing: "groom" }, { doing: "lie" }, { doing: "sleep" }, { speed: 1 }, { afloat: true }, { rising: 0.3 }, { shaking: 0.3 }] as Partial<Kit>[]) {
    expect(gazeAt({ ...k, ...busy }, { x: 2, z: 2 }), JSON.stringify(busy)).toEqual({ yaw: 0, pitch: 0 });
  }
  expect(gazeAt({ ...k, doing: "sit" }, { x: 2, z: 2 }).yaw).not.toBe(0);
  // Its head follows eased: part of the way in a tenth of a second, all but there in a second, and back as slowly.
  const beaver = { x: 2, z: 2 }, to = gazeAt(k, beaver);
  for (let t = 0; t < 0.1; t += dt) look(k, beaver, dt);
  expect(k.gaze.yaw / to.yaw).toBeGreaterThan(0.2);
  expect(k.gaze.yaw / to.yaw).toBeLessThan(0.6);
  for (let t = 0; t < 1; t += dt) look(k, beaver, dt);
  expect(k.gaze.yaw).toBeCloseTo(to.yaw, 1);
  expect(k.gaze.pitch).toBeCloseTo(to.pitch, 1);
  k.doing = "forage";
  for (let t = 0; t < 0.1; t += dt) look(k, beaver, dt);
  expect(k.gaze.yaw / to.yaw).toBeGreaterThan(0.4);
  for (let t = 0; t < 1; t += dt) look(k, beaver, dt);
  expect(k.gaze.yaw).toBeCloseTo(0, 1);
});
