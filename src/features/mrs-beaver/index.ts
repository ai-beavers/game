// Mrs. Beaver: the player's own beaver companion. At the start of every visit she has been carried off and is shut in
// a pen of sticks under one of six brush piles at the edge of the Clearing, all alike from outside, and she left two
// clues on her way there: her flower dropped about a third of the way out, her tracks about two thirds, pointing at
// her pile (rules.ts). The player rescues her in a quest, four steps in order, shown as a checklist in the HUD
// (panel.ts) with nothing on the map: find her flower (the Use key, E / X / the Use button, offers "Pick up the
// flower" at it with free paws), find her tracks (walk onto them), find her (within a few metres of her pile), gnaw the
// pen open (hold Use there about three seconds, with the gnaw motion; letting go keeps what is gnawed). A wrong pile is
// only solid: Use offers nothing there and nothing ticks. Each step done chimes with a "✓" notice (the goalDone event).
// Then her pile and pen fall into loose sticks to carry and build with, she wears her flower again and walks home to a
// spot beside the building site, where she waits for the rest of the visit, and the list says only "Mrs. Beaver found".
//
//   import { create as mrsBeaver } from "./features/mrs-beaver/index.ts";   after shop in FEATURES (it shares the Use key)
//
// Nothing is kept or sent: the quest, the flower and she live in this browser's memory for one visit, and other players
// never see them. The pen's sticks are loose sticks of this browser only (marked local, so the net feature leaves them
// out of its ids).
//
// Debug, for bun shot --eval and the tour (window.mrsBeaver): .pen (where the pen stands) · .flower (where her flower
// lies) · .tracks (the middle of her tracks) · .piles (every brush pile, hers among them) · .step (flower, tracks,
// find, gnaw, freed) · .gnawed (s gnawed so far) · .state (missing, freed) · .home (where she
// waits) · .her() (where she is now) · .wears (her flower behind her ear) · .dropped (her flower on the ground) ·
// .stand(place?) (where to stand to gnaw the pen, or at the pile of that hiding place) · .at() stands there facing the pen · .atFlower() stands at the flower ·
// .reset(place?) a new quest, at a hiding place picked anew (or the one given).
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { CreateFeature } from "../../game.ts";
import { GROUND, SOLID, cylinder, isEnabled, type PhysicsBody } from "../../physics.ts";
import type { Actor, Offer } from "../../player/index.ts";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh.js";
import { BRUSH, buildBrush, buildDropped, buildPen, buildTracks, mrsBeaver, PEN } from "./creature.ts";
import { questList } from "./panel.ts";
import { done, find, FLOWER, follow, gnaw, GNAW, HIDING, HOME, offered, pick, take, TRACKS, TRACKS_FACING, wayHome, type Quest } from "./rules.ts";

const NEAR = 28; // m: within this she moves (or while she walks home)
const WALK = 1.1; // m/s on her way home
const STAND = 1.0; // m from the pen's middle, towards the Clearing, where a player gnaws it open
const FALLEN = 8; // sticks the pen and its pile fall into

/** Facing (radians, as Player.teleport) from a to b. */
const towards = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.atan2(b.x - a.x, b.z - a.z);

