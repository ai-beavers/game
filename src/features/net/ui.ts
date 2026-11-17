// What the net feature shows: names over the other beavers, chat lines over the speaker's head and in a small list,
// the one-line chat field (Enter), the address to share, and a quiet notice while the connection is down.
// All of it is hidden while document.body has the class "photo". Text is always set as text, never as HTML.
//
//   const ui = createUi(camera, { send, rename });
//   ui.tag(id, name, node) / ui.untag(id)    a label that follows node (a beaver's feet); id "me" for the local one
//   ui.say(id, text)  ui.line(text)          a chat line over a head and in the list; a plain line in the list
//   ui.behind(id, yes)                       fades a label while its beaver is hidden behind something solid
//   ui.status(text?)  ui.address(text)  ui.update()   once a frame
//
// Keys: one listener on window, in the capture phase, registered before the HUD's. While the chat field or the name
// dialog has the focus it takes every key first, so neither the HUD (M, Escape) nor the beaver reacts to typing.
import * as THREE from "three";
import { CHAT_LENGTH } from "./protocol.ts";

const SHOW = 8000, SAY = 6000; // ms a line stays in the list, and over a head
const HEAD = 1.05; // m over the feet

const CSS = `
#beaver-net { position: fixed; inset: 0; pointer-events: none; z-index: 5; color: #f3efe6;
  font: 14px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; --panel: rgba(18, 22, 28, 0.74); }
body.photo #beaver-net { display: none; }
#beaver-net .tag { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; gap: 4px;
  transform-origin: 0 0; white-space: nowrap; will-change: transform; transition: opacity 0.25s; }
#beaver-net .tag .who { font-weight: 600; font-size: 13px; padding: 2px 8px; border-radius: 999px; background: rgba(18, 22, 28, 0.55);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
#beaver-net .tag.me .who { display: none; }
#beaver-net .tag .said { max-width: 260px; white-space: normal; text-align: center; padding: 6px 10px; border-radius: 12px;
  background: rgba(250, 247, 240, 0.94); color: #1a1d22; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25); overflow-wrap: anywhere; }
#beaver-net .tag .said:empty { display: none; }
#beaver-net .side { position: absolute; left: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); width: min(360px, calc(100vw - 32px));
  display: flex; flex-direction: column; gap: 6px; }
#beaver-net .log { display: flex; flex-direction: column; gap: 3px; }
#beaver-net .log div { align-self: flex-start; max-width: 100%; padding: 3px 9px; border-radius: 8px; background: var(--panel);
  overflow-wrap: anywhere; transition: opacity 0.6s; }
#beaver-net .log div.old { opacity: 0; }
#beaver-net.typing .log div.old { opacity: 0.85; }
#beaver-net .log b { font-weight: 600; color: #f1c470; }
#beaver-net .log .note { color: rgba(243, 239, 230, 0.68); font-style: italic; }
#beaver-net .chat { display: none; pointer-events: auto; }
#beaver-net.typing .chat { display: block; }
#beaver-net .chat input { width: 100%; box-sizing: border-box; font: inherit; color: inherit; padding: 7px 10px; border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3); background: rgba(18, 22, 28, 0.85); outline: none; }
#beaver-net .chat input:focus { border-color: #f1c470; }
#beaver-net .info { display: flex; gap: 8px; align-items: center; font-size: 12px; color: rgba(243, 239, 230, 0.68); }
#beaver-net .info button { pointer-events: auto; font: inherit; color: inherit; background: var(--panel); border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px; padding: 2px 8px; cursor: pointer; }
#beaver-net .info button:focus-visible { outline: 2px solid #f1c470; }
#beaver-net .status { position: absolute; left: 16px; top: 64px; font-size: 12px; padding: 5px 10px; border-radius: 8px;
  background: var(--panel); color: rgba(243, 239, 230, 0.8); }
#beaver-net .status:empty { display: none; }
dialog.net-name { border: 0; padding: 0; background: none; color: #f3efe6; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
dialog.net-name::backdrop { background: rgba(10, 12, 16, 0.55); }
dialog.net-name form { display: flex; flex-direction: column; gap: 10px; width: min(340px, 86vw); padding: 20px 22px; border-radius: 14px;
  background: rgba(18, 22, 28, 0.92); border: 1px solid rgba(255, 255, 255, 0.14); }
dialog.net-name h2 { margin: 0; font-size: 18px; }
dialog.net-name p { margin: 0; font-size: 13px; color: rgba(243, 239, 230, 0.7); }
dialog.net-name input { font: inherit; font-size: 16px; color: inherit; padding: 9px 11px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(0, 0, 0, 0.3); outline: none; }
dialog.net-name input:focus { border-color: #f1c470; }
dialog.net-name button { font: inherit; font-weight: 600; padding: 9px; border-radius: 8px; border: 0; background: #f3efe6; color: #1a1d22; cursor: pointer; }
dialog.net-name button:focus-visible { outline: 2px solid #f1c470; outline-offset: 2px; }
dialog.net-name .join b { color: #f3efe6; font-weight: 600; user-select: all; }
`;

interface Tag { el: HTMLElement; said: HTMLElement; node: THREE.Object3D; until: number; behind: boolean }

