import { hex as colorFromHex } from "../../world/color.ts";
// The map: the ground painted from world.heightAt (water, sand, grass, the path, hill shading), again whenever the pond's
// level changes, then drawn each frame into a canvas with what is there now: standing trees, sticks, the dam as far
// as it is built, the lodge, other players as named dots, and the beaver as an arrow.
//
//   const map = createMap(world.heightAt, world.waterLevel);
//   map.draw(canvas, { centre, span, beaver, facing, yaw, sticks, trees, dam, lodge, players, level }, size);
//                                         size: CSS pixels across where it is shown; the canvas gets size × devicePixelRatio
//
// North up, fixed: up on the map is +z, the way the camera looks at the start, so right is -x.
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { pathAt } from "../../world/terrain.ts";
import { FONT, GOLD, INK, PANEL, PAPER, PLAYERS, STICKS } from "./style.ts";

/** Half the width of the mapped square around the middle of the clearing, m, and metres per pixel. */
export const EXTENT = 38;
const RESOLUTION = 0.2;
const OUTSIDE = "#4a5f36"; // beyond the painted square: thicket

const C = (hex: number) => colorFromHex(hex).toLinearSpace();
const DEEP = C(0x3a6f8c), SHALLOW = C(0x7db3c0), SAND = C(0xc4b28a), PATH = C(0xb09a6e), GRASS = C(0x7c9b4b), HIGH = C(0x5a7a36), BANK = C(0x3f5530);
const SAND_REACH = 1.4; // m from the water's edge

interface Point { x: number; z: number }
export interface MapView {
  /** The world point in the middle of the canvas, and how many metres the canvas spans. */
  centre: Point;
  span: number;
  beaver: Point;
  /** The beaver's facing (0 = +z) and the camera's yaw, radians. */
  facing: number;
  yaw: number;
  sticks: Point[];
  /** Standing trees (felled ones are left out). */
  trees?: Point[];
  /** The dam's line along the shore, and how much of it is built, 0 … 1. */
  dam?: { from: Point; to: Point; built: number };
  lodge?: Point;
  /** The Shop (src/features/shop): a round roof with its mirror ball's sparkle. */
  shop?: Point;
  /** The bakery (src/features/bakery): a little roof with a chimney. */
  bakery?: Point;
  /** The Dance floor (src/features/dance-floor): a square of four coloured tiles. */
  danceFloor?: Point;
  /** The workbench (src/features/workbench): a stump seen from above, its rings. */
  workbench?: Point;
  players?: (Point & { name: string })[];
  /** Where the goal at hand is done, and its chip ("Dam · 14 m"), kept inside the map when it lies beyond. */
  objective?: Point & { label: string };
  /** The pond's surface now; the ground is painted again when it moves. */
  level?: number;
}