export const create: CreateFeature = (game) => {
  const { stage, world, player, events } = game;
  let quest: Quest = pick(Math.random());
  const where = () => HIDING[quest.place]!, flowerAt = () => FLOWER[quest.place]!, tracksAt = () => TRACKS[quest.place]!;
  /** Where to stand at the pile of hiding place i (hers by default): STAND m from its middle towards the Clearing's,
   *  where she faces and the player comes from. */
  const stand = (i = quest.place) => { const p = HIDING[i]!, r = Math.hypot(p.x, p.z) || 1; return { x: p.x - (p.x / r) * STAND, z: p.z - (p.z / r) * STAND }; };

  // A brush pile at every hiding place, each with a collider so the beaver cannot walk in; under hers, her pen.
  const brush = buildBrush(stage);
  let piles: ({ mesh: InstancedMesh; solid: PhysicsBody } | undefined)[] = [];
  let pen: ReturnType<typeof buildPen> | undefined;
  /** Takes away the pile at hiding place i, if it stands. */
  const clear = (i: number) => {
    const pile = piles[i];
    if (!pile) return;
    pile.mesh.dispose();
    stage.physics.remove(pile.solid);
    piles[i] = undefined;
  };
  const shut = () => {
    HIDING.forEach((_, i) => clear(i));
    pen?.dispose();
    piles = HIDING.map((p) => {
      const y = world.heightAt(p.x, p.z);
      return {
        mesh: brush.place(p.x, y, p.z, towards(p, { x: 0, z: 0 })), // all turned alike, to the middle
        solid: stage.physics.fixed(cylinder(stage.scene, BRUSH.height / 2, BRUSH.solid, { x: p.x, y: y + BRUSH.height / 2 - 0.1, z: p.z })),
      };
    });
    const p = where();
    pen = buildPen(stage);
    pen.root.position.set(p.x, world.heightAt(p.x, p.z), p.z);
    pen.root.rotation.y = towards(p, { x: 0, z: 0 });
  };
  shut();

  // Her tracks, pressed into the ground on her way, pointing at her pile; they stay for the visit.
  let tracks: ReturnType<typeof buildTracks> | undefined;
  const press = () => {
    tracks?.dispose();
    tracks = buildTracks(stage, tracksAt(), TRACKS_FACING[quest.place]!, (x, z) => world.heightAt(x, z));
  };
  press();

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
    clear(quest.place);
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
  /** While she walks home: the point of her way home (wayHome) she walks to now. */
  let leg = 0;
  const place = () => {
    if (!her) return;
    const root = her.beaver.root, p = phase === "home" ? HOME : where();
    root.position.set(p.x, world.heightAt(p.x, p.z), p.z);
    root.rotation.y = phase === "home" ? towards(HOME, world.site ?? { x: 0, z: 0 }) : towards(p, { x: 0, z: 0 });
  };
  void mrsBeaver(stage).then((h) => { her = h; place(); wear(); });
  /** Her flower behind her ear once freed, not while she is missing. */
  const wear = () => { if (her) her.flower = quest.step === "freed"; };

  /** A straight way over land from a to b, past nothing solid. */
  const clearLeg = (a: { x: number; z: number }, b: { x: number; z: number }) => {
    const d = Math.hypot(b.x - a.x, b.z - a.z), dir = { x: (b.x - a.x) / d, y: 0, z: (b.z - a.z) / d }, STEP = 0.25;
    for (let s = 0; s < d; s += STEP) {
      const x = a.x + dir.x * s, z = a.z + dir.z * s;
      if (world.heightAt(x, z) < world.waterLevel + 0.03) return false;
      // Knee high over the ground here, one step on: a trunk, a rock, a wall (the ground itself rises less than that).
      if (stage.physics.ray({ x, y: world.heightAt(x, z) + 0.4, z }, dir, Math.min(STEP, d - s), GROUND | SOLID)) return false;
    }
    return true;
  };
  /** Her way home from the pen, leg by leg, over land past nothing solid (rules.test.ts checks the six; this is the
   *  game's own check, for a world changed since). */
  const clearWay = () => {
    let from = where();
    for (const to of wayHome(quest.place)) { if (!clearLeg(from, to)) return false; from = to; }
    return true;
  };

  const list = questList(stage, ["Find her flower", "Find her tracks", "Find Mrs. Beaver", "Gnaw the pen open"]);
  const say = () => list.set(done(quest));
  say();

  const away = () => { const p = where(); return Math.hypot(player.feet.x - p.x, player.feet.z - p.z); };
  const toFlower = () => { const f = flowerAt(); return Math.hypot(player.feet.x - f.x, player.feet.z - f.z); };
  const toTracks = () => { const t = tracksAt(); return Math.hypot(player.feet.x - t.x, player.feet.z - t.z); };
  const offers = (carrying: boolean) => offered(quest, { flower: toFlower(), pen: away(), carrying, afloat: player.afloat || player.riding });
  const takeFlower = () => {
    if (!take(quest)) return;
    dropped?.dispose(); dropped = undefined;
    say();
    events.emit("goalDone", { goal: "mrs-beaver-flower", text: "Flower found" });
  };
  const freeHer = () => {
    fall();
    phase = clearWay() ? "walk" : "unseen";
    leg = 0;
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
      get tracks() { const t = tracksAt(); return { x: t.x, z: t.z }; },
      /** Every brush pile's place, hers among them (in the order of the hiding places). */
      get piles() { return HIDING.map((p) => ({ x: p.x, z: p.z })); },
      get step() { return quest.step; },
      get gnawed() { return quest.gnawed; },
      get state() { return quest.step === "freed" ? "freed" : "missing"; },
      /** Whether she wears her flower behind her ear. */
      get wears() { return !!her?.flower; },
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
        // The sticks an earlier pen fell into go (they are this browser's alone), at whichever pile it stood: every
        // pile stands clear again, and no stick by a wrong one takes the Use key.
        for (const stick of world.sticks.filter((t) => t.mesh.metadata?.local && t !== player.carrying && isEnabled(t.body))) {
          const at = stick.body.transformNode.position;
          if (HIDING.some((p) => Math.hypot(at.x - p.x, at.z - p.z) < 2)) { world.removeLoose?.(stick); stick.mesh.dispose(); }
        }
        shut();
        drop();
        press();
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
      // The step "Find her tracks": with her flower in the paws, on her tracks.
      if (quest.step === "tracks" && follow(quest, toTracks())) {
        say();
        events.emit("goalDone", { goal: "mrs-beaver-tracks", text: "Tracks found" });
      }
      // The step "Find Mrs. Beaver": once her tracks are found, within a few metres of her pile.
      if (quest.step === "find" && find(quest, away())) {
        say();
        events.emit("goalDone", { goal: "mrs-beaver-find", text: "Mrs. Beaver found" });
      }
      if (!her) return;
      const moving = stage.paused ? 0 : dt, root = her.beaver.root, feet = player.feet;
      const near = Math.hypot(feet.x - root.position.x, feet.z - root.position.z) < NEAR;
      let speed = 0;
      if (phase === "walk" && moving > 0) {
        const way = wayHome(quest.place), to = way[leg]!;
        const dx = to.x - root.position.x, dz = to.z - root.position.z, d = Math.hypot(dx, dz), step = Math.min(d, WALK * moving);
        if (d < 0.05) { if (++leg >= way.length) { phase = "home"; place(); } }
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
