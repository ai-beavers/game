// What the parts of the game promise each other. Each part lives in its own folder and is built against this file
// alone, so the parts fit when they meet in main.ts.
//
//   src/beaver   the animal: mesh, fur, shirt; takes a Pose                       loadBeaver(scene) → Beaver
//   src/anim     how it moves: turns a Motion into a Pose, pure maths             createAnimator() → Animator
//   src/player   who steers it: input, kinematic capsule, camera; reports Motion   createPlayer(stage, options) → Player
//   src/world    where it lives: ground, pond, sky, things to carry               createWorld(stage, props?) → World
//   src/props    what stands around: trees, rocks, sticks, built in Blender       loadProps(scene) → Props
//
// Conventions (set in engine.ts): Babylon.js, right-handed, y up, 1 unit = 1 m. The beaver is 1 m tall, stands on
// y = 0 of its root and faces +z. Physics is Havok (src/physics.ts), stepped in fixed steps of STEP seconds by run() in engine.ts.
import type { Matrix, TransformNode, Quaternion, Vector3 } from "@babylonjs/core";
import type { Stage } from "./engine.ts";
import type { PhysicsBody } from "./physics.ts";

// ---- the beaver ------------------------------------------------------------------------------------------------

/** The rig in assets/beaver.glb (built by tools/blender/build.py). */
export const BONES = [
  "hips", "spine", "chest", "head", "tail1", "tail2", "brow_L", "brow_R",
  "upper_arm_L", "forearm_L", "hand_L", "upper_arm_R", "forearm_R", "hand_R",
  "thigh_L", "shin_L", "foot_L", "thigh_R", "shin_R", "foot_R",
] as const;
export type Bone = (typeof BONES)[number];

/** One bone as a glTF animation channel would hold it: local to its parent, in the glb's own axes.
 *  rotation is a quaternion [x, y, z, w]; translation is the full local offset, not a difference to rest. */
export interface BonePose { rotation: [number, number, number, number]; translation?: [number, number, number]; scale?: number }
/** Bones left out stand in their rest pose. */
export type Pose = Partial<Record<Bone, BonePose>>;

/** Where the backpack sits in the chest bone's space (x to the beaver's left, y up, z ahead, from the chest bone's
 *  head), m: on the back. The lantern feature puts it there; the animator reaches the left paw to it. */
export const BACKPACK = { y: -0.03, z: -0.17, height: 0.2 };

export type RGB = [number, number, number];
/** How the beaver is dressed. shirt: linear RGB the shirt's print is tinted by ([1, 1, 1]: as printed, cream);
 *  hat: the felt's colour, linear RGB (the band keeps its own), or the hood's grey when it wears one;
 *  hood: a shark's hood in the hat's place (a fin on top, teeth round the face) instead of the felt hat. Left out: a hat. */
export interface Look { shirt: RGB; hat: RGB; hood?: boolean }
/** The look every beaver has unless told otherwise. */
export const DEFAULT_LOOK: Look = { shirt: [1, 1, 1], hat: [0.075, 0.062, 0.058], hood: false };
/** The shirt's cream as printed, which the look's shirt colour tints: warm, to sit with the chestnut coat. */
export const SHIRT_CREAM = "#f1e8d6";

export interface Beaver {
  /** Move, turn or parent this. Feet on its y = 0, facing its +z. It throws and takes shadows by itself (its
   *  shape once, without the fur's many layers). */
  root: TransformNode;
  /** Between the eyes, on the head bone: where the beaver sees from (the first-person view). */
  eyes: TransformNode;
  /** The right hand; parent a carried thing to it. */
  hand: TransformNode;
  /** The left hand (the beaver's own left, its +x side). The lantern hangs below it; read where it is rather than
   *  parent to it, since the hand turns and grows into a fist. */
  leftHand: TransformNode;
  /** The chest bone: wear things on the trunk here (the backpack, at BACKPACK), so they follow every pose. */
  chest: TransformNode;
  /** 0 calm … 1 furious: redder, muscular, glowing eyes. */
  anger: number;
  /** Wears its T-shirt; false: fur all over. */
  shirt: boolean;
  /** Wears its headwear (on the head bone, so it follows every pose): the small felt hat, or the hood when the look
   *  says so; false: bare-headed. */
  hat: boolean;
  /** The colours of its shirt and hat, as one look (an Outfit, src/features/shop). Read: a copy of what it wears. */
  look: Look;
  /** The colour of its calm coat, linear RGB (anger reddens it from there). */
  coat: RGB;
  /** 0 … 1: grey with age on the muzzle, the face and the pale markings (the Old Beaver); 0 for every player. */
  grey: number;
  /** Puts every bone where the pose says; bones left out go to rest. */
  pose(pose: Pose): void;
  /** Once per frame, after pose(): whatever the look needs (fur density for the size on screen, …). */
  update(dt: number): void;
}

