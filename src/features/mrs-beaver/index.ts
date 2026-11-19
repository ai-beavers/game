// Mrs. Beaver: the player's own beaver companion. At the start of every visit she has been carried off and is shut in
// a pen of sticks at one of three hiding places at the edge of the Clearing, and her flower lies dropped on the way
// there (rules.ts). The player rescues her in a quest, three steps in order, shown as a checklist in the HUD (panel.ts)
// with nothing on the map: find her flower (the Use key, E / X / the Use button, offers "Pick up the flower" at it with
// free paws), find her (within a few metres of her pen), gnaw the pen open (hold Use there about three seconds, with
// the gnaw motion; letting go keeps what is gnawed). Each step done chimes with a "✓" notice (the goalDone event). Then
// the pen falls into loose sticks to carry and build with, she wears her flower again and walks home to a spot beside
// the building site, where she waits for the rest of the visit, and the list says only "Mrs. Beaver found".
//
//   import { create as mrsBeaver } from "./features/mrs-beaver/index.ts";   after shop in FEATURES (it shares the Use key)
//
// Nothing is kept or sent: the quest, the flower and she live in this browser's memory for one visit, and other players
// never see them. The pen's sticks are loose sticks of this browser only (marked local, so the net feature leaves them
// out of its ids).
//
// Debug, for bun shot --eval and the tour (window.mrsBeaver): .pen (where the pen stands) · .flower (where her flower
// lies) · .step (flower, find, gnaw, freed) · .gnawed (s gnawed so far) · .state (missing, freed) · .home (where she
// waits) · .her() (where she is now) · .wears (her flower behind her ear) · .dropped (her flower on the ground) ·
// .stand() (where to stand to gnaw the pen) · .at() stands there facing the pen · .atFlower() stands at the flower ·
// .reset(place?) a new quest, at a hiding place picked anew (or the one given).
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { CreateFeature } from "../../game.ts";
import { RAPIER } from "../../engine.ts";
import type { Actor, Offer } from "../../player/index.ts";
import { buildDropped, buildPen, mrsBeaver, PEN } from "./creature.ts";
import { questList } from "./panel.ts";
import { find, FLOWER, gnaw, GNAW, HIDING, HOME, offered, pick, take, type Quest } from "./rules.ts";

const NEAR = 28; // m: within this she moves (or while she walks home)
const WALK = 1.1; // m/s on her way home
const STAND = 1.0; // m from the pen's middle, towards the Clearing, where a player gnaws it open
const FALLEN = 6; // sticks the pen falls into

/** Facing (radians, as Player.teleport) from a to b. */
const towards = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.atan2(b.x - a.x, b.z - a.z);

