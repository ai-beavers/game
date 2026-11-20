import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { type TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { TextBlock } from "@babylonjs/gui";
import type { Rectangle } from "@babylonjs/gui/2D/controls/rectangle.js";
import type { Stage } from "../../engine.ts";
import { Overlay, box, floating, hudLayout, measure, onViewport } from "../hud/overlay.ts";
import { INK, PANEL, PAPER, QUIET, RADIUS } from "../hud/style.ts";
import { CHAT_LENGTH } from "./protocol.ts";
import { place, wrap } from "./tags.ts";

// Over each other beaver a tag: its name in a dark pill, with what it is busy with in small letters; over the speaker
// (the player too) a light bubble with its last chat line, for a few seconds. Both keep a readable size on screen,
// fade with distance and behind walls, and are laid out apart (tags.ts place) so close beavers do not cover each other.
const SHOW = 8000, SAY = 6000, HEAD = 1.0;
const NEAR = 16, FAR = 34; // m from the camera: tags fade out between these
const SPOKEN = 4; // px between a bubble and its beaver's tag
const BUBBLE = "rgba(246,242,231,0.95)";
interface Tag {
  name: string; said: string; node: TransformNode; until: number; behind: boolean; doing: string;
  pill: Rectangle; label: TextBlock; activity: TextBlock; bubble: Rectangle; speech: TextBlock;
  /** What it was last fitted for, its sizes then, where it was last put, and this frame's point over its head. */
  fitted: string; w: number; h: number; pillW: number; pillH: number; nameW: number; actW: number; pad: number; bubbleW: number; bubbleH: number;
  at: string; x: number; y: number; distance: number;
}

// The tour's live view is a stream nobody plays: no chat row, no chat log; the tags over the beavers stay.
const live = new URLSearchParams(location.search).get("tour") === "live";

export function createUi(stage: Stage, actions: { send(text: string): void; rename(): void; canChat(): boolean }) {
  const layer = new Overlay(stage, "beaver-net",false,6), tagLayer = new Overlay(stage,"name-tags");
  const tags = new Map<number | "me",Tag>(), lines: { text: string; at: number }[] = [];
  const log = document.createElement("output");
  log.setAttribute("aria-live","polite");
  let statusText = "", typing = false, input: HTMLInputElement | undefined;
  let messages: TextBlock, status: TextBlock;
  // The bottom left of the HUD's layout (hud/style.ts): the chat row at its foot (one "Chat [T]" pill; the name is
  // changed in Settings), the log and the connection over it.
  function layout() {
    const draft = input?.value || "";
    layer.clear();
    layer.dom.append(log);
    const at = hudLayout(stage), {x, y, w: width, h: rowH} = at.chatRow, size = Math.round(at.small*1.05);
    const iconSize = Math.round(size*1.2), capSize = Math.round(size*1.35), pad = Math.round(rowH*.4), keys = !document.getElementById("touch-controls"); // touch has no keys
    const pillW = Math.round(pad*2+iconSize+6+measure("Chat",size,"800")+(keys ? 8+capSize : 0));
    const chat = layer.button("chat-open","Chat",box(x,y,pillW,rowH),openChat);
    chat.panel.background = PANEL; chat.panel.cornerRadius = rowH/2; chat.panel.thickness = 0;
    chat.element.addEventListener("blur",() => { chat.panel.thickness = 0; });
    chat.caption.fontSize = size; chat.caption.fontWeight = "800";
    chat.caption.textHorizontalAlignment = 0; // left
    layer.move(chat.caption,box(x+pad+iconSize+6,y,pillW,rowH));
    layer.icon("chat-icon","chat",box(x+pad,y+(rowH-iconSize)/2,iconSize,iconSize),PAPER);
    if (keys) layer.cap("chat-key","T",box(x+pillW-pad-capSize,y+(rowH-capSize)/2,capSize,capSize),Math.round(size*.8));
    const lineH = Math.round(at.small*1.3*1.1);
    status = layer.label("connection-status",statusText,box(x,at.log.y,width,lineH),at.small);
    messages = layer.label("chat-log","",box(x,at.log.y+lineH,width,at.log.h-lineH-(typing ? 42 : 0)),at.small);
    messages.textVerticalAlignment = 1; // bottom
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
  const rebuild = () => layout();
  function openChat() {
    if (!actions.canChat() || stage.paused || typing) return;
    typing = true; rebuild();
  }
  function closeChat() { typing = false; rebuild(); }
  window.addEventListener("keydown",e => {
    if (typing || document.querySelector("dialog:modal") || stage.paused || e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
    if ((e.code === "Enter" || e.code === "KeyT") && !e.repeat && !e.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey && actions.canChat()) {
      e.preventDefault(); e.stopImmediatePropagation(); openChat();
    }
  },true);
  function push(text: string) {
    lines.push({text,at:performance.now()}); if (lines.length > 8) lines.shift();
    log.value = text;
  }
  onViewport(stage,layout);
  const identity = Matrix.Identity(), point = new Vector3(), screen = new Vector3(), up = new Vector3(0,HEAD,0);
  const controls = (t: Tag) => [t.bubble,t.speech,t.pill,t.label,t.activity];
  /** Sizes the tag and its bubble for what they say now at this font size; nothing to do when that is unchanged. */
  function fit(t: Tag, name: string, speech: string, size: number, width: number) {
    const key = `${size}|${width}|${name}|${t.doing}|${speech}`;
    if (t.fitted === key) return;
    t.fitted = key;
    const small = Math.round(size*0.8), pad = t.pad = Math.round(size*0.55), doing = name && t.doing ? "· " + t.doing : "";
    t.nameW = name ? measure(name,size,"600") : 0;
    t.actW = doing ? measure(doing,small) : 0;
    t.pillW = name ? Math.ceil(2*pad + t.nameW + (doing ? size*0.4 + t.actW : 0)) : 0;
    t.pillH = name ? Math.round(size*1.55) : 0;
    t.label.text = name; t.label.fontSize = size;
    t.activity.text = doing; t.activity.fontSize = small;
    const lines = speech ? wrap(speech,Math.max(120,Math.min(280,width*0.3))-2*pad,s => measure(s,size)) : [];
    t.speech.text = lines.join("\n"); t.speech.fontSize = size;
    t.bubbleW = lines.length ? Math.ceil(2*pad + Math.max(...lines.map(l => measure(l,size)))) : 0;
    t.bubbleH = lines.length ? Math.round(lines.length*size*1.25 + size*0.7) : 0;
    t.w = Math.max(t.pillW,t.bubbleW);
    t.h = t.pillH + t.bubbleH + (t.pillH && t.bubbleH ? SPOKEN : 0);
    t.at = ""; // sizes changed: move everything again
  }
  /** Puts the tag's group with its top-left corner at x, y: the bubble on top, the pill under it. */
  function put(t: Tag, x: number, y: number) {
    x = Math.round(x); y = Math.round(y);
    if (t.at === x + "," + y) return;
    t.at = x + "," + y;
    const bx = x + (t.w-t.bubbleW)/2, px = x + (t.w-t.pillW)/2, py = y + t.h - t.pillH;
    tagLayer.move(t.bubble,box(bx,y,t.bubbleW,t.bubbleH)); tagLayer.move(t.speech,box(bx,y,t.bubbleW,t.bubbleH));
    tagLayer.move(t.pill,box(px,py,t.pillW,t.pillH));
    tagLayer.move(t.label,box(px+t.pad,py,t.nameW+2,t.pillH));
    tagLayer.move(t.activity,box(px+t.pillW-t.pad-t.actW-1,py,t.actW+2,t.pillH));
  }
  return {
    get typing() { return typing; },
    tag(id: number | "me", name: string, node: TransformNode) {
      this.untag(id);
      const bubble = tagLayer.rect("bubble-"+id,box(0,0,0,0),BUBBLE,RADIUS), speech = tagLayer.text("said-"+id,"",box(0,0,0,0),14,"center",false);
      const pill = tagLayer.rect("tag-"+id,box(0,0,0,0),PANEL,RADIUS), label = tagLayer.text("name-"+id,"",box(0,0,0,0),14,"left");
      const activity = tagLayer.text("doing-"+id,"",box(0,0,0,0),11,"left",false);
      speech.color = INK; label.fontWeight = "600"; activity.color = QUIET;
      for (const text of [speech,label,activity]) text.textWrapping = false;
      const tag: Tag = { name, said: "", node, until: 0, behind: false, doing: "", pill, label, activity, bubble, speech,
        fitted: "", w: 0, h: 0, pillW: 0, pillH: 0, nameW: 0, actW: 0, pad: 0, bubbleW: 0, bubbleH: 0, at: "", x: 0, y: 0, distance: 0 };
      for (const c of controls(tag)) c.isVisible = false;
      tags.set(id,tag);
    },
    rename(id: number | "me", name: string) { const t = tags.get(id); if (t) t.name = name; },
    behind(id: number | "me", yes: boolean) { const t = tags.get(id); if (t) t.behind = yes; },
    /** What it is busy with, a word ("carrying"), or "" for nothing. */
    doing(id: number | "me", value: string) { const t = tags.get(id); if (t) t.doing = value; },
    untag(id: number | "me") { const t = tags.get(id); if (t) for (const c of controls(t)) c.dispose(); tags.delete(id); },
    say(id: number | "me", name: string, message: string) {
      const tag = tags.get(id); if (tag) { tag.said = message; tag.until = performance.now()+SAY; }
      push(name + ": " + message);
    },
    line: push,
    status(value = "") { statusText = value; status.text = value; },
    /** The join address is shown on Pause → Players (hud/index.ts), not on the play screen. */
    address(_value: string) {},
    /** The player's own name: shown on the player card (shop/panel.ts) and changed in Settings, not here. */
    me(_value: string) {},
    update() {
      const visible = !stage.paused && !document.querySelector("dialog:modal");
      layer.show(visible && !live); tagLayer.show(visible);
      if (!visible) { if (typing) closeChat(); return; }
      const now = performance.now(), w = stage.canvas.clientWidth, h = stage.canvas.clientHeight;
      messages.text = lines.filter(l => typing || now-l.at<SHOW).slice(-5).map(l => l.text).join("\n");
      const camera = stage.camera, viewport = camera.viewport.toGlobal(w,h), transform = stage.scene.getTransformMatrix();
      // A constant size on screen, larger on a larger one (12 px on a 640×360 stream tile, 17 at 1080p), a little smaller far off.
      const base = Math.max(12,Math.min(17,Math.round(h/30))), shown: Tag[] = [];
      for (const [id,tag] of tags) {
        const speech = tag.until > now ? tag.said : "", name = id === "me" ? "" : tag.name; // our own name: never over our head
        let alpha = 0;
        if ((name || speech) && tag.node.isEnabled()) {
          tag.node.getAbsolutePosition().addToRef(up,point);
          Vector3.ProjectToRef(point,identity,transform,viewport,screen);
          tag.distance = Vector3.Distance(point,camera.globalPosition);
          alpha = Math.min(1,(FAR-tag.distance)/(FAR-NEAR)) * (tag.behind ? 0.22 : 1);
          if (!(screen.z > 0 && screen.z < 1 && screen.x > -50 && screen.x < w+50)) alpha = 0;
        }
        const on = alpha > 0.02;
        if (on) {
          fit(tag,name,speech,Math.max(11,Math.round(base*Math.max(0.8,Math.min(1,1.05-tag.distance/80)))),w);
          tag.x = screen.x; tag.y = screen.y;
          shown.push(tag);
        }
        alpha = Math.round(alpha*20)/20;
        tag.pill.isVisible = tag.label.isVisible = tag.activity.isVisible = on && tag.pillW > 0;
        tag.bubble.isVisible = tag.speech.isVisible = on && tag.bubbleW > 0;
        for (const c of controls(tag)) c.alpha = alpha;
      }
      shown.sort((a,b) => a.distance-b.distance); // the nearest keeps its place, the others make way above it
      floating.length = 0;
      place(shown,w,h).forEach((p,i) => { const t = shown[i]!; put(t,p.x,p.y); floating.push(box(p.x,p.y,t.w,t.h)); });
    },
  };
}
