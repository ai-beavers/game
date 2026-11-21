// The River kit: the beaver's child, a small four-legged beaver that keeps to the player's beaver. It waddles after
// it over the meadow, bounds to catch up, swims after it through the water and steps out of its way. When the beaver
// stands still it noses in the ground, looks about, sits up, grooms or sits; when the beaver stays, sooner in the
// dark, it lies down and sleeps until the beaver goes. In the water it only paddles.
//
//   import { create as riverKit } from "./features/river-kit/index.ts";
//
// Each player has their own: it follows only the local player's beaver, and nothing is kept or sent (as the Bear,
// docs/adr/0009). How it decides lives in rules.ts (pure, tested), its mesh and clips in assets/kit.glb
// (tools/comfyui, tools/blender/kit.py).
//
// Debug, for bun shot --eval and the tour (window.riverKit): .x · .z · .speed · .following · .doing.
//
// It goes round the water and whatever stands or lies solid on the ground (trees, rocks, logs, the lodge), and climbs
// onto what is low: a deck, a bench, a crate. It has no solid body of its own: one stood in the beaver's way where
// the kit could not make room in time (still getting up, or cornered), and a child must never block its parent.
//
// Cost per frame: one skinned mesh of 15,000 triangles, drawn once for each layer of its fur (ten within 3 m of the
// camera, one beyond 12 m), its long hair (12,000 triangles, cut out), one sampled clip and four rays for the ground
// under its paws. A step on its way asks two rays and two overlaps of the ground ahead; going round something, up
// to 26 times that.
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { CreateFeature } from "../../game.ts";
import { ball, HEAVY, SOLID } from "../../physics.ts";
import { loadKit, SIZE } from "./model.ts";
import { newKit, step } from "./rules.ts";

const FLOAT = 0.19; // m of it under the water when it swims: where the water is deeper than that, it is afloat
const BODY = 0.22; // m: the room it needs between solid things, a ball round its trunk
const PAWS = 0.12 * SIZE, FLANK = 0.06 * SIZE; // m from its middle to its fore and hind paws, and to each side
const DARK = 0.5; // of the sky's dark from which it is night to the kit
const CLIMB = 0.45; // m above the ground it steps up onto
const SETTLE = 12; // 1/s its height follows a step up or down
const turnBetween = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export const create: CreateFeature = async (game) => {
  const { stage, world, player } = game, { scene, physics } = stage;
  const model = await loadKit(scene);
  const room = ball(scene, BODY), still = Quaternion.Identity(), middle = new Vector3(), down = Vector3.Down();
  /** m above the ground of what lies on it at x, z, up to a metre (rays that start inside a thing miss it: a trunk). */
  const laid = (x: number, z: number, ground: number) => 1 - (physics.ray(middle.set(x, ground + 1, z), down, 1, SOLID | HEAVY)?.distance ?? 1);
  /** The pond's level now (src/world/water.ts keeps it in scene.metadata: the dam raises it). */
  const level = () => (scene.metadata?.water as { level: number } | undefined)?.level ?? world.waterLevel;
  /** What carries it at x, z: the ground, or the water where that is deep enough to swim. */
  const bed = (x: number, z: number) => Math.max(world.heightAt(x, z), level() - FLOAT);
  /** The height it is at: on what carries it, or on what is laid on that. */
  const floor = (x: number, z: number) => { const base = bed(x, z); return base + laid(x, z, base); };
  const swims = (x: number, z: number) => world.heightAt(x, z) < level() - FLOAT;
  // Free: nothing too high to climb under its paws, and nothing above what it climbs in its way (a trunk, a wall).
  const free = (x: number, z: number) => {
    const base = bed(x, z), on = laid(x, z, base);
    return on < CLIMB && !physics.overlaps(room, still, middle.set(x, base + on + CLIMB + BODY, z), SOLID | HEAVY);
  };
  // It starts a step behind the beaver, where there is room.
  const behind = [Math.PI, Math.PI / 2, -Math.PI / 2, 0].map((a) => ({ x: player.feet.x + Math.sin(player.facing + a) * 1.2, z: player.feet.z + Math.cos(player.facing + a) * 1.2 }));
  const start = behind.find((p) => free(p.x, p.z)) ?? behind[0]!;
  const kit = newKit(start.x, start.z);
  kit.heading = player.facing;
  const before = { x: kit.x, z: kit.z, heading: kit.heading };
  let height = floor(kit.x, kit.z);
  Object.assign(window, { riverKit: kit });

  return {
    step(dt) {
      Object.assign(before, { x: kit.x, z: kit.z, heading: kit.heading });
      step(kit, { x: player.feet.x, z: player.feet.z, land: !player.afloat && !player.riding }, free, dt, Math.random, (game.sky?.dark ?? 0) > DARK, swims(kit.x, kit.z));
    },
    update(dt, alpha) {
      const x = before.x + (kit.x - before.x) * alpha, z = before.z + (kit.z - before.z) * alpha;
      const heading = before.heading + turnBetween(before.heading, kit.heading) * alpha;
      // It leans with the ground under its paws, uphill, downhill and across a bank.
      const dx = Math.sin(heading), dz = Math.cos(heading);
      const fore = floor(x + dx * PAWS, z + dz * PAWS), hind = floor(x - dx * PAWS, z - dz * PAWS);
      const across = floor(x + dz * FLANK, z - dx * FLANK) - floor(x - dz * FLANK, z + dx * FLANK);
      height += ((fore + hind) / 2 - height) * Math.min(1, dt * SETTLE);
      model.root.position.set(x, height, z);
      model.root.rotation.set(Math.atan((hind - fore) / (2 * PAWS)), heading, Math.atan(across / (2 * FLANK)));
      if (!stage.paused) model.update(kit, dt, x, z, Math.min(1, Math.max(0, (level() - height) / FLOAT)));
    },
  };
};
