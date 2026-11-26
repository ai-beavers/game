// Other ways in than the keyboard: a gamepad. Touch controls have no station: they are not tested automatically. Stream false: the live stream leaves it out.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Kit } from "../kit.ts";
import type { Station } from "../live.ts";

export const controls = (kit: Kit): Station[] => {
  const { player, wait, until, expect, after } = kit;
  return [
    // A standard gamepad (a stand-in for navigator.getGamepads): the left stick walks, A jumps.
    ["Gamepad", async () => {
      const pad = { connected: true, index: 0, mapping: "standard", axes: [0, -1, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      Object.defineProperty(navigator, "getGamepads", { value: () => [pad], configurable: true });
      try {
        const from = player.feet.clone(), steps = after("footstep");
        await wait(1.5);
        const moved = Vector3.Distance(from, player.feet);
        expect(moved > 0.5 && steps(), `the left stick pushed for 1.5 s, the beaver went ${moved.toFixed(2)} m`);
        pad.axes[1] = 0;
        await wait(0.5);
        const jumped = after("jump");
        pad.buttons[0]!.pressed = true;
        await wait(0.3);
        pad.buttons[0]!.pressed = false;
        await until(jumped, 1, "A pressed on the pad, no jump");
      } finally { delete (navigator as { getGamepads?: unknown }).getGamepads; }
      await wait(1);
    }, undefined, false],
  ];
};
