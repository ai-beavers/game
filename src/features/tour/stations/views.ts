// The player's two views: the third-person view behind the beaver and the first-person view through its eyes (V).
// Stream false: the live stream always shows the third-person view.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Kit } from "../kit.ts";
import type { Station } from "../live.ts";

export const views = (kit: Kit): Station[] => {
  const { player, stage, beaver, wait, frame, press, key, expect } = kit;
  const head = beaver.eyes.parent as TransformNode;
  const fromHead = () => Vector3.Distance(stage.camera.position, head.getAbsolutePosition());
  /** Whether the last picture drew any of the player's own beaver (its body, hat, backpack). */
  const drawn = () => {
    const own = new Set(beaver.root.getChildMeshes());
    const active = stage.scene.getActiveMeshes();
    return active.data.slice(0, active.length).some((mesh) => own.has(mesh));
  };
  return [
    // V: through the beaver's eyes, W walks the way they look; V again: back behind the beaver.
    ["First person", async () => {
      try {
        key("KeyV");
        await frame(); await frame();
        expect(fromHead() < 0.2, `V pressed, the camera is ${fromHead().toFixed(2)} m from the beaver's head`);
        expect(!drawn(), "V pressed, the player's own beaver is still drawn");
        const from = player.feet.clone(), look = stage.camera.getTarget().subtract(stage.camera.position);
        press("KeyW", "keydown");
        try { await wait(1); } finally { press("KeyW", "keyup"); }
        const moved = player.feet.subtract(from).multiplyByFloats(1, 0, 1), ahead = new Vector3(look.x, 0, look.z).normalize();
        const along = Vector3.Dot(moved, ahead) / (moved.length() || 1);
        expect(moved.length() > 0.5, `W held for 1 s in the first-person view, the beaver went ${moved.length().toFixed(2)} m`);
        expect(along > 0.8, `W held, the beaver went ${Math.acos(Math.min(1, along)).toFixed(2)} rad off the way the eyes look`);
        await wait(0.5);
        key("KeyV");
        await wait(0.5);
        expect(fromHead() >= 1.5, `V pressed again, the camera is ${fromHead().toFixed(2)} m from the beaver's head`);
        expect(drawn(), "V pressed again, the player's own beaver is not drawn");
      } finally { if (player.camera.view === "first-person") key("KeyV"); }
      await wait(1);
    }, undefined, false],
  ];
};
