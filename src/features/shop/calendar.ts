// The Calendar board: a big board on two posts beside the shop, mirroring the HOUSE OF AI sign across the path to the
// doorway, showing the real week (week.ts) with Build Fridays and the House of AI events as a desktop calendar's week
// view, with the hours down its left. Its face is a dynamic texture drawn as real text, lit by the scene like the sign; a
// collider over its whole width keeps the beaver out of it.
//
//   const board = calendarBoard(stage, shop, new Date())   board.week (what is drawn) · board.show(now) redraws if the
//                                                          local date changed · board.give(events) redraws if they did
//                                                          · board.events · board.front(d, along) · board.toBoard(p)
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { Stage } from "../../engine.ts";
import { box } from "../../physics.ts";
import type { buildShop } from "./building.ts";
import { paint, WOOD } from "./building.ts";
import { CALENDAR } from "./place.ts";
import type { HouseEvent } from "./feed.ts";
import { clock, span, week, type CalendarWeek } from "./week.ts";

const { width: WIDTH, height: HEIGHT, lift: LIFT } = CALENDAR;
const S = WIDTH / 2.4; // the posts and frame grow with the board from the first one, 2.4 m wide
const PX = 1536, PY = 896; // texture, the board's proportions (kept when it grew: the drawing scales as a whole)
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/** The pieces joined by spaces into lines no wider than `width`, a piece wider than that standing on a line of its own. */
function lines(g: CanvasRenderingContext2D, words: string[], width: number) {
  const out: string[] = [];
  for (const word of words) {
    const last = out[out.length - 1];
    if (last !== undefined && g.measureText(`${last} ${word}`).width <= width) out[out.length - 1] = `${last} ${word}`;
    else out.push(word);
  }
  return out;
}

/** The week on the texture, as a desktop calendar's week view: the title; seven columns headed by weekday and date,
 *  today's date in a red circle; the hours down a margin on the left with a thin line at every hour; and each entry as a
 *  purple block from its start to its end (between the lines for :30), in its lane of the day's column, with its name
 *  and time span inside and kept inside. */
