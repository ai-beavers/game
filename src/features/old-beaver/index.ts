// The Old Beaver: an old, grey-muzzled beaver who sits hidden at the foot of the bank, among the trees at the
// Clearing's edge, always in the same place (rules.ts PLACE). Nothing on the map shows him. When the player's beaver
// comes within a few metres on land he turns to it and tells a Lore, line by line: each line murmured from where he
// sits (the oldBeaverSpeaks event; the audio feature plays it, one slow syllable a word) and shown in a speech box in
// the HUD under his name (panel.ts). Coming back after walking off, he tells the next lore, and after the last the
// first again. Walking off mid-lore he stops with a closing word and turns back.
//
//   import { create as oldBeaver } from "./features/old-beaver/index.ts";
//
// Only the local player's beaver drives him; other players' never do. Nothing is kept or sent: what he tells lives in
// this browser's memory for one visit, and the lores start at the first on each visit. He is no Animal: he never
// flees and is not saved; a small fixed collider keeps beavers from walking through him.
//
// Debug, for bun shot --eval and the tour (window.oldBeaver): .place (where he sits) · .state (idle, telling, away) ·
// .lore · .line (the lore and line told now) · .said (the line in the speech box) · .spoken (lines murmured so far) ·
// .facing (radians he faces) · .faces() (how far, radians, he is turned from the player's beaver) · .loaded ·
// .reset() (a visit anew: idle, the first lore next).
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { CreateFeature } from "../../game.ts";
import { RAPIER } from "../../engine.ts";
import { oldBeaver } from "./creature.ts";
import { speechBox } from "./panel.ts";
import { CLOSING, COLLIDER, lineTime, newVisit, PLACE, REST, tell, words, type Happening } from "./rules.ts";

const NEAR = 30; // m: within this he breathes and moves (his fur thins with distance by itself)
const TURN = 2.2; // how fast he turns, 1/s (eased)

/** The angle from a to b, wrapped to -π … π. */
const turnBetween = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export const create: CreateFeature = (game) => {
  const { stage, world, player, events } = game;
  const ground = world.heightAt(PLACE.x, PLACE.z), place = new Vector3(PLACE.x, ground + 0.35, PLACE.z);
  stage.physics.createCollider(RAPIER.ColliderDesc.cylinder(0.35, COLLIDER).setTranslation(PLACE.x, ground + 0.35, PLACE.z));

  let him: Awaited<ReturnType<typeof oldBeaver>> | undefined, facing = REST;
  void oldBeaver(stage).then((h) => {
    him = h;
    h.beaver.root.position.set(PLACE.x, ground, PLACE.z);
    h.beaver.root.rotation.y = facing;
  });

  const box = speechBox(stage);
  let visit = newVisit(), closing = 0, spoken = 0;
  /** He murmurs a line (or his closing word) from where he sits, and it shows under his name. */
  const speak = (text: string) => {
    box.say(text);
    spoken++;
    events.emit("oldBeaverSpeaks", { place: place.clone(), words: words(text) });
  };
  const act = (h: Happening) => {
    if (h.kind === "line") { closing = 0; speak(h.text); }
    else if (h.kind === "broke") { closing = lineTime(CLOSING); speak(CLOSING); }
    else if (h.kind === "ended") box.say("");
  };
  const away = () => Math.hypot(player.feet.x - PLACE.x, player.feet.z - PLACE.z);
  const towardsPlayer = () => Math.atan2(player.feet.x - PLACE.x, player.feet.z - PLACE.z);

  Object.assign(window, {
    oldBeaver: {
      place: { x: PLACE.x, z: PLACE.z },
      get state() { return visit.state; },
      get lore() { return visit.lore; },
      get line() { return visit.line; },
      get said() { return box.said; },
      get spoken() { return spoken; },
      get facing() { return facing; },
      get loaded() { return !!him; },
      faces: () => Math.abs(turnBetween(facing, towardsPlayer())),
      reset() { visit = newVisit(); closing = 0; box.say(""); },
    },
  });

  return {
    step(dt) {
      for (const h of tell(visit, { distance: away(), land: !player.afloat && !player.riding }, dt)) act(h);
      if (closing > 0 && (closing -= dt) <= 0) box.say("");
    },
    update(dt) {
      box.update();
      if (!him || stage.paused) return;
      // Turned to the player's beaver while he tells (and says his closing word), back to rest after.
      const target = visit.state === "telling" || closing > 0 ? towardsPlayer() : REST;
      facing += turnBetween(facing, target) * (1 - Math.exp(-TURN * dt));
      him.beaver.root.rotation.y = facing;
      if (away() < NEAR) him.update(dt);
    },
  };
};
