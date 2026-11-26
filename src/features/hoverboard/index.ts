// The Hoverboard (a viewer's wish): a wooden plank the beaver's size, floating a hand's width over the grass beside the
// path near the spawn, a soft glow under it. With empty paws beside it, on land, E offers "Step on": the beaver stands
// upright on it and the move keys glide it over the land at BOARD_SPEED (Player.ride on land: up and down the ground,
// round trees and rocks, stopped at the shore, never over the water). E again offers "Step off": onto the ground beside
// it, and the board stays where it was left. A bear's Swipe knocks the beaver off, and the board stays there too.
// place.ts says where it lies and where the beaver goes.
//
//   import { create as hoverboard } from "./features/hoverboard/index.ts";   after canoe in FEATURES (it shares E)
//
// The board is the player's own (docs/adr/0003, as the canoe): one per browser, never sent, never saved: back by the
// spawn after a reload. Others see a beaver standing upright and gliding (Motion.glide), not the board. Events boardOn
// and boardOff { outcome: "step" | "knocked" }.
//
// Debug, for bun shot --eval (window.hoverboard): hoverboard.place (its middle and heading now) · hoverboard.home
// (where it lies after a reload) · hoverboard.riding · hoverboard.at() (stands beside it, empty-pawed).
import { Quaternion } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Stage } from "../../engine.ts";
import { box, enable, place, PhysicsMotionType, SOLID } from "../../physics.ts";
import type { CreateFeature } from "../../game.ts";
import type { Actor, Offer } from "../../player/index.ts";
import { BOARD_SPEED } from "../../player/state.ts";
import { pathAt } from "../../world/terrain.ts";
import { material } from "../../world/models.ts";
import { HOVER, PLANK, homePlace, near, stepOff } from "./place.ts";

const ON: Offer = { action: "use", text: "Step on" }, OFF: Offer = { action: "use", text: "Step off" };
/** m: the solid box over the board while it lies there, to its top. Higher than the beaver steps up (0.15 m), so it
 *  walks round it, not onto it. */
const SOLID_TOP = 0.3;

export const create: CreateFeature = (game) => {
  const { stage, world, player, events } = game;
  const level = () => player.waterLevel ?? -Infinity;
  const home = homePlace(world.spawn, pathAt, world.heightAt, level());
  /** Where the board is when nobody stands on it: its middle and heading. */
  const left = { x: home.x, z: home.z, heading: home.heading };
  const board = buildBoard(stage);

  // Solid while it lies there, so the beaver walks round it; out of the way while the beaver rides it.
  const body = stage.physics.body(new TransformNode("hoverboard body", stage.scene), PhysicsMotionType.STATIC,
    box(stage.scene, PLANK.width / 2, SOLID_TOP / 2, PLANK.length / 2), SOLID);
  const lie = () => {
    const ground = world.heightAt(left.x, left.z);
    board.position.set(left.x, ground + HOVER, left.z);
    board.rotation.set(0, left.heading, 0);
    place(body, { x: left.x, y: ground + SOLID_TOP / 2, z: left.z }, Quaternion.FromEulerAngles(0, left.heading, 0));
  };
  lie();

  // ---- E: step on beside it with empty paws, step off wherever it is ----------------------------------------------
  let riding = false, wants: "on" | "off" | undefined;
  const canStepOn = (carrying: boolean) => !riding && !carrying && !player.riding && !player.afloat && !player.diving && player.motion.grounded && near(player.feet, left);
  const before = player.actor;
  const actor: Actor = {
    begin(carrying) {
      if (riding) { wants = "off"; return undefined; }
      if (canStepOn(carrying)) { wants = "on"; return undefined; }
      return before?.begin(carrying);
    },
    offer(carrying) { return riding ? OFF : canStepOn(carrying) ? ON : before?.offer?.(carrying); },
    step(dt, held) { return before?.step(dt, held); },
  };
  player.actor = actor;

  const stepOn = () => {
    enable(body, false);
    const ground = world.heightAt(left.x, left.z);
    player.teleport(left.x, ground + 0.02, left.z, left.heading);
    player.ride({ on: "land", hover: HOVER, speed: BOARD_SPEED });
    riding = true;
    events.emit("boardOn", { place: player.feet.clone() });
  };
  /** Keeps up where the board is with the beaver on it: under its feet, along its facing. */
  const follow = () => { left.x = player.feet.x; left.z = player.feet.z; left.heading = Math.atan2(Math.sin(player.facing), Math.cos(player.facing)); };
  /** Leaves the board where it was last with the beaver on it. */
  const leave = () => {
    riding = false;
    lie();
    enable(body, true);
  };
  const stepDown = () => {
    follow();
    // The side the player looks to: the camera's way (its yaw looks from +z round to -z, see camera.gaze).
    const look = player.camera.yaw + Math.PI;
    const clear = (x: number, z: number) => !stage.physics.overlaps(body.shape!, Quaternion.Identity(), { x, y: world.heightAt(x, z) + 0.35, z }, SOLID);
    const out = stepOff(left, look, world.heightAt, level(), clear);
    player.ride(undefined);
    player.teleport(out.x, world.heightAt(out.x, out.z) + 0.05, out.z, player.facing);
    leave();
    events.emit("boardOff", { place: player.feet.clone(), outcome: "step" });
  };

  Object.assign(window, {
    hoverboard: {
      get place() { return { ...left }; },
      /** Where it lies after a reload. */
      home,
      get riding() { return riding; },
      /** Stands beside it, on its left, facing along it, with empty paws. */
      at() {
        player.drop();
        const x = left.x + Math.cos(left.heading) * 0.6, z = left.z - Math.sin(left.heading) * 0.6;
        player.teleport(x, world.heightAt(x, z), z, left.heading);
        player.camera.yaw = left.heading + Math.PI + 0.5;
        return { at: [+x.toFixed(2), +z.toFixed(2)] };
      },
    },
  });

  let time = 0;
  return {
    step() {
      if (riding && !player.riding) { // off without E: knocked off (a Swipe tosses it), or put somewhere else
        const knocked = !player.motion.grounded;
        leave();
        if (knocked) events.emit("boardOff", { place: player.feet.clone(), outcome: "knocked" });
      }
      if (riding) follow();
      const now = wants;
      wants = undefined;
      if (now === "on" && !riding) stepOn();
      else if (now === "off" && riding) stepDown();
    },
    update(dt) {
      time += stage.paused ? 0 : dt;
      if (!riding) { board.position.y = world.heightAt(left.x, left.z) + HOVER + 0.012 * Math.sin(time * 2.1); return; } // bobbing a little
      // Under the beaver, at the picture's place between two steps: the plank's top at its feet.
      const node = player.node;
      board.position.set(node.position.x, node.position.y, node.position.z);
      board.rotation.set(0, node.rotation.y, 0);
    },
  };
};

