// Sky watch: a day passing, the same hour for all in a shared world, the lantern at night, from the backpack and flashed, deer at dusk, rain and fog.
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { deerHours, type Deer } from "../../life/brain.ts";
import { packMotion } from "../../net/protocol.ts";
import { dayAt } from "../../sky/clock.ts";
import { hourAt } from "../../sky/day.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

export const skyWatch = (kit: Kit): Station[] => {
  const { player, world, stage, beaver, live, fast, wait, until, walkTo, flat, expect, sky, hudText, key } = kit;
  return [
    ["A day passes", async () => {
      const s = sky(), hour = s.hour, running = s.running;
      s.running = false;
      try {
        for (const h of [19.3, 20.5, 23, 5.6]) { s.setHour(h); await wait(3.5); if (h === 23) expect(s.dark > 0.5, `dark ${s.dark.toFixed(2)} at 23:00`); }
      } finally { s.setHour(hour); s.running = running; }
    }, "Sky watch"],
    // A viewer's wish: in a shared world everyone sees the same hour. src/features/net makes the sky follow the server's
    // hour on welcome and lets it go alone when the connection drops; the tour plays alone, so it does the same here.
    // It sets the clock, so the live tour skips it.
    ["Same hour for all", async () => {
      if (live) return skip("the live tour never sets the clock");
      const s = sky(), { scene } = stage, hour = s.hour, running = s.running;
      try {
        s.setWeather("fair");
        s.follow(23); // a welcome from a world deep in the night
        expect(Math.abs(s.hour - 23) < 0.01, `told 23:00, the sky shows ${s.hour.toFixed(2)} h`);
        await until(() => s.dark > 0.5, 3, `joined at 23:00, still not dark (${s.dark.toFixed(2)})`);
        await until(() => hudText("weather").startsWith("23:"), 3, `joined at 23:00, the HUD reads "${hudText("weather")}"`);
        await until(() => !!scene.getMeshByName("lantern")?.isEnabled(), 6, "joined at night, the beaver takes out no lantern");
        // The shared day runs on real time: the fast tour's 4x world must not move it on faster.
        const from = s.hour, at = performance.now();
        let played = 0;
        while (performance.now() - at < 3000) played += await kit.frame();
        const real = performance.now() - at, shared = hourAt(from, at, performance.now());
        const off = Math.abs(((s.hour - shared + 36) % 24) - 12); // h; at 4x the 3 s would put it 0.3 h ahead
        expect(off < 0.01, `after ${(real / 1000).toFixed(1)} s the sky is at ${s.hour.toFixed(3)} h, the shared day at ${shared.toFixed(3)} h`);
        if (fast) expect(played > real / 1000 * 2, `the world played only ${played.toFixed(1)} s in ${(real / 1000).toFixed(1)} s: not fast`);
        // The connection drops: the own day runs on from the shared hour, in steps of play.
        s.alone();
        const left = s.hour;
        expect(Math.abs(left - shared) < 0.01, `alone again, the sky jumped from ${shared.toFixed(2)} h to ${left.toFixed(2)} h`);
        await wait(3);
        expect(s.hour > left, `alone again, the hour stands at ${s.hour.toFixed(3)} h`);
        expect(s.dark > 0.5, `alone again, it is day at ${s.hour.toFixed(2)} h`);
      } finally { s.setHour(hour); s.running = running; s.setWeather("auto"); }
    }, "Sky watch"],
    // A viewer's wish: at night the beaver carries a lantern in its left hand that lights the ground around it
    // (src/features/lantern), the right hand free for sticks; by day it is out. Live it plays only at night and never sets the clock.
    ["Lantern at night", async () => {
      const s = sky(), { scene } = stage, light = () => scene.getLightByName("lantern-light") ?? skip("no lantern");
      if (live && s.dark <= 0.5) return skip(`not dark enough for the lantern at ${s.hour.toFixed(1)} h`);
      const hour = s.hour, running = s.running;
      try {
        if (!live) { s.running = false; s.setWeather("fair"); s.setHour(23); }
        await walkTo(world.spawn.x + 2.5, world.spawn.z + 2);
        // On low quality the light is off and the glass glows alone.
        if (light().isEnabled()) await until(() => light().intensity > 0, 3, `no light from the lantern at ${s.hour.toFixed(1)} h`);
        const lantern = scene.getMeshByName("lantern");
        expect(!!lantern?.isEnabled(), "the beaver carries no lantern at night");
        // In the left paw, wherever the walk left it: near the left hand, across the beaver from the stick hand.
        const at = lantern!.getAbsolutePosition(), off = Vector3.Distance(at, beaver.leftHand.getAbsolutePosition());
        expect(off < 0.15, `the lantern hangs ${off.toFixed(2)} m from the beaver's left hand, not in it`);
        const centre = beaver.root.getAbsolutePosition();
        const side = Vector3.TransformNormal(Vector3.Right(), beaver.root.getWorldMatrix()).normalize();
        const across = (p: Vector3) => Vector3.Dot(p.subtract(centre), side);
        const left = across(at), right = across(beaver.hand.getAbsolutePosition());
        expect(left * right < 0, `the lantern (${left.toFixed(2)} m sideways) is on the stick hand's side (${right.toFixed(2)} m)`);
        if (live) return;
        s.setHour(13);
        await until(() => light().intensity === 0, 3, `the lantern still shines at noon (${light().intensity.toFixed(2)})`);
      } finally {
        if (!live) { s.setHour(hour); s.running = running; s.setWeather("auto"); }
      }
    }, "Sky watch"],
    // A viewer's wish: by day the lantern rides in the backpack, the left paw empty; at dusk the beaver reaches over its
    // left shoulder, takes it out and brings it down to hang in the paw; at dawn it puts it back the same way
    // (src/features/lantern). It sets the clock, so the live tour skips it.
    ["Lantern from the backpack", async () => {
      if (live) return skip("the live tour never sets the clock");
      const s = sky(), { scene } = stage, motion = player.motion;
      const mesh = (name: string) => scene.getMeshByName(name) ?? skip(`no ${name}`);
      const drawn = (name: string) => mesh(name).isEnabled();
      const hour = s.hour, running = s.running;
      /** Waits until the left paw is at the backpack (Motion.reachBack past 0.8), then until it is back down. */
      const reachesBack = async (when: string) => {
        await until(() => (motion.reachBack ?? 0) > 0.8, 3, `the left paw never reached the backpack ${when}`);
        await until(() => (motion.reachBack ?? 0) === 0, 3, `the left paw stayed at the backpack ${when}`);
      };
      try {
        s.running = false; s.setWeather("fair"); s.setHour(13);
        await walkTo(world.spawn.x + 2.5, world.spawn.z + 2);
        await until(() => !drawn("lantern"), 3, "the beaver carries its lantern at noon");
        expect(drawn("backpack"), "the beaver wears no backpack");
        s.setHour(23);
        await reachesBack("at nightfall");
        expect(drawn("lantern"), "the beaver reached into its backpack at night but brought no lantern");
        const off = Vector3.Distance(mesh("lantern").getAbsolutePosition(), beaver.leftHand.getAbsolutePosition());
        expect(off < 0.15, `the lantern came out but hangs ${off.toFixed(2)} m from the beaver's left hand, not in it`);
        const light = scene.getLightByName("lantern-light") ?? skip("no lantern light");
        // On low quality the light is off and the glass glows alone.
        if (light.isEnabled()) await until(() => light.intensity > 0, 3, "the lantern is out but gives no light");
        await wait(1); // a look at it lit
        s.setHour(13);
        await reachesBack("at daybreak");
        expect(!drawn("lantern"), "the beaver reached back at daybreak but still holds its lantern");
        expect(drawn("backpack"), "the backpack went with the lantern");
      } finally {
        s.setHour(hour); s.running = running; s.setWeather("auto");
      }
    }, "Sky watch"],
    // A viewer's wish: a flash. While the lantern is out, L switches it off and on again at once: its light and its
    // glass go dark together, and the Motion the beaver sends to other players says so (src/features/lantern). By day
    // L does nothing. Live it plays only at night and never sets the clock; it always leaves the lantern lit.
    ["Flash the lantern", async () => {
      const s = sky(), { scene } = stage, game = kit.game;
      if (live && s.dark <= 0.5) return skip(`not dark enough for the lantern at ${s.hour.toFixed(1)} h`);
      const lantern = () => game.lantern ?? skip("no lantern");
      const light = () => scene.getLightByName("lantern-light") ?? skip("no lantern light");
      const glass = () => (scene.getMaterialByName("lantern-glass") as StandardMaterial | null)?.emissiveColor ?? skip("no lantern glass");
      const glows = () => glass().r > 0.05, shines = () => light().intensity > 0;
      const sent = () => packMotion(player.motion).at(-1); // the lantern's switch, last in what the others get
      const hour = s.hour, running = s.running;
      try {
        if (!live) { s.running = false; s.setWeather("fair"); s.setHour(23); }
        await until(() => lantern().out, 6, `no lantern out at ${s.hour.toFixed(1)} h`);
        await until(() => shines() && glows(), 3, "the lantern is out but neither shines nor glows");
        await wait(1); // a look at it lit
        for (const n of [1, 2]) { // off, on: twice, a flash a friend can read
          key("KeyL");
          await until(() => light().intensity === 0 && !glows(), 0.2, `pressed L, the lantern still shines (${light().intensity.toFixed(2)}) or glows (${glass().r.toFixed(2)})`);
          expect(sent() === 1, `switched off, the beaver tells the others ${sent()}, not 1`);
          await wait(n === 1 ? 1.2 : 0.4); // a long dark, then a short
          key("KeyL");
          await until(() => shines() && glows(), 0.2, "pressed L again, the lantern stays dark");
          expect(sent() === 0, `switched on again, the beaver tells the others ${sent()}, not 0`);
          await wait(0.4);
        }
        if (live) return;
        s.setHour(13);
        await until(() => !lantern().out, 4, "the lantern is still out at noon");
        key("KeyL");
        await wait(0.5);
        expect(!lantern().off && sent() === 0, "pressed L at noon with the lantern in the backpack, it switched off");
        expect(!lantern().out && light().intensity === 0, "pressed L at noon, the lantern came out or shines");
      } finally {
        if (game.lantern?.off) { key("KeyL"); await wait(0.1); } // left lit for whoever comes next
        if (!live) { s.setHour(hour); s.running = running; s.setWeather("auto"); }
      }
    }, "Sky watch"],
    // Dusk: deer come out of the forest's edge to graze (src/features/life); the beaver runs at one, it bounds off into
    // the trees. Live it plays only in the deer's hours and never sets the clock (the tour has no way to keep a station
    // out of the stream by the hour, so it skips itself); otherwise it sets the hour, fair weather, and starts at spawn.
    ["Deer at dusk", async () => {
      const s = sky(), deer = (window as { life?: { animals: { deer: Deer[] } } }).life?.animals.deer ?? skip("no deer");
      if (live && !deerHours(dayAt(s.hour).sunHeight)) return skip(`no deer about at ${s.hour.toFixed(1)} h`);
      const hour = s.hour, running = s.running;
      try {
        if (!live) {
          s.running = false;
          s.setHour(19.6);
          s.setWeather("fair");
          player.teleport(world.spawn.x, world.heightAt(world.spawn.x, world.spawn.z), world.spawn.z);
        }
        await until(() => deer.some((d) => d.state === "graze"), 60, "no deer came out to graze at dusk");
        const d = deer.find((o) => o.state === "graze")!;
        expect(!!stage.scene.getMeshByName("life-deer")?.isEnabled(), "a deer grazes, none is drawn");
        await wait(2); // a look at it grazing
        await walkTo(d.x, d.z, { run: 1, near: 2, arrived: () => d.state === "flee", limit: 25 });
        expect(d.state === "flee", `ran at a deer, it stayed (${d.state}, ${flat(d.x, d.z).toFixed(1)} m off)`);
        const from = flat(d.x, d.z);
        await until(() => d.state === "away", 12, "the deer bounded off but never reached the trees");
        expect(flat(d.x, d.z) > from + 3, "the deer fled, but not away from the beaver");
      } finally {
        if (!live) { s.setHour(hour); s.running = running; s.setWeather("auto"); }
      }
    }, "Sky watch"],
    ["Weather", async () => {
      const s = sky();
      try {
        s.setWeather("rain");
        await until(() => s.rain > 0.3, 12, "asked for rain, none came");
        await wait(3);
        s.setWeather("fog");
        await until(() => s.fog > 0.3, 12, "asked for fog, none came");
        await wait(3);
      } finally { s.setWeather("auto"); }
    }, "Sky watch"],
  ];
};