/** How fast the beaver goes over flat ground, m/s: walking, and running with Shift held. The player aims for
 *  these, the animator shapes its stride for them. */
export const WALK_SPEED = 0.8, RUN_SPEED = 2.0;

// ---- motion: what the body is doing, told by the player, drawn by the animator -----------------------------------

export type Action = "none" | "pickup" | "drop" | "gnaw" | "build";

export interface Motion {
  /** Speed over the ground, m/s. */
  speed: number;
  /** Metres walked on the ground since the start. The stride follows this, not the clock, so feet do not slide
   *  and stand still at a wall. */
  distance: number;
  /** How fast it is turning, radians/s, positive to its left. */
  turning: number;
  grounded: boolean;
  /** Vertical speed, m/s, up is positive. */
  vertical: number;
  /** Seconds since it left the ground; 0 on the ground. */
  airTime: number;
  /** Seconds since it last touched down; large when that was long ago. */
  sinceLanding: number;
  /** How hard it touched down, m/s; with sinceLanding it shapes the dip after a jump. */
  landingSpeed: number;
  /** 0 on land … 1 afloat. */
  swimming: number;
  /** What the arms and trunk are busy with, and how far along a one-time action is, 0 … 1. With action "none" a
   *  progress above 0 is the tail slap's (it travels to other players in the Motion as it is: src/features/net). */
  action: Action;
  actionProgress: number;
  /** Holds something in its right hand. */
  carrying: boolean;
  /** 0 … 1, as Beaver.anger. */
  anger: number;
  /** Seconds since the start, for breathing and other idle motion. */
  time: number;
  /** 0 … 1: how far the left paw is on its way to the backpack, over the left shoulder (0 at rest, 1 at the
   *  backpack). Only the left arm follows it; the right arm, a carried stick and the trunk do not. The lantern
   *  feature writes it into the local player's Motion; the player leaves it alone. Left out: 0 (remotes, bots). */
  reachBack?: number;
  /** Low on land, held by the player: "sit" on its haunches, tail flat on the ground; "crawl" low on all fours, the
   *  front paws stepping with the hind feet. Left out: standing (bots never go low). */
  low?: "sit" | "crawl";
  /** Sits in a canoe (with low "sit") and paddles it: the right arm strokes as the speed says, a paddle in the paw. Only
   *  the local player's own beaver tells it (src/features/canoe); left out: no paddle. */
  paddle?: boolean;
  /** The player switched the lantern off (a flash): its glass and its light dark. The lantern feature writes it into
   *  the local player's Motion; it travels to other players. Left out or false: on (bots never flash). */
  lanternOff?: boolean;
  /** Stands upright on the Hoverboard and glides: the feet together and still, the arms a little out to balance, no
   *  walk, bound or run cycle whatever the speed. The local player's Motion tells it on a land ride
   *  (src/features/hoverboard); it travels to other players, the board itself does not. Left out: no glide. */
  glide?: boolean;
  /** A Stare (GLOSSARY.md): the head turned to look along yaw and pitch, rad relative to the body (yaw 0 ahead, positive
   *  to its left; pitch positive up), by weight 0 … 1, unblinking and cocked a little to one side. The stare feature
   *  writes it into the local player's Motion each frame, so the eyes follow a moving camera. Left out: no stare
   *  (remotes and bots never stare; it does not travel). */
  stare?: { weight: number; yaw: number; pitch: number };
}

