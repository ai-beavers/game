// The Bear: the one Animal that goes for the beaver. By day it comes running out of the far forest onto the wide outer
// meadow (rules.ts: its ground), where it ambles about, noses and digs in the ground, looks about and sits; a beaver
// on land there it notices (from the forest already: then it runs straight for it), rears up at with a growl, charges
// and swipes. A Swipe
// never harms the beaver, which has no health: it tosses it a few metres, knocks the stick from its paw and leaves
// it furious for a while. The beaver's Tail slap on land within reach takes some of the bear's Health, shown in the
// Health bar at the top of the HUD (panel.ts); with none left the bear is driven off: it runs all the way back into
// the far forest and stays there until the next Day. Everything near the pond is safe: the bear never leaves its ground.
//
//   import { create as bear } from "./features/bear/index.ts";
//
// Fighting it, the beaver's tail slap is a leap, once round in the air (player.foe), and one that lands is felt: the
// picture jolts, the world holds for a moment (longer for the last one), fur flies (../fx) and it smacks (../audio).
//
// Each player has their own bear: only the local player's beaver and its own tail slaps count, nothing is kept or sent
// (docs/adr/0009). With ?tour in the address it comes only when a station calls for it, so no other station meets
// a bear by chance. How it decides lives in rules.ts (pure, tested), its mesh and clips in assets/bear.glb (tools/blender/bear.py).
//
// Debug, for bun shot --eval and the tour (window.bear): .state · .doing · .health · .x · .z · .swipes (Swipes that
// hit, this visit) · .come(x, z) (it comes running out of the forest to there, with all its health) · .reset() (it
// runs back into the forest, a Day anew).
//
// shortcut: it steers round the Clearing's trees only; the far forest's trunks (seen, never walked: world/place.ts
// farTree) it runs through, 30 m off and more. Hand them to step() if that ever shows.
//
// Cost per frame while it is out: one skinned mesh (about 23,000 triangles) and one sampled clip. The forest hides the mesh and stops its clip.
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { CREATURE, capsule, enable, isEnabled, place, PhysicsMotionType } from "../../physics.ts";
import type { CreateFeature } from "../../game.ts";
import { sunAt } from "../sky/clock.ts";
import { loadBear } from "./model.ts";
import { healthBar } from "./panel.ts";
import { after, arrive, comesOut, entry, FURY, FURY_EASE, leave, newBear, slap, SLAP_REACH, step, TOSS_SPEED, TOSS_UP, type Happening } from "./rules.ts";

