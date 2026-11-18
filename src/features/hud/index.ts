// The HUD: everything on screen that is not the 3D picture, as HTML laid over the canvas.
//
//   createGame(canvas, [..., hud])       creates #beaver-hud in document.body; nothing else to call
//
// What it shows:
// - a start screen with the player's name (required, kept in settings.name; the net feature asks for none while
//   #beaver-hud exists) and, when the game runs on the network server, the address others open to join;
//   pressing Play sends a "beaver:play" event on window, still inside the click, so other features may start sound
// - what the context key does right now (player.offer(), or its own reach rule while the player has none)
// - the goals of the build feature (build/panel.ts hands them over), a line when one is reached or the dam is done
// - a round map, true to the world (M, Y on a gamepad or a click makes it large), and under it the hour and weather;
//   the map and its N are drawn by three.js (map-display.ts), its <button> here only places it and takes input
// - control hints for the first seconds, for the device used last (keyboard, gamepad, touch)
// - the players on the network while Tab is held, and in the pause menu
// - the pause menu (Escape, Start, or the button top left): Resume, Players, Settings, Controls
// While body has the class "photo" (photo mode) all of it is hidden and Escape is left to the photo mode.
//
// With the touch overlay of src/features/controls on screen its pause button is the only one (ours hides) and the
// map moves left of it; nothing of the HUD sits where the thumbs are.
//
// Keys: the HUD listens on window in the capture phase. Keys typed into a text field are never the HUD's. While the
// start screen or the menu is open it keeps every key from the game (the menu still works with Tab, Enter, Space,
// arrows, Escape); during play it takes only Escape, M and Tab, which the player does not use.
// When the window loses focus the game pauses, unless other players are connected: then the world goes on.
//
// ?play in the address skips the start screen (labs, screenshots); without a name it plays as "Beaver".
import type { CreateFeature } from "../../game.ts";
import type { Settings } from "../../settings.ts";
import { DAM, SLOTS, type Goal } from "../build/rules.ts";
import { showGoalsIn } from "../build/panel.ts";
import { BUTTON, down, firstPad } from "../controls/pad.ts";
import { clean, INFO_PATH, NAME_LENGTH } from "../net/protocol.ts";
import { cap, caps, CONTROLS, DEVICE_NAMES, USE, type Device } from "./devices.ts";
import { createMap, EXTENT, type MapView } from "./map.ts";
import { createMapDisplay } from "./map-display.ts";
import { contextAction } from "./reach.ts";
import { SKY_ICONS, skyLabel } from "./sky.ts";
import { CSS } from "./style.ts";

const HINT_TIME = 12, AGAIN_TIME = 8, NOTE_TIME = 6; // s of play the hints stay, again after a change of device; the swimming line
const SMALL_SPAN = 26; // m across the small map, around the beaver
const TITLE = "Beaver Dam";

/** What the net feature puts on window.net, as far as the HUD reads it. */
interface NetView {
  connected: boolean; me: number; host: number;
  remotes: Map<number, { name: string; node: { visible: boolean; position: { x: number; z: number } } }>;
}
/** What the build feature puts on window.build, as far as the map reads it. */
interface BuildView {
  state: { trees: Record<number, { fell?: number }>; dam: string[] };
  dam: { frame: { origin: { x: number; z: number }; across: { x: number; z: number } }; lodgeAt: { x: number; z: number } };
}
const net = () => (window as { net?: NetView }).net;
const build = () => (window as { build?: BuildView }).build;

const controlList = (device: Device, online: boolean, cls = "", hintsOnly = false) =>
  `<dl class="keys ${cls}">${CONTROLS[device].filter((c) => (online || !c.net) && (!hintsOnly || c.hint))
    .map((c) => `<dt>${caps(device, c.caps)}</dt><dd>${c.what}</dd>`).join("")}</dl>`;
const check = (key: keyof Settings, label: string) =>
  `<div class="setting"><label for="hud-${key}">${label}</label><input type="checkbox" id="hud-${key}" data-key="${key}"></div>`;
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable
  || target instanceof HTMLTextAreaElement
  || (target instanceof HTMLInputElement && !["checkbox", "radio", "range", "button", "submit"].includes(target.type)));

