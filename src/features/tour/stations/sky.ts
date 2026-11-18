// Sky watch: a day passing, the lantern at night, deer at dusk, rain and fog.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { deerHours, type Deer } from "../../life/brain.ts";
import { dayAt } from "../../sky/clock.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

export const skyWatch = (kit: Kit): Station[] => {
  const { player, world, stage, beaver, live, wait, until, walkTo, flat, expect, sky } = kit;
  return [
    ["A day passes", async () => {
      const s = sky(), hour = s.hour, running = s.running;
      s.running = false;
      try {
        for (const h of [19.3, 20.5, 23, 5.6]) { s.setHour(h); await wait(3.5); if (h === 23) expect(s.dark > 0.5, `dark ${s.dark.toFixed(2)} at 23:00`); }
      } finally { s.setHour(hour); s.running = running; }
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
        kit.subject = () => d;
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
