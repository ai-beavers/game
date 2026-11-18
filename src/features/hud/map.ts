// The map: the ground painted from world.heightAt (water, sand, grass, hill shading), again whenever the pond's
// level changes, then drawn each frame into a canvas with what is there now: standing trees, sticks, the dam as far
// as it is built, the lodge, other players as named dots, and the beaver as an arrow.
//
//   const map = createMap(world.heightAt, world.waterLevel);
//   map.draw(canvas, { centre, span, beaver, facing, yaw, sticks, trees, dam, lodge, players, level }, size);
//                                         size: CSS pixels across where it is shown; the canvas gets size × devicePixelRatio
//
// North up, fixed: up on the map is +z, the way the camera looks at the start, so right is -x.
import * as THREE from "three";

/** Half the width of the mapped square around the middle of the clearing, m, and metres per pixel. */
export const EXTENT = 22;
const RESOLUTION = 0.2;
const OUTSIDE = "#4a5f36"; // beyond the painted square: thicket

const C = (hex: number) => new THREE.Color(hex);
const DEEP = C(0x3a6f8c), SHALLOW = C(0x7db3c0), SAND = C(0xc4b28a), GRASS = C(0x7c9b4b), HIGH = C(0x5a7a36), BANK = C(0x3f5530);
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
  players?: (Point & { name: string })[];
  /** The pond's surface now; the ground is painted again when it moves. */
  level?: number;
}

export function createMap(heightAt: (x: number, z: number) => number, waterLevel: number) {
  const size = Math.round(2 * EXTENT / RESOLUTION);
  const ground = document.createElement("canvas");
  ground.width = ground.height = size;
  const image = ground.getContext("2d")!.createImageData(size, size);
  // Pixel (i, j) shows world x = EXTENT - i·RESOLUTION, z = EXTENT - j·RESOLUTION (north up, right is -x).
  const heights = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) heights[j * size + i] = heightAt(EXTENT - i * RESOLUTION, EXTENT - j * RESOLUTION);
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
  const color = new THREE.Color(), shown = new THREE.Color();
  const paint = (waterLevel: number) => {
    painted = waterLevel;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const above = height(i, j) - waterLevel;
      if (above < 0) color.copy(SHALLOW).lerp(DEEP, Math.min(1, -above / 1.2));
      else if (above < 0.3 && nearWater(i, j)) color.copy(SAND);
      else color.copy(GRASS).lerp(HIGH, Math.min(1, above / 3)).lerp(BANK, Math.max(0, Math.min(1, (above - 2.5) / 1.5)));
      if (above >= 0) {
        // Hill shading: light from the top left of the map.
        const dx = height(i + 1, j) - height(i - 1, j), dy = height(i, j + 1) - height(i, j - 1);
        color.multiplyScalar(Math.max(0.5, Math.min(1.4, 1 + (dx + dy) * 3)));
        // A faint contour line every metre of height.
        const level = Math.floor(above);
        if (level > 0 && (Math.floor(height(i + 1, j) - waterLevel) < level || Math.floor(height(i, j + 1) - waterLevel) < level)) color.multiplyScalar(0.8);
      }
      shown.copy(color).convertLinearToSRGB(); // THREE.Color works in linear light, the canvas wants sRGB
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
      const sw = Math.min(size, sx + view.span / RESOLUTION) - cx, sh = Math.min(size, sy + view.span / RESOLUTION) - cy;
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
      for (const stick of view.sticks) {
        const [x, y] = at(stick);
        g.beginPath();
        g.arc(x, y, 2.6 * unit, 0, Math.PI * 2);
        g.fillStyle = "#f2d49a"; g.strokeStyle = "rgba(40,28,14,0.8)";
        g.fill(); g.stroke();
      }
      g.font = `600 ${Math.round(10 * unit)}px system-ui, sans-serif`;
      g.textBaseline = "middle";
      for (const p of view.players ?? []) {
        const [x, y] = at(p);
        g.beginPath();
        g.arc(x, y, 4 * unit, 0, Math.PI * 2);
        g.fillStyle = "#8fd3ff"; g.strokeStyle = "#ffffff";
        g.fill(); g.stroke();
        g.lineWidth = 3 * unit; g.strokeStyle = "rgba(20,24,30,0.75)";
        g.strokeText(p.name, x + 6.5 * unit, y);
        g.fillStyle = "#f3efe6";
        g.fillText(p.name, x + 6.5 * unit, y);
        g.lineWidth = 1.2 * unit;
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
      g.fillStyle = "#ffffff"; g.strokeStyle = "rgba(20,24,30,0.9)"; g.lineJoin = "round";
      g.fill(); g.stroke();
      g.restore();
    },
  };
}
export type GameMap = ReturnType<typeof createMap>;
