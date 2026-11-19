// Puts the parts together into the running game and hands every feature the same grip on it.
//
//   const game = await createGame(canvas, [audio, hud]);     index.html: all features; a lab page: just its own
//
// A feature is a function that takes the Game and returns what the loop should call:
//
//   export const create: CreateFeature = (game) => {
//     game.events.on("land", ({ place, speed }) => …);
//     return { step(dt) { …once per physics step… }, update(dt, alpha) { …once per picture… } };
//   };
//
// Address parameters, for looking at one situation: ?spawn=x,z puts the beaver there; ?standins uses the world's
// own stand-in models instead of assets/props.glb; ?anger=0.8.

import { createAnimator } from "./anim/index.ts";
import { loadBeaver } from "./beaver/index.ts";
import type { Animator, Beaver, World } from "./contracts.ts";
import { run, start, STEP, type Stage } from "./engine.ts";
import { createEvents, watch, type Events } from "./events.ts";
import { createPlayerControls, type PlayerControls } from "./player/index.ts";
import { OWN_LAYER } from "./player/camera.ts";
import { loadProps } from "./props/index.ts";
import { createSettings, type SettingsStore } from "./settings.ts";
import type { SkyState } from "./features/sky/index.ts";
import { createWorld } from "./world/index.ts";

export interface Game {
  stage: Stage;
  world: World;
  beaver: Beaver;
  animator: Animator;
  /** The Player of the contract plus its keyboard, camera, velocity and teleport. */
  player: PlayerControls;
  events: Events;
  settings: SettingsStore;
  /** The hour, the dark and the weather, once the sky feature runs (it puts itself here). */
  sky?: SkyState;
  /** The player's lantern, once the lantern feature runs (it puts itself here): out of the backpack, and switched
   *  off by a flash. */
  lantern?: { readonly out: boolean; readonly off: boolean };
}

export interface Feature {
  /** Once per physics step (STEP seconds), after the player has moved. Not called while stage.paused. */
  step?(dt: number): void;
  /** Once per picture, after beaver and world are updated; alpha as in run(). Called while paused too, with
   *  the real frame time: use stage.paused to hold still what belongs to the world. */
  update?(dt: number, alpha: number): void;
}
export type CreateFeature = (game: Game) => Feature | Promise<Feature>;

export async function createGame(canvas: HTMLCanvasElement, features: CreateFeature[] = []): Promise<Game> {
  const params = new URLSearchParams(location.search);
  const stage = await start(canvas);
  const [props, beaver] = await Promise.all([params.has("standins") ? undefined : loadProps(stage.scene), loadBeaver(stage.scene)]);
  const world = await createWorld(stage, props);
  const player = createPlayerControls(stage, { spawn: world.spawn, hand: beaver.hand, sticks: world.sticks, waterLevel: world.waterLevel });
  beaver.root.parent = player.node;
  // The player's own beaver, seen from its own eyes in the first-person view and left out of that picture.
  player.camera.eyes = beaver.eyes;
  for (const mesh of beaver.root.getChildMeshes()) mesh.layerMask = OWN_LAYER;
  const spawn = params.get("spawn")?.split(",").map(Number);
  if (spawn?.length === 2) player.teleport(spawn[0]!, world.heightAt(spawn[0]!, spawn[1]!), spawn[1]!);
  player.setAnger(Number(params.get("anger") ?? 0));

  // Half a second of standing still before anything else, so the beaver stands on the ground (and not in the
  // air it was put into) when a start screen holds the world.
  for (let step = 0; step < 30; step++) { player.step(STEP); stage.physics.step(); }

  const game: Game = { stage, world, beaver, animator: createAnimator(), player, events: createEvents(), settings: createSettings() };
  game.animator.pose(player.motion, 1);
  const notice = watch(player.motion, player.feet, game.events), parts: Feature[] = [];
  for (const create of features) parts.push(await create(game));
  Object.assign(window, { game });

  run(stage, (dt) => {
    player.step(dt);
    notice();
    for (const part of parts) part.step?.(dt);
  }, (dt, alpha) => {
    const moving = stage.paused ? 0 : dt;
    // Posed before the player moves the camera: the first-person view stands at the eyes of this picture's pose.
    beaver.pose(game.animator.pose(player.motion, moving));
    player.update(moving, alpha);
    beaver.anger = player.motion.anger;
    beaver.update(moving);
    world.update(moving, player.node.position);
    for (const part of parts) part.update?.(dt, alpha);
  });
  return game;
}
