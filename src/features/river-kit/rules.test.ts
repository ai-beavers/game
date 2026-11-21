// The River kit's rules as a player meets them: it keeps up with the beaver, never goes into the water, and finds
// something to do when the beaver stands still.
import { expect, test } from "bun:test";
import { RUN_SPEED, WALK_SPEED } from "../../contracts.ts";
import { FAR, HURRY, IDLE, NEAR, newKit, PAUSE, RUN, step, WALK, type Kit } from "./rules.ts";

const dt = 1 / 60, anywhere = () => true;
function run(k: Kit, seconds: number, beaver: () => { x: number; z: number; land: boolean }, free = anywhere, random = () => 0.5) {
  for (let t = 0; t < seconds; t += dt) step(k, beaver(), free, dt, random);
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

test("it never goes into the water: it goes round a pond to a beaver beyond it, and waits on the bank for one that swims", () => {
  const dry = (x: number, z: number) => Math.hypot(x, z - 10) > 4; // a pond 4 m wide in its way
  const k = newKit(0, 0), beyond = { x: 0, z: 20, land: true };
  for (let t = 0; t < 30; t += dt) { step(k, beyond, dry, dt, () => 0.5); expect(dry(k.x, k.z)).toBe(true); }
  expect(away(k, beyond)).toBeLessThan(NEAR);
  const swimmer = { x: 0, z: 10, land: false };
  for (let t = 0; t < 20; t += dt) { step(k, swimmer, dry, dt, () => 0.5); expect(dry(k.x, k.z)).toBe(true); }
  expect(away(k, swimmer)).toBeLessThan(4.6); // at the water's edge
  expect([k.speed, k.doing]).toEqual([0, "sit"]); // and there it sits and waits
  expect(Math.abs(Math.atan2(Math.sin(k.heading - Math.atan2(swimmer.x - k.x, swimmer.z - k.z)), 1))).toBeLessThan(0.1); // looking after it
});

test("left standing it noses in the ground, looks about or sits, each for its while, and is up at once when the beaver goes", () => {
  for (const [r, doing] of [[0.1, "forage"], [0.6, "look"], [0.9, "sit"]] as const) {
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
    expect([k.doing, k.speed]).toEqual(["stand", RUN]);
  }
});