const HTML = `
<div class="corner play">
  <button class="pause panel" type="button" aria-label="Pause menu (Escape)"></button>
  <span class="fps panel" aria-hidden="true" hidden></span>
</div>
<button class="map play" type="button" aria-label="Map. Press M to enlarge or shrink it."></button>
<div class="side play">
  <div class="sky panel" hidden><span class="icon"></span><span class="time"></span><span class="weather"></span></div>
  <section class="goals panel" aria-label="Goals" hidden><h3>Beaver work</h3><ol></ol></section>
</div>
<div class="cheer" role="status" aria-live="polite"><b></b><small></small></div>
<section class="who panel" aria-label="Players" hidden><h3>Players</h3><ul class="people"></ul></section>
<div class="bottom play">
  <div class="note panel off" role="status">Swimming: steer as on land, swim to the shore to climb out</div>
  <div class="prompt panel off" role="status" aria-live="polite"><span class="cap"></span><span class="text"></span></div>
  <div class="hints panel" aria-hidden="true"></div>
</div>
<dialog class="start" aria-labelledby="hud-title">
  <div class="inner">
    <header><h1 id="hud-title">${TITLE}</h1><p class="tagline">Gnaw trees, carry sticks, dam the pond. Together, if friends are near.</p></header>
    <form class="enter panel">
      <label for="hud-start-name">Your name</label>
      <div class="row">
        <input id="hud-start-name" name="name" maxlength="${NAME_LENGTH}" autocomplete="nickname" spellcheck="false" required placeholder="Name">
        <button class="go" type="submit">Play</button>
      </div>
      <p class="need" hidden>A name first: the others see it over your beaver.</p>
      <p class="join address" hidden>Friends join at <b></b> <button type="button" class="copy small">Copy</button></p>
    </form>
    <div class="start-keys"></div>
  </div>
</dialog>
<dialog class="menu" aria-labelledby="hud-menu-title">
  <section class="panel" data-page="main">
    <h2 id="hud-menu-title">Paused</h2>
    <div class="row-buttons">
      <button class="item primary" type="button" data-do="resume">Resume</button>
      <button class="item" type="button" data-do="players" hidden>Players</button>
      <button class="item" type="button" data-do="settings">Settings</button>
      <button class="item" type="button" data-do="controls">Controls</button>
    </div>
  </section>
  <section class="panel" data-page="players" aria-labelledby="hud-players-title" hidden>
    <h2 id="hud-players-title">Players</h2>
    <ul class="people"></ul>
    <p class="address" hidden>Friends join at <b></b> <button type="button" class="copy small">Copy</button></p>
    <button class="item" type="button" data-do="back">Back</button>
  </section>
  <section class="panel" data-page="settings" aria-labelledby="hud-settings-title" hidden>
    <h2 id="hud-settings-title">Settings</h2>
    <div class="setting"><label for="hud-name">Name</label><input type="text" id="hud-name" maxlength="${NAME_LENGTH}" autocomplete="nickname" spellcheck="false"></div>
    <div class="setting"><label for="hud-volume">Volume</label><input type="range" id="hud-volume" min="0" max="100" step="5"></div>
    ${check("mute", "Mute")}
    ${check("music", "Music")}
    <fieldset class="setting"><legend>Picture quality</legend><div class="choice">
      ${["low", "medium", "high"].map((q) => `<label><input type="radio" name="hud-quality" value="${q}">${q[0]!.toUpperCase() + q.slice(1)}</label>`).join("")}
    </div></fieldset>
    ${check("effects", "Effects")}
    ${check("invertY", "Invert look up / down")}
    ${check("fps", "Show frames per second")}
    <button class="item" type="button" data-do="back">Back</button>
  </section>
  <section class="panel wide" data-page="controls" aria-labelledby="hud-controls-title" hidden>
    <h2 id="hud-controls-title">Controls</h2>
    <div class="devices"></div>
    <button class="item" type="button" data-do="back">Back</button>
  </section>
</dialog>`;

