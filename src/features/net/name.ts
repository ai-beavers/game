import type { Stage } from "../../engine.ts";
import { box, onViewport, Overlay } from "../hud/overlay.ts";
import { clean, NAME_LENGTH } from "./protocol.ts";

export function askName(stage: Stage, current: string, address?: string): Promise<string> {
  const layer = new Overlay(stage,"net-name",true,40);
  let draft = current, field: HTMLInputElement;
  return new Promise(resolve => {
    function finish(value: string) {
      layer.show(false); stop(); layer.dom.remove(); layer.group.dispose(); resolve(value);
    }
    const stop = onViewport(stage,(w,h) => {
      layer.clear();
      const width = Math.min(w-24,360), x = (w-width)/2, y = (h-200)/2;
      layer.rect("shade",box(0,0,w,h),"rgba(10,17,18,.55)",0);
      layer.rect("name-dialog",box(x,y,width,200));
      layer.text("name-title","Your name",box(x+16,y+8,width-32,34),22);
      field = layer.field("net-player-name",draft,box(x+16,y+50,width-32,38),"Player name",NAME_LENGTH);
      field.oninput = () => { draft = field.value; };
      const save = () => { const name = clean(draft,NAME_LENGTH); if (name) finish(name); else field.focus(); };
      layer.button("confirm-name","Play",box(x+16,y+100,width-32,36),save,true);
      layer.text("address", address ? "Friends join at "+ address : "",box(x+16,y+144,width-32,42),13);
      field.onkeydown = e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); save(); } };
    });
    layer.dom.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape" && current) finish(current); });
    layer.show(true); field.focus(); field.select();
  });
}
