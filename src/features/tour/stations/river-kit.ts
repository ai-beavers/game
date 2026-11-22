// The River kit (src/features/river-kit), as a player meets it: the beaver walks off over the meadow and its child
// comes after it and stops beside it; left standing there, the kit finds something of its own to do; and when the
// beaver runs, the kit runs to keep up; the beaver swims and the kit swims after it; the beaver stays where it is and the kit lies down and falls asleep, wakes
// when the beaver goes, and makes room when the beaver walks right up to it. Standing by, it looks up at the beaver;
// left behind it calls, and chirps when it has caught up; out of the water it shakes itself dry; and it wakes with a
// yawn. Where the kit is and what it does come from the feature's debug handle, and how its head and jaw are turned
// from its joints in the scene: nothing on screen says them.
import { CLOSE, FAR, GAZE, HURRY, IDLE, NEAR, PAUSE, QUIET, TIRED, WALK, type Kit as RiverKit } from "../../river-kit/rules.ts";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

export const riverKit = (tools: Kit): Station[] => {
  const { player, world, stage, until, wait, walkTo, expect, flat, sky } = tools;
  const need = () => (window as { riverKit?: RiverKit }).riverKit ?? skip("no river kit feature");
  /** One of the kit's joints as it is drawn (a joint lies along its own upward axis: the skull from neck to nose). */
  const joint = (name: string) => stage.scene.getNodeByName("river-kit")!.getDescendants(false, (node) => node.name === name)[0] as TransformNode;
  const turnBetween = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  /** A dry spot `far` m from the beaver, tried round the compass from where it faces (from the `from`-th try on). */
  const spot = (far: number, from = 0) => {
    for (let i = from; i < from + 16; i++) {
      const a = player.facing + i * Math.PI / 8, x = player.feet.x + Math.sin(a) * far, z = player.feet.z + Math.cos(a) * far;
      const dry = [0.25, 0.5, 0.75, 1].every((f) => world.heightAt(player.feet.x + (x - player.feet.x) * f, player.feet.z + (z - player.feet.z) * f) > world.waterLevel + 0.15);
      if (dry && Math.hypot(x, z) < 14) return { x, z };
    }
    return skip("no dry way for a walk from here");
  };
  /** Walks `far` m to a dry spot and waits there for the kit to come up beside the beaver. With something in the
   *  beaver's way, or in the kit's (it cannot follow over a felled tree or a dam), it walks on another way, as a
   *  player would. */
  const walk = async (kit: RiverKit, far: number, options: Parameters<typeof walkTo>[2] = {}, beside: () => void = () => {}) => {
    let stuck: unknown;
    for (let from = 0; from < 16; from += 4) {
      const to = spot(far, from);
      try {
        await walkTo(to.x, to.z, { near: 0.5, limit: 40, ...options });
        return await until(() => { beside(); return flat(kit.x, kit.z) < NEAR + 0.2 && kit.speed === 0; }, 12, `the beaver went ${far} m, the kit is ${flat(kit.x, kit.z).toFixed(1)} m behind (${kit.doing})`);
      } catch (e) { stuck = e; }
    }
    throw stuck;
  };
  /** The kit beside the beaver, to start from. A station starts at the spawn, wherever the last one left the kit: one
   *  left where it finds no way from (shut in behind what was built) is set down behind the beaver. */
  const together = (kit: RiverKit) => until(() => flat(kit.x, kit.z) < FAR + 0.3 && kit.speed === 0, 20, "").catch(() => {
    Object.assign(kit, { x: player.feet.x - Math.sin(player.facing) * 1.2, z: player.feet.z - Math.cos(player.facing) * 1.2, following: false, doing: "stand", time: 0, side: 0, stuck: 0 });
  });
  return [
    ["The kit follows", async () => {
      const kit = need();
      await together(kit);
      await walk(kit, 6);
      // Left standing, it finds something of its own to do.
      await until(() => kit.doing !== "stand", IDLE + 2, `left standing ${IDLE + 2} s, the kit still only stands`);
      // The beaver runs: the kit runs too, and is beside it again.
      let fastest = 0;
      const pace = () => { fastest = Math.max(fastest, kit.speed); };
      await walk(kit, 8, { run: 1, arrived: () => { pace(); return false; } }, pace);
      expect(fastest > WALK, `the beaver ran ${HURRY} m and more ahead, the kit never ran (its fastest: ${fastest} m/s)`);
    }, "Around the clearing"],
    // The beaver steps round to the kit's side: the kit stays where it is and its head follows, up to the beaver's
    // face; the beaver walks on, and the kit's head is its own again.
    ["The kit looks up", async () => {
      const kit = need();
      await together(kit);
      await walk(kit, 4);
      // A step to one side of the kit, no further off than the kit lets the beaver go: on dry ground, left or right.
      const beside = [0.9, -0.9].map((off) => ({ x: kit.x + Math.sin(kit.heading + off) * 1.7, z: kit.z + Math.cos(kit.heading + off) * 1.7 }))
        .find((p) => world.heightAt(p.x, p.z) > world.waterLevel + 0.15) ?? skip("no dry ground beside the kit");
      await walkTo(beside.x, beside.z, { near: 0.25, limit: 10 });
      const to = () => Math.atan2(player.feet.x - kit.x, player.feet.z - kit.z), off = () => turnBetween(kit.heading, to());
      // Where its nose points, as it is drawn: round from north, and up.
      const skull = joint("skull"), nose = () => skull.getDirection(Vector3.Up()).normalize();
      const says = () => `the beaver stands ${(off() * 180 / Math.PI).toFixed(0)}° to the side of the kit (${kit.doing}), its head is turned ${(kit.gaze.yaw * 180 / Math.PI).toFixed(0)}° and ${(kit.gaze.pitch * 180 / Math.PI).toFixed(0)}° up, its nose points ${(turnBetween(to(), Math.atan2(nose().x, nose().z)) * 180 / Math.PI).toFixed(0)}° off the beaver`;
      await until(() => kit.doing === "stand" && kit.speed === 0 && Math.abs(off()) > 0.5 && Math.abs(off()) < GAZE.yaw
        && Math.abs(kit.gaze.yaw - off()) < 0.1 && kit.gaze.pitch > 0.2 && Math.abs(turnBetween(to(), Math.atan2(nose().x, nose().z))) < 0.4, 20, says());
      const level = nose().y;
      // The beaver walks on: the kit comes after it, looking where it goes.
      let turned = Infinity, lowest = Infinity;
      const ahead = () => { if (kit.speed > 0) { turned = Math.min(turned, Math.abs(kit.gaze.yaw) + kit.gaze.pitch); lowest = Math.min(lowest, nose().y); } return false; };
      await walk(kit, 5, { arrived: ahead }, ahead);
      expect(turned < 0.05, `walking after the beaver, the kit's head stayed turned ${turned.toFixed(2)} rad to it`);
      expect(lowest < level - 0.1, `looking up at the beaver its nose pointed ${level.toFixed(2)} up, walking ${lowest.toFixed(2)}: no higher for the beaver`);
    }, "Around the clearing"],
    // The beaver runs off: left behind, the kit calls after it as it starts to run, and chirps beside it again.
    ["The kit calls", async () => {
      const kit = need();
      await together(kit);
      await walk(kit, 4);
      // Quiet for a while first: it never calls twice in QUIET s, so a call from before would keep it silent now.
      await until(() => kit.quiet.left >= QUIET && kit.quiet.caught >= QUIET, QUIET + 1, `beside the beaver, yet the kit called ${Math.min(kit.quiet.left, kit.quiet.caught).toFixed(1)} s ago`);
      const heard: { call: string; far: number }[] = [];
      const hear = () => {
        for (const call of ["left", "caught"] as const) if (kit.quiet[call] < QUIET && !heard.some((h) => h.call === call)) heard.push({ call, far: flat(kit.x, kit.z) });
        return false;
      };
      await walk(kit, 8, { run: 1, arrived: hear }, hear);
      const said = heard.map((h) => `${h.call === "left" ? "left behind" : "caught up"} ${h.far.toFixed(1)} m from the beaver`).join(", then ") || "nothing";
      expect(heard.length === 2 && heard[0]!.call === "left" && heard[0]!.far > HURRY - 0.5 && heard[1]!.far < NEAR + 0.2, `the beaver ran 8 m and the kit came up beside it again; it called: ${said}. It should call left behind beyond ${HURRY} m, then caught up within ${NEAR} m`);
    }, "Around the clearing"],
    // The beaver swims out into the pond: the kit swims after it, paddles beside it, and is on its feet again on the
    // bank, where it shakes itself dry, once.
    ["The kit swims", async () => {
      const kit = need(), pond = tools.pond ?? skip("no pond");
      await together(kit);
      const level = () => (stage.scene.metadata?.water as { level: number } | undefined)?.level ?? world.waterLevel;
      const wet = () => world.heightAt(kit.x, kit.z) < level();
      // The way in, to go back out by: the beaver's steps on land, the last of them at the water's edge.
      const trail = [player.feet.clone()];
      let other = "", shakes = 0, shaking = false, inWater = false, dripping = 0, shaken = 0;
      const watch = () => {
        if (!player.afloat && Vector3.Distance(trail.at(-1)!, player.feet) > 0.3) trail.push(player.feet.clone());
        if (kit.afloat && kit.doing !== "stand") other = kit.doing;
        if (kit.shaking > 0 && !shaking) { shakes++; dripping = kit.wet; }
        if (kit.shaking > 0 && world.heightAt(kit.x, kit.z) < level() - 0.03) inWater = true;
        if (shaking && kit.shaking <= 0) shaken = kit.wet;
        shaking = kit.shaking > 0;
        return false;
      };
      await walkTo(pond.x, pond.z + tools.clear(), { near: 0.8, arrived: watch, limit: 40 });
      expect(player.afloat, "walked out into the pond, yet the beaver does not swim");
      // Beside it: within FAR, from where on it would set off after the beaver again.
      await until(() => { watch(); return wet() && flat(kit.x, kit.z) < FAR + 0.2 && kit.speed === 0; }, 20, `the beaver swims in the pond, the kit is ${flat(kit.x, kit.z).toFixed(1)} m off, ${wet() ? "in the water" : "on dry ground"}`);
      expect(!shakes, "the kit shook itself in the pond");
      // Back out the way it came, two metres up the bank and more: the kit does not stay behind in the water.
      const edge = trail.at(-1)!, back = trail.findLast((p) => Vector3.Distance(p, edge) > 3) ?? trail[0]!;
      await walkTo(back.x, back.z, { near: 0.4, arrived: () => { watch(); return !player.afloat && Vector3.Distance(player.feet, edge) > 2; }, limit: 40 });
      await until(() => { watch(); return !kit.afloat && flat(kit.x, kit.z) < FAR + 0.2 && kit.speed === 0; }, 20, `the beaver is back on land, the kit is ${flat(kit.x, kit.z).toFixed(1)} m off, ${kit.afloat ? "afloat" : "on its feet"}`);
      expect(!other, `afloat the kit did not only paddle: it was at ${other}`);
      // The beaver walks on, away from the pond and up out of its shallows, where the kit may still stand (round
      // what is in its way: another way out): with dry ground under it the kit shakes itself, once, and its coat is
      // much drier for it.
      const out = Math.atan2(player.feet.x - pond.x, player.feet.z - pond.z), up = pond.radius + 6;
      const shook = () => { watch(); return shakes > 0 && !shaking; };
      for (const turn of [0, 0.7, -0.7]) {
        if (!shakes) await walkTo(pond.x + Math.sin(out + turn) * up, pond.z + Math.cos(out + turn) * up, { near: 0.5, arrived: shook, limit: 25 }).catch(() => {});
      }
      await until(shook, 8, `the kit is out of the pond, ${(world.heightAt(kit.x, kit.z) - level()).toFixed(2)} m above the water and ${flat(kit.x, kit.z).toFixed(1)} m from the beaver, and never shook itself (its coat is ${kit.wet.toFixed(2)} wet)`);
      expect(!inWater, "the kit shook itself standing in the water");
      expect(shaken < dripping / 2, `shaken, the kit's coat is ${shaken.toFixed(2)} wet, from ${dripping.toFixed(2)}: not much drier`);
      await wait(2);
      watch();
      expect(shakes === 1, `after one swim the kit shook itself ${shakes} times`);
    }, "Around the clearing"],
    ["The kit sleeps", async () => {
      const kit = need();
      await together(kit);
      // The beaver stays where it is: the kit lies down, sooner in the dark, and falls asleep.
      const limit = (sky().dark > 0.5 ? TIRED.night : TIRED.day) + 2 * IDLE + PAUSE.sit + PAUSE.lie + 5;
      await until(() => kit.doing === "sleep", limit, `the beaver stood still ${limit} s, the kit never fell asleep (it is at: ${kit.doing})`);
      // The beaver goes: the kit wakes with a yawn (its jaw, as it is drawn, opens wide), gets up and is beside it again.
      const jaw = joint("jaw"), shut = jaw.rotationQuaternion!.clone();
      let woke = false, wide = 0;
      const yawn = () => {
        if (kit.waking && kit.rising > 0) { woke = true; wide = Math.max(wide, 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(shut, jaw.rotationQuaternion!))))); }
        return false;
      };
      await walk(kit, 6, { arrived: yawn }, yawn);
      expect(woke && wide > 0.4, woke ? `waking, the kit's jaw opened ${wide.toFixed(2)} rad: no yawn` : "the beaver went and the kit came after it without waking from its sleep");
      // The beaver walks right up to where the kit stands: the kit makes room.
      await walkTo(kit.x, kit.z, { near: 0.15, limit: 10 });
      await until(() => flat(kit.x, kit.z) >= CLOSE - 0.02 && kit.speed === 0, 5, `the beaver walked up to the kit, the kit made no room: ${flat(kit.x, kit.z).toFixed(2)} m between them`);
    }, "Around the clearing"],
  ];
};
