// Walking, running, jumping and the Double jump round the clearing, over a log in the way, and a run out to its far meadow.
import { placeAll } from "../../../world/place.ts";
import { JUMP_HEIGHT, WALL_SOLID } from "../../../player/index.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

export const movement = (kit: Kit): Station[] => {
  const { player, world, walkTo, expect, after, since, tap, wait, until, press } = kit;
  return [
    ["Walk", async () => {
      const steps = after("footstep");
      await walkTo(world.spawn.x + 1, world.spawn.z + 3);
      expect(steps(), "walked without a footstep");
    }, "Around the clearing"],
    ["Run", async () => {
      await kit.rest();
      let top = 0;
      const fast = () => { top = Math.max(top, player.motion.speed); return false; };
      await walkTo(world.spawn.x + 4, world.spawn.z + 1, { run: 1, arrived: fast });
      expect(top > 1.5, `top speed ${top.toFixed(2)} m/s, not running`);
    }, "Around the clearing"],
    ["Jump", async () => {
      const jumped = after("jump"), landed = after("land");
      for (let i = 0; i < 3; i++) { await tap("jump", 0.3); await wait(0.7); }
      expect(jumped() && landed(), "no jump, or no landing");
    }, "Around the clearing"],
    // A jump, and at its top Space again: the Double jump takes the feet higher than one jump, but never as high as
    // the shop's walls keep it out.
    ["Double jump", async () => {
      await wait(0.5); // settled on the ground
      const ground = player.feet.y, jumps = since("jump"), landed = after("land");
      let top = 0;
      const stop = kit.everyStep(() => { top = Math.max(top, player.feet.y - ground); });
      const hold = async (seconds: number) => {
        kit.want.jump = true;
        try { await wait(seconds); } finally { kit.want.jump = false; }
        await kit.frame(); // let go for a step: the next press is a fresh one
      };
      try {
        await hold(0.3); // held: the full jump
        await until(() => player.motion.vertical <= 0.3 || player.motion.grounded, 2, "jumped, never came near the top");
        expect(!player.motion.grounded && !landed(), "landed before the second press");
        await hold(0.3);
        await until(() => player.motion.grounded, 3, () => `still in the air 3 s after the Double jump, the feet ${(player.feet.y - ground).toFixed(2)} m up`);
      } finally { stop(); }
      expect(jumps() === 2, `${jumps()} jump events, not 2 (a jump and a Double jump)`);
      expect(landed(), "no landing after the two jumps");
      expect(top > JUMP_HEIGHT + 0.05, `the feet went up only ${top.toFixed(2)} m, not over one jump's ${JUMP_HEIGHT} m`);
      expect(top < WALL_SOLID, `the feet went up ${top.toFixed(2)} m, over the shop's walls' ${WALL_SOLID} m`);
    }, "Around the clearing"],
    // The camera follows the beaver, the mouse looks round: a look holds while the beaver stands, and walking on (W
    // and D, half away from the camera) the camera swings round behind it again.
    ["Camera follows", async () => {
      if (player.camera.view === "first-person") skip("the first-person view looks where the player looks");
      await walkTo(world.spawn.x + 1, world.spawn.z + 3);
      player.camera.turn(0.8, 0);
      const looked = player.camera.yaw;
      await wait(1.5);
      expect(player.camera.yaw === looked, "looked round with the beaver standing, the camera did not hold that look");
      press("KeyW", "keydown"); press("KeyD", "keydown");
      try { await wait(2.5); } finally { press("KeyW", "keyup"); press("KeyD", "keyup"); }
      const swung = Math.abs(Math.atan2(Math.sin(player.camera.yaw - looked), Math.cos(player.camera.yaw - looked)));
      expect(swung > 0.4, `walked half away from the camera for 2.5 s, it swung only ${swung.toFixed(2)} rad round behind`);
    }, undefined, false],
    ["Jump over a log", async () => {
      // The meadow log nearest the spawn (about 0.3 m high, under a jump's 0.6 m), crossed square to its length: its
      // template lies along z, turned about y. Up to it from the spawn's side, then straight over to as far past it.
      // shortcut: the world does not tell where its meadow logs lie; same layout as createWorld uses. Upgrade when World
      // in contracts.ts names them.
      const log = placeAll().log.reduce((a, b) => Math.hypot(a.x - world.spawn.x, a.z - world.spawn.z) < Math.hypot(b.x - world.spawn.x, b.z - world.spawn.z) ? a : b);
      let ax = Math.cos(log.turn), az = -Math.sin(log.turn);
      if (ax * (world.spawn.x - log.x) + az * (world.spawn.z - log.z) > 0) { ax = -ax; az = -az; } // from the spawn's side
      const OFF = 1.3; // m from the log's middle line, both sides
      await walkTo(log.x - ax * OFF, log.z - az * OFF, { near: 0.2, hop: true });
      const jumped = after("jump"), landed = after("land");
      let wide = 0; // how far off the straight line over the log it got: going round the log goes wide
      const off = () => { wide = Math.max(wide, Math.abs(-az * (player.feet.x - log.x) + ax * (player.feet.z - log.z))); return false; };
      await walkTo(log.x + ax * OFF, log.z + az * OFF, { near: 0.3, arrived: off, limit: 12 });
      const past = ax * (player.feet.x - log.x) + az * (player.feet.z - log.z);
      expect(jumped() && landed(), "walked into the log and never jumped, or never landed");
      expect(past > 0.8, `only ${past.toFixed(2)} m past the log's middle`);
      expect(wide < 0.6, `went ${wide.toFixed(2)} m off the line over the log: round it, not over`);
    }, "Around the clearing"],
    ["Walk to the bank", async () => {
      // Due south, away from where the sun sets: 28 m out, where the first clearing's bank stood 4 m high.
      const x = 0, z = -28;
      await walkTo(x, z, { run: 1, near: 1, limit: 60 });
      const out = Math.hypot(player.feet.x, player.feet.z), high = world.heightAt(player.feet.x, player.feet.z);
      expect(out > 26.5, `only ${out.toFixed(1)} m from the middle`);
      expect(high < 1, `the ground ${out.toFixed(1)} m out is ${high.toFixed(2)} m high, not low meadow`);
    }, "Around the clearing"],
  ];
};
