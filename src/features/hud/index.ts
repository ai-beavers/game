import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scalar } from "@babylonjs/core/Maths/math.scalar.js";
import type { TextBlock } from "@babylonjs/gui";
import { Control } from "@babylonjs/gui/2D/controls/control.js";
import type { CreateFeature } from "../../game.ts";
import { DAM, SLOTS, type Goal } from "../build/rules.ts";
import { showGoalsIn } from "../build/panel.ts";
import { BUTTON, down, firstPad } from "../controls/pad.ts";
import { randomName } from "../net/name.ts";
import { clean, INFO_PATH, NAME_LENGTH } from "../net/protocol.ts";
import type { Remote } from "../net/remote.ts";
import { CONTROLS, DEVICE_NAMES, PRESS, TEACH, USE, type Device, type Step } from "./devices.ts";
import { MapDisplay } from "./map-display.ts";
import { menuNav } from "./nav.ts";
import { EXTENT, type MapView } from "./map.ts";
import { box, GOLD, onViewport, Overlay, safeArea } from "./overlay.ts";
import { skyLabel } from "./sky.ts";

interface NetView { connected: boolean; me: number; host: number; remotes: Map<number, Remote> }
interface BuildView {
  state: { trees: Record<number, { fell?: number; split?: unknown }>; dam: string[] };
  dam: { frame: { origin: { x: number; z: number }; across: { x: number; z: number } }; lodgeAt: { x: number; z: number } };
}
const net = () => (window as { net?: NetView }).net;
const build = () => (window as { build?: BuildView }).build;
type Page = "start" | "pause" | "players" | "settings" | "controls";
// The line under the goal at hand: what to do for it, with this device's button.
const HOW: Record<Goal["id"], (p: { press: string; hold: string }) => string> = {
  stick: p => `Go to the marker, ${p.press}`,
  fell: p => `At a tree, ${p.hold} to gnaw`,
  wood: p => `At the fallen tree, ${p.hold}`,
  dam: p => `Carry sticks to the pond, ${p.press}`,
  lodge: p => `Swim sticks out to the lodge, ${p.press}`,
};
const TAUGHT = "beaver.taught"; // the steps this player has done once, kept between visits like the settings

