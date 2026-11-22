// The HUD's texture goes to the GPU only where it changed. Babylon GUI draws only the changed part of the HUD's
// canvas again, but then sends the whole canvas: 12 to 18 ms on a phone for one to two megapixels (measured, iPhone
// over https), and on a touch screen the stick's knob changes it every frame.
//
//   sendChanges(hud, engine);   once, after the fullscreen texture is made (src/engine.ts)
//
// shortcut: this reads Babylon's own fields (the texture's _render, _invalidatedRectangle and _rootContainer, the
// engine's _gl and its texture binding), which a new Babylon may rename, and it draws no background colour (the HUD has
// none); on the WebGPU engine, and wherever one of them is missing, Babylon's own way stays. Take it out when Babylon
// GUI draws and uploads rectangles itself.
import type { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { Measure } from "@babylonjs/gui/2D/measure.js";

export interface Rect { x: number; y: number; w: number; h: number }
const MARGIN = 2, MOST = 8; // px round each change (shadows, rounding); changes kept apart before they count as the whole

/** The rectangles to send for the changes of one picture (min and max corners, inclusive, as Babylon gives them),
 *  inside a canvas of width × height; undefined when the whole canvas is as cheap: none known, too many, or more
 *  than half of it. Rectangles that overlap are sent as one. */
export function changed(marks: [number, number, number, number][], width: number, height: number): Rect[] | undefined {
  if (!marks.length || marks.length > MOST) return;
  const out: Rect[] = [];
  for (const [minX, minY, maxX, maxY] of marks) {
    const x = Math.max(0, Math.floor(minX) - MARGIN), y = Math.max(0, Math.floor(minY) - MARGIN);
    let next = { x, y, w: Math.min(width, Math.ceil(maxX) + 1 + MARGIN) - x, h: Math.min(height, Math.ceil(maxY) + 1 + MARGIN) - y };
    if (next.w <= 0 || next.h <= 0) continue;
    for (let i = out.length - 1; i >= 0; i--) {
      const o = out[i]!;
      if (o.x > next.x + next.w || next.x > o.x + o.w || o.y > next.y + next.h || next.y > o.y + o.h) continue;
      const x0 = Math.min(o.x, next.x), y0 = Math.min(o.y, next.y);
      next = { x: x0, y: y0, w: Math.max(o.x + o.w, next.x + next.w) - x0, h: Math.max(o.y + o.h, next.y + next.h) - y0 };
      out.splice(i, 1);
      i = out.length; // the grown one may now meet the others
    }
    out.push(next);
  }
  return out.reduce((area, r) => area + r.w * r.h, 0) > width * height / 2 ? undefined : out;
}

export function sendChanges(hud: AdvancedDynamicTexture, engine: AbstractEngine) {
  type Inner = { _gl?: WebGL2RenderingContext; _bindTextureDirectly?(target: number, texture: unknown, forTextureDataUpdate?: boolean, force?: boolean): boolean; _unpackFlipY?(value: boolean): void };
  type Drawn = { _render(skipRender?: boolean): void; _invalidatedRectangle: Measure | null; _rootContainer: { _render(context: unknown, rect: Measure): void } };
  const inner = engine as unknown as Inner, gl = inner._gl, drawn = hud as unknown as Drawn;
  if (!gl || !inner._bindTextureDirectly || !inner._unpackFlipY || !drawn._rootContainer?._render || typeof OffscreenCanvas === "undefined") return;
  let marks: [number, number, number, number][] = [], redrawn: Rect[] | undefined, sized = "";
  const mark = hud.invalidateRect.bind(hud), draw = drawn._render.bind(hud), whole = hud.update.bind(hud);
  hud.invalidateRect = (minX, minY, maxX, maxY) => { marks.push([minX, minY, maxX, maxY]); mark(minX, minY, maxX, maxY); };
  // Babylon draws one rectangle round every change again: the stick's knob in one corner and the map in the other
  // make that the whole screen. Here each change is drawn again alone, so what is drawn is what is sent.
  drawn._render = (skipRender) => {
    if (skipRender) return draw(true);
    draw(true); // the layout, which may mark more
    const canvas = hud.getContext().canvas as HTMLCanvasElement, size = `${canvas.width}x${canvas.height}`;
    redrawn = size === sized && drawn._invalidatedRectangle ? changed(marks, canvas.width, canvas.height) : undefined;
    marks = [];
    sized = size;
    if (!redrawn) return draw(false); // the first time, a new size, most of it: Babylon's own way
    const context = hud.getContext();
    for (const { x, y, w, h } of redrawn) {
      context.clearRect(x, y, w, h);
      drawn._rootContainer._render(context, new Measure(x, y, w, h));
    }
    drawn._invalidatedRectangle = null;
  };
  const piece = new OffscreenCanvas(1, 1), pen = piece.getContext("2d")!;
  hud.update = (invertY = true, premulAlpha = false, allowGPUOptimization = false) => {
    const canvas = hud.getContext().canvas as HTMLCanvasElement, texture = hud.getInternalTexture(), rects = redrawn;
    redrawn = undefined;
    if (!rects || !texture) return whole(invertY, premulAlpha, allowGPUOptimization);
    inner._bindTextureDirectly!(gl.TEXTURE_2D, texture, true);
    inner._unpackFlipY!(invertY);
    if (premulAlpha) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    for (const { x, y, w, h } of rects) {
      piece.width = w; // a new size empties it
      piece.height = h;
      pen.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, invertY ? canvas.height - y - h : y, gl.RGBA, gl.UNSIGNED_BYTE, piece);
    }
    if (premulAlpha) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    inner._bindTextureDirectly!(gl.TEXTURE_2D, null);
  };
}
