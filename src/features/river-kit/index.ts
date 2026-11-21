// The River kit: the beaver's child, a small four-legged beaver that keeps to the player's beaver. It trots after it
// over the meadow, runs to catch up, and when the beaver stands still it noses in the ground, looks about or sits.
// It never goes into the water: when the beaver swims or paddles off, it waits on the bank and looks after it.
//
//   import { create as riverKit } from "./features/river-kit/index.ts";
//
// Each player has their own: it follows only the local player's beaver, and nothing is kept or sent (as the Bear,
// docs/adr/0009). How it decides lives in rules.ts (pure, tested), its mesh and clips in assets/kit.glb
// (tools/comfyui, tools/blender/kit.py).
//
// Debug, for bun shot --eval and the tour (window.riverKit): .x · .z · .speed · .following · .doing.
//
// shortcut: it has no body of its own: the beaver walks through it, and it through logs and rocks (it goes round
// trees and water). Give it a collider and the ground's obstacles if that shows in play.
//
// Cost per frame: one skinned mesh of 15,000 triangles and one sampled clip.
import type { CreateFeature } from "../../game.ts";
import { loadKit } from "./model.ts";
import { newKit, step } from "./rules.ts";

const TRUNK = 0.45; // m from a trunk's middle it keeps
const DRY = 0.04; // m above the water the ground must be for it to tread there
const turnBetween = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export const create: CreateFeature = async (game) => {
  const { stage, world, player } = game;
  const model = await loadKit(stage.scene);
  const trunks = (world.trees ?? []).map((t) => ({ x: t.place.x, z: t.place.z }));
  const free = (x: number, z: number) => world.heightAt(x, z) > world.waterLevel + DRY && trunks.every((t) => Math.hypot(t.x - x, t.z - z) > TRUNK);
  // It starts a step behind the beaver, on the side that is dry.
  const behind = [Math.PI, Math.PI / 2, -Math.PI / 2, 0].map((a) => ({ x: player.feet.x + Math.sin(player.facing + a) * 1.2, z: player.feet.z + Math.cos(player.facing + a) * 1.2 }));
  const start = behind.find((p) => free(p.x, p.z)) ?? behind[0]!;
  const kit = newKit(start.x, start.z);
  kit.heading = player.facing;
  const before = { x: kit.x, z: kit.z, heading: kit.heading };
  Object.assign(window, { riverKit: kit });

  return {
    step(dt) {
      Object.assign(before, { x: kit.x, z: kit.z, heading: kit.heading });
      step(kit, { x: player.feet.x, z: player.feet.z, land: !player.afloat && !player.riding }, free, dt, Math.random);
    },
    update(dt, alpha) {
      const x = before.x + (kit.x - before.x) * alpha, z = before.z + (kit.z - before.z) * alpha;
      const heading = before.heading + turnBetween(before.heading, kit.heading) * alpha;
      model.root.position.set(x, world.heightAt(x, z), z);
      model.root.rotation.y = heading;
      if (!stage.paused) model.update(kit, dt, x, z);
    },
  };
};
