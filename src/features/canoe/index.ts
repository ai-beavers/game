// The Canoe (a viewer's wish): a small wooden canoe pulled up on the pond's bank near the spawn. With empty paws beside
// it, on land or swimming, E offers "Get in": the beaver sits in it with a paddle in its right paw and the move keys
// paddle it over the pond (Player.ride: faster than swimming, stopped by the shore and the lodge). E again gets out:
// onto the bank when it is near, else into the water beside the canoe, which stays where it was left, floating on the
// live water level (it rises with the dam). place.ts says where it lies and where the beaver goes.
//
//   import { create as canoe } from "./features/canoe/index.ts";     after shop in FEATURES (it shares the Use key)
//
// The canoe is the player's own (docs/adr/0003): one per browser, never sent, never saved: back on the bank after a
// reload. Others see a beaver sitting on the water (Motion.low "sit", the feet at the surface). Events canoeIn and
// canoeOut { outcome: "bank" | "water" }.
//
// Debug, for bun shot --eval (window.canoe): canoe.place (its middle and heading now) · canoe.bank (where it lies
// after a reload) · canoe.riding · canoe.at() (stands beside it facing it, empty-pawed).
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Node } from "@babylonjs/core/node.js";
import type { Stage } from "../../engine.ts";
import { box, enable, place, PhysicsMotionType, SOLID } from "../../physics.ts";
import type { CreateFeature } from "../../game.ts";
import { OWN_LAYER } from "../../player/camera.ts";
import type { Actor, Offer } from "../../player/index.ts";
import { material } from "../../world/models.ts";
import { BOW, DEPTH, DRAFT, HULL, SEAT, bankPlace, beside, launch, wayOut } from "./place.ts";

const IN: Offer = { action: "use", text: "Get in" }, OUT: Offer = { action: "use", text: "Get out" };

