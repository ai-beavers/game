// The Calendar board: a big board on two posts beside the shop, mirroring the HOUSE OF AI sign across the path to the
// doorway, showing the real week (week.ts) in the clean column style of a desktop calendar. Its face is a dynamic
// texture drawn as real text, lit by the scene like the sign; a collider over its posts keeps the beaver out of it.
//
//   const board = calendarBoard(stage, shop, new Date())   board.week (what is drawn) · board.show(now) redraws if the
//                                                          local date changed · board.front(d) · board.toBoard(p)
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { RAPIER, type Stage } from "../../engine.ts";
import type { buildShop } from "./building.ts";
import { paint, SIGN, WOOD } from "./building.ts";
import { week, type CalendarWeek } from "./week.ts";

/** Where it stands in the shop's frame: the sign mirrored across the path, further out for its width. */
const AT = { x: -SIGN.x - 0.85, z: SIGN.z, yaw: -SIGN.yaw }; // m, m, rad: turned a little towards the path, as the sign is
const WIDTH = 2.4, HEIGHT = 1.4, LIFT = 0.75; // m: the board, and its lower edge over the ground
const PX = 1536, PY = 896; // texture, the board's proportions
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/** The week on the texture: the title, seven columns headed by weekday and date, today's date in a red circle, and the
 *  Friday's Build Fridays block. */
