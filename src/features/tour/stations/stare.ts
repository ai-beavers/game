// The Stare (src/features/stare): left alone on land for a minute of game time (a quarter of it in the fast tour), the
// beaver turns round and looks straight into the player's camera; any input ends it at once and does what it always
// does. Live it stares into the stream's camera, the player's own, behind the beaver.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { inv, rotate } from "../../../anim/quat.ts";
import { REST } from "../../../anim/rest.ts";
import { THRESHOLD, TURN } from "../../stare/stare.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

const ACTIVITY = "Left alone";
const AIMED = (15 * Math.PI) / 180; // rad between the face and the way to the camera that counts as looking into it
/** The face's forward on the head bone: the way the head looks at rest (+z, as the beaver faces). */
const FACE = Vector3.FromArray(rotate(inv(REST.head.armatureRotation), [0, 0, 1]));

export const stare = (kit: Kit): Station[] => {
  const { player, stage, beaver, world, live, wait, until, walkTo, press, expect } = kit;
  /** rad between where the face looks and the way from the eyes to the camera, in this picture. */
  const off = () => {
    const look = Vector3.TransformNormal(FACE, beaver.eyes.getWorldMatrix()).normalize();
    const way = stage.camera.position.subtract(beaver.eyes.getAbsolutePosition()).normalize();
    return Math.acos(Math.min(1, Vector3.Dot(look, way)));
  };
  const deg = (rad: number) => `${((rad * 180) / Math.PI).toFixed(0)}°`;
  /** Hands off every control until the beaver looks into the camera. */
  const leftAlone = async () => {
    await until(() => !!player.motion.stare && player.motion.stare.weight >= 1 && off() < AIMED, THRESHOLD + TURN + 6,
      `left alone for ${THRESHOLD + TURN + 6} s of game time, the beaver does not look into the camera (its face ${deg(off())} off, stare ${player.motion.stare?.weight.toFixed(2) ?? "none"})`);
  };
  return [
    ["Stares when left alone", async () => {
      if (player.camera.view === "first-person") skip("the first-person view: no beaver to see staring");
      // Open flat ground on land, where the walking station goes; then nothing touched.
      await walkTo(world.spawn.x + 1, world.spawn.z + 3, { limit: 60 });
      await wait(0.5);
      expect(!player.afloat && player.motion.grounded, "wanted to stand on land, still afloat or in the air");
      if (!live) {
        // A turn of the camera is input: the stare ends at once (following a moving camera is in the unit tests).
        await leftAlone();
        player.camera.turn(0.1, 0);
        await until(() => !player.motion.stare, 1, "turned the camera during a stare, the beaver goes on staring");
      }
      await leftAlone();
      await wait(live ? 4 : 0.5); // live: long enough to be seen
      expect(off() < AIMED, `staring, the beaver's face is ${deg(off())} off the camera`);
      // A key a person presses: W walks away from the camera, as it always does.
      const from = player.feet.clone(), facing = player.facing;
      press("KeyW", "keydown");
      try { await wait(0.6); } finally { press("KeyW", "keyup"); }
      await wait(0.4);
      const moved = Vector3.Distance(from, player.feet), turned = Math.abs(Math.atan2(Math.sin(player.facing - facing), Math.cos(player.facing - facing)));
      expect(!player.motion.stare, "W pressed, the beaver stares on");
      expect(off() > AIMED, `W pressed, the beaver still looks into the camera (${deg(off())} off)`);
      expect(moved > 0.1 || turned > 0.5, `W pressed after a stare, the beaver went ${moved.toFixed(2)} m and turned ${deg(turned)}: the key did nothing`);
    }, ACTIVITY],
  ];
};