export const create: CreateFeature = (game) => {
  const { stage, world, player, beaver, events } = game;
  const pond = world.pond;
  if (!pond) return {};
  const level = () => world.waterLevel; // live: the pond rises with the dam
  const bank = bankPlace(pond, world.spawn, world.heightAt, level());
  /** Where the canoe is when nobody sits in it: its middle and heading. */
  const left = { x: bank.x, z: bank.z, heading: bank.heading };
  const hull = buildHull(stage), paddle = buildPaddle(stage);

  // Solid while it lies there (one box over the hull), so the beaver walks and swims round it; out of the way while
  // the beaver sits in it.
  const body = stage.physics.body(new TransformNode("canoe body", stage.scene), PhysicsMotionType.STATIC,
    box(stage.scene, HULL.beam / 2 - 0.02, 0.12, HULL.length / 2 - 0.1), SOLID);
  let settled = NaN; // the water level it was last put down at
  const settle = () => {
    settled = level();
    lie(hull, left, world.heightAt, settled);
    place(body, { x: hull.position.x, y: hull.position.y + 0.02, z: hull.position.z }, Quaternion.FromEulerAngles(hull.rotation.x, hull.rotation.y, 0));
  };
  settle();

  // ---- E: get in beside it with empty paws, get out wherever it is --------------------------------------------------
  let riding = false, wants: "in" | "out" | undefined;
  const canGetIn = (carrying: boolean) => !riding && !carrying && !player.diving && beside(player.feet, left);
  const before = player.actor;
  const actor: Actor = {
    begin(carrying) {
      if (riding) { wants = "out"; return undefined; }
      if (canGetIn(carrying)) { wants = "in"; return undefined; }
      return before?.begin(carrying);
    },
    offer(carrying) { return riding ? OUT : canGetIn(carrying) ? IN : before?.offer?.(carrying); },
    step(dt, held) { return before?.step(dt, held); },
  };
  player.actor = actor;

  const getIn = () => {
    const feet = launch(left, left.heading, world.heightAt, level());
    if (!feet) return;
    player.teleport(feet.x, level() + SEAT.height, feet.z, left.heading);
    player.ride({ seat: SEAT.height, depth: DEPTH, bow: BOW, draft: DRAFT });
    enable(body, false);
    riding = true;
    events.emit("canoeIn", { place: player.feet.clone() });
  };
  /** Keeps up where the canoe is with the beaver in it: its middle a little ahead of the feet. */
  const follow = () => {
    const f = player.facing;
    left.x = player.feet.x + Math.sin(f) * SEAT.back; left.z = player.feet.z + Math.cos(f) * SEAT.back; left.heading = Math.atan2(Math.sin(f), Math.cos(f));
  };
  /** Leaves the canoe where it was last with the beaver in it. */
  const leave = () => {
    riding = false;
    enable(body, true);
    settle();
  };
  const getOut = () => {
    const facing = player.facing, out = wayOut(player.feet, facing, world.heightAt, level());
    follow();
    leave();
    player.ride(undefined);
    if (out.outcome === "bank") player.teleport(out.x, world.heightAt(out.x, out.z) + 0.05, out.z, Math.atan2(out.x - player.feet.x, out.z - player.feet.z));
    else player.teleport(out.x, level() - 0.55, out.z, facing); // in up to the chest: it floats up to swimming depth
    events.emit("canoeOut", { place: player.feet.clone(), outcome: out.outcome });
  };

  // The right paw, its world matrix made current for this picture (the bones are posed after the scene last drew).
  const hand = beaver.hand, chain: TransformNode[] = [];
  for (let n: Node | null = hand; n; n = n.parent) if (n instanceof TransformNode) chain.unshift(n);

  Object.assign(window, {
    canoe: {
      get place() { return { ...left }; },
      /** Where it lies on the bank after a reload. */
      bank,
      get riding() { return riding; },
      /** Stands beside it, on its left, facing it, with empty paws. */
      at() {
        player.drop();
        const x = left.x + Math.cos(left.heading) * 0.75, z = left.z - Math.sin(left.heading) * 0.75;
        player.teleport(x, world.heightAt(x, z), z, left.heading - Math.PI / 2);
        player.camera.yaw = left.heading + Math.PI / 2 + 0.6;
        return { at: [+x.toFixed(2), +z.toFixed(2)] };
      },
    },
  });

  let time = 0;
  return {
    step() {
      if (riding && !player.riding) leave(); // put somewhere else (a teleport): the canoe stays where it was
      if (riding) follow();
      const now = wants;
      wants = undefined;
      if (now === "in" && !riding) getIn();
      else if (now === "out" && riding) getOut();
      // Left lying: put down again only when the water rose under it (a few heightAt lookups and two physics writes).
      // Riding, update() costs one bone chain's world matrices and a few vectors a frame: the paddle in the paw.
      if (!riding && level() !== settled) settle();
    },
    update(dt) {
      time += stage.paused ? 0 : dt;
      paddle.setEnabled(riding);
      if (!riding) return;
      // Under the beaver, at the picture's place between two steps: the seat at its feet, rocking a little.
      const node = player.node, f = node.rotation.y;
      hull.position.set(node.position.x + Math.sin(f) * SEAT.back, node.position.y - SEAT.height, node.position.z + Math.cos(f) * SEAT.back);
      hull.rotation.set(0.01 * Math.sin(time * 1.1), f, 0.025 * Math.sin(time * 1.7));
      // The paddle in the right paw: its shaft down past the hull's right side, slanting back, the blade in the water.
      for (const n of chain) n.computeWorldMatrix(true);
      const grip = hand.getAbsolutePosition(), ahead = new Vector3(Math.sin(f), 0, Math.cos(f)), right = new Vector3(-ahead.z, 0, ahead.x);
      const up = right.scale(-0.42).addInPlace(ahead.scale(0.12)).addInPlace(new Vector3(0, 1, 0)).normalize(); // along the shaft, to the grip
      const across = Vector3.Cross(up, ahead).normalize(), face = Vector3.Cross(across, up);
      paddle.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(across, up, face);
      paddle.position.copyFrom(grip);
    },
  };
};

/** Puts the hull at `at`: afloat at the level where the water is deep enough, else resting on the ground, its keel
 *  following the ground from stern to bow. */
function lie(hull: TransformNode, at: { x: number; z: number; heading: number }, heightAt: (x: number, z: number) => number, level: number) {
  const f = { x: Math.sin(at.heading), z: Math.cos(at.heading) }, half = HULL.length / 2 - 0.2;
  const keel = (d: number) => Math.max(heightAt(at.x + f.x * d, at.z + f.z * d), level - HULL.keel);
  const bow = keel(half), stern = keel(-half);
  hull.position.set(at.x, (bow + stern) / 2 + HULL.keel, at.z);
  hull.rotation.set(Math.atan2(stern - bow, 2 * half), at.heading, 0);
}

/** The hull, made in code: a pointed wooden shell open at the top (one ribbon from bow to stern, each cross-section
 *  round from gunwale to keel), two thwarts across, a gunwale rim. Its origin lies on the water line amidships, +z to
 *  the bow. */