function draw(texture: DynamicTexture, w: CalendarWeek) {
  const g = texture.getContext() as CanvasRenderingContext2D;
  g.setTransform(-1, 0, 0, 1, PX, 0); // a plane turned to face out shows it mirrored (as the sign's)
  g.fillStyle = "#fbfbfd"; g.fillRect(0, 0, PX, PY);
  const pad = 40, top = 170, col = (PX - 2 * pad) / 7, head = 190;
  g.textBaseline = "middle";
  // The title, month and year, at the top left.
  g.fillStyle = "#1c1c1e"; g.textAlign = "left";
  g.font = `700 92px ${FONT}`;
  g.fillText(w.title, pad + 12, 92);
  // Weekend columns a shade darker, as a calendar app shows them.
  g.fillStyle = "#f0f0f3"; g.fillRect(pad + 5 * col, top, 2 * col, PY - top - pad);
  w.days.forEach((d, i) => {
    const x = pad + col * (i + 0.5);
    g.textAlign = "center";
    g.fillStyle = "#8e8e93"; g.font = `600 52px ${FONT}`;
    g.fillText(d.name.toUpperCase(), x, top + 48);
    if (d.today) { g.fillStyle = "#ff3b30"; g.beginPath(); g.arc(x, top + 130, 62, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = d.today ? "#ffffff" : "#1c1c1e"; g.font = `${d.today ? 700 : 500} 84px ${FONT}`;
    g.fillText(String(d.date), x, top + 132);
    d.entries.forEach((entry, k) => {
      const bx = pad + col * i + 10, by = top + head + 24 + k * 230, bw = col - 20, bh = 210;
      g.fillStyle = "#7d5cf0"; g.beginPath(); g.roundRect(bx, by, bw, bh, 20); g.fill();
      g.fillStyle = "#ffffff"; g.font = `700 50px ${FONT}`; g.textAlign = "left";
      entry.split(" ").forEach((word, n) => g.fillText(word, bx + 18, by + 52 + n * 62));
    });
  });
  // Thin lines: under the heads, and between the columns.
  g.strokeStyle = "#d1d1d6"; g.lineWidth = 3;
  g.beginPath();
  g.moveTo(pad, top + head); g.lineTo(PX - pad, top + head);
  for (let i = 1; i < 7; i++) { g.moveTo(pad + col * i, top); g.lineTo(pad + col * i, PY - pad); }
  g.stroke();
  g.setTransform(1, 0, 0, 1, 0, 0);
  texture.update(true);
}

export function calendarBoard(stage: Stage, shop: ReturnType<typeof buildShop>, now: Date) {
  const scene: Scene = stage.scene;
  const node = new TransformNode("shop-calendar", scene);
  node.parent = shop.root;
  node.position.set(AT.x, 0, AT.z);
  node.rotation.y = AT.yaw;
  node.computeWorldMatrix(true);
  const parts: Mesh[] = [];
  for (const side of [-1, 1]) {
    const post = MeshBuilder.CreateCylinder("calendar-post", { height: LIFT + HEIGHT + 0.25, diameter: 0.11 }, scene);
    post.position.set(side * (WIDTH / 2 - 0.25), (LIFT + HEIGHT + 0.25) / 2 - 0.1, -0.07);
    parts.push(paint(post, WOOD));
  }
  const frame = MeshBuilder.CreateBox("calendar-frame", { width: WIDTH + 0.1, height: HEIGHT + 0.1, depth: 0.08 }, scene);
  frame.position.y = LIFT + HEIGHT / 2;
  parts.push(paint(frame, new Color3(0.32, 0.2, 0.11)));
  const frameMat = new StandardMaterial("shop-calendar-wood", scene);
  frameMat.specularColor.setAll(0.05);
  const wooden = Mesh.MergeMeshes(parts, true)!;
  wooden.name = "shop-calendar-wood"; wooden.material = frameMat; wooden.parent = node;
  wooden.isPickable = false; wooden.receiveShadows = true;

  const face = MeshBuilder.CreatePlane("shop-calendar-face", { width: WIDTH, height: HEIGHT }, scene);
  const texture = new DynamicTexture("shop-calendar", { width: PX, height: PY }, scene, true);
  texture.anisotropicFilteringLevel = 8; // read at a slant from the path
  const faceMat = new StandardMaterial("shop-calendar-face", scene);
  faceMat.diffuseTexture = texture;
  // No emissive texture: Babylon adds it whole, whatever emissiveColor says, and the light face glows white at night.
  faceMat.specularColor.setAll(0.04);
  face.material = faceMat; face.parent = node;
  face.position.set(0, LIFT + HEIGHT / 2, 0.045);
  face.rotation.y = Math.PI; // its face to local +z, out of the shop (the texture is drawn mirrored for this)
  face.isPickable = false; face.receiveShadows = true;

  // Solid from the ground to over the beaver's head, the whole width of the board.
  const at = shop.toWorld(AT.x, 0, AT.z);
  const q = node.absoluteRotationQuaternion;
  stage.physics.createCollider(RAPIER.ColliderDesc.cuboid(WIDTH / 2 + 0.05, 0.9, 0.08)
    .setTranslation(at.x, at.y + 0.8, at.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.9));

  let shown = week(now);
  draw(texture, shown);
  const today = (w: CalendarWeek) => w.days.find((d) => d.today)!.key;
  return {
    get week() { return shown; },
    /** Redraws only when the local date has changed (a new today, or on a Monday a new week). */
    show(date: Date) {
      const next = week(date);
      if (today(next) === today(shown)) return false;
      shown = next;
      draw(texture, shown);
      return true;
    },
    /** A world point d m out in front of the board's middle, on the ground. */
    front: (d: number) => Vector3.TransformCoordinates(new Vector3(0, 0, d), node.getWorldMatrix()),
    /** A world point in the board's frame: z out of its face (negative behind it), x along it. */
    toBoard(p: { x: number; z: number }) {
      const inv = node.getWorldMatrix().clone().invert(), l = Vector3.TransformCoordinates(new Vector3(p.x, at.y, p.z), inv);
      return { x: l.x, z: l.z };
    },
    /** By the sky's dark (0 … 1): a touch of its own light by day, none at night, where the brightened exposure would
     *  make its light face a white blob; then the scene's moonlight shows it, as it does the sign's wood. */
    update(dark: number) { faceMat.emissiveColor.setAll(0.22 * (1 - Math.min(1, Math.max(0, (dark - 0.08) / 0.3)))); },
  };
}
