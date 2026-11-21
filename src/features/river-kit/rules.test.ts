// The River kit's rules as a player meets them: it keeps up with the beaver, on land and swimming, and out of its
// way, goes round what it cannot cross, finds something to do when the beaver stands still, and sleeps when it stays.
import { expect, test } from "bun:test";
import { RUN_SPEED, WALK_SPEED } from "../../contracts.ts";
import { CLOSE, FAR, HURRY, IDLE, LAP, NEAR, newKit, PAUSE, RISE, RUN, step, TIRED, WALK, type Kit } from "./rules.ts";

const dt = 1 / 60, anywhere = (_x: number, _z: number) => true;
function run(k: Kit, seconds: number, beaver: () => { x: number; z: number; land: boolean }, free = anywhere, random = () => 0.5, night = false, afloat = false) {
  for (let t = 0; t < seconds; t += dt) step(k, beaver(), free, dt, random, night, afloat);
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

test("it swims after a beaver in the water, and afloat it only paddles: nothing of what it does on land", () => {
  const k = newKit(0, 0), swimmer = { x: 0, z: 8, land: false };
  run(k, 6, () => swimmer, anywhere, () => 0.9, false, true);
  expect(away(k, swimmer)).toBeLessThan(NEAR); // beside the swimming beaver
  expect(k.afloat).toBe(true);
  run(k, IDLE + PAUSE.sit + 30, () => swimmer, anywhere, () => 0.9, true, true); // for long, at night
  expect([k.doing, k.speed]).toEqual(["stand", 0]);
  run(k, IDLE + 0.5, () => swimmer, anywhere, () => 0.9); // on the bank again
  expect(k.doing).toBe("sit");
});

test("left standing it noses in the ground, looks about, sits up, grooms or sits, each for its while, and gets up and goes when the beaver goes", () => {
  for (const [r, doing] of [[0.1, "forage"], [0.5, "look"], [0.6, "up"], [0.8, "groom"], [0.9, "sit"]] as const) {
    const k = newKit(0, 0), beaver = { x: 0, z: 1, land: true };
    run(k, IDLE + 0.1, () => beaver, anywhere, () => r);
    expect(k.doing).toBe(doing);
    run(k, PAUSE[doing] - 0.5, () => beaver, anywhere, () => r);
    expect(k.doing).toBe(doing);
    run(k, 0.6, () => beaver, anywhere, () => r);
    expect(k.doing).toBe("stand");
    run(k, IDLE + 0.1, () => beaver, anywhere, () => r);
    beaver.z = 9;
    step(k, beaver, anywhere, dt, () => r);
    expect([k.doing, k.speed]).toEqual(["stand", RISE[doing] ? 0 : RUN]); // from low down it gets up first,
    run(k, (RISE[doing] ?? 0) + 2 * dt, () => beaver, anywhere, () => r);
    expect(k.speed).toBe(RUN); // then off
  }
});

test("beside a beaver that stays it lies down and falls asleep, sooner at night, and wakes and follows when the beaver goes", () => {
  for (const night of [false, true]) {
    const k = newKit(0, 0), beaver = { x: 0, z: 1, land: true }, tired = night ? TIRED.night : TIRED.day;
    run(k, tired, () => beaver, anywhere, () => 0.1, night);
    expect(["lie", "sleep"]).not.toContain(k.doing);
    run(k, PAUSE.forage + 2 * IDLE + 1, () => beaver, anywhere, () => 0.1, night); // done with what it was at
    expect(k.doing).toBe("lie");
    run(k, PAUSE.lie, () => beaver, anywhere, () => 0.1, night);
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
