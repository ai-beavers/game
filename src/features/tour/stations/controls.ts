// Other ways in than the keyboard: a gamepad, touch controls. Stream false: the live stream leaves them out.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

export const controls = (kit: Kit): Station[] => {
  const { player, stage, wait, until, expect, after } = kit;
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
    // With a touch screen (or ?touch): a thumb on the left half walks, the Jump button jumps.
    ["Touch controls", async () => {
      const jump = document.querySelector<HTMLButtonElement>('#touch-controls button[aria-label="Jump"]') ?? skip("no touch controls (add &touch)");
      const touch = (type: string, x: number, y: number) => (type === "pointerdown" ? stage.canvas : window).dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: "touch", clientX: x, clientY: y, bubbles: true, cancelable: true }));
      const x = stage.canvas.clientWidth * 0.2, y = stage.canvas.clientHeight * 0.7, from = player.feet.clone();
      touch("pointerdown", x, y);
      try { touch("pointermove", x, y - 60); await wait(1.5); } finally { touch("pointerup", x, y - 60); }
      const moved = Vector3.Distance(from, player.feet);
      expect(moved > 0.5, `a thumb pushed up for 1.5 s, the beaver went ${moved.toFixed(2)} m`);
      await wait(0.5);
      const jumped = after("jump");
      jump.click(); // a tap without a pointer (detail 0) counts once, as from a screen reader
      await until(jumped, 1, "Jump tapped, no jump");
      await wait(1);
    }, undefined, false],
  ];
};