export function createUi(camera: THREE.Camera, actions: { send(text: string): void; rename(): void; canChat(): boolean }) {
  const style = document.createElement("style");
  style.textContent = CSS;
  const root = document.createElement("div");
  root.id = "beaver-net";
  root.innerHTML = `
    <div class="status" role="status"></div>
    <div class="side">
      <div class="log" aria-live="polite"></div>
      <form class="chat"><input maxlength="${CHAT_LENGTH}" autocomplete="off" spellcheck="false" placeholder="Say something, Enter to send, Esc to close" aria-label="Chat"></form>
      <div class="info"><button type="button" class="me" title="Change your name"></button><span class="where"></span></div>
    </div>`;
  document.head.append(style);
  document.body.append(root);
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const log = $(".log"), input = $<HTMLInputElement>(".chat input"), status = $(".status"), me = $(".me"), where = $(".where");
  me.addEventListener("click", () => actions.rename());

  const tags = new Map<number | "me", Tag>();
  const lines: { el: HTMLElement; at: number }[] = [];
  const push = (el: HTMLElement) => {
    log.append(el);
    lines.push({ el, at: performance.now() });
    while (lines.length > 8) lines.shift()!.el.remove();
  };

  const typing = () => root.classList.contains("typing");
  const open = () => { root.classList.add("typing"); input.value = ""; input.focus(); };
  const close = () => { root.classList.remove("typing"); input.blur(); };
  window.addEventListener("keydown", (e) => {
    if (document.body.classList.contains("photo")) return;
    const target = e.target as Element | null;
    if (target === input) {
      e.stopImmediatePropagation(); // the HUD and the beaver do not see typing
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        if (e.isComposing) return;
        e.preventDefault();
        const text = input.value.trim();
        if (text) actions.send(text);
        close();
      } else if (e.code === "Escape") { e.preventDefault(); close(); }
      return;
    }
    if (target?.closest?.("dialog.net-name")) { e.stopImmediatePropagation(); return; }
    if ((e.code === "Enter" || e.code === "NumpadEnter") && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey
      && !document.querySelector("dialog:modal") && actions.canChat()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      open();
    }
  }, true);
  input.addEventListener("blur", () => root.classList.remove("typing"));
  root.querySelector("form")!.addEventListener("submit", (e) => e.preventDefault());

  const at = new THREE.Vector3();
  return {
    root,
    get typing() { return typing(); },
    tag(id: number | "me", name: string, node: THREE.Object3D) {
      this.untag(id);
      const el = document.createElement("div"), who = document.createElement("span"), said = document.createElement("div");
      el.className = id === "me" ? "tag me" : "tag";
      who.className = "who";
      who.textContent = name;
      said.className = "said";
      el.append(said, who);
      root.prepend(el);
      tags.set(id, { el, said, node, until: 0, behind: false });
    },
    rename(id: number | "me", name: string) { const tag = tags.get(id); if (tag) tag.el.querySelector(".who")!.textContent = name; },
    behind(id: number | "me", yes: boolean) { const tag = tags.get(id); if (tag) tag.behind = yes; },
    untag(id: number | "me") { tags.get(id)?.el.remove(); tags.delete(id); },
    say(id: number | "me", name: string, text: string) {
      const tag = tags.get(id);
      if (tag) { tag.said.textContent = text; tag.until = performance.now() + SAY; }
      const el = document.createElement("div"), who = document.createElement("b");
      who.textContent = `${name}: `;
      el.append(who, text);
      push(el);
    },
    line(text: string) {
      const el = document.createElement("div");
      el.className = "note";
      el.textContent = text;
      push(el);
    },
    status(text = "") { if (status.textContent !== text) status.textContent = text; },
    address(text: string) { where.textContent = text; },
    me(name: string) { me.textContent = name || "Set name"; },

    update() {
      const now = performance.now();
      for (const line of lines) line.el.classList.toggle("old", now - line.at > SHOW);
      const width = innerWidth, height = innerHeight;
      for (const tag of tags.values()) {
        if (tag.until && now > tag.until) { tag.said.textContent = ""; tag.until = 0; }
        tag.node.updateWorldMatrix(true, false);
        at.setFromMatrixPosition(tag.node.matrixWorld);
        at.y += HEAD;
        const distance = at.distanceTo(camera.position);
        at.project(camera);
        const seen = tag.node.visible && at.z < 1 && at.z > -1 && Math.abs(at.x) < 1.2 && Math.abs(at.y) < 1.2;
        tag.el.style.display = seen ? "" : "none";
        if (!seen) continue;
        // Never smaller than readable; a little smaller and fainter far away so a crowd stays legible.
        const scale = Math.max(0.75, Math.min(1, 6 / distance));
        tag.el.style.transform = `translate(${(at.x + 1) / 2 * width}px, ${(1 - at.y) / 2 * height}px) scale(${scale}) translate(-50%, -100%)`;
        tag.el.style.opacity = String(Math.max(0.6, Math.min(1, 30 / distance)) * (tag.behind ? 0.2 : 1));
      }
    },
  };
}
export type Ui = ReturnType<typeof createUi>;
