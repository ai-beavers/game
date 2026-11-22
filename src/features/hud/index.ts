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
import { CONTROLS, DEVICE_NAMES, FIGHT, PRESS, TEACH, USE, type Device, type Step } from "./devices.ts";
import { MapDisplay } from "./map-display.ts";
import { menuNav } from "./nav.ts";
import { EXTENT, type MapView } from "./map.ts";
import { place } from "../net/tags.ts";
import { box, floating, GOLD, hudLayout, measure, onViewport, Overlay, PANEL, goalsPanel, safeArea, underGoals } from "./overlay.ts";
import { skyLabel } from "./sky.ts";
import { FAINT, PAPER, PLAYERS, QUIET, RADIUS, STICKS, TRACK, TRACKER } from "./style.ts";
import { isEnabled } from "../../physics.ts";

interface NetView { connected: boolean; me: number; host: number; remotes: Map<number, Remote> }
interface BuildView {
  state: { trees: Record<number, { fell?: number; split?: unknown }>; dam: string[] };
  dam: { frame: { origin: { x: number; z: number }; across: { x: number; z: number } }; lodgeAt: { x: number; z: number } };
}
const net = () => (window as { net?: NetView }).net;
const build = () => (window as { build?: BuildView }).build;
const shop = () => (window as { shop?: { place: { x: number; z: number } } }).shop;
const bakery = () => (window as { bakery?: { place: { x: number; z: number } } }).bakery;
const workbench = () => (window as { workbench?: { place: { x: number; z: number } } }).workbench;
type Page = "start" | "pause" | "players" | "settings" | "controls";
// The line under the goal at hand: what to do for it; then the key cap of the Use button (held where it says "hold"),
// on touch "tap Use" or "hold Use" in words.
const HOW: Record<Goal["id"], { what: string; hold?: true }> = {
  stick: { what: "Go to the marker" },
  fell: { what: "Gnaw down a tree", hold: true },
  wood: { what: "Gnaw the fallen tree", hold: true },
  dam: { what: "Carry sticks to the pond" },
  lodge: { what: "Swim sticks out to the lodge" },
  cache: { what: "Dive a stick down beside the lodge" },
};
const howText = (id: Goal["id"], device: Device) => {
  const how = HOW[id], words = PRESS[device][how.hold ? "hold" : "press"];
  return device === "touch" ? `${how.what}, ${words}` : how.hold ? `${how.what}, hold` : how.what;
};
/** "Build the dam: 13 of 30" → the title and the count, for the tracker's heading and bar. */
const split = (text: string) => {
  const m = /^(.*): (\d+) of (\d+)$/.exec(text);
  return m ? { title: m[1]!, n: Number(m[2]), of: Number(m[3]) } : { title: text, n: 0, of: 0 };
};
const PLACE = "Beaver Pond"; // the map card's header: where the map is
const spaced = (s: string) => [...s].join(" "); // Babylon GUI has no letter spacing: hair spaces between letters
const TAUGHT = "beaver.taught"; // the steps this player has done once, kept between visits like the settings

