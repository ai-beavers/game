// The felt hat every beaver wears: on the head, small, moving with the head, and off and on through beaver.hat.
// No player input takes the hat off or turns the head alone, so this station uses the beaver contract directly: it
// switches beaver.hat and nods the head through beaver.pose, as the hat's issue (#32) asks.
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Kit } from "../kit.ts";
import type { Station } from "../live.ts";

const NOD = 0.5; // rad the head is nodded to see the hat go with it
const SINK = 0.035; // m the rim of the tilted brim may reach down the domed crown of the head

export const hat = (kit: Kit): Station[] => {
  const { beaver, live, wait, expect } = kit;
  /** What beaver.hat switches: the meshes on the beaver that go out with it. */
  const hatMeshes = () => {
    const shown = () => beaver.root.getChildMeshes(false).filter((m) => m.isEnabled() && m.isVisible);
    const before = shown();
    beaver.hat = false;
    try {
      const after = new Set(shown());
      return before.filter((m) => !after.has(m));
    } finally { beaver.hat = true; }
  };
  const under = (node: TransformNode, parent: TransformNode) => {
    for (let p = node.parent; p; p = p.parent) if (p === parent) return true;
    return false;
  };
  /** The skull in the head's frame, from the coat's skinned vertices (as posed now) at the height of the eyes and
   *  above: its width across, m, and the height of its crown between the ears, m. */
  const skull = (head: TransformNode) => {
    const toHead = head.getWorldMatrix().clone().invert(), at = new Vector3();
    let min = Infinity, max = -Infinity, top = -Infinity;
    for (const mesh of beaver.root.getChildMeshes(false)) {
      if (!mesh.skeleton) continue;
      const data = mesh.getPositionData(true, true), world = mesh.computeWorldMatrix(true);
      if (!data) continue;
      for (let i = 0; i < data.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(data[i]!, data[i + 1]!, data[i + 2]!, world, at);
        Vector3.TransformCoordinatesToRef(at, toHead, at);
        if (at.y < 0.08 || Math.abs(at.z) > 0.12) continue; // the skull: above the cheeks, not the snout nor the neck
        min = Math.min(min, at.x);
        max = Math.max(max, at.x);
        if (Math.abs(at.x) < 0.02) top = Math.max(top, at.y); // between the ears
      }
    }
    return { width: max - min, top };
  };
  const centre = (meshes: AbstractMesh[]) => {
    const sum = new Vector3();
    for (const m of meshes) { m.computeWorldMatrix(true); sum.addInPlace(m.getBoundingInfo().boundingBox.centerWorld); }
    return sum.scaleInPlace(1 / meshes.length);
  };
  return [
    ["Wears a hat", async () => {
      // Live: a few seconds standing still, so the close shot (live.ts) glides in and the hat is seen.
      if (live) await wait(4);
      expect(beaver.hat, "the beaver says it wears no hat");
      const head = beaver.root.getDescendants(false, (n) => n.name === "head")[0] as TransformNode | undefined;
      expect(!!head, "the beaver has no head bone");
      const parts = hatMeshes();
      expect(parts.length > 0, "beaver.hat = false hides nothing on the beaver: no hat is shown");
      expect(parts.every((m) => under(m, head!)), "the hat does not hang under the beaver's head bone");
      expect(beaver.hat && parts.every((m) => m.isEnabled() && m.isVisible), "beaver.hat = true does not show the hat again");

      // On top of the head and no wider than it, in the head's own frame (the head may be nodding).
      head!.computeWorldMatrix(true);
      const toHead = head!.getWorldMatrix().clone().invert(), at = new Vector3();
      let minX = Infinity, maxX = -Infinity, minY = Infinity;
      for (const m of parts) {
        m.computeWorldMatrix(true);
        for (const corner of m.getBoundingInfo().boundingBox.vectorsWorld) {
          Vector3.TransformCoordinatesToRef(corner, toHead, at);
          minX = Math.min(minX, at.x); maxX = Math.max(maxX, at.x); minY = Math.min(minY, at.y);
        }
      }
      const { width, top } = skull(head!), hatWidth = maxX - minX;
      expect(width > 0.05, `could not measure the head (${width.toFixed(3)} m across)`);
      expect(hatWidth <= width, `the hat is ${hatWidth.toFixed(3)} m across, wider than the head (${width.toFixed(3)} m)`);
      expect(minY > top - SINK, `the hat's foot is ${minY.toFixed(3)} m up the head, under its crown (${top.toFixed(3)} m): not on top of it`);
      expect(Math.abs((minX + maxX) / 2) < 0.03, `the hat sits ${((minX + maxX) / 2).toFixed(3)} m to the side, not between the ears`);

      // A nod of the head through the beaver's pose: the hat goes with it and keeps its place on the head. The next
      // picture the animator poses the beaver again.
      const from = centre(parts), onHead = Vector3.TransformCoordinates(from, toHead);
      const rest = head!.rotationQuaternion?.clone() ?? Quaternion.Identity();
      const nodded = rest.multiply(Quaternion.RotationAxis(Vector3.Right(), NOD));
      beaver.pose({ head: { rotation: [nodded.x, nodded.y, nodded.z, nodded.w] } });
      beaver.root.computeWorldMatrix(true);
      for (const n of beaver.root.getDescendants(false)) (n as TransformNode).computeWorldMatrix?.(true);
      const to = centre(parts), stays = Vector3.TransformCoordinates(to, Matrix.Invert(head!.getWorldMatrix()));
      const moved = Vector3.Distance(from, to), slipped = Vector3.Distance(onHead, stays);
      expect(moved > 0.03, `the head nodded, the hat moved only ${(moved * 100).toFixed(1)} cm`);
      expect(slipped < 0.002, `the hat slipped ${(slipped * 100).toFixed(1)} cm on the nodding head`);
      if (live) await wait(3);
    }],
  ];
};
