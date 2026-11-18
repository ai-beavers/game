// Another player's beaver: a real beaver (loadBeaver) with its own animator, moved smoothly between the updates
// its player sends, so it walks, runs, jumps, swims, carries, gnaws and slaps its tail as it does on its own screen.
//
//   const remote = createRemote(stage, id, name);    starts loading the beaver; updates before it is ready are kept
//   remote.receive(state, now);                      on every "state" message
//   remote.update(dt);                               once a frame
//   remote.dispose();
//
// It is solid: a kinematic capsule as big as the player's, which the local beaver's character controller walks
// against but which never pushes it (two kinematic bodies do not meet in the solver) nor any loose thing (its
// collision groups touch nothing; the controller's queries ask for no groups, so they still see it).
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { createAnimator } from "../../anim/index.ts";
import { loadBeaver } from "../../beaver/index.ts";
import type { Beaver } from "../../contracts.ts";
import { RAPIER, type Stage } from "../../engine.ts";
import { HEIGHT, RADIUS } from "../../player/index.ts";
import { newMotion, slapHits } from "../../player/state.ts";
import type { Game } from "../../game.ts";
import { unpackMotion } from "./protocol.ts";
import { doing as doingOf } from "./tags.ts";
import { DELAY, Track } from "./track.ts";

// The sample is feet x y z, facing, then the 14 packed Motion numbers (protocol.ts): grounded, action and carrying
// jump from one value to the next instead of blending; actionProgress blends only within one action (the tail slap's
// is action "none"'s, and must not run up from a gnaw's).
const FACING = 3, MOTION_AT = 4;
const STEPS = [3, 9, 11].map((i) => i + MOTION_AT), FOLLOWS = { [10 + MOTION_AT]: 9 + MOTION_AT };
const LIFT = HEIGHT / 2 + 0.02; // feet to the capsule's middle, with the player's gap to the ground
const NO_CONTACTS = 0x0002_0000; // member of group 1, takes contacts with no group
const CLOCK = 13, HOLD = 1500; // the Motion's time in the packed list; ms a short action (a build) stays on its tag

export function createRemote(stage: Stage, id: number, name: string) {
  const node = new TransformNode("net-remote", stage.scene);
  node.setEnabled(false);
  const track = new Track({ angles: [FACING], steps: STEPS, follows: FOLLOWS }), animator = createAnimator(), motion = newMotion();
  const sample: number[] = [], motionValues: number[] = [];
  let before = { ...motion };
  let beaver: Beaver | undefined, disposed = false, carry = -1, body: RAPIER.RigidBody | undefined;
  let clock = -1, ticked = performance.now(), doing = "", since = 0;
  const ready = loadBeaver(stage.scene).then((b) => {
    if (disposed) { b.root.dispose(false, true); return undefined; }
    beaver = b;
    b.root.parent = node;
    return b;
  });

  return {
    id, node, name, ready,
    /** The stick it holds, -1 for none, as its last update said. */
    get carry() { return carry; },
    set carry(value: number) { carry = value; },
    get beaver() { return beaver; },
    /** Where its feet are now on this screen. */
    get feet() { return node.position; },
    /** What it is busy with, for its tag (tags.ts doing): "" for nothing. */
    get doing() { return doing; },

    receive(p: [number, number, number], facing: number, packed: number[], now = performance.now()) {
      track.push(now, [...p, facing, ...packed]);
      if (packed[CLOCK] !== clock) { clock = packed[CLOCK]!; ticked = now; }
    },

    update(dt: number) {
      if (!track.samples.length) return;
      track.at(performance.now() - DELAY, sample);
      node.setEnabled(true);
      node.position.set(sample[0]!, sample[1]!, sample[2]!);
      node.rotation.set(0, sample[FACING]!, 0);
      const middle = { x: sample[0]!, y: sample[1]! + LIFT, z: sample[2]! };
      if (!body) {
        body = stage.physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(middle.x, middle.y, middle.z));
        stage.physics.createCollider(RAPIER.ColliderDesc.capsule(HEIGHT / 2 - RADIUS, RADIUS).setCollisionGroups(NO_CONTACTS), body);
      } else body.setNextKinematicTranslation(middle);
      for (let i = MOTION_AT; i < sample.length; i++) motionValues[i - MOTION_AT] = sample[i]!;
      unpackMotion(motionValues, motion);
      // Its tail slap is heard and seen here too: sound, splash and animals listen to the same event as for our own.
      if (slapHits(before, motion)) (window as { game?: Game }).game?.events.emit("tailSlap", { place: node.position.clone(), water: motion.swimming >= 0.5, remote: true });
      before = { ...motion };
      const now = performance.now(), busy = doingOf(motion, now - ticked);
      if (busy || now - since > HOLD) { doing = busy; since = now; }
      if (!beaver) return;
      const pose = animator.pose(motion, dt); // always, so its blends go on while out of sight
      beaver.anger = motion.anger;
      beaver.pose(pose);
      beaver.update(dt);
    },

    /** Its capsule, once it has been seen. */
    get body() { return body; },

    dispose() {
      disposed = true;
      if (body) stage.physics.removeRigidBody(body);
      body = undefined;
      node.dispose(false, true);
    },
  };
}
export type Remote = ReturnType<typeof createRemote>;