export interface Animator {
  /** The pose for this moment. Keeps what it needs to blend from one moment to the next. */
  pose(motion: Motion, dt: number): Pose;
}

// ---- the player ------------------------------------------------------------------------------------------------

/** A loose thing with a dynamic Havok body the beaver can pick up: the world makes them (and binds mesh to
 *  body with stage.bind), the player carries them. */
export interface Stick { mesh: TransformNode; body: PhysicsBody }

export interface PlayerOptions {
  /** Where the feet start. */
  spawn: Vector3;
  /** The beaver's right hand, to carry things in; without it nothing can be picked up. */
  hand?: TransformNode;
  /** Things that can be picked up. */
  sticks?: Stick[];
  /** Height of the water's surface; below it the beaver swims. Without it there is no water. */
  waterLevel?: number;
}

export interface Player {
  /** At the feet, turned the way the beaver faces. Add Beaver.root to it. */
  node: TransformNode;
  /** What the body is doing right now; the same object every frame, updated in place. */
  motion: Motion;
  /** Once per physics step, before it (run()'s `fixed`): reads the keys, moves the character. */
  step(dt: number): void;
  /** Once per frame (run()'s `frame`): places node between the last two steps, moves stage.camera. */
  update(dt: number, alpha: number): void;
}

// ---- the world -------------------------------------------------------------------------------------------------

export const PROP_NAMES = ["tree", "stump", "log", "stick", "rock", "crate", "reed"] as const;
export type PropName = (typeof PROP_NAMES)[number];
/** Models to place: per name its variants, each a disabled template in the game scene. A template stands on
 *  y = 0 around its own origin, y up, in metres; sticks and logs lie along their z. */
export type Props = Record<PropName, TransformNode[]>;

export interface World {
  /** A good place for the feet to start. */
  spawn: Vector3;
  sticks: Stick[];
  /** Height of the pond's surface. */
  waterLevel: number;
  /** Height of the ground at a place. */
  heightAt(x: number, z: number): number;
  /** Once per frame: water, grass in the wind; keeps the sun's shadows around `focus` (the player). */
  update(dt: number, focus: Vector3): void;
  /** The trees that can be felled, in a fixed order (the index is the tree's name in saved games). */
  trees?: WorldTree[];
  /** The flat building site at the water, and the pond it lies at; y of the site is its ground height. */
  site?: { x: number; z: number; radius: number; height: number };
  pond?: { x: number; z: number; radius: number };
  /** The models the world was built from, to make more of the same. */
  props?: Props;
  /** Puts a new loose thing into the world, its body's middle at `at`, its size in metres (sticks and logs lie along
   *  z). A stick also joins `sticks`, so it can be picked up. */
  addLoose?(kind: "stick" | "log", variant: number, size: Vector3, at: Vector3, turn: Quaternion, mass: number): Stick;
  /** Takes a loose thing out of the world: out of `sticks`, its body removed. The mesh stays where it is, for the
   *  caller to keep or take away. */
  removeLoose?(thing: Stick): void;
}

/** A tree standing in the world, which another part may take over (the build feature fells them). */
export interface WorldTree {
  /** The foot of the trunk, on the ground. */
  place: Vector3;
  /** Trunk radius at knee height, m. */
  radius: number;
  /** The template it is drawn from, and where: matrix takes template space into the world. */
  model: TransformNode;
  matrix: Matrix;
  /** No longer drawn by the world; whoever calls this draws it from now on. */
  hide(): void;
  /** No longer solid: its trunk collider is removed. */
  clear(): void;
}

export type LoadBeaver = (scene: import("@babylonjs/core").Scene) => Promise<Beaver>;
export type CreateAnimator = () => Animator;
export type CreatePlayer = (stage: Stage, options: PlayerOptions) => Player;
export type CreateWorld = (stage: Stage, props?: Props) => Promise<World>;
export type LoadProps = (scene: import("@babylonjs/core").Scene) => Promise<Props>;
