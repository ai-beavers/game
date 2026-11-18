import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { type TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { TextBlock } from "@babylonjs/gui";
import type { Stage } from "../../engine.ts";
import { Overlay, box, onViewport } from "../hud/overlay.ts";
import { CHAT_LENGTH } from "./protocol.ts";

const SHOW = 8000, SAY = 6000, HEAD = 1.15;
interface Tag { name: string; said: string; node: TransformNode; text: TextBlock; until: number; behind: boolean }

export function createUi(stage: Stage, actions: { send(text: string): void; rename(): void; canChat(): boolean }) {
  const layer = new Overlay(stage, "beaver-net",false,6), tagLayer = new Overlay(stage,"name-tags");
  const tags = new Map<number | "me",Tag>(), lines: { text: string; at: number }[] = [];
  const log = document.createElement("output");
  log.setAttribute("aria-live","polite");
  let name = "", address = "", statusText = "", typing = false, input: HTMLInputElement | undefined;
  let messages: TextBlock, status: TextBlock, me: ReturnType<Overlay["button"]>, join: TextBlock;
  function layout(w: number, h: number) {
    const draft = input?.value || "";
    layer.clear();
    layer.dom.append(log);
    const touch = !!document.getElementById("touch-controls"), narrow = w < 640;
    const bottom = touch ? 145 : 10, x = 12, width = Math.min(w-24,narrow ? w*.66 : 350);
    const y = h-bottom-30;
    me = layer.button("rename",name || "Set name",box(x,y,Math.min(102,width*.42),30),actions.rename);
    me.element.setAttribute("aria-label","Change player name");
    layer.button("chat-open","Chat",box(x+Math.min(102,width*.42)+5,y,55,30),openChat);
    join = layer.text("join",address,box(x+165,y,Math.max(0,width-150),30),11);
    join.isVisible = !narrow;
    messages = layer.text("chat-log","",box(x,y-150,width,typing ? 102 : 150),14);
    messages.textVerticalAlignment = 1; // bottom
    messages.outlineWidth = 2; messages.outlineColor = "#1c2924";
    status = layer.text("connection-status",statusText,box(x,y-181,width,30),13);
    status.outlineWidth = 2; status.outlineColor = "#1c2924";
    input = undefined;
    if (typing) {
      input = layer.field("chat-message",draft,box(x,y-42,width,38),"Message",CHAT_LENGTH);
      input.setAttribute("enterkeyhint","send");
      input.focus({preventScroll:true});
      input.onkeydown = e => {
        if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); const message = input!.value.trim(); if (message) actions.send(message); closeChat(); }
        else if (e.key === "Escape") { e.preventDefault(); closeChat(); }
        e.stopPropagation();
      };
      input.onblur = () => { queueMicrotask(() => { if (typing && input !== document.activeElement) closeChat(); }); };
    }
  }
  const rebuild = () => layout(stage.canvas.clientWidth,stage.canvas.clientHeight);
  function openChat() {
    if (!actions.canChat() || stage.paused || typing) return;
    typing = true; rebuild();
  }
  function closeChat() { typing = false; rebuild(); }
  window.addEventListener("keydown",e => {
    if (typing || document.querySelector("dialog:modal") || stage.paused || e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
    if (e.code === "Enter" && !e.repeat && !e.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey && actions.canChat()) {
      e.preventDefault(); e.stopImmediatePropagation(); openChat();
    }
  },true);
  function push(text: string) {
    lines.push({text,at:performance.now()}); if (lines.length > 8) lines.shift();
    log.value = text;
  }
  onViewport(stage,layout);
  const identity = Matrix.Identity();
  return {
    get typing() { return typing; },
    tag(id: number | "me", name: string, node: TransformNode) {
      this.untag(id);
      const text = tagLayer.text("name-"+id,"",box(0,0,200,50),14,"center");
      text.outlineWidth = 3; text.outlineColor = "#152322";
      tags.set(id,{name,said:"",node,text,until:0,behind:false});
    },
    rename(id: number | "me", name: string) { const t = tags.get(id); if (t) t.name = name; },
    behind(id: number | "me", yes: boolean) { const t = tags.get(id); if (t) t.behind = yes; },
    untag(id: number | "me") { tags.get(id)?.text.dispose(); tags.delete(id); },
    say(id: number | "me", name: string, message: string) {
      const tag = tags.get(id); if (tag) { tag.said = message; tag.until = performance.now()+SAY; }
      push(name + ": " + message);
    },
    line: push,
    status(value = "") { statusText = value; status.text = value; },
    address(value: string) { address = value; join.text = value; },
    me(value: string) { name = value; me.caption.text = value || "Set name"; me.element.textContent = me.caption.text; me.element.setAttribute("aria-label","Change player name"); },
    update() {
      const visible = !stage.paused && !document.querySelector("dialog:modal");
      layer.show(visible); tagLayer.show(visible);
      if (!visible) { if (typing) closeChat(); return; }
      const now = performance.now(), w = stage.canvas.clientWidth, h = stage.canvas.clientHeight;
      messages.text = lines.filter(l => typing || now-l.at<SHOW).slice(-5).map(l => l.text).join("\n");
      const camera = stage.camera, viewport = camera.viewport.toGlobal(w,h);
      for (const [id,tag] of tags) {
        const speech = tag.until > now ? tag.said : "";
        tag.text.text = [speech,id === "me" ? "" : tag.name].filter(Boolean).join("\n");
        if (!tag.text.text || !tag.node.isEnabled()) { tag.text.isVisible = false; continue; }
        const point = tag.node.getAbsolutePosition().add(new Vector3(0,HEAD,0));
        const screen = Vector3.Project(point,identity,stage.scene.getTransformMatrix(),viewport);
        tag.text.isVisible = screen.z > 0 && screen.z < 1 && screen.x > -50 && screen.x < w+50;
        tag.text.alpha = tag.behind ? 0.22 : 1;
        if (tag.text.isVisible) tagLayer.move(tag.text,box(screen.x-120,screen.y-56,240,56));
      }
    },
  };
}