function buildHull(stage: Stage) {
  const { scene } = stage;
  const root = new TransformNode("canoe", scene);
  root.rotationQuaternion = null;
  const wood = material(scene, "canoe wood", 0x9a5a2c), rim = material(scene, "canoe rim", 0x5c3418), light = material(scene, "canoe thwart", 0xc08850);
  const L = HULL.length / 2, sections = 24, around = 12;
  const halfBeam = (u: number) => HULL.beam / 2 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), 2.4)), 0.55);
  const keelAt = (u: number) => -HULL.keel + 0.05 * u * u; // a little rocker: the ends ride up
  const gunwaleAt = (u: number) => 0.15 + 0.1 * Math.pow(Math.abs(u), 4); // the sheer sweeps up to bow and stern
  const paths: Vector3[][] = [];
  for (let i = 0; i <= sections; i++) {
    const u = -1 + 2 * i / sections, w = halfBeam(u), k = keelAt(u), g = gunwaleAt(u), path: Vector3[] = [];
    for (let j = 0; j <= around; j++) {
      const a = -Math.PI / 2 + Math.PI * j / around;
      path.push(new Vector3(w * Math.sin(a), k + (g - k) * (1 - Math.pow(Math.cos(a), 0.7)), u * L));
    }
    paths.push(path);
  }
  const shell = MeshBuilder.CreateRibbon("canoe hull", { pathArray: paths, sideOrientation: Mesh.DOUBLESIDE }, scene);
  shell.material = wood;
  const part = (mesh: Mesh) => { mesh.parent = root; mesh.receiveShadows = true; mesh.isPickable = false; return mesh; };
  part(shell);
  // The rim along both gunwales: thin tubes on the top edge.
  for (const side of [-1, 1]) {
    const edge = paths.map((p) => side < 0 ? p[0]! : p[around]!);
    part(MeshBuilder.CreateTube("canoe gunwale", { path: edge, radius: 0.018, tessellation: 6 }, scene)).material = rim;
  }
  for (const z of [0.5, -0.62]) {
    const u = z / L, thwart = part(MeshBuilder.CreateBox("canoe thwart", { width: halfBeam(u) * 2 - 0.02, height: 0.025, depth: 0.09 }, scene));
    thwart.position.set(0, gunwaleAt(u) - 0.04, z);
    thwart.material = light;
  }
  // Dry inside: the pond is one sheet through everything, and would fill the hull below the water line. An unseen lid
  // across the hull at the water line, drawn after the hull and before the pond (alphaIndex 0, the pond's is 1), keeps
  // its depth there, so the pond is not drawn in the hull. A little above the line: the hull rocks.
  const LID = 0.02, waterline = (u: number) => { // half the hull's width at height LID, from the cross-section above
    const k = keelAt(u), t = (LID - k) / (gunwaleAt(u) - k);
    return t >= 1 ? 0 : halfBeam(u) * Math.sin(Math.acos(Math.pow(1 - t, 1 / 0.7))) * 0.97;
  };
  const sides = [-1, 1].map((s) => Array.from({ length: sections + 1 }, (_, i) => { const u = -1 + 2 * i / sections; return new Vector3(s * waterline(u), LID, u * L); }));
  const lid = MeshBuilder.CreateRibbon("canoe lid", { pathArray: sides, sideOrientation: Mesh.DOUBLESIDE }, scene);
  const unseen = new StandardMaterial("canoe lid", scene);
  unseen.disableColorWrite = true;
  unseen.forceDepthWrite = true;
  unseen.alpha = 0.99; // in the transparent pass, sorted by alphaIndex
  lid.material = unseen;
  lid.alphaIndex = 0;
  lid.parent = root;
  lid.isPickable = false; // receives no shadows, so it throws none (src/light.ts)
  return root;
}

/** The paddle: its origin at the grip, the shaft down along -y, the blade at the bottom, flat across x. */
function buildPaddle(stage: Stage) {
  const { scene } = stage;
  const root = new TransformNode("canoe paddle", scene);
  const wood = material(scene, "paddle wood", 0xc49a62);
  const shaft = MeshBuilder.CreateCylinder("paddle shaft", { height: 0.68, diameter: 0.028, tessellation: 8 }, scene);
  shaft.position.y = -0.22;
  const blade = MeshBuilder.CreateBox("paddle blade", { width: 0.13, height: 0.24, depth: 0.018 }, scene);
  blade.position.y = -0.62;
  const knob = MeshBuilder.CreateBox("paddle grip", { width: 0.08, height: 0.03, depth: 0.03 }, scene);
  knob.position.y = 0.12;
  for (const m of [shaft, blade, knob]) { m.parent = root; m.material = wood; m.isPickable = false; m.layerMask = OWN_LAYER; m.receiveShadows = true; }
  root.setEnabled(false);
  return root;
}
