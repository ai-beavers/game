// The Clear view (GLOSSARY.md; a viewer's wish): in the third-person view, the leaves of a tree, bush or reed that hide
// the beaver from the player's camera, or that the camera stands in, turn see-through for as long as they are in the
// way and come back after. The camera keeps the distance the player chose: its cast does not see leaves, and nothing
// here pulls it in for them. Trunks, rocks, crates, logs, the lodge and the ground have colliders and still bring it in.
//
// Only this client's picture changes (mesh visibility, see-through stand-ins): nothing travels, nothing is saved. The
// live tour plays with the player's own camera, so the stream shows exactly this.
//
// fade.ts finds the leaves near the beaver, decides what to fade (watch) and fades it (fader); volumes.ts is the
// geometry. The game runs without it.
import type { CreateFeature } from "../../game.ts";
import { GROUND, HEAVY, SOLID } from "../../physics.ts";
import { fader, occluders, watch } from "./fade.ts";
import { bodyPoints, enter, inside, KEEP_OUT, type Volume, type XYZ } from "./volumes.ts";

export const create: CreateFeature = (game) => {
  const { stage, player } = game;
  // Taken now, before the first picture: the backdrop's thin instances are all there (fade.ts: occluders).
  const fade = fader(stage.scene), near = occluders(stage.scene, player.node, fade.has), look = watch();
  let volumes: Volume[] = [];
  // The bank's bushes and far trees are thin instances, which cannot be faded one at a time: the camera keeps out of
  // those (they stand behind the bank, so this rarely moves it). Every other leaf it may stand in; that one fades.
  const room = (from: XYZ, to: XYZ) => {
    let t = Infinity;
    for (const v of volumes) if (v.round && v.tag === undefined && !inside(v, from)) t = Math.min(t, enter(v, from, to, KEEP_OUT));
    return Math.min(1, t);
  };
  player.camera.room = (from, direction, distance) => Math.max(0.05, room(from, from.add(direction.scale(distance))) * distance);
  // The ground, trunks, rocks, fallen trees, crates and logs in between: these hide the beaver too, though no leaf fades for them.
  const solid = (from: XYZ, to: XYZ) => {
    const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const dir = { x: (to.x - from.x) / d, y: (to.y - from.y) / d, z: (to.z - from.z) / d };
    return d > 0.15 && !!stage.physics.ray(from, dir, d - 0.1, GROUND | SOLID | HEAVY);
  };

  return {
    update(dt) {
      if (stage.paused) return;
      volumes = near(player.feet, dt);
      // Through the beaver's eyes nothing new fades; what is faded eases back.
      if (player.camera.view === "third-person") fade.want(look(dt, stage.camera.position, bodyPoints(player.feet), volumes, solid));
      fade.update(dt);
    },
  };
};