export const create: CreateFeature = game => {
  const { stage, world, player, settings, events } = game;
  const hud = new Overlay(stage, "beaver-hud", false, 4);
  const dialog = new Overlay(stage, "game-menu", true, 20);
  const map = new MapDisplay(world.heightAt, world.waterLevel);
  const touch = !!document.getElementById("touch-controls");
  let device: Device = touch ? "touch" : "keys", helpDevice: Device = device;
  let large = false, started = false, page: Page | undefined, address = "", goals: Goal[] = [];
  let played = 0, swimUntil = 0, praise = "", praiseUntil = 0, listOpen = false, others: number | undefined;
  let startName = settings.values.name || randomName();
  let sky: TextBlock, fps: TextBlock, mission: TextBlock, prompt: TextBlock, hints: TextBlock, note: TextBlock, players: TextBlock, north: TextBlock, marker: TextBlock;
  let markerY = [0, 0], justDone = "", justDoneUntil = 0;
  // The first minute: each step's hint shows when it is of use and goes once done; done steps are remembered.
  let taught = new Set<Step>();
  try { taught = new Set(JSON.parse(localStorage.getItem(TAUGHT) ?? "[]")); } catch { /* a broken or blocked store: all to learn */ }
  const learn = (step: Step) => {
    if (taught.has(step)) return;
    taught.add(step);
    try { localStorage.setItem(TAUGHT, JSON.stringify([...taught])); } catch { /* not kept, still learnt */ }
  };
  let walked = 0, looked = 0, lastYaw = player.camera.yaw;
  const lastAt = player.node.position.clone();
  let mapSize = 0, nextMap = 0, goalPanel: ReturnType<Overlay["rect"]>, skyPanel: ReturnType<Overlay["rect"]>;
  const readers = document.createElement("output");
  readers.setAttribute("aria-live", "polite");
  const photo = () => document.body.classList.contains("photo");
  // The tour's live view is a stream nobody plays: no buttons, key hints or pause on losing focus (src/features/tour).
  const live = new URLSearchParams(location.search).get("tour") === "live";

  function playerNames() {
    const n = net(), names = [settings.values.name + (n?.connected && n.me === n.host ? " · you · host" : " · you")];
    for (const [id,r] of n?.remotes ?? []) names.push(r.name + (id === n?.host ? " · host" : ""));
    return names;
  }

  function redrawHud() {
    hud.group.removeControl(map);
    hud.clear();
    hud.dom.append(readers);
    const w = stage.canvas.clientWidth, h = stage.canvas.clientHeight;
    const compact = w < 650 || h < 530;
    const {top: T, right: R, bottom: B, left: L} = safeArea(); // all 0 on a desktop
    if (!touch && !live) hud.button("pause","Pause",box(L+12,T+12,68,36),() => open("pause"));
    fps = hud.text("fps","",box(L+(touch ? 12 : 90),T+(touch ? (compact ? 86 : 140) : 12),80,36),13);
    mapSize = large ? Math.min(w-24-L-R,h-62-T-B,390) : compact ? 92 : 126;
    const goalW = compact ? Math.min(w/2-16,200) : 260;
    // The live caption at the top centre (src/features/tour, same sizes): on a small screen the goals and the map go below it.
    const captionSize = Math.max(18,Math.round(h*.03)), captionW = Math.min(w-24,captionSize*24);
    const below = (left: number, right: number) => live && right > (w-captionW)/2 && left < (w+captionW)/2 ? Math.round(h*.025+captionSize*1.9)+8 : 0;
    const mapX = large ? L+(w-L-R-mapSize)/2 : w-R-mapSize-(touch ? 66 : 14);
    const mapY = large ? T+(h-T-B-mapSize)/2 : Math.max(T+14,below(mapX,w));
    const mapBox = box(mapX,mapY,mapSize,mapSize);
    const toggle = hud.button("map","Map",mapBox,toggleMap);
    toggle.element.className = large ? "map large" : "map";
    toggle.element.setAttribute("aria-expanded", String(large));
    toggle.panel.isVisible = toggle.caption.isVisible = false;
    hud.put(map,mapBox);
    map.focused = false;
    toggle.element.onfocus = () => { map.focused = toggle.element.matches(":focus-visible"); map.markAsDirty(); };
    toggle.element.onblur = () => { map.focused = false; map.markAsDirty(); };
    north = hud.text("map-north","N",box(mapX,mapY+3,mapSize,23),15,"center");
    north.fontWeight = "bold"; north.shadowBlur = 3; north.shadowColor = "black"; north.isVisible = large;
    const statusX = w - R - (touch ? 66 : 14) - (compact ? 110 : 146);
    const statusY = large ? T+14 : mapY+mapSize+7;
    skyPanel = hud.rect("weather-panel",box(statusX,statusY,compact ? 110 : 146,27));
    sky = hud.text("weather","",box(statusX,statusY,compact ? 110 : 146,27),13,"center");
    const goalY = Math.max(T + (touch || live ? 14 : 56), below(L+12,L+12+goalW));
    goalPanel = hud.rect("goals-panel",box(L+12,goalY,goalW,1));
    mission = hud.text("goals","",box(L+22,goalY+8,goalW-20,1),compact ? 12 : 14);
    // The panel takes the height of its text, however many lines the goals wrap into; a touch screen's fps go below it.
    // A text resized to fit counts the texture's pixels, not the CSS pixels the rest scales from (twice as many on a phone).
    const k = stage.hud.getSize().width/w;
    mission.resizeToFit = true;
    mission.width = (goalW-20)*k+"px";
    mission.onLinesReadyObservable.add(() => {
      const tall = mission.heightInPixels/k;
      goalPanel.height = tall+16+"px";
      markerY[0] = goalY+tall+16+60; // the marker stays below the goals
      if (touch) fps.top = goalY+tall+22+"px";
    });
    // On a narrow touch screen the thumbs' controls and the chat (net/ui.ts) fill the bottom: prompt and hints above them.
    // On a small desktop window the centred hints would reach the chat row at the bottom left: they go above it.
    // A wide touch screen has the thumbs' buttons at both sides: the centre lines stay between them.
    const bottom = B + (touch ? (w < 640 ? 330 : 152) : compact ? 94 : 58), centerW = Math.min(w-24-L-R,touch && w >= 640 ? w-380 : 560);
    prompt = hud.text("context","",box((w-centerW)/2,h-bottom-54,centerW,46),18,"center");
    hints = hud.text("input-hints","",box((w-centerW)/2,h-bottom,centerW,48),13,"center");
    note = hud.text("announcement","",box(L+12,Math.max(T+8,h*.25),w-24-L-R,54),20,"center");
    players = hud.text("players-list","",box(L+12,T+58,w-24-L-R,Math.max(50,h-128-T-B)),17,"center");
    // Over the thing the goal at hand needs, kept on screen between the goals and the prompt; at the side when off it.
    marker = hud.text("first-marker","",box(0,0,140,52),15,"center",false);
    marker.color = GOLD; marker.fontWeight = "bold"; marker.shadowBlur = 6; marker.shadowColor = "#0b1814"; marker.isVisible = false;
    markerY = [T+(compact ? 150 : 190), h-bottom-60];
    for (const block of [prompt,hints,note,players]) {
      block.shadowBlur = 4; block.shadowColor = "#0b1814"; block.outlineWidth = 2; block.outlineColor = "#1c2824";
    }
    nextMap = 0;
  }

  function toggleMap() {
    const focused = document.activeElement?.matches("#beaver-hud .map");
    large = !large;
    redrawHud();
    if (focused) hud.dom.querySelector<HTMLButtonElement>(".map")?.focus({preventScroll:true});
  }
  function close() {
    page = undefined; dialog.show(false); stage.paused = false;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }
  function play() {
    const name = clean(startName, NAME_LENGTH) || randomName();
    // From the start screen's view of the beaver's face back behind it, where walking starts.
    if (page === "start") player.camera.turn(player.facing + Math.PI - player.camera.yaw, 0);
    lastYaw = player.camera.yaw; walked = 0;
    settings.set({name}); started = true;
    close(); window.dispatchEvent(new Event("beaver:play"));
  }
  function open(next: Page) {
    page = next; stage.paused = true; listOpen = false;
    drawPage(); dialog.show(true);
    dialog.dom.querySelector<HTMLElement>("button")?.focus({preventScroll:true});
  }

  function drawPage() {
    if (!page) return;
    const oldFocus = document.activeElement instanceof HTMLElement && dialog.dom.contains(document.activeElement) ? document.activeElement.getAttribute("aria-label") : null;
    dialog.clear();
    if (page === "start") { drawStart(); refocus(oldFocus); return; }
    const w = stage.canvas.clientWidth, h = stage.canvas.clientHeight, {left: L, right: R} = safeArea();
    const width = Math.min(w-20-L-R,470), rows = {start:7,pause:6,settings:10,controls:10,players:6}[page];
    // Rows of 48 px buttons for fingers where there is room (44 px is the smallest comfortable target).
    const row = Math.min(touch ? 52 : 44, Math.max(21,(h-44)/(rows+1))), height = Math.min(h-12,(rows+1)*row+20);
    const x = L+(w-L-R-width)/2, y = (h-height)/2, inset = width < 340 ? 12 : 22, left = x+inset, inner = width-inset*2;
    dialog.rect("shade",box(0,0,w,h),"rgba(8,17,18,0.55)",0);
    dialog.rect("menu-card",box(x,y,width,height));
    const title = { start:"Beaver Dam", pause:"Paused", settings:"Settings", controls:"Controls", players:"Players" }[page];
    const heading = dialog.text("title",title,box(left,y+6,inner,row*1.28),Math.min(30,row*.8));
    heading.fontFamily = "Georgia, serif"; heading.fontWeight = "bold";
    dialog.dom.setAttribute("aria-label", title);
    let cy = y+row*1.4;
    const nextRow = () => { const r = box(left,cy,inner,row-4); cy += row; return r; };
    const action = (text: string, click: () => void, primary = false) => dialog.button(text,text,nextRow(),click,primary);
    const msg = (name: string, text: string) => dialog.text(name,text,nextRow(),Math.min(14,row*.52));
    const back = () => open("pause");
    if (page === "pause") {
      action("Resume",close,true); action("Players",() => open("players"));
      action("Settings",() => open("settings")); action("Controls",() => { helpDevice = device; open("controls"); });
    } else if (page === "players") {
      const names = playerNames(), r = nextRow();
      const list = dialog.text("names",names.join("   ·   "),box(r.x,r.y,r.w,row*2),14); list.textWrapping = true; cy += row;
      if (address) copyAddress();
      action("Back",back);
    } else if (page === "settings") {
      const r = nextRow(), labelW = Math.min(95,inner*.32);
      dialog.text("name-label","Name",box(r.x,r.y,labelW,r.h));
      const input = dialog.field("hud-name", settings.values.name,box(r.x+labelW,r.y,r.w-labelW,r.h),"Player name",NAME_LENGTH);
      input.onchange = () => { const name = clean(input.value,NAME_LENGTH); if (name) settings.set({name}); input.value = settings.values.name; input.dispatchEvent(new Event("input")); };
      const v = nextRow();
      dialog.text("volume-label","Volume",box(v.x,v.y,labelW,v.h));
      dialog.range("Volume",box(v.x+labelW,v.y,v.w-labelW,v.h),settings.values.volume,volume => settings.set({volume}));
      for (const [key,label] of [["mute","Mute"],["music","Music"],["effects","Picture effects"],["invertY","Invert vertical look"],["fps","Show FPS"]] as const) {
        const b = action("",() => { settings.set({[key]: !settings.values[key]}); sync(); });
        b.element.dataset.adjust = "";
        const sync = () => {
          b.element.setAttribute("aria-label",label); b.element.setAttribute("aria-pressed",String(settings.values[key]));
          b.caption.text = label + (settings.values[key] ? "   ✓" : "   –");
        };
        sync();
      }
      const quality = action("",() => {
        const values = ["low","medium","high"] as const;
        settings.set({quality: values[(values.indexOf(settings.values.quality)+1)%3]!}); syncQuality();
      });
      quality.element.dataset.adjust = "";
      const syncQuality = () => { quality.caption.text = "Picture quality   ·   " + settings.values.quality; quality.element.setAttribute("aria-label",quality.caption.text); };
      syncQuality();
      action("Back",back);
    } else {
      const r = nextRow(), devices: Device[] = ["keys","pad","touch"];
      devices.forEach((d,i) => dialog.button(d,DEVICE_NAMES[d],box(r.x+i*r.w/3,r.y,r.w/3-4,r.h),() => { helpDevice = d; drawPage(); }, d===helpDevice));
      const here = CONTROLS[helpDevice].filter(c => !c.net || !!address);
      const list = here.map(c => c.caps.join(" ") + "    " + c.what).join("\n");
      // Small enough that every line fits the box (a line is about 1.5 font sizes tall), however many the device has.
      dialog.text("bindings",list,box(left,cy,inner,row*6.35),Math.min(15,row*.46,row*6.35/(here.length*1.5)));
      cy += row*6.6; action("Back",back);
    }
    function copyAddress() {
      const r = nextRow(), size = 68;
      dialog.text("join-address",address,box(r.x,r.y,r.w-size-6,r.h),13);
      const copy = dialog.button("copy","Copy",box(r.x+r.w-size,r.y,size,r.h),async () => {
        try { await navigator.clipboard.writeText(address); } catch {
          const input = document.createElement("textarea"); dialog.dom.append(input); input.value = address; input.select(); document.execCommand("copy"); input.remove();
        }
        copy.caption.text = "Copied";
      });
    }
    refocus(oldFocus);
  }
  function refocus(label: string | null) {
    if (label) Array.from(dialog.dom.querySelectorAll<HTMLElement>("button,input")).find(el => el.getAttribute("aria-label")===label)?.focus({preventScroll:true});
  }

  // The start screen: the world and the beaver are the picture; the name and the line on top, Play at the bottom,
  // both in a column at the left on a wide screen and full width on a phone held upright, the beaver between them.
  function drawStart() {
    const w = stage.canvas.clientWidth, h = stage.canvas.clientHeight, {top: T, right: R, bottom: B, left: L} = safeArea();
    const pad = Math.round(Math.max(18, Math.min(56, w*.045))), x = L+pad;
    const colW = Math.min(w-2*pad-L-R, w > h ? Math.min(420, w*.38) : 520);
    const titleSize = Math.round(Math.min(68, colW/6.6, h*.13)), tagSize = Math.round(Math.min(22, Math.max(15, titleSize*.34)));
    const lit = (t: TextBlock) => { t.shadowBlur = 8; t.shadowColor = "rgba(5,12,12,0.9)"; t.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP; return t; };
    dialog.rect("shade",box(0,0,w,h),"rgba(8,17,18,0.18)",0);
    dialog.dom.setAttribute("aria-label", "Beaver Dam");
    let y = T+Math.round(pad*.8);
    const kicker = lit(dialog.text("kicker","LIVE ON STREAM  ·  BUILT BY AI AGENTS",box(x,y,colW,18),12));
    kicker.color = GOLD; kicker.fontWeight = "bold";
    y += 22;
    const title = lit(dialog.text("title","Beaver Dam",box(x,y,colW,titleSize*1.25),titleSize));
    title.fontFamily = "Georgia, serif"; title.fontWeight = "bold"; title.textWrapping = false;
    y += Math.round(titleSize*1.2);
    lit(dialog.text("tagline","Fell trees. Build a dam. Raise your lodge. Together.",box(x,y,colW,tagSize*4),tagSize));
    const inset = 16, inner = colW-inset*2, left = x+inset, playH = touch ? 54 : 48, fieldH = 42, count = others !== undefined;
    const cardH = inset*2 + (count ? 28 : 0) + playH + 10 + fieldH;
    let cy = h-B-Math.round(pad*.8)-cardH;
    dialog.rect("menu-card",box(x,cy,colW,cardH));
    cy += inset;
    if (count) {
      const line = others ? `${others} ${others === 1 ? "beaver is" : "beavers are"} in the world right now` : "Nobody else is here yet: be the first beaver";
      dialog.text("count",line,box(left,cy,inner,20),13).color = GOLD;
      cy += 28;
    }
    dialog.button("play","Play",box(left,cy,inner,playH),play,true).caption.fontSize = 20;
    cy += playH+10;
    const labelW = 90;
    dialog.text("name-label","Your name",box(left,cy,labelW,fieldH),13);
    const input = dialog.field("hud-start-name", startName, box(left+labelW,cy,inner-labelW,fieldH), "Your name", NAME_LENGTH);
    input.oninput = () => { startName = input.value; };
    input.onkeydown = e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); play(); } };
  }

  onViewport(stage, () => { redrawHud(); drawPage(); });
  fetch(INFO_PATH,{signal: AbortSignal.timeout(2000)}).then(r => r.ok ? r.json() : undefined).then(info => {
    if (Array.isArray(info?.addresses) && typeof info.addresses[0] === "string") address = info.addresses[0];
    if (typeof info?.players === "number") others = info.players;
    drawPage();
  }).catch(() => {});
  function use(d: Device) { device = d; }
  window.addEventListener("pointerdown", e => use(e.pointerType === "touch" ? "touch" : "keys"),true);
  window.addEventListener("keydown",e => {
    if (photo() || document.querySelector("dialog:modal") && !dialog.dom.matches(":modal")) return;
    if (page) {
      if (e.code === "Escape") {
        e.preventDefault();
        if (page === "pause") close(); else if (page !== "start") open("pause");
      }
      // Let the focused semantic control receive text, Enter and native Tab navigation.
      return;
    }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.isTrusted) use("keys");
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.code === "Escape") { e.preventDefault(); open("pause"); }
    else if (e.code === "KeyM" && !e.repeat) toggleMap();
    else if (e.code === "Tab" && started) { e.preventDefault(); listOpen = true; }
  },true);
  dialog.dom.addEventListener("keydown",e => e.stopPropagation());
  window.addEventListener("keyup",e => { if (e.code === "Tab") listOpen = false; });
  // The bot plays in tiles nobody focuses (stream pages, several per browser): a tour never pauses for a lost focus.
  function away() { if (!new URLSearchParams(location.search).has("tour") && started && !page && !photo() && !(net()?.remotes.size)) open("pause"); }
  window.addEventListener("blur",away);
  document.addEventListener("visibilitychange",() => { if (document.hidden) away(); });
  events.on("enterWater",() => { swimUntil = played+6; });
  events.on("goalDone",({goal,text}) => { announce("✓ "+text,5); justDone = goal; justDoneUntil = played+4; });
  events.on("action",() => learn("use"));
  events.on("tailSlap",({remote}) => { if (!remote) learn("slap"); });
  // For the tour's "First steps" station: a visitor who has never played.
  Object.assign(window, { hud: { fresh(steps: Step[] = ["move","look","use","slap"]) {
    for (const s of steps) taught.delete(s);
    try { localStorage.setItem(TAUGHT, JSON.stringify([...taught])); } catch { /* not kept */ }
    if (steps.includes("move")) walked = 0;
    if (steps.includes("look")) looked = 0;
  } } });
  function announce(text: string, seconds: number) { praise = text; praiseUntil = played+seconds; readers.value = text; }
  showGoalsIn({ show(list) { goals = list; }, praise(line,more,seconds) { announce(line+"\n"+more,seconds); } });
  const params = new URLSearchParams(location.search);
  if (params.has("play")) { startName ||= "Beaver"; play(); } else open("start");
  let padWas: boolean[] = [], oldOffer = "";

  /** Where the goal at hand can be done, while the player is not at it: the nearest stick until one was picked up,
   *  then the nearest tree to fell, then the fallen one to gnaw. The dam shows its own glowing stick (build/dam.ts). */
  function firstTarget() {
    if (player.carrying || player.offer()) return;
    const at = player.node.position, b = build();
    const nearest = (places: Vector3[]) => places.reduce<Vector3 | undefined>((best,p) => !best || Vector3.DistanceSquared(p,at) < Vector3.DistanceSquared(best,at) ? p : best, undefined);
    if (!taught.has("use")) {
      const stick = nearest(world.sticks.filter(s => s.body.isEnabled()).map(s => s.mesh.position));
      return stick && { at: stick.add(new Vector3(0,0.3,0)), label: "Stick" };
    }
    const goal = current(), standing = goal === "fell";
    if (!standing && goal !== "wood") return;
    const tree = nearest((world.trees ?? []).filter((_,i) => {
      const t = b?.state.trees[i];
      return standing ? t?.fell === undefined : t?.fell !== undefined && !t.split;
    }).map(t => t.place));
    return tree && { at: tree.add(new Vector3(0,standing ? 1.8 : 0.6,0)), label: standing ? "Tree" : "Fallen tree" };
  }
  function current() { return goals.find(g => !g.done)?.id; }
  function pointAt(target: { at: Vector3; label: string } | undefined) {
    marker.isVisible = !!target;
    if (!target) return;
    const w = stage.canvas.clientWidth, h = stage.canvas.clientHeight;
    const p = Vector3.Project(target.at, Matrix.IdentityReadOnly, stage.scene.getTransformMatrix(), stage.camera.viewport.toGlobal(w,h));
    // Behind the camera the projection mirrors: then it is off to a side, the side it lies on.
    const behind = p.z < 0 || p.z > 1, rawX = behind ? (w-p.x < w/2 ? 0 : w) : p.x;
    const x = Scalar.Clamp(rawX,80,w-80), y = Scalar.Clamp(behind ? h : p.y,markerY[0]!,markerY[1]!);
    marker.text = target.label + "\n" + (rawX < 80 ? "◀" : rawX > w-80 ? "▶" : "▼");
    marker.left = x-70+"px";
    marker.top = y-52-5*Math.abs(Math.sin(performance.now()/300))+"px";
  }
  const nav = menuNav();
  return {
    step(dt) { if (started) played += dt; },
    update() {
      nav.update();
      // The start screen looks at the beaver's face, swaying slowly; playing, a turn of the camera is a look around.
      if (page === "start") player.camera.turn(player.facing + 0.6 + 0.3*Math.sin(performance.now()/5000) - player.camera.yaw, 0);
      if (started && !page) looked += Math.abs(player.camera.yaw - lastYaw);
      lastYaw = player.camera.yaw;
      // Metres gone on land or afloat; a jump of more than a metre in one picture is a teleport, not a walk.
      const moved = Vector3.Distance(player.node.position, lastAt);
      if (started && !page && moved < 1) walked += moved;
      lastAt.copyFrom(player.node.position);
      if (walked > 3) learn("move");
      if (looked > 0.8) learn("look");
      const pad = firstPad(navigator.getGamepads?.());
      if (pad) {
        const pressed = pad.buttons.map((_,i) => down(pad,i));
        if (pressed.some((v,i) => v && !padWas[i]) || pad.axes.some(a => Math.abs(a) > 0.5)) use("pad");
        if (pressed[BUTTON.y] && !padWas[BUTTON.y] && !stage.paused && started) toggleMap();
        padWas = pressed;
      } else padWas = [];
      hud.show(started && !photo());
      if (!hud.group.isVisible) return;
      const compact = stage.canvas.clientWidth < 650 || stage.canvas.clientHeight < 530;
      goalPanel.isVisible = mission.isVisible = goals.length > 0 && !large;
      // The goal at hand stands out with what to do for it; a goal just done keeps its tick a moment on a small screen.
      const doing = current();
      const shown = compact ? (doing ? goals.filter(g => g.id === doing || g.id === justDone && played < justDoneUntil) : goals.slice(-1)) : goals;
      const lines = shown.map(g => (g.done ? "✓ " : g.id === doing ? "› " : "· ") + g.text + (g.id === doing && !live ? "\n    " + HOW[g.id](PRESS[device]) : ""));
      if (!doing) lines.push("The world goes on: trees grow back, and others keep building.");
      mission.text = "Beaver work\n" + lines.join("\n");
      fps.text = settings.values.fps ? Math.round(stage.engine.getFps())+" fps" : "";
      const offer = player.offer()?.text || "";
      prompt.text = offer && !live ? USE[device] + "   " + offer : "";
      if (oldOffer !== offer) { oldOffer = offer; readers.value = prompt.text; }
      const feet = player.node.position, pond = world.pond;
      const wet = !!pond && Math.hypot(feet.x-pond.x, feet.z-pond.z) < pond.radius+2.5;
      const step: Step | undefined = !taught.has("move") ? "move" : !taught.has("look") ? "look" : !taught.has("use") && offer ? "use" : !taught.has("slap") && wet ? "slap" : undefined;
      hints.text = step && !live ? TEACH[device][step] : "";
      pointAt(live || large ? undefined : firstTarget());
      note.text = played < praiseUntil ? praise : played < swimUntil && !live ? "Swim to the shore to climb out" : "";
      players.text = listOpen ? "Players\n" + playerNames().join("\n") : "";
      if (game.sky) {
        const s = skyLabel(game.sky.hour,game.sky.weather,game.sky.dark);
        sky.text = s.time+"   "+s.text;
      }
      skyPanel.isVisible = sky.isVisible = !!game.sky;
      const now = performance.now();
      if (now < nextMap) return;
      nextMap = now+90;
      const at = player.node.position, b = build(), n = net();
      let dam: MapView["dam"];
      if (b) {
        const {origin,across} = b.dam.frame, dx = -across.z*DAM.length/2, dz = across.x*DAM.length/2;
        dam = {from:{x:origin.x-dx,z:origin.z-dz},to:{x:origin.x+dx,z:origin.z+dz},built:Math.min(1,b.state.dam.length/SLOTS)}; // the lodge's sticks come after the dam's in that list
      }
      map.paint({centre:large ? {x:0,z:0} : at, span:large ? 2*EXTENT : 26, beaver:at, facing:player.facing, yaw:player.camera.yaw,
        sticks:world.sticks.filter(s => s.body.isEnabled()).map(s => s.mesh.position), trees:world.trees?.filter((_,i) => b?.state.trees[i]?.fell===undefined).map(t => t.place),
        dam, level:world.waterLevel, lodge:b && b.state.dam.length>=SLOTS ? b.dam.lodgeAt : undefined,
        players:n ? [...n.remotes.values()].filter(r => r.node.isEnabled()).map(r => ({x:r.feet.x,z:r.feet.z,name:r.name})) : [] },mapSize);
    },
  };
};