export const create: CreateFeature = (game) => {
  const { stage, world, player, events } = game;
  let quest: Quest = pick(Math.random());
  const where = () => HIDING[quest.place]!, flowerAt = () => FLOWER[quest.place]!;
  /** Towards the Clearing's middle from the pen: she faces it, the player comes from it. */
  const inward = () => { const p = where(), r = Math.hypot(p.x, p.z) || 1; return { x: -p.x / r, z: -p.z / r }; };
  const stand = () => { const p = where(), n = inward(); return { x: p.x + n.x * STAND, z: p.z + n.z * STAND }; };

  // The pen, and a collider round it so the beaver cannot walk in.
  let pen: ReturnType<typeof buildPen> | undefined, solid: RAPIER.Collider | undefined;
  const shut = () => {
    pen?.dispose();
    if (solid) stage.physics.removeCollider(solid, false);
    const p = where(), y = world.heightAt(p.x, p.z);
    pen = buildPen(stage);
    pen.root.position.set(p.x, y, p.z);
    pen.root.rotation.y = towards(p, { x: 0, z: 0 });
    solid = stage.physics.createCollider(RAPIER.ColliderDesc.cylinder(PEN.height / 2 + 0.2, PEN.radius + 0.06).setTranslation(p.x, y + PEN.height / 2 - 0.1, p.z));
  };
  shut();

  // Her flower, dropped on the ground on the way to her until it is picked up.
  let dropped: ReturnType<typeof buildDropped> | undefined;
  const drop = () => {
    dropped?.dispose();
    const f = flowerAt();
    dropped = buildDropped(stage);
    dropped.root.position.set(f.x, world.heightAt(f.x, f.z), f.z);
    dropped.root.rotation.y = f.x * 7.3 + f.z * 3.1; // lying any which way
  };
  drop();

  /** The pen falls into loose sticks round where it stood, lying along the ring. */
  const fall = () => {
    const p = where(), y = world.heightAt(p.x, p.z), variants = world.props?.stick.length ?? 1, turn0 = towards(p, { x: 0, z: 0 });
    pen?.dispose(); pen = undefined;
    if (solid) stage.physics.removeCollider(solid, false);
    solid = undefined;
    if (!world.addLoose) return;
    for (let k = 0; k < FALLEN; k++) {
      // Not on the side towards the Clearing, where the player stands and she walks out.
      const a = turn0 + Math.PI * (0.35 + (1.3 * k) / (FALLEN - 1)), r = PEN.radius * (0.9 + (k % 2) * 0.25);
      const at = new Vector3(p.x + Math.sin(a) * r, y + 0.08 + k * 0.03, p.z + Math.cos(a) * r);
      at.y = Math.max(at.y, world.heightAt(at.x, at.z) + 0.08);
      const turn = Quaternion.RotationYawPitchRoll(a + Math.PI / 2 + Math.sin(k * 2.1) * 0.3, 0, 0);
      const stick = world.addLoose("stick", k % variants, new Vector3(0.04, 0.04, 0.55 + (k % 3) * 0.06), at, turn, 0.3);
      stick.mesh.metadata = { ...stick.mesh.metadata, local: true };
    }
  };

  // Her beaver loads while the game starts; until then the pen stands empty.
  let her: Awaited<ReturnType<typeof mrsBeaver>> | undefined;
  /** standing in the pen, walking home, waiting out of sight to appear at home (no clear way), or at home. */
  let phase: "pen" | "walk" | "unseen" | "home" = "pen";
  const place = () => {
    if (!her) return;
    const root = her.beaver.root, p = phase === "home" ? HOME : where();
    root.position.set(p.x, world.heightAt(p.x, p.z), p.z);
    root.rotation.y = phase === "home" ? towards(HOME, world.site ?? { x: 0, z: 0 }) : towards(p, { x: 0, z: 0 });
  };
  void mrsBeaver(stage).then((h) => { her = h; place(); wear(); });
  /** Her flower behind her ear once freed, not while she is missing. */
  const wear = () => { if (her) her.flower = quest.step === "freed"; };

  /** A straight way over land from the pen home, past nothing solid (rules.test.ts checks the three; this is the
   *  game's own check, for a world changed since). */
  const clearWay = () => {
    const p = where(), d = Math.hypot(HOME.x - p.x, HOME.z - p.z), dir = { x: (HOME.x - p.x) / d, y: 0, z: (HOME.z - p.z) / d }, STEP = 0.25;
    const FLAGS = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC;
    const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, dir);
    for (let s = 0; s < d; s += STEP) {
      const x = p.x + dir.x * s, z = p.z + dir.z * s;
      if (world.heightAt(x, z) < world.waterLevel + 0.03) return false;
      // Knee high over the ground here, one step on: a trunk, a rock, a wall (the ground itself rises less than that).
      ray.origin = { x, y: world.heightAt(x, z) + 0.4, z };
      if (stage.physics.castRay(ray, Math.min(STEP, d - s), true, FLAGS)) return false;
    }
    return true;
  };

  const list = questList(stage, ["Find her flower", "Find Mrs. Beaver", "Gnaw the pen open"]);
  const DONE = { flower: 0, find: 1, gnaw: 2, freed: 3 } as const;
  const say = () => list.set(DONE[quest.step]);
  say();

  const away = () => { const p = where(); return Math.hypot(player.feet.x - p.x, player.feet.z - p.z); };
  const toFlower = () => { const f = flowerAt(); return Math.hypot(player.feet.x - f.x, player.feet.z - f.z); };
  const offers = (carrying: boolean) => offered(quest, { flower: toFlower(), pen: away(), carrying, afloat: player.afloat });
  const takeFlower = () => {
    if (!take(quest)) return;
    dropped?.dispose(); dropped = undefined;
    say();
    events.emit("goalDone", { goal: "mrs-beaver-flower", text: "Flower found" });
  };
  const freeHer = () => {
    fall();
    phase = clearWay() ? "walk" : "unseen";
    wear();
    say();
    events.emit("goalDone", { goal: "mrs-beaver", text: "Pen gnawed open" });
  };

  // The Use key: hers at the flower and at the pen with free paws, on the step for each; anywhere else whatever the
  // actor before had. A gnaw runs here while Use is held (gnawing), and stops when it is let go or the pen is open.
  const before = player.actor;
  const PICK: Offer = { action: "use", text: "Pick up the flower" }, GNAWING: Offer = { action: "use", text: "Gnaw the pen open" };
  let gnawing = false;
  const actor: Actor = {
    begin(carrying) {
      const o = offers(carrying);
      if (o === "flower") { takeFlower(); return undefined; }
      if (o === "gnaw") { gnawing = true; return { action: "gnaw", face: towards(player.feet, where()) }; }
      return before?.begin(carrying);
    },
    offer(carrying) {
      const o = offers(carrying);
      return o === "flower" ? PICK : o === "gnaw" ? GNAWING : before?.offer?.(carrying);
    },
    step(dt, held) {
      if (!gnawing) return before?.step(dt, held);
      if (!held || quest.step !== "gnaw") return (gnawing = false, undefined);
      if (gnaw(quest, dt)) { gnawing = false; freeHer(); return undefined; }
      return quest.gnawed / GNAW;
    },
  };
  player.actor = actor;

  Object.assign(window, {
    mrsBeaver: {
      get pen() { const p = where(); return { x: p.x, z: p.z }; },
      get flower() { const f = flowerAt(); return { x: f.x, z: f.z }; },
      get step() { return quest.step; },
      get gnawed() { return quest.gnawed; },
      get state() { return quest.step === "freed" ? "freed" : "missing"; },
      /** Whether she wears her flower behind her ear. */
      get wears() { return !!her?.beaver.root.getDescendants(false, (n) => n.name === "mrs-beaver-flower")[0]?.isEnabled(false); },
      /** Whether her flower lies on the ground. */
      get dropped() { return !!dropped; },
      home: { x: HOME.x, z: HOME.z },
      /** Where she stands now, on the ground. */
      her: () => her ? { x: her.beaver.root.position.x, z: her.beaver.root.position.z } : undefined,
      stand,
      /** Stands at her flower, facing it from the building site's side. */
      atFlower() {
        const f = flowerAt(), d = Math.hypot(f.x - HOME.x, f.z - HOME.z) || 1, s = { x: f.x - ((f.x - HOME.x) / d) * 0.6, z: f.z - ((f.z - HOME.z) / d) * 0.6 };
        const face = towards(s, f);
        player.teleport(s.x, world.heightAt(s.x, s.z), s.z, face);
        player.camera.yaw = face + Math.PI;
      },
      /** Stands where the pen can be gnawed open, facing it. */
      at() {
        const s = stand(), face = towards(s, where());
        player.teleport(s.x, world.heightAt(s.x, s.z), s.z, face);
        player.camera.yaw = face + Math.PI;
      },
      reset(at?: number) {
        quest = at === undefined ? pick(Math.random()) : { place: at, step: "flower", gnawed: 0 };
        phase = "pen";
        gnawing = false;
        // The sticks an earlier pen here fell into go (they are this browser's alone): the new pen stands clear of them.
        const p = where();
        for (const stick of world.sticks.filter((t) => t.mesh.metadata?.local && t !== player.carrying && t.body.isEnabled())) {
          const at = stick.body.translation();
          if (Math.hypot(at.x - p.x, at.z - p.z) < 2) { world.removeLoose?.(stick); stick.mesh.dispose(); }
        }
        shut();
        drop();
        place();
        wear();
        say();
        return quest;
      },
    },
  });

  return {
    update(dt) {
      list.update();
      // The step "Find Mrs. Beaver": with her flower in the paws, within a few metres of her pen.
      if (quest.step === "find" && find(quest, away())) {
        say();
        events.emit("goalDone", { goal: "mrs-beaver-find", text: "Mrs. Beaver found" });
      }
      if (!her) return;
      const moving = stage.paused ? 0 : dt, root = her.beaver.root, feet = player.feet;
      const near = Math.hypot(feet.x - root.position.x, feet.z - root.position.z) < NEAR;
      let speed = 0;
      if (phase === "walk" && moving > 0) {
        const dx = HOME.x - root.position.x, dz = HOME.z - root.position.z, d = Math.hypot(dx, dz), step = Math.min(d, WALK * moving);
        if (d < 0.05) { phase = "home"; place(); }
        else {
          root.position.x += (dx / d) * step;
          root.position.z += (dz / d) * step;
          root.position.y = world.heightAt(root.position.x, root.position.z);
          root.rotation.y = Math.atan2(dx, dz);
          speed = WALK;
        }
      } else if (phase === "unseen") {
        const camera = stage.scene.activeCamera, body = root.getChildMeshes(false)[0];
        if (!camera || !body || !camera.isInFrustum(body)) { phase = "home"; place(); }
      }
      if (near || phase === "walk") her.update(moving, speed);
    },
  };
};
