// Running on all fours: with Shift held the beaver drops from walking upright onto its front paws and bounds along,
// long and low, as a beaver runs; let go of Shift and it rises onto its hind legs again.
//
// Run till tired: running takes stamina (src/player/stamina.ts). Run long enough and the beaver is tired and walks,
// Shift held or not; gnawing a tree brings it back faster than resting; the stamina bar shows only while it is not full.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { WALK_SPEED } from "../../../contracts.ts";
import { GNAW_RATE, REST_TIME } from "../../../player/stamina.ts";
import { GROUND, HEAVY, SOLID } from "../../../physics.ts";
import { skip } from "../kit.ts";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Kit } from "../kit.ts";
import type { Station } from "../live.ts";

const LOWER = 0.15; // m the head must come down to count as on all fours
const LEG = 3; // m of each run out from the tree and back: short, so the tree is near when the beaver tires
const BRAKE = 0.6; // s for a tired beaver to slow from a run to a walk
const GNAW = 0.6; // s of gnawing measured: short, so the stamina is not full before it ends

export const runOnAllFours = (kit: Kit): Station[] => {
  const { player, world, stage, beaver, live, wait, until, rest, walkTo, want, needBuild, standingTrees, expect } = kit;
  const barShown = () => !!(window as { staminaBar?: { shown: boolean } }).staminaBar?.shown;
  /** m a bone is above the feet in this picture. */
  const above = (name: string) => {
    const bone = beaver.root.getDescendants(false, (n) => n.name === name)[0] as TransformNode | undefined;
    expect(!!bone, `the beaver has no ${name} bone`);
    bone!.computeWorldMatrix(true);
    return bone!.getAbsolutePosition().y - player.feet.y;
  };
  return [
    ["Run on all fours", async () => {
      if (player.afloat) await walkTo(world.spawn.x, world.spawn.z, { arrived: () => !player.afloat, limit: 40 });
      await rest(); // a run it means to make, out of breath from the last one or not
      expect(!player.afloat && player.motion.grounded, "wanted to start on land, still afloat or in the air");
      const head = above("head"), paw = above("hand_L");
      let low = Infinity, pawLow = Infinity, done = false;
      const running = () => {
        if (player.motion.speed > 1.7 && player.motion.grounded) { low = Math.min(low, above("head")); pawLow = Math.min(pawLow, above("hand_L")); }
        return done;
      };
      // Shift held for three seconds of the game's time (live: longer, to be seen), out to the clearing's far side
      const time = wait(live ? 5 : 3).then(() => { done = true; });
      await walkTo(world.spawn.x + 4, world.spawn.z + 1, { run: 1, arrived: running, limit: 20 });
      await time;
      expect(low < head - LOWER, `running, the head stays at ${low.toFixed(2)} m, standing ${head.toFixed(2)} m: not on all fours`);
      expect(pawLow < paw - 0.1, `running, the front paw stays at ${pawLow.toFixed(2)} m, standing ${paw.toFixed(2)} m: not on the ground`);
      await until(() => above("head") > head - 0.05, 2, `stopped running, the head stays at ${above("head").toFixed(2)} m, standing ${head.toFixed(2)} m`);
    }, "Around the clearing"],
    ["Run till tired", async () => {
      if (player.afloat) await walkTo(world.spawn.x, world.spawn.z, { arrived: () => !player.afloat, limit: 40 });
      // A standing tree near the building site with no other beaver at it (Bots gnaw there too), with a way to it in a
      // straight line, and a run out from it towards where the beaver came from and back, all on dry land.
      const others = () => [...((window as { net?: { remotes: Map<number, { node: TransformNode }> } }).net?.remotes.values() ?? [])]
        .filter((r) => r.node.isEnabled()).map((r) => r.node.position);
      const along = (a: number) => new Vector3(Math.sin(a), 0, Math.cos(a));
      const ground = (p: Vector3) => new Vector3(p.x, world.heightAt(p.x, p.z) + 0.5, p.z);
      /** Nothing solid (a trunk, a rock, the ground of a hill) on the straight line from a to b, half a metre up. */
      const clear = (a: Vector3, b: Vector3) => {
        const from = ground(a), d = ground(b).subtract(from), length = d.length();
        return length < 0.2 || !stage.physics.ray(from, d.scale(1 / length), length, GROUND | SOLID | HEAVY);
      };
      const plan = (t: number) => {
        const tree = world.trees![t]!, side = (a: number) => tree.place.add(along(a).scale(tree.radius + 0.35));
        if (others().some((o) => Math.hypot(o.x - tree.place.x, o.z - tree.place.z) < 3)) return undefined;
        const towards = Math.atan2(player.feet.x - tree.place.x, player.feet.z - tree.place.z);
        for (const k of [0, 1, -1, 2, -2]) {
          const heading = towards + k * Math.PI / 6, stand = side(heading), far = stand.add(along(heading).scale(LEG));
          const dry = [0, 0.25, 0.5, 0.75, 1].every((f) => {
            const p = stand.add(along(heading).scale(LEG * f));
            return world.heightAt(p.x, p.z) > world.waterLevel + 0.2;
          });
          if (dry && clear(stand, far) && clear(player.feet, stand)) return { i: t, side, heading, stand, far };
        }
        return undefined;
      };
      const trees = standingTrees(needBuild());
      if (!trees.length) skip("no tree left standing");
      const { i, side, heading, stand, far } = trees.map(plan).find((p) => !!p) ?? skip(`no standing tree with a clear, dry way to it and a run beside it (${trees.join(", ")})`);
      // Round the trunk from there until E would gnaw (a mushroom there, E would eat it); the side that worked first next time.
      let best = 0;
      const toTree = async () => {
        const gnaws = () => player.offer()?.action === "gnaw";
        for (const k of [best, 0, 1, -1, 2, -2, 3]) {
          const at = side(heading + k * Math.PI / 3);
          await walkTo(at.x, at.z, { near: 0.2, arrived: gnaws, limit: 10 }).catch(() => {});
          if (gnaws()) { best = k; return; }
        }
        expect(false, `went round tree ${i}, E would never gnaw it (E would: ${player.offer()?.action ?? "nothing"})`);
      };
      await toTree();
      // Shift held, out and back, until it is tired.
      for (let leg = 0; !player.tired; leg++) {
        expect(leg < 20, `ran ${leg} times ${LEG} m with Shift held, never tired (stamina ${player.stamina.toFixed(2)})`);
        const at = leg % 2 ? stand : far;
        await walkTo(at.x, at.z, { run: 1, near: 0.5, arrived: () => player.tired, limit: 15 });
        if (!player.tired) expect(barShown(), `stamina at ${player.stamina.toFixed(2)}, its bar is not shown`);
      }
      // Shift still held, on along the way it went: after a moment to brake, no faster than a walk.
      const since = player.motion.time, from = player.feet.clone(), on = Vector3.Distance(player.feet, stand) > LEG / 2 ? stand : far;
      let fastest = 0;
      await walkTo(on.x, on.z, { run: 1, near: 0.3, limit: 10, arrived: () => {
        const t = player.motion.time - since;
        if (t > BRAKE) fastest = Math.max(fastest, player.motion.speed);
        return t > BRAKE + 1;
      } });
      expect(Vector3.Distance(from, player.feet) > 0.5, "tired, it did not walk on at all");
      expect(fastest > 0 && fastest < WALK_SPEED * 1.1, `tired with Shift held, it went ${fastest.toFixed(2)} m/s, not a walk (${WALK_SPEED} m/s)`);
      // To the tree, and a gnaw at it: the stamina comes back faster than standing would bring it.
      await toTree();
      expect(player.stamina < 0.75, `back at the tree, its stamina is already ${player.stamina.toFixed(2)}`);
      expect(barShown(), `stamina at ${player.stamina.toFixed(2)}, its bar is not shown`);
      want.act = true;
      try {
        await until(() => player.motion.action === "gnaw", 3, "E at the tree, no gnaw");
        const start = player.stamina, at = player.motion.time;
        await until(() => player.motion.action !== "gnaw" || player.motion.time - at >= GNAW, GNAW + 1, "");
        const took = player.motion.time - at, rose = player.stamina - start, resting = took / REST_TIME;
        expect(took >= 0.3, `it gnawed only ${took.toFixed(2)} s`); // the tree may fall under the last bites
        expect(rose > resting * (1 + GNAW_RATE) / 2, `gnawing ${took.toFixed(2)} s brought back ${rose.toFixed(3)} of its stamina, resting would ${resting.toFixed(3)}`);
        if (live) await wait(1.5); // a moment more to be seen
      } finally { want.act = false; }
      // Caught its breath: the bar goes again.
      await rest();
      await until(() => !barShown(), 4, "stamina full again, its bar is still shown");
    }, "Around the clearing"],
  ];
};
