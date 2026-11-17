// Another player's beaver: a real beaver (loadBeaver) with its own animator, moved smoothly between the updates
// its player sends, so it walks, runs, jumps, swims, carries and gnaws as it does on its own screen.
//
//   const remote = createRemote(stage, id, name);    starts loading the beaver; updates before it is ready are kept
//   remote.receive(state, now);                      on every "state" message
//   remote.update(dt);                               once a frame
//   remote.dispose();
//
// It is solid: a kinematic capsule as big as the player's, which the local beaver's character controller walks
// against but which never pushes it (two kinematic bodies do not meet in the solver) nor any loose thing (its
// collision groups touch nothing; the controller's queries ask for no groups, so they still see it).
import * as THREE from "three";
import { createAnimator } from "../../anim/index.ts";
import { loadBeaver } from "../../beaver/index.ts";
import type { Beaver } from "../../contracts.ts";
import { RAPIER, type Stage } from "../../engine.ts";
import { HEIGHT, RADIUS } from "../../player/index.ts";
import { newMotion } from "../../player/state.ts";
import { unpackMotion } from "./protocol.ts";
import { DELAY, Track } from "./track.ts";

// The sample is feet x y z, facing, then the 14 packed Motion numbers (protocol.ts): grounded, action and carrying
// jump from one value to the next instead of blending.
const FACING = 3, MOTION_AT = 4;
// The beaver's fur is never frustum culled (its shells leave the rest pose's bounds), so a beaver behind the camera
// would still draw every shell: this sphere round it decides instead, generous enough to keep its shadow in view.
const BOUNDS = new THREE.Sphere(new THREE.Vector3(), 1.6), frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4();
const STEPS = [3, 9, 11].map((i) => i + MOTION_AT);
const LIFT = HEIGHT / 2 + 0.02; // feet to the capsule's middle, with the player's gap to the ground
const NO_CONTACTS = 0x0002_0000; // member of group 1, takes contacts with no group

export function createRemote(stage: Stage, id: number, name: string) {
  const node = new THREE.Object3D();
  node.name = "net-remote";
  node.visible = false; // until the first update says where it is
  stage.scene.add(node);
  const track = new Track({ angles: [FACING], steps: STEPS }), animator = createAnimator(), motion = newMotion();
  const sample: number[] = [], motionValues: number[] = [];
  let beaver: Beaver | undefined, disposed = false, carry = -1, body: RAPIER.RigidBody | undefined;
  const ready = loadBeaver().then((b) => {
    if (disposed) return undefined;
    beaver = b;
    node.add(b.root);
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

    receive(p: [number, number, number], facing: number, packed: number[], now = performance.now()) {
      track.push(now, [...p, facing, ...packed]);
    },

    update(dt: number) {
      if (!track.samples.length) return;
      track.at(performance.now() - DELAY, sample);
      node.visible = true;
      node.position.set(sample[0]!, sample[1]!, sample[2]!);
      node.rotation.set(0, sample[FACING]!, 0);
      const middle = { x: sample[0]!, y: sample[1]! + LIFT, z: sample[2]! };
      if (!body) {
        body = stage.physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(middle.x, middle.y, middle.z));
        stage.physics.createCollider(RAPIER.ColliderDesc.capsule(HEIGHT / 2 - RADIUS, RADIUS).setCollisionGroups(NO_CONTACTS), body);
      } else body.setNextKinematicTranslation(middle);
      for (let i = MOTION_AT; i < sample.length; i++) motionValues[i - MOTION_AT] = sample[i]!;
      unpackMotion(motionValues, motion);
      if (!beaver) return;
      const pose = animator.pose(motion, dt); // always, so its blends go on while out of sight
      const camera = stage.camera;
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      BOUNDS.center.copy(node.position).y += 0.5;
      beaver.root.visible = frustum.setFromProjectionMatrix(viewProjection).intersectsSphere(BOUNDS);
      if (!beaver.root.visible) return;
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
      node.removeFromParent();
      // Its own geometry, materials and textures (loadBeaver makes them anew for each beaver).
      node.traverse((part) => {
        const mesh = part as THREE.Mesh;
        mesh.geometry?.dispose();
        for (const material of [mesh.material ?? []].flat()) {
          for (const value of Object.values(material)) if ((value as THREE.Texture)?.isTexture) (value as THREE.Texture).dispose();
          material.dispose();
        }
      });
    },
  };
}
export type Remote = ReturnType<typeof createRemote>;
