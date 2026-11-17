// The look of everything the HUD puts on screen. Every rule is scoped to #beaver-hud, so nothing leaks into the
// page or other features. One typeface (the system's), four sizes: 12, 14, 18 and 40 px; one panel; one key cap.
//
// Places: top left the pause button; top right the map, under it the hour and weather, under that the goals; top
// middle the players (Tab) and the line when a goal is reached; bottom middle what E does and the hints.
// With the touch overlay (.touchy) the pause button is theirs (top right): the map moves left of it, the bottom
// stack rises above the thumbs when upright.
export const CSS = `
#beaver-hud {
  --panel: rgba(18, 22, 28, 0.74); --line: rgba(255, 255, 255, 0.14); --text: #f3efe6; --dim: rgba(243, 239, 230, 0.68);
  --accent: #f1c470; --good: #9fd18b; --edge: 16px; --map: 132px; --right: var(--edge);
  position: fixed; inset: 0; pointer-events: none; z-index: 10;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--text);
  -webkit-font-smoothing: antialiased; user-select: none;
}
#beaver-hud.touchy { --right: calc(var(--edge) + 56px + env(safe-area-inset-right)); }
body.photo #beaver-hud { display: none; }
#beaver-hud [hidden] { display: none !important; }
#beaver-hud .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25); }
#beaver-hud kbd { font: 600 12px/1 system-ui, sans-serif; display: inline-block; min-width: 12px; padding: 4px 6px;
  border: 1px solid rgba(255, 255, 255, 0.35); border-bottom-width: 2px; border-radius: 5px; text-align: center;
  color: var(--text); background: rgba(255, 255, 255, 0.08); white-space: nowrap; }
#beaver-hud kbd.round { border-radius: 999px; min-width: 12px; padding: 4px 6px; border-bottom-width: 1px; }
#beaver-hud kbd.pill { border-radius: 999px; padding: 4px 9px; border-bottom-width: 1px; background: rgba(20, 24, 30, 0.45);
  border-color: rgba(255, 255, 255, 0.5); }
#beaver-hud button, #beaver-hud input { font: inherit; color: inherit; }
#beaver-hud :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#beaver-hud .play { transition: opacity 0.4s; }
#beaver-hud.waiting .play, #beaver-hud.waiting .who { opacity: 0; visibility: hidden; }
#beaver-hud h3 { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim); }

/* top left: pause button and frames per second */
#beaver-hud .corner { position: absolute; left: var(--edge); top: calc(var(--edge) + env(safe-area-inset-top)); display: flex; gap: 10px; align-items: center; }
#beaver-hud .pause { pointer-events: auto; width: 40px; height: 40px; padding: 0; cursor: pointer; display: grid; place-items: center; }
#beaver-hud .pause::before { content: ""; width: 10px; height: 14px; border: solid var(--text); border-width: 0 3px; }
#beaver-hud.touchy .pause { display: none; }
#beaver-hud .fps { font: 12px/1 ui-monospace, Menlo, monospace; padding: 7px 9px; color: var(--dim); }

/* top right: the map, and under it the sky and the goals */
#beaver-hud .map { position: absolute; right: var(--right); top: calc(var(--edge) + env(safe-area-inset-top)); width: var(--map); height: var(--map); padding: 0;
  border-radius: 50%; overflow: hidden; pointer-events: auto; cursor: pointer; border: 2px solid rgba(255, 255, 255, 0.5);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35); background: #4a5f36; z-index: 1;
  transition: width 0.25s, height 0.25s, right 0.25s, top 0.25s; }
#beaver-hud .map canvas { width: 100%; height: 100%; display: block; }
#beaver-hud .map.large { width: min(72vmin, 560px); height: min(72vmin, 560px);
  right: calc(50% - min(36vmin, 280px)); top: calc(50% - min(36vmin, 280px)); }
#beaver-hud .map-n { position: absolute; left: 50%; top: 4px; transform: translateX(-50%); font-size: 12px; font-weight: 600;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8); }
#beaver-hud .side { position: absolute; right: var(--right); top: calc(var(--edge) + env(safe-area-inset-top) + var(--map) + 8px);
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
#beaver-hud:has(.map.large) .side { opacity: 0; }
#beaver-hud .sky { display: flex; gap: 6px; align-items: center; justify-content: center; box-sizing: border-box; min-width: var(--map);
  padding: 5px 10px; font-size: 12px; border-radius: 999px; }
#beaver-hud .sky .icon { display: grid; color: var(--accent); }
#beaver-hud .sky .time { font-weight: 600; font-variant-numeric: tabular-nums; }
#beaver-hud .sky .weather { color: var(--dim); }
#beaver-hud .goals { width: 252px; box-sizing: border-box; padding: 10px 12px 11px; display: flex; flex-direction: column; gap: 6px; }
#beaver-hud .goals ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
#beaver-hud .goals li { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--dim); transition: color 0.4s; }
#beaver-hud .goals li.now { color: var(--text); font-weight: 600; }
#beaver-hud .goals li.done .text { text-decoration: line-through; text-decoration-color: rgba(243, 239, 230, 0.4); }
#beaver-hud .goals .tick { flex: none; width: 14px; height: 14px; box-sizing: border-box; border-radius: 50%; border: 1.5px solid var(--dim); }
#beaver-hud .goals li.now .tick { border-color: var(--accent); box-shadow: inset 0 0 0 3px var(--panel), inset 0 0 0 7px var(--accent); }
#beaver-hud .goals li.done .tick { border-color: var(--good); background: var(--good); position: relative; }
#beaver-hud .goals li.done .tick::after { content: ""; position: absolute; left: 3.5px; top: 1px; width: 3px; height: 6px;
  border: solid #1a1d22; border-width: 0 2px 2px 0; transform: rotate(45deg); }
#beaver-hud .goals .text { flex: 1; min-width: 0; }
#beaver-hud .goals .bar { flex: none; width: 44px; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.16); overflow: hidden; position: relative; }
#beaver-hud .goals .bar::before { content: ""; position: absolute; inset: 0; transform-origin: left; transform: scaleX(var(--done));
  background: var(--accent); transition: transform 0.4s; }
#beaver-hud .goals li.done .bar::before { background: var(--good); }
#beaver-hud .goals .count { flex: none; font-size: 12px; font-weight: 400; color: var(--dim); font-variant-numeric: tabular-nums; min-width: 30px; text-align: right; }

/* top middle: the players while Tab is held, the line when a goal is reached */
#beaver-hud .who { position: absolute; left: 50%; top: calc(var(--edge) + env(safe-area-inset-top)); transform: translateX(-50%);
  min-width: 220px; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
#beaver-hud .people { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
#beaver-hud .people li { display: flex; align-items: center; gap: 8px; }
#beaver-hud .people .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
#beaver-hud .people .tag, #beaver-hud .people .host { font-size: 12px; color: var(--dim); }
#beaver-hud .people .host { display: inline-flex; align-items: center; gap: 4px; }
#beaver-hud .people .host::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
#beaver-hud .cheer { position: absolute; left: 0; right: 0; top: 17%; display: flex; flex-direction: column; align-items: center; gap: 4px;
  text-align: center; padding: 0 24px; opacity: 0; transform: translateY(8px); transition: opacity 0.6s, transform 0.6s;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.6); }
#beaver-hud .cheer.on { opacity: 1; transform: none; }
#beaver-hud .cheer b { font-size: 18px; font-weight: 600; color: var(--good); }
#beaver-hud .cheer small { font-size: 18px; }
#beaver-hud .cheer.big b { font-size: 40px; color: var(--text); }
#beaver-hud .cheer.big small { font-size: 18px; color: var(--text); }
#beaver-hud .cheer small:empty { display: none; }

/* bottom middle: what E does now, and the hints under it */
#beaver-hud .bottom { position: absolute; left: 50%; bottom: calc(var(--edge) + env(safe-area-inset-bottom)); transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 10px; width: max-content; max-width: calc(100vw - 2 * var(--edge)); }
#beaver-hud .prompt { display: flex; gap: 10px; align-items: center; padding: 8px 14px 8px 8px; font-size: 18px;
  transition: opacity 0.15s; }
#beaver-hud .prompt.off { opacity: 0; }
#beaver-hud .prompt kbd { font-size: 14px; padding: 6px 9px; }
#beaver-hud .prompt kbd.round { min-width: 14px; padding: 6px 8px; }
#beaver-hud .hints { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 16px; padding: 8px 14px;
  font-size: 12px; color: var(--dim); transition: opacity 0.8s; }
#beaver-hud .hints.off { opacity: 0; }
#beaver-hud .hints span { display: inline-flex; gap: 6px; align-items: center; white-space: nowrap; }
#beaver-hud .note { padding: 8px 14px; font-size: 14px; transition: opacity 0.8s; }
#beaver-hud .note.off { opacity: 0; }

/* dialogs: start screen and pause menu */
#beaver-hud dialog { pointer-events: auto; color: var(--text); padding: 0; border: 0; background: none; max-width: none; max-height: none; }
#beaver-hud dialog:not([open]) { display: none; }
#beaver-hud dialog::backdrop { background: rgba(10, 13, 18, 0.45); }
#beaver-hud h1, #beaver-hud h2 { margin: 0; font-weight: 600; }
#beaver-hud h2 { font-size: 18px; }
#beaver-hud p { margin: 0; }
#beaver-hud .address { font-size: 12px; color: var(--dim); display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; justify-content: center; }
#beaver-hud .address b { color: var(--text); font-weight: 600; user-select: all; overflow-wrap: anywhere; }
#beaver-hud button.small { pointer-events: auto; cursor: pointer; font-size: 12px; padding: 3px 9px; border-radius: 6px;
  border: 1px solid var(--line); background: rgba(255, 255, 255, 0.08); }
#beaver-hud button.small:hover { background: rgba(255, 255, 255, 0.16); }

#beaver-hud .start { width: 100vw; height: 100dvh;
  background: linear-gradient(180deg, rgba(10, 13, 18, 0.5), rgba(10, 13, 18, 0) 30%, rgba(10, 13, 18, 0) 50%, rgba(10, 13, 18, 0.65)); }
#beaver-hud .start::backdrop { background: none; }
/* the title above the beaver, the name and the keys below it: the middle stays free */
#beaver-hud .start .inner { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; align-items: center;
  gap: 14px; text-align: center; padding: calc(8vh + env(safe-area-inset-top)) 16px calc(5vh + env(safe-area-inset-bottom)); overflow: auto; }
#beaver-hud .start header { margin-bottom: auto; display: flex; flex-direction: column; gap: 8px; text-shadow: 0 2px 16px rgba(0, 0, 0, 0.5); }
#beaver-hud .start h1 { font-size: 40px; letter-spacing: 0.02em; }
#beaver-hud .start .tagline { font-size: 14px; color: var(--text); }
#beaver-hud .enter { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; width: min(380px, 100%); box-sizing: border-box; text-align: left; }
#beaver-hud .enter label { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim); }
#beaver-hud .enter .row { display: flex; gap: 8px; }
#beaver-hud .enter input { flex: 1; min-width: 0; font-size: 18px; padding: 9px 12px; border-radius: 999px; user-select: text;
  border: 1px solid rgba(255, 255, 255, 0.3); background: rgba(0, 0, 0, 0.3); outline: none; }
#beaver-hud .enter input:focus { border-color: var(--accent); }
#beaver-hud .enter .need { font-size: 12px; color: var(--accent); }
#beaver-hud .enter .address { justify-content: flex-start; }
#beaver-hud .go { cursor: pointer; font-size: 18px; font-weight: 600; padding: 9px 26px; border-radius: 999px;
  border: 0; background: var(--text); color: #1a1d22; }
#beaver-hud .go:hover { background: #fff; }

#beaver-hud .keys { display: grid; grid-template-columns: auto auto; gap: 8px 14px; align-items: center; text-align: left;
  padding: 14px 18px; margin: 0; }
#beaver-hud .keys dt { text-align: right; white-space: nowrap; }
#beaver-hud .keys dd { margin: 0; color: var(--dim); }
#beaver-hud .start .keys { grid-template-columns: repeat(4, auto auto); }

#beaver-hud .menu { width: min(340px, calc(100vw - 32px)); }
#beaver-hud .menu:has(.wide:not([hidden])) { width: min(760px, calc(100vw - 32px)); }
#beaver-hud .menu .panel { padding: 20px; display: flex; flex-direction: column; gap: 14px; max-height: calc(100dvh - 48px); overflow: auto; box-sizing: border-box; }
#beaver-hud .menu .row-buttons { display: flex; flex-direction: column; gap: 8px; }
#beaver-hud .menu button.item { cursor: pointer; padding: 11px 14px; text-align: left; border-radius: 8px;
  border: 1px solid var(--line); background: rgba(255, 255, 255, 0.06); }
#beaver-hud .menu button.item:hover { background: rgba(255, 255, 255, 0.12); }
#beaver-hud .menu button.primary { background: var(--text); color: #1a1d22; border-color: transparent; font-weight: 600; }
#beaver-hud .menu button.primary:hover { background: #fff; }
#beaver-hud .menu .keys { padding: 0; grid-template-columns: max-content 1fr; }
#beaver-hud .menu .address { justify-content: flex-start; }
#beaver-hud .devices { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 18px; }
#beaver-hud .devices > div { display: flex; flex-direction: column; gap: 10px; }
#beaver-hud .setting { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 30px; }
#beaver-hud .setting input[type="text"] { width: 140px; padding: 5px 9px; border-radius: 6px; border: 1px solid var(--line);
  background: rgba(0, 0, 0, 0.3); user-select: text; }
#beaver-hud .setting input[type="range"] { width: 140px; accent-color: var(--accent); }
#beaver-hud .setting input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--accent); margin: 0; }
#beaver-hud fieldset.setting { border: 0; padding: 0; margin: 0; }
#beaver-hud fieldset.setting legend { float: left; padding: 0; }
#beaver-hud .choice { display: flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
#beaver-hud .choice label { position: relative; padding: 5px 10px; cursor: pointer; font-size: 12px; }
#beaver-hud .choice input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
#beaver-hud .choice label:has(input:checked) { background: var(--text); color: #1a1d22; font-weight: 600; }
#beaver-hud .choice label:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: -2px; }

/* small screens: a smaller map; the start screen's keys in two columns */
@media (max-width: 600px) {
  #beaver-hud { --edge: 12px; --map: 96px; }
  #beaver-hud .map.large { width: calc(100vw - 24px); height: calc(100vw - 24px); right: 12px; top: calc(50% - 50vw + 12px); }
  #beaver-hud .start .keys { grid-template-columns: auto auto; }
  #beaver-hud .goals { width: 200px; padding: 8px 10px; }
  #beaver-hud .goals li:not(.now) { display: none; }
}
/* low screens (a phone held sideways): a smaller map with the sky and the goal to do now beside it, all above the
   buttons under the right thumb */
@media (max-height: 520px) {
  #beaver-hud { --edge: 12px; --map: 96px; }
  #beaver-hud .side { top: calc(var(--edge) + env(safe-area-inset-top)); right: calc(var(--right) + var(--map) + 8px); }
  #beaver-hud .sky { min-width: 0; }
  #beaver-hud .goals { width: 220px; padding: 8px 10px; }
  #beaver-hud .goals li:not(.now) { display: none; }
  #beaver-hud .start .inner { padding-top: 16px; gap: 10px; }
  #beaver-hud .start h1 { font-size: 40px; }
  #beaver-hud .start .tagline, #beaver-hud .start-keys { display: none; }
}
/* touch, upright: the stick and the buttons fill the bottom 190 px, so what E does and the hints sit above them */
@media (orientation: portrait) {
  #beaver-hud.touchy .bottom { bottom: calc(200px + env(safe-area-inset-bottom)); }
}
@media (prefers-reduced-motion: reduce) { #beaver-hud * { transition: none !important; } }
`;
