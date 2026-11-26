// The HUD and its menus: the map, photo mode, the player list, the settings. Tests of the player's controls, so
// stream false: the live stream leaves them out.
import { MapDisplay } from "../../hud/map-display.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

export const hud = (kit: Kit): Station[] => {
  const { game, stage, frame, paint, wait, until, press, key, expect, hudText } = kit;
  return [
    ["Map", async () => {
      const button = () => document.querySelector<HTMLButtonElement>("#beaver-hud .map") ?? skip("no map button");
      const disc = stage.hud.getControlByName("map-disc");
      if (!(disc instanceof MapDisplay)) throw new Error("Babylon HUD has no map");
      const north = () => stage.hud.getControlByName("map-north");
      const aligned = () => {
        const rect = button().getBoundingClientRect(), m = disc!._currentMeasure;
        const scale = stage.hud.getSize().width / stage.canvas.clientWidth;
        return Math.abs(rect.left-m.left/scale)<2 && Math.abs(rect.top-m.top/scale)<2 && Math.abs(rect.width-m.width/scale)<2;
      };
      if (button().getAttribute("aria-expanded") === "true") key("KeyM");
      await until(aligned,3,"small map and input bounds disagree");
      const width = disc._currentMeasure.width, previous = disc.draws;
      await until(() => disc.draws>previous,3,"Babylon did not draw the map");
      expect(!north()?.isVisible,"north marker on small map");
      key("KeyM");
      try {
        await until(() => aligned() && disc._currentMeasure.width>width*1.5,3,"map did not enlarge");
        const marker = north(), m = disc._currentMeasure;
        expect(!!marker?.isVisible && marker._currentMeasure.top >= m.top && marker._currentMeasure.top < m.top+m.height*0.15,"north marker missing at the top");
        key("Escape");
        try {
          await new Promise(requestAnimationFrame);
          expect(stage.paused && !!disc.parent?.isVisible,"map disappeared while paused");
        } finally { key("Escape"); }
        expect(!stage.paused,"pause menu did not close");
        key("KeyP");
        if (document.body.classList.contains("photo")) {
          try { await frame(); await frame(); expect(!disc.parent?.isVisible,"map visible in photo mode"); } finally { key("KeyP"); }
          await until(() => !!disc.parent?.isVisible,2,"map did not return after photo mode");
        }
      } finally { if (button().getAttribute("aria-expanded") === "true") key("KeyM"); }
      await until(() => aligned() && Math.abs(disc._currentMeasure.width-width)<2,3,"map did not return to its small size");
    }, undefined, false],
    ["Photo mode", async () => {
      key("KeyP");
      if (!document.body.classList.contains("photo")) return skip("no photo mode");
      try { await wait(4); } finally { key("KeyP"); }
      expect(!document.body.classList.contains("photo") && !stage.paused, "P did not leave photo mode");
    }, undefined, false],
    // Tab held: who plays, the beaver itself first; let go, the list goes.
    ["Player list", async () => {
      if (!stage.hud.getControlByName("players-list")) return skip("no HUD");
      const me = `${game.settings.values.name} · you`;
      press("Tab", "keydown");
      try {
        await frame(); await frame();
        expect(hudText("players-list").startsWith("Players\n" + me), `Tab held, the list reads "${hudText("players-list")}"`);
      } finally { press("Tab", "keyup"); }
      await frame(); await frame();
      expect(!hudText("players-list"), "Tab let go, the player list stays");
    }, undefined, false],
    // Escape, Settings, Picture quality round once through low, medium and high, as a player clicks it, and back.
    ["Settings", async () => {
      const menu = document.querySelector<HTMLDialogElement>("dialog#game-menu") ?? skip("no menu");
      const button = (label: string) => menu.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`) ?? skip(`no "${label}" in the menu`);
      const was = game.settings.values.quality, seen: string[] = [];
      key("Escape");
      try {
        await paint();
        expect(stage.paused && menu.open, "Escape opened no pause menu");
        button("Settings").click();
        for (let k = 0; k < 3; k++) {
          await paint();
          button("Picture quality").click();
          seen.push(game.settings.values.quality);
          expect(button("Picture quality").getAttribute("aria-label")!.endsWith(game.settings.values.quality), `the button says "${button("Picture quality").getAttribute("aria-label")}", the game ${game.settings.values.quality}`);
        }
        expect(new Set(seen).size === 3 && seen[2] === was, `picture quality went ${was} → ${seen.join(" → ")}`);
        button("Back").click();
        await paint();
        expect(!!button("Resume"), "Back did not lead to the pause menu");
      } finally {
        if (game.settings.values.quality !== was) game.settings.set({ quality: was });
        for (let k = 0; k < 2 && stage.paused; k++) { key("Escape"); await paint(); }
      }
      expect(!stage.paused && !menu.open, "the menu did not close");
    }, undefined, false],
  ];
};
