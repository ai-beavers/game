import { Control } from "@babylonjs/gui/2D/controls/control.js";
import type { ICanvasRenderingContext } from "@babylonjs/core";
import { createMap, type MapView } from "./map.ts";
import { GOLD } from "./style.ts";

/** The map's offscreen canvas is sampled by the same Babylon GUI texture as all other controls. */
export class MapDisplay extends Control {
  private readonly image = document.createElement("canvas");
  private readonly map;
  draws = 0;
  focused = false;

  constructor(heightAt: (x: number, z: number) => number, water: number) {
    super("map-disc");
    this.map = createMap(heightAt, water);
  }

  paint(view: MapView, size: number) {
    this.map.draw(this.image, view, size);
    this.markAsDirty();
  }

  override _draw(ctx: ICanvasRenderingContext) {
    const { left, top, width, height } = this._currentMeasure;
    if (width <= 2) return;
    // A rounded square inside the map card; a gold edge while it has the keyboard's focus.
    ctx.save();
    ctx.beginPath();
    (ctx as unknown as CanvasRenderingContext2D).roundRect(left, top, width, height, Math.min(12, width / 10)); // the GUI draws on a 2D canvas
    ctx.clip();
    ctx.drawImage(this.image, left,top,width,height);
    if (this.focused) { ctx.strokeStyle = GOLD; ctx.lineWidth = 4; ctx.stroke(); }
    ctx.restore();
    this.draws++;
  }
}