export const create: CreateFeature = (game) => {
  const { stage, world, player, settings, events } = game;
  const style = document.createElement("style");
  style.textContent = CSS;
  const root = document.createElement("div");
  root.id = "beaver-hud";
  root.innerHTML = HTML;
  document.head.append(style);
  document.body.append(root);
  const $ = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const start = $<HTMLDialogElement>(".start"), menu = $<HTMLDialogElement>(".menu");
  const prompt = $(".prompt"), promptCap = $(".prompt .cap"), promptText = $(".prompt .text"), hints = $(".hints"), note = $(".note"), fps = $(".fps");
  const mapButton = $(".map"), mapDisplay = createMapDisplay(stage);
  const map = createMap(world.heightAt, world.waterLevel);
  const photo = () => document.body.classList.contains("photo");
  const touchOverlay = !!document.querySelector(".touch-controls");
  root.classList.toggle("touchy", touchOverlay); // their pause button, top right, is the one; the map moves left of it

  // ---- the device used last: keyboard, gamepad or touch ----
  let device: Device = touchOverlay ? "touch" : "keys", online = false, played = 0, hintsUntil = HINT_TIME;
  const showDevice = () => {
    hints.innerHTML = CONTROLS[device].filter((c) => c.hint && (online || !c.net))
      .map((c) => `<span>${caps(device, c.caps)} ${c.what}</span>`).join("");
    $(".start-keys").innerHTML = controlList(device, online, "panel", true);
    $(".devices").innerHTML = (["keys", "pad", "touch"] as Device[])
      .map((d) => `<div><h3>${DEVICE_NAMES[d]}</h3>${controlList(d, online)}</div>`).join("");
    promptCap.innerHTML = cap(device, USE[device]);
  };
  const use = (now: Device) => {
    if (now === device) return;
    device = now;
    root.dataset.device = now;
    showDevice();
    if (playing) hintsUntil = Math.max(hintsUntil, played + AGAIN_TIME);
  };
  root.dataset.device = device;
  showDevice();
  window.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") use("touch"); else if (e.pointerType === "mouse" && device === "pad") use("keys"); }, true);

  // ---- start screen: the name, and the address to join ----
  let playing = false, noteUntil = -1;
  const nameField = $<HTMLInputElement>("#hud-start-name"), need = $(".need");
  nameField.value = settings.values.name;
  const play = () => {
    if (playing) return;
    playing = true;
    if (start.open) start.close();
    root.classList.remove("waiting");
    stage.paused = false;
    window.dispatchEvent(new Event("beaver:play"));
  };
  $(".enter").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = clean(nameField.value, NAME_LENGTH);
    need.hidden = !!name;
    if (!name) { nameField.focus(); return; }
    if (name !== settings.values.name) settings.set({ name });
    play();
  });
  nameField.addEventListener("input", () => { if (clean(nameField.value, NAME_LENGTH)) need.hidden = true; });
  if (new URLSearchParams(location.search).has("play")) {
    if (!settings.values.name) settings.set({ name: "Beaver" });
    play();
  } else {
    root.classList.add("waiting");
    stage.paused = true;
    start.showModal();
    (settings.values.name ? $(".go") : nameField).focus();
  }

  // The address others open, when the game runs on the network server (server.ts answers INFO_PATH).
  let address = "";
  fetch(INFO_PATH, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok ? r.json() : undefined).then((info) => {
    const first = Array.isArray(info?.addresses) ? String(info.addresses[0] ?? "") : "";
    if (!first) return;
    address = first;
    online = true;
    for (const el of root.querySelectorAll<HTMLElement>(".address")) { el.hidden = false; el.querySelector("b")!.textContent = address; }
    $('[data-do="players"]').hidden = false;
    showDevice();
  }).catch(() => { /* played alone, without the server */ });
  for (const button of root.querySelectorAll<HTMLButtonElement>(".copy")) button.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(address); } catch {
      // No clipboard API (plain http on another device): select the text and copy the old way.
      const range = document.createRange();
      range.selectNodeContents(button.previousElementSibling!);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      document.execCommand("copy");
    }
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = "Copy"), 1500);
  });

  // ---- pause menu ----
  let before: Element | null = null, opener: HTMLElement | undefined;
  const page = (name: string, focus?: HTMLElement) => {
    for (const section of menu.querySelectorAll<HTMLElement>("section")) section.hidden = section.dataset.page !== name;
    if (name === "players") showPlayers();
    (focus ?? menu.querySelector<HTMLElement>(`section[data-page="${name}"] button:not([hidden]), section[data-page="${name}"] input`))!.focus();
  };
  const open = () => {
    if (menu.open || !playing) return;
    before = document.activeElement;
    stage.paused = true;
    menu.showModal();
    page("main");
  };
  const close = () => {
    menu.close();
    stage.paused = false;
    if (before instanceof HTMLElement) before.focus(); else (document.activeElement as HTMLElement | null)?.blur();
  };
  const current = () => menu.querySelector<HTMLElement>("section:not([hidden])")!.dataset.page;
  menu.addEventListener("click", (e) => {
    const button = (e.target as Element).closest<HTMLElement>("[data-do]");
    const what = button?.dataset.do;
    if (what === "resume") close();
    else if (what === "back") page("main", opener);
    else if (what) { opener = button!; page(what); }
  });
  for (const dialog of [start, menu]) dialog.addEventListener("cancel", (e) => e.preventDefault()); // Escape is ours, below
  $(".pause").addEventListener("click", open);

  // ---- players ----
  const who = $(".who");
  const showPlayers = () => {
    const n = net(), list = [{ name: settings.values.name || "You", me: true, host: !!n && n.host === n.me }];
    if (n?.connected) for (const [id, r] of n.remotes) list.push({ name: r.name, me: false, host: id === n.host });
    for (const ul of root.querySelectorAll(".people")) ul.replaceChildren(...list.map((p) => {
      const li = document.createElement("li");
      li.append(Object.assign(document.createElement("span"), { className: "name", textContent: p.name }));
      if (p.me) li.append(Object.assign(document.createElement("span"), { className: "tag", textContent: "you" }));
      if (p.host) li.append(Object.assign(document.createElement("span"), { className: "host", title: "Host: keeps the loose things in step", textContent: "host" }));
      return li;
    }));
    const count = n?.connected ? `${list.length} here` : "Alone, not connected";
    who.querySelector("h3")!.textContent = `Players · ${count}`;
  };
  const holdPlayers = (on: boolean) => { if (on) showPlayers(); who.hidden = !on; };

  // ---- settings, both ways ----
  const volume = $<HTMLInputElement>("#hud-volume"), nameSetting = $<HTMLInputElement>("#hud-name");
  volume.addEventListener("input", () => settings.set({ volume: Number(volume.value) / 100 }));
  nameSetting.addEventListener("change", () => {
    const name = clean(nameSetting.value, NAME_LENGTH);
    if (name && name !== settings.values.name) settings.set({ name }); else nameSetting.value = settings.values.name;
  });
  for (const box of root.querySelectorAll<HTMLInputElement>("input[data-key]")) {
    box.addEventListener("change", () => settings.set({ [box.dataset.key!]: box.checked }));
  }
  for (const radio of root.querySelectorAll<HTMLInputElement>('input[name="hud-quality"]')) {
    radio.addEventListener("change", () => settings.set({ quality: radio.value as Settings["quality"] }));
  }
  settings.on((values) => {
    volume.value = String(Math.round(values.volume * 100));
    if (document.activeElement !== nameSetting) nameSetting.value = values.name;
    for (const box of root.querySelectorAll<HTMLInputElement>("input[data-key]")) box.checked = !!values[box.dataset.key as keyof Settings];
    for (const radio of root.querySelectorAll<HTMLInputElement>('input[name="hud-quality"]')) radio.checked = radio.value === values.quality;
    fps.hidden = !values.fps;
  });

  // ---- keys ----
  const toggleMap = () => mapButton.classList.toggle("large");
  mapButton.addEventListener("click", toggleMap);
  window.addEventListener("keydown", (e) => {
    if (photo()) return;
    const screen = start.open || menu.open;
    if (isTyping(e.target)) { if (screen) e.stopImmediatePropagation(); return; } // text, not commands
    if (e.isTrusted && !e.metaKey && !e.ctrlKey) use("keys"); // not the Escape that Start sends
    if (screen) {
      e.stopImmediatePropagation(); // the game does not see keys while a screen is open
      if (e.code !== "Escape") return;
      e.preventDefault();
      if (menu.open) { if (current() === "main") close(); else page("main", opener); }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "Escape") { e.preventDefault(); holdPlayers(false); open(); }
    else if (e.code === "KeyM" && !e.repeat) toggleMap();
    else if (e.code === "Tab" && playing) { e.preventDefault(); holdPlayers(true); }
  }, true);
  window.addEventListener("keyup", (e) => { if (e.code === "Tab") holdPlayers(false); }, true);

  // ---- the window loses focus: pause, unless others play on ----
  const away = () => {
    holdPlayers(false);
    const n = net();
    if (playing && !photo() && !(n?.connected && n.remotes.size > 0)) open();
  };
  window.addEventListener("blur", away);
  document.addEventListener("visibilitychange", () => { if (document.hidden) away(); });

  events.on("enterWater", () => { if (noteUntil < 0) noteUntil = played + NOTE_TIME; });

  // ---- goals, and a line when one is reached ----
  const goalsBox = $(".goals"), goalsList = $(".goals ol"), cheer = $(".cheer");
  let cheerTimer: ReturnType<typeof setTimeout> | undefined;
  const say = (line: string, more: string, seconds: number, big: boolean) => {
    cheer.querySelector("b")!.textContent = line;
    cheer.querySelector("small")!.textContent = more;
    cheer.classList.toggle("big", big);
    cheer.classList.add("on");
    clearTimeout(cheerTimer);
    cheerTimer = setTimeout(() => cheer.classList.remove("on"), seconds * 1000);
  };
  showGoalsIn({
    show(list: Goal[]) {
      goalsBox.hidden = false;
      const now = list.find((g) => !g.done);
      goalsBox.querySelector("h3")!.textContent = now ? "Beaver work" : "All done";
      goalsList.replaceChildren(...list.map((g) => {
        const li = document.createElement("li"), count = g.text.match(/^(.*?):?\s*(\d+) of (\d+)$/);
        li.className = g.done ? "done" : g === now ? "now" : "";
        li.append(Object.assign(document.createElement("span"), { className: "tick", ariaHidden: "true" }));
        li.append(Object.assign(document.createElement("span"), { className: "text", textContent: count ? count[1] : g.text }));
        if (count) { // the dam: a small bar and the count instead of "n of 30"
          const done = +count[2]!, all = +count[3]!, bar = document.createElement("span");
          bar.className = "bar";
          bar.style.setProperty("--done", String(Math.min(1, done / all)));
          li.append(bar, Object.assign(document.createElement("span"), { className: "count", textContent: `${done}/${all}` }));
          li.setAttribute("aria-label", g.text);
        }
        return li;
      }));
    },
    praise(line, more, seconds) { say(line, more, seconds, true); },
  });
  events.on("goalDone", ({ goal, text }) => { if (goal !== "dam") say("Done!", text, 3.5, false); }); // the dam has its own praise

  // ---- every frame ----
  const skyBox = $(".sky"), skyIcon = $(".sky .icon"), skyTime = $(".sky .time"), skyWeather = $(".sky .weather");
  let frames = 0, counted = performance.now(), shownPrompt = "", shownSky = "", padWas: boolean[] = [];
  const felled = new Set<number>();
  events.on("treeFalls", ({ tree }) => felled.add(tree)); // without window.build: at least the trees felled now
  return {
    step(dt) {
      if (!playing) return;
      played += dt;
      hints.classList.toggle("off", played > hintsUntil);
      note.classList.toggle("off", !(played < noteUntil));
    },
    update() {
      frames++;
      const now = performance.now();
      if (now - counted > 500) { fps.textContent = `${Math.round(frames * 1000 / (now - counted))} fps`; frames = 0; counted = now; }

      // The gamepad: any use makes it the device; Y toggles the map.
      const pad = firstPad(navigator.getGamepads?.());
      if (pad) {
        const pressed = pad.buttons.map((_, i) => down(pad, i));
        if (pressed.some((p, i) => p && !padWas[i]) || pad.axes.some((a) => Math.abs(a) > 0.5)) use("pad");
        if (pressed[BUTTON.y] && !padWas[BUTTON.y] && playing && !stage.paused && !photo()) toggleMap();
        padWas = pressed;
      }
      if (!playing || photo()) { mapDisplay.hide(); return; }

      // What the context key does now.
      const m = player.motion, loose = world.sticks.filter((s) => s.body.isEnabled());
      const offer = (player as { offer?: () => { action: string; text: string } | undefined }).offer;
      let text = "";
      if (offer) text = offer.call(player)?.text ?? "";
      else {
        const what = contextAction({
          feet: player.feet, facing: player.facing, carrying: m.carrying, ready: (m.grounded || player.afloat) && m.action === "none",
          sticks: loose.map((s) => s.body.translation()),
        });
        text = what === "drop" ? "Drop" : what === "pickup" ? "Pick up stick" : "";
      }
      if (text !== shownPrompt) {
        shownPrompt = text;
        prompt.classList.toggle("off", !text);
        if (text) promptText.textContent = text;
      }

      // The hour and the weather.
      if (game.sky) {
        const label = skyLabel(game.sky.hour, game.sky.weather, game.sky.dark), key = `${label.time}${label.icon}${label.text}`;
        if (key !== shownSky) {
          shownSky = key;
          skyBox.hidden = false;
          skyIcon.innerHTML = SKY_ICONS[label.icon];
          skyTime.textContent = label.time;
          skyWeather.textContent = label.text;
          skyBox.setAttribute("aria-label", `${label.time}, ${label.text}`);
        }
      }

      // The map, as the world is now.
      const large = mapButton.classList.contains("large"), at = player.node.position, b = build(), n = net();
      const trees = (world.trees ?? []).filter((_, i) => !felled.has(i) && b?.state.trees[i]?.fell === undefined).map((t) => t.place);
      let dam: MapView["dam"];
      if (b) {
        const { origin, across } = b.dam.frame, along = { x: -across.z, z: across.x }, half = DAM.length / 2;
        dam = { from: { x: origin.x - along.x * half, z: origin.z - along.z * half }, to: { x: origin.x + along.x * half, z: origin.z + along.z * half }, built: b.state.dam.length / SLOTS };
      }
      const players = n?.connected ? [...n.remotes.values()].filter((r) => r.node.visible).map((r) => ({ x: r.node.position.x, z: r.node.position.z, name: r.name })) : [];
      // Drawn by three.js where CSS puts the button, as visible as the button would be (it fades in with .play).
      const look = getComputedStyle(mapButton), opacity = look.visibility === "hidden" ? 0 : Number(look.opacity);
      mapDisplay.show(mapButton.getBoundingClientRect(), { large, focused: mapButton.matches(":focus-visible"), opacity }, (canvas, size) => map.draw(canvas, {
        centre: large ? { x: 0, z: 0 } : at, span: large ? 2 * EXTENT : SMALL_SPAN,
        beaver: at, facing: player.facing, yaw: player.camera.yaw,
        sticks: loose.map((s) => s.mesh.position), trees, dam, players, level: world.waterLevel,
        lodge: b && b.state.dam.length >= SLOTS ? b.dam.lodgeAt : undefined,
      }, size));
      if (!who.hidden && frames % 30 === 0) showPlayers();
    },
  };
};
