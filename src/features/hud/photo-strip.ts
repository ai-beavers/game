import type { Stage } from "../../engine.ts";
import type { Device } from "./devices.ts";
import { box, onViewport, Overlay } from "./overlay.ts";

/** What steers the photo camera on each device (features/post/photo.ts). */
const HELP: Record<Device, string> = {
  keys: "Drag orbits · Right-drag pans · Wheel zooms · Enter saves · Esc leaves",
  pad: "Left stick orbits · Right stick zooms · D-pad ← → blur · A saves · B leaves",
  touch: "Drag to orbit · Pinch to zoom · Two fingers pan",
};

export function createPhotoStrip(stage: Stage, actions: { save(): void; leave(): void; setStrength(n: number): void }) {
  const layer = new Overlay(stage, "photo-strip", false, 30);
  let strength = 0.35, range: ReturnType<Overlay["range"]>, help: ReturnType<Overlay["text"]>;
  let device: Device = document.getElementById("touch-controls") ? "touch" : "keys";
  onViewport(stage, (w,h) => {
    layer.clear();
    const width = Math.min(w-20, 500), x = (w-width)/2, y = h-90;
    layer.rect("photo-panel", box(x,y,width,78));
    help = layer.text("photo-help", HELP[device], box(x+6,y+2,width-12,30), 13, "center");
    const row = y+38, label = 38, button = Math.min(82,width*0.22), slider = width - label - button*2 - 38;
    layer.text("photo-blur","Blur",box(x+10,row,label,30));
    range = layer.range("Depth of field",box(x+label+8,row,slider,30),strength,actions.setStrength);
    layer.button("photo-save","Save PNG",box(x+width-button*2-16,row,button,30),actions.save,true);
    layer.button("photo-back","Back",box(x+width-button-8,row,button,30),actions.leave);
  });
  layer.show(false);
  return {
    show: (on: boolean) => layer.show(on),
    value(n: number) { strength = n; range.set(n); },
    device(d: Device) { if (device !== d) { device = d; help.text = HELP[d]; } },
  };
}
