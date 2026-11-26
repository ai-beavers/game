// The Clear view (src/features/clear-view): walking under a clearing tree with the crown between the camera and the
// beaver, the crown is drawn see-through and the camera keeps its distance; walked clear, the crown comes back whole;
// a trunk in between still brings the camera in.
//
// The feature's geometry (leafVolume, volumes.ts) only plans where to stand and look; the station then plays like a
// player (walks, turns the camera) and checks the picture: what the last frame drew, and the camera's shown distance.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { GROUND, HEAVY, SOLID } from "../../../physics.ts";
import { LOOK_HEIGHT } from "../../../player/camera.ts";
import { isLeaves, leafVolume, STAND_IN } from "../../clear-view/fade.ts";
import { bodyPoints, enter, inside, type Volume } from "../../clear-view/volumes.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

const SOLIDS = GROUND | SOLID | HEAVY;

export const clearView = (kit: Kit): Station[] => {
  const { player, world, stage, walkTo, wait, frame, expect, needBuild, standingTrees } = kit;
  const scene = stage.scene;
  const dir = (yaw: number, pitch: number) => new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  /** The leaves of a standing tree's crown: plain meshes or instances above its foot. */
  const crownOf = (place: Vector3) => scene.meshes.filter((m) => isLeaves(m) && m.isEnabled() && m.isVisible
    && !(m instanceof Mesh && m.thinInstanceCount) && !m.name.endsWith(STAND_IN) && (() => {
      const c = m.getBoundingInfo().boundingBox.centerWorld;
      return Math.hypot(c.x - place.x, c.z - place.z) < 2.5 && c.y > place.y + 1.5;
    })());
  /** The see-through stand-in the Clear view draws in place of a leaf mesh, if any. */
  const standIn = (mesh: AbstractMesh) => {
    const at = mesh.getAbsolutePosition();
    return scene.meshes.find((m) => m.name === mesh.name + STAND_IN && Vector3.Distance(m.position, at) < 0.05);
  };
  const active = () => { const a = scene.getActiveMeshes(); return a.data.slice(0, a.length); };
  /** Whether the last picture drew the crown below full visibility (itself, or its stand-in). */
  const drawnFaded = (crown: AbstractMesh[]) => {
    const drawn = new Set(active());
    return crown.some((m) => (drawn.has(m) && m.visibility < 1) || (() => { const s = standIn(m); return !!s && drawn.has(s) && s.visibility < 1; })());
  };
  /** Whether the last picture drew the crown whole: every part itself, opaque, no stand-in left. */
  const drawnWhole = (crown: AbstractMesh[]) => {
    const drawn = new Set(active());
    return crown.every((m) => drawn.has(m) && m.visibility >= 1 && !standIn(m));
  };
  /** The free way from the look point along a direction: no collider within `length` (and a hand's breadth either side). */
  const free = (from: Vector3, d: Vector3, length: number) => {
    const side = Vector3.Cross(d, Vector3.Up()).normalize().scaleInPlace(0.25);
    return [Vector3.Zero(), side, side.negate()].every((o) => !stage.physics.ray(from.add(o), d, length + 0.3, SOLIDS));
  };
  const hiddenBy = (eye: Vector3, feet: Vector3, volumes: Volume[]) =>
    bodyPoints(feet).filter((p) => volumes.some((v) => enter(v, eye, p) <= 1 && !inside(v, p))).length;

  /** A spot beside a standing tree, and a yaw and pitch where its crown hides the beaver from a free camera, and one
   *  at the same pitch where nothing does. */
  const plan = (distance: number) => {
    const b = needBuild(), pick = standingTrees(b).slice(0, 8);
    for (const i of pick) {
      const tree = world.trees![i]!, crown = crownOf(tree.place);
      const volumes = crown.map(leafVolume).filter((v): v is Volume => !!v);
      if (!volumes.length) continue;
      for (const step of [1, 1.6, 2.2]) for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, out = new Vector3(Math.sin(a), 0, Math.cos(a));
        const x = tree.place.x + out.x * (tree.radius + step), z = tree.place.z + out.z * (tree.radius + step);
        if (world.heightAt(x, z) < world.waterLevel + 0.1) continue; // on land
        const feet = new Vector3(x, world.heightAt(x, z), z), look = feet.add(new Vector3(0, LOOK_HEIGHT, 0));
        for (let pitch = 0.5; pitch <= 1.25; pitch += 0.15) {
          let hide: number | undefined, clear: number | undefined, most = 3;
          for (let y = 0; y < 36; y++) {
            const yaw = (y / 36) * Math.PI * 2, d = dir(yaw, pitch), eye = look.add(d.scale(distance));
            if (!free(look, d, distance)) continue;
            const n = hiddenBy(eye, feet, volumes);
            if (n > most && !volumes.some((v) => inside(v, eye))) { most = n; hide = yaw; }
            else if (n === 0 && clear === undefined) clear = yaw;
          }
          if (hide !== undefined && clear !== undefined) return { tree, crown, feet, out, pitch, hide, clear };
        }
      }
    }
    return skip("no standing clearing tree with room to look through its crown");
  };

  return [
    ["Walk under the trees", async () => {
      if (player.camera.view === "first-person") skip("the Clear view is for the third-person view");
      const distance = player.camera.distance, at = plan(distance);
      await walkTo(at.feet.x, at.feet.z, { near: 0.25, hop: true });
      // The crown out of the way first: the distance the camera stands at without it.
      player.camera.yaw = at.clear; player.camera.pitch = at.pitch;
      await wait(2);
      const before = player.camera.shown;
      expect(Math.abs(before - distance) < 0.3, `nothing in the way, the camera stands ${before.toFixed(2)} m back, not the ${distance.toFixed(2)} m chosen`);
      expect(drawnWhole(at.crown), "before the crown came between, it was not drawn whole");
      // Turned so the crown is between the camera and the beaver: it turns see-through, the camera stays where it was.
      player.camera.yaw = at.hide;
      let off = 0, faded = -1;
      for (let t = 0; t < 1.5;) {
        t += await frame();
        off = Math.max(off, Math.abs(player.camera.shown - before));
        if (faded < 0 && drawnFaded(at.crown)) faded = t;
      }
      expect(faded >= 0, "the crown between the camera and the beaver was still drawn whole after 1.5 s");
      expect(faded <= 1.1, `the crown between the camera and the beaver turned see-through only after ${faded.toFixed(2)} s`);
      expect(off < 0.05, `the camera moved ${off.toFixed(2)} m from where it stood when the crown came between`);
      expect(drawnFaded(at.crown), "the crown came back while it was still between the camera and the beaver");
      // Walked clear and looking back at the tree: the crown comes back whole after the linger.
      const away = at.feet.add(at.out.scale(6));
      await walkTo(away.x, away.z, { near: 0.4 });
      player.camera.yaw = Math.atan2(at.out.x, at.out.z); player.camera.pitch = 0.22;
      await wait(2.5);
      expect(drawnWhole(at.crown), "walked clear of the tree, its crown was not drawn whole again");
      // A trunk in between still brings the camera in.
      const by = at.tree.place.add(at.out.scale(at.tree.radius + 1.2));
      await walkTo(by.x, by.z, { near: 0.25 });
      player.camera.yaw = Math.atan2(-at.out.x, -at.out.z);
      await wait(1.5);
      const shown = player.camera.shown;
      expect(shown < distance * 0.75, `the trunk between the camera and the beaver, the camera stands ${shown.toFixed(2)} m back, not in front of it`);
    }, "Around the clearing"],
  ];
};