/** The board, made in code: a plain wooden plank, its ends rounded, two dark bands across, and a soft glow under it.
 *  Its origin is at the plank's top middle, +z to its nose. */
function buildBoard(stage: Stage) {
  const { scene } = stage;
  const root = new TransformNode("hoverboard", scene);
  root.rotationQuaternion = null;
  const wood = material(scene, "hoverboard wood", 0xb07a44), band = material(scene, "hoverboard band", 0x5c3a1e);
  const part = <T extends { parent: unknown; receiveShadows: boolean; isPickable: boolean }>(mesh: T) => { mesh.parent = root; mesh.receiveShadows = true; mesh.isPickable = false; return mesh; };
  const t = PLANK.thickness, straight = PLANK.length - PLANK.width;
  const plank = part(MeshBuilder.CreateBox("hoverboard plank", { width: PLANK.width, height: t, depth: straight }, scene));
  plank.position.y = -t / 2;
  plank.material = wood;
  for (const end of [-1, 1]) { // the rounded nose and tail
    const cap = part(MeshBuilder.CreateCylinder("hoverboard end", { diameter: PLANK.width, height: t, tessellation: 16, arc: 0.5 }, scene));
    cap.position.set(0, -t / 2, end * straight / 2);
    cap.rotation.y = end > 0 ? -Math.PI / 2 : Math.PI / 2;
    cap.material = wood;
  }
  for (const z of [-0.3, 0.3]) {
    const strip = part(MeshBuilder.CreateBox("hoverboard band", { width: PLANK.width + 0.004, height: t + 0.004, depth: 0.05 }, scene));
    strip.position.set(0, -t / 2, z * straight);
    strip.material = band;
  }
  // The glow: a flat soft oval just under the plank, lit by itself, faint enough not to bloom at night.
  const glow = MeshBuilder.CreateDisc("hoverboard glow", { radius: 0.5, tessellation: 24 }, scene);
  glow.rotation.x = Math.PI / 2;
  glow.scaling.set(PLANK.width * 1.3, PLANK.length * 1.1, 1);
  glow.position.y = -t - 0.03;
  glow.parent = root;
  glow.isPickable = false;
  const light = new StandardMaterial("hoverboard glow", scene);
  light.disableLighting = true;
  light.emissiveColor = new Color3(0.45, 0.85, 0.75);
  light.alpha = 0.35;
  light.backFaceCulling = false;
  glow.material = light;
  return root;
}