export function createMap(heightAt: (x: number, z: number) => number, waterLevel: number) {
  const size = Math.round(2 * EXTENT / RESOLUTION);
  const ground = document.createElement("canvas");
  ground.width = ground.height = size;
  const image = ground.getContext("2d")!.createImageData(size, size);
  // Pixel (i, j) shows world x = EXTENT - i·RESOLUTION, z = EXTENT - j·RESOLUTION (north up, right is -x).
  const heights = new Float32Array(size * size), paths = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    heights[j * size + i] = heightAt(EXTENT - i * RESOLUTION, EXTENT - j * RESOLUTION);
    paths[j * size + i] = pathAt(EXTENT - i * RESOLUTION, EXTENT - j * RESOLUTION);
  }
  const height = (i: number, j: number) => heights[Math.min(size - 1, Math.max(0, j)) * size + Math.min(size - 1, Math.max(0, i))]!;
  let painted = waterLevel;
  // Sand: low ground within SAND_REACH of water.
  const wet = (i: number, j: number) => height(i, j) < painted;
  const nearWater = (i: number, j: number) => {
    for (let r = 1; r <= SAND_REACH / RESOLUTION; r++) for (let a = 0; a < 8; a++) {
      if (wet(i + Math.round(Math.cos(a * Math.PI / 4) * r), j + Math.round(Math.sin(a * Math.PI / 4) * r))) return true;
    }
    return false;
  };
  const color = new Color3(), shown = new Color3();
  const paint = (waterLevel: number) => {
    painted = waterLevel;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const above = height(i, j) - waterLevel;
      if (above < 0) Color3.LerpToRef(SHALLOW, DEEP, Math.min(1, -above / 1.2), color);
      else if (above < 0.3 && nearWater(i, j)) color.copyFrom(SAND);
      else {
        Color3.LerpToRef(GRASS, HIGH, Math.min(1, above / 3), color);
        Color3.LerpToRef(color, BANK, Math.max(0, Math.min(1, (above - 2.5) / 1.5)), color);
        Color3.LerpToRef(color, PATH, paths[j * size + i]! * 0.8, color);
      }
      if (above >= 0) {
        // Hill shading: light from the top left of the map.
        const dx = height(i + 1, j) - height(i - 1, j), dy = height(i, j + 1) - height(i, j - 1);
        color.scaleInPlace(Math.max(0.5, Math.min(1.4, 1 + (dx + dy) * 3)));
        // A faint contour line every metre of height.
        const level = Math.floor(above);
        if (level > 0 && (Math.floor(height(i + 1, j) - waterLevel) < level || Math.floor(height(i, j + 1) - waterLevel) < level)) color.scaleInPlace(0.8);
      }
      color.toGammaSpaceToRef(shown); // Color works in linear light, the canvas wants sRGB
      const at = (j * size + i) * 4;
      image.data[at] = Math.min(255, shown.r * 255); image.data[at + 1] = Math.min(255, shown.g * 255);
      image.data[at + 2] = Math.min(255, shown.b * 255); image.data[at + 3] = 255;
    }
    ground.getContext("2d")!.putImageData(image, 0, 0);
  };
  paint(waterLevel);

  return {
    /** Paints the view into canvas (made size × devicePixelRatio pixels square), size CSS pixels across on screen. */
    draw(canvas: HTMLCanvasElement, view: MapView, size: number) {
      const px = Math.round(size * devicePixelRatio);
      if (!px) return;
      if (view.level !== undefined && Math.abs(view.level - painted) > 0.005) paint(view.level);
      if (canvas.width !== px) canvas.width = canvas.height = px;
      const g = canvas.getContext("2d")!, k = px / view.span; // canvas pixels per metre
      const at = (p: Point) => [px / 2 + (view.centre.x - p.x) * k, px / 2 + (view.centre.z - p.z) * k] as const;
      g.fillStyle = OUTSIDE;
      g.fillRect(0, 0, px, px);
      const sx = (EXTENT - view.centre.x - view.span / 2) / RESOLUTION, sy = (EXTENT - view.centre.z - view.span / 2) / RESOLUTION;
      const [ox, oy] = [Math.max(0, -sx), Math.max(0, -sy)], [cx, cy] = [Math.max(0, sx), Math.max(0, sy)];
      const sw = Math.min(ground.width, sx + view.span / RESOLUTION) - cx, sh = Math.min(ground.height, sy + view.span / RESOLUTION) - cy;
      if (sw > 0 && sh > 0) g.drawImage(ground, cx, cy, sw, sh, ox * RESOLUTION * k, oy * RESOLUTION * k, sw * RESOLUTION * k, sh * RESOLUTION * k);

      const unit = devicePixelRatio * Math.max(0.8, Math.min(1.7, size / 128)); // marks: about the same size on screen at any span
      g.lineWidth = 1.2 * unit;
      for (const tree of view.trees ?? []) {
        const [x, y] = at(tree);
        g.beginPath();
        g.arc(x, y, 3.4 * unit, 0, Math.PI * 2);
        g.fillStyle = "#2c4420"; g.strokeStyle = "rgba(14,22,10,0.7)";
        g.fill(); g.stroke();
      }
      if (view.dam) {
        // The whole line as a faint dashed outline, the built part solid; at least a few pixels wide on any map.
        const [ax, ay] = at(view.dam.from), [bx, by] = at(view.dam.to);
        g.lineCap = "round";
        g.lineWidth = Math.max(6 * unit, 0.65 * k);
        g.strokeStyle = "rgba(255,255,255,0.4)";
        g.setLineDash([3 * unit, 3 * unit]);
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
        g.setLineDash([]);
        if (view.dam.built > 0) {
          g.strokeStyle = "#6e4a2a";
          g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + (bx - ax) * view.dam.built, ay + (by - ay) * view.dam.built); g.stroke();
        }
        g.lineWidth = 1.2 * unit;
      }
      if (view.lodge) {
        const [x, y] = at(view.lodge);
        g.beginPath();
        g.arc(x, y, Math.max(4.5 * unit, 0.9 * k), 0, Math.PI * 2);
        g.fillStyle = "#6b4a2e"; g.strokeStyle = "rgba(40,28,14,0.9)";
        g.fill(); g.stroke();
      }
      if (view.shop) {
        const [x, y] = at(view.shop), r = Math.max(5 * unit, 2.9 * k);
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fillStyle = "#5a2d78"; g.strokeStyle = GOLD;
        g.fill(); g.stroke();
        g.beginPath();
        g.arc(x, y, Math.max(1.8 * unit, r * 0.3), 0, Math.PI * 2);
        g.fillStyle = "#e8eef5"; g.fill();
      }
      if (view.danceFloor) {
        // Four tiles in a dark square, as the floor is seen from above.
        const [x, y] = at(view.danceFloor), r = Math.max(4.5 * unit, 2 * k), t = r * 0.8;
        g.fillStyle = "#141418"; g.strokeStyle = "rgba(14,14,18,0.9)";
        g.fillRect(x - r, y - r, 2 * r, 2 * r); g.strokeRect(x - r, y - r, 2 * r, 2 * r);
        ["#ff3d8b", "#2fd4ff", "#ffd23a", "#5cff6a"].forEach((c, i) => {
          g.fillStyle = c;
          g.fillRect(x - t + (i % 2) * t + t * 0.08, y - t + Math.floor(i / 2) * t + t * 0.08, t * 0.84, t * 0.84);
        });
      }
      if (view.bakery) {
        // A chimney mark: a gable roof, its chimney standing up on the right, a puff over it.
        const [x, y] = at(view.bakery), r = Math.max(5 * unit, 1.6 * k);
        g.beginPath();
        g.moveTo(x - r, y + r * 0.6); g.lineTo(x - r, y - r * 0.1); g.lineTo(x, y - r * 0.8); g.lineTo(x + r * 0.45, y - r * 0.45);
        g.lineTo(x + r * 0.45, y - r * 1.05); g.lineTo(x + r * 0.75, y - r * 1.05); g.lineTo(x + r * 0.75, y - r * 0.2);
        g.lineTo(x + r, y - r * 0.1); g.lineTo(x + r, y + r * 0.6); g.closePath();
        g.fillStyle = "#b5532f"; g.strokeStyle = "rgba(40,28,14,0.9)";
        g.fill(); g.stroke();
        g.beginPath();
        g.arc(x + r * 0.6, y - r * 1.4, Math.max(1.6 * unit, r * 0.22), 0, Math.PI * 2);
        g.fillStyle = "rgba(235,235,235,0.85)"; g.fill();
      }
      if (view.workbench) {
        // A stump from above: a ring of bark round the pale cut top, a growth ring in it.
        const [x, y] = at(view.workbench), r = Math.max(4 * unit, 1.1 * k);
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fillStyle = "#d2a874"; g.strokeStyle = "#5e3d24"; g.lineWidth = Math.max(1.5, r * 0.35);
        g.fill(); g.stroke();
        g.beginPath();
        g.arc(x, y, r * 0.45, 0, Math.PI * 2);
        g.strokeStyle = "#a77a4a"; g.lineWidth = Math.max(1, r * 0.15); g.stroke();
        g.lineWidth = 1.2 * unit;
      }
      for (const stick of view.sticks) {
        const [x, y] = at(stick);
        g.beginPath();
        g.arc(x, y, 2.6 * unit, 0, Math.PI * 2);
        g.fillStyle = STICKS; g.strokeStyle = "rgba(40,28,14,0.8)";
        g.fill(); g.stroke();
      }
      g.font = `800 ${Math.round(9 * unit)}px ${FONT}`;
      g.textBaseline = "middle";
      /** A chip: text on a rounded backing, its left end at x (or its middle, centred), kept inside the map. */
      const chip = (text: string, x: number, y: number, back: string, ink: string, centred = false) => {
        const h = 14 * unit, w = g.measureText(text).width + 10 * unit;
        x = Math.max(2, Math.min(px - w - 2, centred ? x - w / 2 : x)); y = Math.max(h / 2 + 2, Math.min(px - h / 2 - 2, y));
        g.beginPath(); g.roundRect(x, y - h / 2, w, h, h / 2);
        g.fillStyle = back; g.fill();
        g.fillStyle = ink; g.fillText(text, x + 5 * unit, y + 0.5 * unit);
      };
      for (const p of view.players ?? []) {
        const [x, y] = at(p);
        g.beginPath();
        g.arc(x, y, 4 * unit, 0, Math.PI * 2);
        g.fillStyle = PLAYERS; g.strokeStyle = "#ffffff";
        g.fill(); g.stroke();
        chip(p.name, x - 2 * unit, y + 12 * unit, PANEL, PAPER, true);
      }
      if (view.objective) {
        const [x, y] = at(view.objective);
        chip(view.objective.label, x, y - 12 * unit, GOLD, INK, true);
      }
      const [bx, by] = at(view.beaver);
      // Where the camera looks: a faint wedge. The camera looks along (-sin yaw, -cos yaw) in x, z.
      const look = Math.atan2(Math.cos(view.yaw), Math.sin(view.yaw)); // that direction on the canvas
      g.beginPath();
      g.moveTo(bx, by);
      g.arc(bx, by, 22 * unit, look - 0.4, look + 0.4);
      g.closePath();
      g.fillStyle = "rgba(255,255,255,0.16)";
      g.fill();
      // The beaver: an arrow pointing where it faces, (sin f, cos f) in x, z is (-sin f, -cos f) on the canvas.
      g.save();
      g.translate(bx, by);
      g.rotate(-view.facing);
      g.beginPath();
      g.moveTo(0, -7 * unit); g.lineTo(5 * unit, 5 * unit); g.lineTo(0, 2.5 * unit); g.lineTo(-5 * unit, 5 * unit);
      g.closePath();
      g.fillStyle = GOLD; g.strokeStyle = "#ffffff"; g.lineJoin = "round"; // you: orange, as in the legend
      g.fill(); g.stroke();
      g.restore();
    },
  };
}
export type GameMap = ReturnType<typeof createMap>;