const LINGER = 5; // s the Health bar stays after the bear gave up
// A tail slap that lands holds the world: s of real time at this share of its pace; the last one, as the bear turns to run.
const HOLD = { hurt: [0.07, 0.05], drivenOff: [0.5, 0.25] } as const;
// Its solid body, m: an upright capsule round its trunk, which the beaver walks against (as another player's beaver).
const BODY = { half: 0.35, radius: 0.5 };
const turnBetween = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export const create: CreateFeature = async (game) => {
  const { stage, world, player, events } = game, { scene, physics } = stage;
  const touring = new URLSearchParams(location.search).has("tour");
  const bear = newBear(), bar = healthBar(stage), trunks = (world.trees ?? []).map((t) => ({ x: t.place.x, z: t.place.z }));
  const model = await loadBear(scene);
  const body = physics.body(new TransformNode("bear body", scene), PhysicsMotionType.ANIMATED, capsule(scene, BODY.half, BODY.radius), CREATURE);
  enable(body, false);
  const middle = new Vector3(), still = Quaternion.Identity();

  let visit = 0, came = false, linger = 0, swipes = 0;
  let fury = 0, calm = 0; // s the tossed beaver is still furious, and the anger it had before
  let held = 0, pace = 1; // when the held moment ends (performance.now(), 0: none), and the pace to go back to
  const before = { x: bear.x, z: bear.z, heading: bear.heading }, towards = new Vector3();
  const at = () => new Vector3(bear.x, world.heightAt(bear.x, bear.z), bear.z);
  const out = (x: number, z: number) => { arrive(bear, x, z); Object.assign(before, { x: bear.x, z: bear.z, heading: bear.heading }); };

  /** The Swipe hit: the beaver flies away from the bear, drops what it carried and is furious for a while. */
  const toss = () => {
    const dx = player.feet.x - bear.x, dz = player.feet.z - bear.z, d = Math.hypot(dx, dz) || 1;
    player.drop();
    player.toss(dx / d * TOSS_SPEED, dz / d * TOSS_SPEED, TOSS_UP);
    player.camera.jolt(1);
    if (fury <= 0) calm = player.motion.anger;
    fury = FURY;
    swipes++;
  };
  const act = (h: Happening) => {
    if (h.kind === "notices") events.emit("bearNotices", { place: at() });
    else if (h.kind === "swipes") { if (h.hit) toss(); }
    else if (h.kind === "gaveUp") linger = LINGER;
  };
  // Only this player's own tail slap, on land: on the water it stays the alarm it is.
  events.on("tailSlap", ({ place, water, remote }) => {
    if (remote || water) return;
    const what = slap(bear, place);
    if (!what) return;
    events.emit("bearSlapped", { place: at(), health: bear.health });
    player.camera.jolt(what === "hurt" ? 0.6 : 1);
    if (!held) pace = stage.timeScale;
    stage.timeScale = pace * HOLD[what][1];
    held = performance.now() + HOLD[what][0] * 1000;
    if (what !== "drivenOff") return;
    linger = 0; // the bar goes with the bear, also when it had only just given up
    events.emit("goalDone", { goal: "bear", text: "Bear driven off" });
  });

  Object.assign(window, {
    bear: {
      get state() { return bear.state; },
      get doing() { return bear.doing; },
      get health() { return bear.health; },
      get x() { return bear.x; },
      get z() { return bear.z; },
      get swipes() { return swipes; },
      come: out,
      reset() {
        leave(bear);
        came = false; linger = 0;
        if (fury > 0) { fury = 0; player.setAnger(calm); }
      },
    },
  });

  return {
    step(dt) {
      visit += dt;
      if (bear.state === "away" && !touring) {
        const height = Math.asin(sunAt(game.sky?.hour ?? 16, towards).y) * 180 / Math.PI;
        if (height < 0) came = false; // night: a new Day comes
        if (comesOut(height, visit, came)) { came = true; const e = entry(player.feet, Math.random); out(e.x, e.z); }
      }
      Object.assign(before, { x: bear.x, z: bear.z, heading: bear.heading });
      for (const h of step(bear, { x: player.feet.x, z: player.feet.z, land: !player.afloat && !player.riding }, trunks, dt, Math.random)) act(h);
      const here = bear.state !== "away";
      if (here) middle.set(bear.x, world.heightAt(bear.x, bear.z) + BODY.half + BODY.radius, bear.z);
      if (here !== isEnabled(body)) { enable(body, here); if (here) place(body, middle); }
      if (here) body.setTargetTransform(middle, still);
      linger = Math.max(0, linger - dt);
      // The bear to leap at: while it is after the beaver, or about within a leap of it.
      player.foe = after(bear) || (bear.state === "roam" && Math.hypot(bear.x - player.feet.x, bear.z - player.feet.z) < SLAP_REACH + 1) ? bear : undefined;
      // Furious from the toss, calming down over the last FURY_EASE s to what it was before.
      if (fury > 0) { fury -= dt; player.setAnger(calm + (1 - calm) * Math.min(1, Math.max(0, fury) / FURY_EASE)); }
    },
    update(dt, alpha) {
      if (held && performance.now() >= held) { stage.timeScale = pace; held = 0; }
      bar.set(bear.health);
      bar.update(after(bear) || linger > 0);
      const here = bear.state !== "away";
      model.root.setEnabled(here);
      if (!here) { model.hide(); return; }
      const x = before.x + (bear.x - before.x) * alpha, z = before.z + (bear.z - before.z) * alpha;
      const heading = before.heading + turnBetween(before.heading, bear.heading) * alpha;
      const dx = 0.5 * Math.sin(heading), dz = 0.5 * Math.cos(heading);
      // Fit the metre between the planted paws to the bank as the bear enters or leaves the meadow.
      const fore = world.heightAt(x + dx, z + dz), hind = world.heightAt(x - dx, z - dz);
      const across = world.heightAt(x + dz, z - dx) - world.heightAt(x - dz, z + dx);
      model.root.position.set(x, (fore + hind) / 2, z);
      model.root.rotation.set(Math.atan(hind - fore), heading, Math.atan(across));
      if (!stage.paused) model.update(bear, dt, x, z);
    },
  };
};
