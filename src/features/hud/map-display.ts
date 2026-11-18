import { Control } from "@babylonjs/gui/2D/controls/control.js";
import type { ICanvasRenderingContext } from "@babylonjs/core";
import { createMap, type MapView } from "./map.ts";

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
    const radius = Math.min(width,height) / 2 - 1;
    if (radius <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(left+width/2, top+height/2, radius, 0, 2*Math.PI);
    ctx.clip();
    ctx.drawImage(this.image, left,top,width,height);
    ctx.strokeStyle = this.focused ? "#f7ca77" : "#e6e3bd";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
    this.draws++;
  }
}
