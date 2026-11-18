import type { TextBlock } from "@babylonjs/gui";
import type { CreateFeature } from "../../game.ts";
import { DAM, SLOTS, type Goal } from "../build/rules.ts";
import { showGoalsIn } from "../build/panel.ts";
import { BUTTON, down, firstPad } from "../controls/pad.ts";
import { clean, INFO_PATH, NAME_LENGTH } from "../net/protocol.ts";
import type { Remote } from "../net/remote.ts";
import { CONTROLS, DEVICE_NAMES, USE, type Device } from "./devices.ts";
import { MapDisplay } from "./map-display.ts";
import { EXTENT, type MapView } from "./map.ts";
import { box, onViewport, Overlay, safeArea } from "./overlay.ts";
import { skyLabel } from "./sky.ts";

interface NetView { connected: boolean; me: number; host: number; remotes: Map<number, Remote> }
interface BuildView {
  state: { trees: Record<number, { fell?: number }>; dam: string[] };
  dam: { frame: { origin: { x: number; z: number }; across: { x: number; z: number } }; lodgeAt: { x: number; z: number } };
}
const net = () => (window as { net?: NetView }).net;
const build = () => (window as { build?: BuildView }).build;
type Page = "start" | "pause" | "players" | "settings" | "controls";

export const create: CreateFeature = game => {
  const { stage, world, player, settings, events } = game;
  const hud = new Overlay(stage, "beaver-hud", false, 4);
  const dialog = new Overlay(stage, "game-menu", true, 20);
  const map = new MapDisplay(world.heightAt, world.waterLevel);
  const touch = !!document.getElementById("touch-controls");
  let device: Device = touch ? "touch" : "keys", helpDevice: Device = device;
  let large = false, started = false, page: Page | undefined, address = "", goals: Goal[] = [];
  let played = 0, hintsUntil = 12, swimUntil = 0, praise = "", praiseUntil = 0, listOpen = false;
  let startName = settings.values.name;
  let sky: TextBlock, fps: TextBlock, mission: TextBlock, prompt: TextBlock, hints: TextBlock, note: TextBlock, players: TextBlock, north: TextBlock;
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
    const goalW = compact ? Math.min(w/2-16,200) : 224;
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
    mission.resizeToFit = true;
    mission.onLinesReadyObservable.add(() => {
      goalPanel.height = mission.heightInPixels+16+"px";
      if (touch) fps.top = goalY+mission.heightInPixels+22+"px";
    });
    // On a narrow touch screen the thumbs' controls and the chat (net/ui.ts) fill the bottom: prompt and hints above them.
    // On a small desktop window the centred hints would reach the chat row at the bottom left: they go above it.
    const bottom = B + (touch ? (w < 640 ? 330 : 152) : compact ? 94 : 58), centerW = Math.min(w-24-L-R,560);
    prompt = hud.text("context","",box((w-centerW)/2,h-bottom-54,centerW,46),18,"center");
    hints = hud.text("input-hints","",box((w-centerW)/2,h-bottom,centerW,48),13,"center");
    note = hud.text("announcement","",box(L+12,Math.max(T+8,h*.25),w-24-L-R,54),20,"center");
    players = hud.text("players-list","",box(L+12,T+58,w-24-L-R,Math.max(50,h-128-T-B)),17,"center");
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
    const name = clean(startName, NAME_LENGTH);
    if (!name) {
      dialog.dom.querySelector<HTMLInputElement>("input")?.focus();
      const error = dialog.group.getChildByName("name-error") as TextBlock;
      error.text = "Enter your name to play."; readers.value = error.text;
      return;
    }
    settings.set({name}); started = true;
    close(); window.dispatchEvent(new Event("beaver:play"));
  }
  function open(next: Page) {
    page = next; stage.paused = true; listOpen = false;
    drawPage(); dialog.show(true);
    const target = page === "start" && !startName ? "input" : "button";
    dialog.dom.querySelector<HTMLElement>(target)?.focus({preventScroll:true});
  }

  function drawPage() {
    if (!page) return;
    const oldFocus = document.activeElement instanceof HTMLElement && dialog.dom.contains(document.activeElement) ? document.activeElement.getAttribute("aria-label") : null;
    dialog.clear();
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
    if (page === "start") {
      msg("intro",touch ? "Gnaw trees, carry sticks, build a dam. Left thumb walks, right thumb looks around." : "Gnaw trees, carry sticks and build a dam together.");
      msg("name-label","Your name");
      const input = dialog.field("hud-start-name", startName, nextRow(), "Your name", NAME_LENGTH);
      input.oninput = () => { startName = input.value; };
      input.onkeydown = e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); play(); } };
      action("Play",play,true);
      msg("name-error","");
      if (address) copyAddress();
    } else if (page === "pause") {
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
      const syncQuality = () => { quality.caption.text = "Picture quality   ·   " + settings.values.quality; quality.element.setAttribute("aria-label",quality.caption.text); };
      syncQuality();
      action("Back",back);
    } else {
      const r = nextRow(), devices: Device[] = ["keys","pad","touch"];
      devices.forEach((d,i) => dialog.button(d,DEVICE_NAMES[d],box(r.x+i*r.w/3,r.y,r.w/3-4,r.h),() => { helpDevice = d; drawPage(); }, d===helpDevice));
      const here = CONTROLS[helpDevice].filter(c => !c.net || !!address);
      const list = here.map(c => c.caps.join(" ") + "    " + c.what).join("\n");
      dialog.text("bindings",list,box(left,cy,inner,row*6.35),Math.min(15,row*.46));
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
    if (oldFocus) Array.from(dialog.dom.querySelectorAll<HTMLElement>("button,input")).find(el => el.getAttribute("aria-label")===oldFocus)?.focus({preventScroll:true});
  }

  onViewport(stage, () => { redrawHud(); drawPage(); });
  fetch(INFO_PATH,{signal: AbortSignal.timeout(2000)}).then(r => r.ok ? r.json() : undefined).then(info => {
    if (Array.isArray(info?.addresses) && typeof info.addresses[0] === "string") { address = info.addresses[0]; drawPage(); }
  }).catch(() => {});
  function use(d: Device) { if (device !== d) { device = d; hintsUntil = played+8; } }
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
  events.on("goalDone",({text}) => announce(text,5));
  function announce(text: string, seconds: number) { praise = text; praiseUntil = played+seconds; readers.value = text; }
  showGoalsIn({ show(list) { goals = list; }, praise(line,more,seconds) { announce(line+"\n"+more,seconds); } });
  const params = new URLSearchParams(location.search);
  if (params.has("play")) { startName ||= "Beaver"; play(); } else open("start");
  let padWas: boolean[] = [], oldOffer = "";
  return {
    step(dt) { if (started) played += dt; },
    update() {
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
      const remaining = goals.filter(g => !g.done);
      const shown = compact ? (remaining[0] ? [remaining[0]] : goals.slice(-1)) : goals;
      mission.text = (remaining.length ? "Beaver work" : "All goals complete") + "\n" + shown.map(g => (g.done ? "✓ " : "· ") + g.text).join("\n");
      fps.text = settings.values.fps ? Math.round(stage.engine.getFps())+" fps" : "";
      const offer = player.offer()?.text || "";
      prompt.text = offer && !live ? USE[device] + "   " + offer : "";
      if (oldOffer !== offer) { oldOffer = offer; readers.value = prompt.text; }
      hints.text = played < hintsUntil && !live ? CONTROLS[device].filter(c => c.hint).slice(0,compact ? 3 : 6).map(c => c.caps.join("")+" "+c.what).join("   ·   ") : "";
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