function draw(texture: DynamicTexture, w: CalendarWeek) {
  const g = texture.getContext() as CanvasRenderingContext2D;
  g.setTransform(-1, 0, 0, 1, PX, 0); // a plane turned to face out shows it mirrored (as the sign's)
  g.fillStyle = "#fbfbfd"; g.fillRect(0, 0, PX, PY);
  const pad = 36, margin = 156, top = 128, head = 160, bottom = PY - 34; // px on the texture
  const left = pad + margin, col = (PX - left - pad) / 7, grid = top + head;
  const { from, to } = w.hours, hour = (bottom - grid) / (to - from);
  const y = (h: number) => grid + (h - from) * hour;
  g.textBaseline = "middle";
  // The title, month and year, at the top left.
  g.fillStyle = "#1c1c1e"; g.textAlign = "left";
  g.font = `700 84px ${FONT}`;
  g.fillText(w.title, pad + 12, 68);
  // Weekend columns a shade darker, as a calendar app shows them.
  g.fillStyle = "#f0f0f3"; g.fillRect(left + 5 * col, top, 2 * col, bottom - top);
  // Thin lines: one at every hour across the seven days, and between the columns.
  g.strokeStyle = "#e0e0e6"; g.lineWidth = 2;
  g.beginPath();
  for (let h = from + 1; h < to; h++) { g.moveTo(left, y(h)); g.lineTo(PX - pad, y(h)); }
  g.stroke();
  g.strokeStyle = "#c7c7cc"; g.lineWidth = 3;
  g.beginPath();
  g.moveTo(left, grid); g.lineTo(PX - pad, grid);
  g.moveTo(left, bottom); g.lineTo(PX - pad, bottom);
  for (let i = 0; i <= 7; i++) { g.moveTo(left + col * i, top); g.lineTo(left + col * i, bottom); }
  g.stroke();
  // The hours, every two, in the margin, each beside its line.
  g.fillStyle = "#6e6e73"; g.font = `600 50px ${FONT}`; g.textAlign = "right";
  for (let h = from; h <= to; h += 2) g.fillText(clock(h), left - 14, y(h));
  w.days.forEach((d, i) => {
    const x = left + col * (i + 0.5);
    g.textAlign = "center";
    g.fillStyle = "#8e8e93"; g.font = `600 46px ${FONT}`;
    g.fillText(d.name.toUpperCase(), x, top + 38);
    if (d.today) { g.fillStyle = "#ff3b30"; g.beginPath(); g.arc(x, top + 106, 48, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = d.today ? "#ffffff" : "#1c1c1e"; g.font = `${d.today ? 700 : 500} 70px ${FONT}`;
    g.fillText(String(d.date), x, top + 108);
    for (const entry of d.entries) {
      const lane = (col - 8) / entry.lanes;
      const bx = left + col * i + 4 + lane * entry.lane + 2, by = y(entry.from) + 2, bw = lane - 4, bh = y(entry.to) - y(entry.from) - 4;
      g.fillStyle = entry.lane % 2 ? "#5b8def" : "#7d5cf0"; g.beginPath(); g.roundRect(bx, by, bw, bh, Math.min(16, bh / 2)); g.fill();
      g.save();
      g.beginPath(); g.rect(bx, by, bw, bh); g.clip(); // the text stays inside its block
      g.fillStyle = "#ffffff"; g.textAlign = "left";
      const inner = bw - 16, big = entry.lanes > 1 || bh < 90 ? 0.8 : 1; // smaller type in a narrow or short block
      g.font = `700 ${44 * big}px ${FONT}`;
      const name = lines(g, entry.name.split(" "), inner);
      name.forEach((line, n) => g.fillText(line, bx + 8, by + 32 * big + n * 50 * big));
      g.font = `600 ${40 * big}px ${FONT}`;
      // The time span kept whole where it fits, else broken after its dash.
      const time = lines(g, span(entry).split(/(?<=–) /), inner);
      time.forEach((line, n) => g.fillText(line, bx + 8, by + 32 * big + (name.length * 50 + 8 + n * 46) * big));
      g.restore();
    }
  });
  g.setTransform(1, 0, 0, 1, 0, 0);
  texture.update(true);
}

export function calendarBoard(stage: Stage, shop: ReturnType<typeof buildShop>, now: Date) {
  const scene: Scene = stage.scene;
  const node = new TransformNode("shop-calendar", scene);
  node.parent = shop.root;
  node.position.set(CALENDAR.x, 0, CALENDAR.z);
  node.rotation.y = CALENDAR.yaw;
  node.computeWorldMatrix(true);
  const parts: Mesh[] = [];
  for (const side of [-1, 1]) {
    const post = MeshBuilder.CreateCylinder("calendar-post", { height: LIFT + HEIGHT + 0.25, diameter: 0.11 * S }, scene);
    post.position.set(side * (WIDTH / 2 - 0.25 * S), (LIFT + HEIGHT + 0.25) / 2 - 0.1, -0.07 * S);
    parts.push(paint(post, WOOD));
  }
  const frame = MeshBuilder.CreateBox("calendar-frame", { width: WIDTH + 0.1 * S, height: HEIGHT + 0.1 * S, depth: 0.08 * S }, scene);
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
  face.position.set(0, LIFT + HEIGHT / 2, 0.04 * S + 0.005);
  face.rotation.y = Math.PI; // its face to local +z, out of the shop (the texture is drawn mirrored for this)
  face.isPickable = false; face.receiveShadows = true;

  // Solid from the ground to over the beaver's head, the whole width of the board.
  const at = shop.toWorld(CALENDAR.x, 0, CALENDAR.z);
  const q = node.absoluteRotationQuaternion;
  stage.physics.fixed(box(stage.scene, WIDTH / 2 + 0.05 * S, 0.9, 0.08 * S, { x: at.x, y: at.y + 0.8, z: at.z }, q.clone()), undefined, 0.9);

  let events: readonly HouseEvent[] = [], date = now;
  let shown = week(date, events);
  draw(texture, shown);
  const today = (w: CalendarWeek) => w.days.find((d) => d.today)!.key;
  return {
    get week() { return shown; },
    /** The House of AI events it was given (what week() placed on it). */
    get events() { return events; },
    /** Redraws only when the local date has changed (a new today, or on a Monday a new week). */
    show(next: Date) {
      const w = week(next, events);
      if (today(w) === today(shown)) return false;
      date = next; shown = w;
      draw(texture, shown);
      return true;
    },
    /** Takes the House of AI events; redraws only when they changed. */
    give(next: readonly HouseEvent[]) {
      if (JSON.stringify(next) === JSON.stringify(events)) return false;
      events = next; shown = week(date, events);
      draw(texture, shown);
      return true;
    },
    /** A world point d m out in front of the board, `along` m from its middle (positive towards the path), on the ground. */
    front: (d: number, along = 0) => Vector3.TransformCoordinates(new Vector3(along, 0, d), node.getWorldMatrix()),
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