export const create: CreateFeature = game => {
  const { stage, world, player, settings, events } = game;
  const hud = new Overlay(stage, "beaver-hud", false, 4), quest = new Overlay(stage, "quest-tracker", false, 4);
  const dialog = new Overlay(stage, "game-menu", true, 20);
  const map = new MapDisplay(world.heightAt, world.waterLevel);
  const touch = !!document.getElementById("touch-controls");
  let device: Device = touch ? "touch" : "keys", helpDevice: Device = device;
  let large = false, started = false, page: Page | undefined, address = "", goals: Goal[] = [];
  let played = 0, swimUntil = 0, bearUntil = 0, praise = "", praiseUntil = 0, listOpen = false, others: number | undefined;
  let startName = settings.values.name || randomName();
  type Pill = ReturnType<Overlay["pill"]>;
  let fps: TextBlock, north: TextBlock, prompt: Pill, hints: Pill, note: Pill, players: Pill, marker: Pill;
  type Rect = ReturnType<Overlay["rect"]>;
  /** The quest tracker's parts (redrawHud); `summary` is the whole list in words, for screen readers and the tour. */
  let tracker: { panel: Rect; summary: TextBlock; head: TextBlock; done: TextBlock; title: TextBlock; track: Rect; fill: Rect; count: TextBlock;
    hintIcon: ReturnType<Overlay["icon"]>; hint: TextBlock; cap: ReturnType<Overlay["cap"]>; shown: string };
  /** The map card's header and its card; `timeX` and `timeSize` as laid out (the controls' getters scale by the device ratio). */
  let sky: { card: Rect; time: TextBlock; kind: TextBlock; icons: Map<string, ReturnType<Overlay["icon"]>>; shown: string; timeX: number; timeSize: number };
  let markerY = [0, 0];
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
  let mapSize = 0, nextMap = 0, layoutNow: ReturnType<typeof hudLayout>;
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

  // Each element in its home of style.ts's layout; see there for the regions.
  function redrawHud() {
    hud.group.removeControl(map);
    hud.clear();
    hud.dom.append(readers);
    const w = stage.canvas.clientWidth, h = stage.canvas.clientHeight, at = hudLayout(stage), {u, small, gap, pad} = at;
    const {top: T, right: R, bottom: B, left: L} = safeArea(); // all 0 on a desktop
    layoutNow = at;
    if (at.pause) hud.button("pause","Pause",at.pause,() => open("pause"));
    fps = hud.label("fps","",at.fps,small,"center");
    // The map card: the hour, the weather and the place on top, the map, the legend under it. With the large map
    // asked for, only its header stays in the corner.
    const card = hud.rect("map-card",large ? at.status : at.card,PANEL,RADIUS);
    const iconSize = Math.round(u*1.05), headY = at.status.y+(at.status.h-iconSize)/2;
    const icons = new Map((["sun","moon","cloud","rain","fog"] as const).map(k => [k as string,hud.icon("sky-"+k,k,box(at.status.x+pad,headY,iconSize,iconSize),GOLD)]));
    const timeX = at.status.x+pad+iconSize+gap*.7, timeSize = Math.round(u*.95);
    const time = hud.text("weather","",box(timeX,at.status.y,u*3.2,at.status.h),timeSize);
    time.fontWeight = "800";
    const kind = hud.text("weather-kind","",box(at.status.x+pad+iconSize+gap*.7+u*3,at.status.y,at.status.w-iconSize-u*3-2*pad,at.status.h),small);
    kind.color = QUIET;
    const room = at.status.w-2*pad-iconSize-u*3.2-measure("Cloudy",small)-gap;
    if (measure(spaced(PLACE),small*.85,"800") < room) {
      const place = hud.text("map-place",spaced(PLACE),box(at.status.x+pad,at.status.y,at.status.w-2*pad,at.status.h),Math.round(small*.85));
      place.fontWeight = "800"; place.color = FAINT; place.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    }
    sky = { card, time, kind, icons, shown: "", timeX, timeSize };
    if (at.legend.h && !large) {
      // The legend: what the dots are; the key that opens the large map.
      const dot = Math.round(small*.55), cy = at.legend.y+at.legend.h/2, type = Math.round(small*.85), capSize = Math.round(small*1.25);
      const keyW = !touch && !live ? capSize+5+measure("Map",type) : 0, end = at.legend.x+at.legend.w-pad-keyW-gap;
      let x = at.legend.x+pad;
      for (const [name,colour] of [["You",GOLD],["Players",PLAYERS],["Sticks",STICKS]] as const) {
        const itemW = dot+4+measure(name,type);
        if (x+itemW > end) break; // a narrow card: the first ones only
        hud.rect("legend-"+name,box(x,cy-dot/2,dot,dot),colour,dot/2);
        const label = hud.text("legend-"+name+"-text",name,box(x+dot+4,at.legend.y,itemW,at.legend.h),type,"left",false);
        label.color = QUIET; label.textWrapping = false;
        x += itemW+gap;
      }
      if (keyW) {
        const words = hud.text("legend-map","Map",box(at.legend.x,at.legend.y,at.legend.w-pad,at.legend.h),type,"left",false);
        words.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT; words.color = QUIET;
        hud.cap("legend-map-key","M",box(at.legend.x+at.legend.w-pad-keyW,cy-capSize/2,capSize,capSize),Math.round(small*.8));
      }
    }
    // The large map is asked for: the middle of the screen, as large as fits.
    mapSize = large ? Math.min(w-24-L-R,h-62-T-B,390) : at.map?.w ?? 0;
    const mapBox = large ? box(L+(w-L-R-mapSize)/2,T+(h-T-B-mapSize)/2,mapSize,mapSize) : at.map ?? box(0,0,0,0);
    const toggle = hud.button("map","Map",mapBox,toggleMap);
    toggle.element.className = large ? "map large" : "map";
    toggle.element.setAttribute("aria-expanded", String(large));
    toggle.element.hidden = !mapSize;
    toggle.panel.isVisible = toggle.caption.isVisible = false;
    hud.put(map,mapBox);
    map.isVisible = !!mapSize;
    map.focused = false;
    toggle.element.onfocus = () => { map.focused = toggle.element.matches(":focus-visible"); map.markAsDirty(); };
    toggle.element.onblur = () => { map.focused = false; map.markAsDirty(); };
    north = hud.label("map-north","N",box(mapBox.x,mapBox.y+3,mapSize,u*1.5),u,"center");
    north.fontWeight = "bold"; north.isVisible = large;
    drawTracker(at);
    prompt = hud.pill("context",at.prompt,Math.round(u*1.15));
    prompt.text.fontWeight = "800";
    hints = hud.pill("input-hints",at.hints,u);
    note = hud.toast("announcement",at.toast,Math.round(u*1.1));
    players = hud.pill("players-list",box(at.goals.x,at.middle.top,w-2*at.goals.x,Math.max(u*4,at.middle.bottom-at.middle.top)),u,"top");
    // Over the thing the goal at hand needs, kept in the middle between the regions; at the side when off screen.
    marker = hud.pill("first-marker",box(0,0,w,u*3),u,"bottom",false);
    marker.text.color = GOLD; marker.text.fontWeight = "bold";
    markerY = [at.middle.top, at.middle.bottom];
    nextMap = 0;
  }

  // The quest tracker in the goals' home: "BEAVER WORK" and how many are done, the goal at hand large, its bar where
  // it has a count, and how to do it. Placed by placeTracker() whenever what it says changes.
  function drawTracker(at: ReturnType<typeof hudLayout>) {
    const {x, y, w} = at.goals, {u, small, pad} = at, inner = w-2*pad;
    quest.clear();
    const panel = quest.rect("goals-panel",box(x,y,w,u*TRACKER));
    // The whole list in words, unseen: what screen readers announce, and what the tour reads ("goals").
    const summary = quest.text("goals","",box(x,y,w,1),small);
    summary.alpha = 0;
    const head = quest.text("goals-head",spaced("BEAVER WORK"),box(x+pad,y,inner,small*1.5),Math.round(small*.85),"left",false);
    head.color = GOLD; head.fontWeight = "900";
    const done = quest.text("goals-done","",box(x+pad,y,inner,small*1.5),Math.round(small*.85),"left",false);
    done.color = QUIET; done.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    const title = quest.text("goals-title","",box(x+pad,y,inner,u*1.8),Math.round(u*1.45),"left",false);
    title.fontWeight = "800"; title.textWrapping = false;
    const track = quest.rect("goals-track",box(x+pad,y,1,1),TRACK,3), fill = quest.rect("goals-bar",box(x+pad,y,1,1),GOLD,3);
    const count = quest.text("goals-count","",box(x+pad,y,inner,u*1.3),u,"left",false);
    count.fontWeight = "800"; count.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    const hintIcon = quest.icon("goals-how-icon","stick",box(x+pad,y,small,small),QUIET);
    const hint = quest.text("goals-how","",box(x+pad,y,inner,u*1.4),small,"left",false);
    hint.textWrapping = false;
    const cap = quest.cap("goals-how-key","",box(x,y,Math.round(small*1.4),Math.round(small*1.4)),Math.round(small*.85));
    tracker = { panel, summary, head, done, title, track, fill, count, hintIcon, hint, cap, shown: "" };
  }
  /** Lays the tracker out for what it says now: the panel takes the height of what it shows, the marker keeps under it. */
  function placeTracker(heading: string, doneText: string, counted: { n: number; of: number } | undefined, how: string, key: string, doing: boolean) {
    const at = layoutNow, {x, y, w} = at.goals, {u, small, pad, gap} = at, inner = w-2*pad, t = tracker;
    let cy = y+pad;
    t.done.text = doneText;
    for (const c of [t.head,t.done]) quest.move(c,box(x+pad,cy,inner,Math.round(small*1.4)));
    cy += Math.round(small*1.4)+gap*.6;
    // The title as large as fits its row.
    t.title.text = heading;
    t.title.fontSize = Math.min(Math.round(u*1.45),Math.floor(inner/Math.max(1,measure(heading,1,"800"))));
    quest.move(t.title,box(x+pad,cy,inner,Math.round(u*1.8)));
    cy += Math.round(u*1.8)+gap*.4;
    t.track.isVisible = t.fill.isVisible = t.count.isVisible = !!counted;
    if (counted) {
      const countW = Math.ceil(measure(`${counted.of}/${counted.of}`,u,"800"))+gap, barW = inner-countW-gap, barH = Math.max(4,Math.round(u*.4));
      t.count.text = `${counted.n}/${counted.of}`;
      quest.move(t.count,box(x+pad,cy,inner,Math.round(u*1.3)));
      quest.move(t.track,box(x+pad,cy+Math.round((u*1.3-barH)/2),barW,barH));
      t.fill.isVisible = counted.n > 0;
      quest.move(t.fill,box(x+pad,cy+Math.round((u*1.3-barH)/2),Math.max(barH,Math.round(barW*counted.n/Math.max(1,counted.of))),barH));
      cy += Math.round(u*1.3)+gap*.4;
    }
    // How to do it: the stick's icon, the line, the key cap; all done, only the line.
    t.hint.isVisible = !!how; t.hintIcon.isVisible = !!how && doing;
    t.cap.back.isVisible = !!how && !!key;
    if (how) {
      const rowH = Math.round(u*1.4), iconSize = t.hintIcon.isVisible ? Math.round(small*1.1) : 0, textX = x+pad+(iconSize ? iconSize+gap*.8 : 0);
      t.hint.text = how; t.hint.color = iconSize ? PAPER : QUIET;
      quest.move(t.hintIcon,box(x+pad,cy+(rowH-iconSize)/2,iconSize,iconSize));
      quest.move(t.hint,box(textX,cy,x+pad+inner-textX,rowH));
      if (key) { t.cap.text.text = key; t.cap.at(Math.round(textX+measure(how,small)+gap*.8),Math.round(cy+(rowH-small*1.4)/2)); }
      cy += rowH;
    }
    const tall = Math.min(cy+pad-y, at.goals.h);
    quest.move(t.panel,goalsPanel.box = box(x,y,w,tall));
    markerY[0] = Math.max(at.middle.top, y+tall+gap); // the marker stays below the goals
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
  events.on("bearNotices",() => { bearUntil = played+8; });
  events.on("goalDone",({text}) => { announce("✓ "+text,5); });
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
      const stick = nearest(world.sticks.filter(s => isEnabled(s.body)).map(s => s.mesh.position));
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
    if (!target) return marker.set("");
    const w = stage.canvas.clientWidth, h = stage.canvas.clientHeight;
    const p = Vector3.Project(target.at, Matrix.IdentityReadOnly, stage.scene.getTransformMatrix(), stage.camera.viewport.toGlobal(w,h));
    // Behind the camera the projection mirrors: then it is off to a side, the side it lies on.
    const behind = p.z < 0 || p.z > 1, rawX = behind ? (w-p.x < w/2 ? 0 : w) : p.x;
    const text = target.label + " " + (rawX < 80 ? "◀" : rawX > w-80 ? "▶" : "▼");
    marker.set(text);
    const size = marker.measure(text);
    let x = Scalar.Clamp(rawX,size.w/2+8,w-size.w/2-8), top = markerY[0]!;
    // Clear of what hangs under the goals (Mrs. Beaver's quest list): below it where there is room, else beside it.
    const hung = underGoals.box;
    if (hung && x-size.w/2 < hung.x+hung.w+8) {
      if (hung.y+hung.h+8+size.h <= markerY[1]!) top = Math.max(top, hung.y+hung.h+8);
      else x = Math.max(x, hung.x+hung.w+8+size.w/2);
    }
    const y = Scalar.Clamp(behind ? h : p.y,top+size.h,markerY[1]!) - 5*Math.abs(Math.sin(performance.now()/300));
    // Clear of the name tags and bubbles (net/ui.ts): they keep their places, the marker goes up above them.
    const spot = place([...floating.map(f => ({x: f.x+f.w/2, y: f.y+f.h, w: f.w, h: f.h})), {x, y, ...size}], w, h).at(-1)!;
    marker.at(spot.x, spot.y);
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
        if (pressed[BUTTON.lt] && !padWas[BUTTON.lt] && !stage.paused && started) toggleMap();
        padWas = pressed;
      } else padWas = [];
      hud.show(started && !photo());
      if (!hud.group.isVisible) quest.show(false);
      if (!hud.group.isVisible) return;
      const trackerOn = goals.length > 0 && !large;
      quest.show(trackerOn); tracker.panel.isVisible = trackerOn; // mrs-beaver/panel.ts hangs under it while it shows
      if (!trackerOn) { goalsPanel.box = undefined; tracker.shown = ""; } // placed (and published) anew when it shows again
      // The goal at hand, large, with its count and what to do for it; all done, the world going on.
      const doing = current(), goal = doing ? goals.find(g => g.id === doing)! : undefined, parts = goal && split(goal.text);
      const how = !doing ? "Trees grow back, and others keep building." : live ? "" : howText(doing, device);
      const key = doing && !live && device !== "touch" ? USE[device] : "";
      const doneText = `${goals.filter(g => g.done).length} of ${goals.length} done`;
      const say = [parts?.title, doneText, parts?.n, how, key].join("|");
      if (trackerOn && say !== tracker.shown) {
        tracker.shown = say;
        placeTracker(parts?.title ?? "The world goes on", doneText, parts?.of ? parts : undefined, how, key, !!doing);
      }
      tracker.summary.text = "Beaver work\n" + goals.map(g => (g.done ? "✓ " : g.id === doing ? "› " : "· ") + g.text).join("\n");
      // A card with a row hung under it (Mrs. Beaver's quest) joins it: square corners where they meet.
      tracker.panel.cornerRadiusZ = tracker.panel.cornerRadiusW = underGoals.box ? 0 : RADIUS;
      fps.text = settings.values.fps ? Math.round(stage.engine.getFps())+" fps" : "";
      const offer = player.offer()?.text || "";
      if (live || !offer) prompt.set("");
      else if (device === "touch") prompt.set(USE.touch + "   " + offer); // no keys on touch: the button's name
      else prompt.set(offer, USE[device]);
      if (oldOffer !== offer) { oldOffer = offer; readers.value = prompt.text.text; }
      const feet = player.node.position, pond = world.pond;
      const wet = !!pond && Math.hypot(feet.x-pond.x, feet.z-pond.z) < pond.radius+2.5;
      const step: Step | undefined = !taught.has("move") ? "move" : !taught.has("look") ? "look" : !taught.has("use") && offer ? "use" : !taught.has("slap") && wet ? "slap" : undefined;
      // One line of advice at a time, low in the middle over the prompt: what to do about the bear, what to learn, else
      // how to get out of the water.
      hints.set(live ? "" : played < bearUntil ? FIGHT[device] : step ? TEACH[device][step] : played < swimUntil ? "Swim to the shore to climb out" : "");
      pointAt(live || large ? undefined : firstTarget());
      note.set(played < praiseUntil ? praise : "");
      players.set(listOpen ? "Players\n" + playerNames().join("\n") : "");
      const s = game.sky && skyLabel(game.sky.hour,game.sky.weather,game.sky.dark), sayingSky = s ? s.time+s.icon+s.text : "";
      if (sayingSky !== sky.shown) {
        sky.shown = sayingSky;
        sky.time.text = s?.time ?? ""; sky.kind.text = s?.text ?? "";
        sky.kind.left = Math.round(sky.timeX+measure(sky.time.text,sky.timeSize,"800")+layoutNow.gap*.7)+"px";
        for (const [k,image] of sky.icons) image.isVisible = k === s?.icon;
      }
      const now = performance.now();
      if (now < nextMap) return;
      nextMap = now+90;
      const at = player.node.position, b = build(), n = net();
      let dam: MapView["dam"], objective: MapView["objective"];
      if (b) {
        const {origin,across} = b.dam.frame, dx = -across.z*DAM.length/2, dz = across.x*DAM.length/2;
        dam = {from:{x:origin.x-dx,z:origin.z-dz},to:{x:origin.x+dx,z:origin.z+dz},built:Math.min(1,b.state.dam.length/SLOTS)}; // the lodge's sticks come after the dam's in that list
        // The goal at hand's place, with how far it is: the dam, else the lodge (its cache lies beside it).
        const doing = current(), place = doing === "dam" ? origin : doing === "lodge" || doing === "cache" ? b.dam.lodgeAt : undefined;
        if (place) objective = {...place,label:`${doing === "dam" ? "Dam" : "Lodge"} · ${Math.round(Math.hypot(place.x-at.x,place.z-at.z))} m`};
      }
      map.paint({centre:large ? {x:0,z:0} : at, span:large ? 2*EXTENT : 26, beaver:at, facing:player.facing, yaw:player.camera.yaw,
        sticks:world.sticks.filter(s => isEnabled(s.body)).map(s => s.mesh.position), trees:world.trees?.filter((_,i) => b?.state.trees[i]?.fell===undefined).map(t => t.place),
        dam, objective, level:world.waterLevel, lodge:b && b.state.dam.length>=SLOTS ? b.dam.lodgeAt : undefined, shop:shop()?.place, bakery:bakery()?.place, workbench:workbench()?.place,
        players:n ? [...n.remotes.values()].filter(r => r.node.isEnabled()).map(r => ({x:r.feet.x,z:r.feet.z,name:r.name})) : [] },mapSize);
    },
  };
};
