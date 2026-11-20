// The Race (a viewer's wish): a ring of buoys round the middle of the pond, round the lodge, and a start line between
// two striped buoys off the canoe's bank. Paddling the canoe across the line starts a race and its clock; the beaver
// passes every buoy in order (the next one ringed in gold), and after the third lap the line again stops the clock.
// Getting out of the canoe abandons it. The race card at the top centre shows the lap, the time and the best time of
// this visit. rules.ts holds the rules.
//
//   import { create as race } from "./features/race/index.ts";     after canoe in FEATURES (it races the canoe)
//
// Each player races alone (docs/adr/0003): the race is never sent nor saved; the buoys, the same for everyone, have no
// colliders. No Experience comes from it. Events raceStart, buoyPassed { index }, lap { lap },
// raceFinish { time, best, newBest }, raceAbandon.
//
// Debug, for bun shot --eval (window.race): race.course (the buoys in order, the start line) · race.state (the race
// now) · race.best (the visit's best time, s, or undefined) · race.next (where to paddle next: a buoy, or the line).
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { CreateFeature } from "../../game.ts";
import { material } from "../../world/models.ts";
import { bankPlace } from "../canoe/place.ts";
import { raceCard } from "./card.ts";
import { course, newRace, stepRace, type Place, type RaceState } from "./rules.ts";

export const create: CreateFeature = (game) => {
  const { stage, world, player, events } = game;
  const pond = world.pond;
  if (!pond) return {};
  const level = () => world.waterLevel; // live: the pond rises with the dam
  const c = course(pond, bankPlace(pond, world.spawn, world.heightAt, level()));
  const { scene } = stage;

  // ---- the buoys: instances of two floats, a gold ring round the next one ----------------------------------------
  const red = material(scene, "buoy red", 0xc8462a), cream = material(scene, "buoy cream", 0xf3e6c8);
  const float = buildFloat(scene, red, cream), post = buildPost(scene, red, cream);
  const marks = [
    ...c.buoys.map((b, i) => ({ at: b, mesh: float.createInstance(`buoy ${i}`) })),
    ...[c.start.a, c.start.b].map((b, i) => ({ at: b, mesh: post.createInstance(`start buoy ${i}`) })),
  ];
  for (const { mesh } of marks) { mesh.isPickable = false; mesh.rotation.y = Math.random() * Math.PI * 2; }
  const gold = material(scene, "race ring", 0xf2a53a);
  const rings = [0, 1].map((i) => {
    const ring = MeshBuilder.CreateTorus(`race ring ${i}`, { diameter: 0.62, thickness: 0.05, tessellation: 28 }, scene);
    gold.emissiveColor = Color3.FromHexString("#f2a53a").scale(0.35); // seen at dusk, under the bloom's threshold at night
    ring.material = gold; ring.isPickable = false; ring.setEnabled(false);
    return ring;
  });

  // ---- the race, stepped from the beaver's feet ------------------------------------------------------------------
  let state: RaceState = newRace();
  const before = { x: player.feet.x, z: player.feet.z };
  const card = raceCard(stage);
  /** Where to paddle next: the next buoy, or the start line's middle once every buoy of the lap is passed (or idle). */
  const next = (): Place => state.race.kind === "racing" && state.race.next < c.buoys.length ? c.buoys[state.race.next]! : c.start.middle;

  Object.assign(window, {
    race: {
      course: c,
      get state() { return state.race; },
      get best() { return state.best; },
      get next() { return next(); },
    },
  });

  let time = 0;
  return {
    step(dt) {
      const now = { x: player.feet.x, z: player.feet.z };
      const r = stepRace(state, c, before, now, player.riding, dt);
      state = r.state;
      before.x = now.x; before.z = now.z;
      for (const e of r.events) {
        if (e.name === "raceStart") events.emit("raceStart", {});
        else if (e.name === "raceAbandon") events.emit("raceAbandon", {});
        else if (e.name === "buoyPassed") events.emit("buoyPassed", { index: e.index });
        else if (e.name === "lap") events.emit("lap", { lap: e.lap });
        else events.emit("raceFinish", { time: e.time, best: e.best, newBest: e.newBest });
      }
    },
    update(dt) {
      time += stage.paused ? 0 : dt;
      const y = level();
      marks.forEach(({ at, mesh }, i) => {
        mesh.position.set(at.x, y + 0.025 * Math.sin(time * 1.6 + i * 1.3), at.z);
        mesh.rotation.x = 0.06 * Math.sin(time * 1.1 + i), mesh.rotation.z = 0.06 * Math.cos(time * 1.3 + i * 0.7);
      });
      // The ring round what is next: a buoy, or both start buoys once the lap's buoys are all passed.
      const racing = state.race.kind === "racing", lapDone = racing && state.race.kind === "racing" && state.race.next >= c.buoys.length;
      const at = lapDone ? [c.start.a, c.start.b] : racing ? [next()] : [];
      const pulse = 1 + 0.08 * Math.sin(time * 5);
      rings.forEach((ring, i) => {
        const p = at[i];
        ring.setEnabled(!!p);
        if (!p) return;
        ring.position.set(p.x, y + 0.06 + 0.025 * Math.sin(time * 1.6), p.z);
        ring.scaling.setAll(pulse);
      });
      card.show(state.race, state.best);
    },
  };
};

/** Parts made into one mesh of several materials, for instances. */
function merge(parts: Mesh[], name: string) {
  for (const p of parts) p.receiveShadows = true;
  const mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
  mesh.name = name; mesh.receiveShadows = true; mesh.isPickable = false;
  mesh.isVisible = false; // the template: only its instances are drawn
  return mesh;
}

/** A buoy of the ring: a round red float half in the water, a cream band and a little red top. Its origin on the
 *  water line. */
function buildFloat(scene: Scene, red: Material, cream: Material) {
  const body = MeshBuilder.CreateSphere("buoy body", { diameter: 0.34, segments: 10 }, scene);
  body.scaling.y = 0.75; body.material = red; body.bakeCurrentTransformIntoVertices();
  const band = MeshBuilder.CreateCylinder("buoy band", { diameter: 0.33, height: 0.05, tessellation: 16 }, scene);
  band.position.y = 0.06; band.material = cream;
  const top = MeshBuilder.CreateCylinder("buoy top", { diameterTop: 0.03, diameterBottom: 0.1, height: 0.16, tessellation: 10 }, scene);
  top.position.y = 0.18; top.material = red;
  return merge([body, band, top], "buoy");
}

/** A start buoy: a taller post striped cream and red over a float, so the start line stands out. */
function buildPost(scene: Scene, red: Material, cream: Material) {
  const body = MeshBuilder.CreateSphere("start buoy body", { diameter: 0.4, segments: 10 }, scene);
  body.scaling.y = 0.7; body.material = cream; body.bakeCurrentTransformIntoVertices();
  const parts = [body];
  for (let k = 0; k < 4; k++) {
    const stripe = MeshBuilder.CreateCylinder("start buoy stripe", { diameter: 0.09 - k * 0.008, height: 0.14, tessellation: 10 }, scene);
    stripe.position.y = 0.12 + k * 0.14; stripe.material = k % 2 ? cream : red;
    parts.push(stripe);
  }
  const cap = MeshBuilder.CreateSphere("start buoy cap", { diameter: 0.1, segments: 8 }, scene);
  cap.position.y = 0.7; cap.material = red;
  parts.push(cap);
  return merge(parts, "start buoy");
}
