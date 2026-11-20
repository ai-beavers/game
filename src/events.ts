// What happens to the beaver, as events features can listen to (sound, dust, splashes, counters) instead of
// each watching the Motion themselves.
//
//   game.events.on("land", ({ place, speed }) => puff(place, speed));
//
// watch() derives them from the player's Motion once per physics step.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { gait } from "./anim/index.ts";
import type { Action, Motion } from "./contracts.ts";
import type { BuildChange } from "./features/build/rules.ts";
import { slapHits } from "./player/state.ts";

export interface GameEvents {
  /** A foot comes down while walking or running. */
  footstep: { place: Vector3; side: "L" | "R"; speed: number };
  /** Leaves the ground upwards. */
  jump: { place: Vector3 };
  /** Touches down; speed is how fast it fell, m/s. */
  land: { place: Vector3; speed: number };
  /** Starts to float, and stands on the ground again. */
  enterWater: { place: Vector3; speed: number };
  leaveWater: { place: Vector3 };
  /** Has a stick in its hand, and has let it go. */
  pickup: { place: Vector3 };
  drop: { place: Vector3 };
  /** A one-time or lasting action starts (never "none"). */
  action: { place: Vector3; action: Exclude<Action, "none"> };
  /** The tail comes down: a crack on the water (water true) or a thump on land; place is at the feet. remote:
   *  another player's (src/features/net/remote.ts). */
  tailSlap: { place: Vector3; water: boolean; remote?: boolean };
  /** Animals that noticed a tail slap and fled (src/features/life); count: how many. */
  startled: { place: Vector3; count: number };
  // From the build feature (src/features/build). `tree` is the index in World.trees.
  /** One bite into a tree; progress 0 … 1 towards its fall (standing) or towards breaking it into wood (lying). */
  gnaw: { place: Vector3; tree: number; progress: number };
  /** A gnawed tree starts to tip over; direction is horizontal, unit length, the way it falls. */
  treeFalls: { place: Vector3; tree: number; direction: Vector3 };
  /** Its crown hits the ground; speed m/s of the crown at that moment. place is where the crown hit. */
  treeLands: { place: Vector3; tree: number; speed: number };
  /** A fallen tree breaks into logs and sticks. */
  treeSplits: { place: Vector3; tree: number; logs: number; sticks: number };
  /** A stick has come to its place in the dam; count of total placed now. */
  stickPlaced: { place: Vector3; slot: number; count: number; total: number };
  /** The last stick is in: the dam is finished. */
  damFinished: { place: Vector3 };
  /** Where the pond's surface should be now that the dam holds water back (the water itself does not follow yet). */
  pondLevel: { level: number; rise: number };
  /** A goal of the build feature is reached; or (goal "mrs-beaver") Mrs. Beaver is freed. */
  goalDone: { goal: string; text: string };
  /** From the trade feature (src/features/trade): a good went into the backpack; count: how many of it are in it now. */
  goodTraded: { good: string; count: number };
  /** From the canoe feature (src/features/canoe): the beaver got into its canoe, and out of it again, onto the bank
   *  or into the water beside it. */
  canoeIn: { place: Vector3 };
  canoeOut: { place: Vector3; outcome: "bank" | "water" };
  /** From the flag feature (src/features/flag): the Flag caught fire, and has burnt down to a charred rag. */
  flagLit: { place: Vector3 };
  flagBurnt: { place: Vector3 };
  /** From the Old Beaver feature (src/features/old-beaver): he murmurs a line of a lore, or his closing word, one
   *  syllable a word, syllable s apart, from where he sits; for the local player only. words 0: he falls silent. */
  oldBeaverSpeaks: { place: Vector3; words: number; syllable: number };
  /** A change to the build feature's world state. remote false: made here, after it was applied (send it to others);
   *  emit it with remote true to apply a change that came from another player. */
  buildChange: { change: BuildChange; remote: boolean };
}

export interface Events {
  on<Name extends keyof GameEvents>(name: Name, listener: (event: GameEvents[Name]) => void): () => void;
  emit<Name extends keyof GameEvents>(name: Name, event: GameEvents[Name]): void;
}

export function createEvents(): Events {
  const listeners = new Map<string, Set<(event: never) => void>>();
  return {
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener as (event: never) => void);
      return () => void listeners.get(name)!.delete(listener as (event: never) => void);
    },
    emit(name, event) { for (const listener of listeners.get(name) ?? []) (listener as (e: typeof event) => void)(event); },
  };
}

/** Returns a function to call once per physics step, after the player's step. */
export function watch(motion: Motion, feet: Vector3, events: Events) {
  let before = { ...motion }, steps = 0, side: "L" | "R" = "L";
  return () => {
    const place = feet.clone();
    if (before.grounded && !motion.grounded && motion.vertical > 0.5) events.emit("jump", { place });
    if (!before.grounded && motion.grounded && motion.swimming < 0.5) events.emit("land", { place, speed: motion.landingSpeed });
    if (before.swimming < 0.5 && motion.swimming >= 0.5) events.emit("enterWater", { place, speed: Math.abs(before.vertical) });
    if (before.swimming >= 0.5 && motion.swimming < 0.5) events.emit("leaveWater", { place });
    if (!before.carrying && motion.carrying) events.emit("pickup", { place });
    // A stick built into the dam leaves the hand too, but is not dropped.
    if (before.carrying && !motion.carrying && motion.action !== "build" && before.action !== "build") events.emit("drop", { place });
    if (motion.action !== before.action && motion.action !== "none") events.emit("action", { place, action: motion.action });
    if (slapHits(before, motion)) events.emit("tailSlap", { place, water: motion.swimming >= 0.5 });
    // One footstep per half stride, counted in the stride the animator uses at this speed.
    if (motion.grounded) steps += (motion.distance - before.distance) / (gait(motion.speed, motion.anger).cycle / 2);
    if (steps >= 1) {
      steps %= 1;
      events.emit("footstep", { place, side, speed: motion.speed });
      side = side === "L" ? "R" : "L";
    }
    before = { ...motion };
  };
}
