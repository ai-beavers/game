// One look for everything the HUD draws, and one place on screen for each thing. Pure, tested in style.test.ts;
// overlay.ts draws the shapes (panel, label, pill, toast) from these tokens and hudLayout() feeds this the screen.
//
//   layout(1440, 810, inset, { touch: false, live: true })   → { u: 24, goals: Box, caption: Box, map: Box, … }
//
// The screen's regions, each element with one home in one of them:
//   top left       pause (play, desktop), the player card,    top centre    the tour's caption, toasts under it
//                  the quest tracker (goals)
//   top right      the map card (hour and weather, the map,    bottom left   chat log, connection, chat row
//                  its legend), fps
//   bottom centre  breath or speech, hints and advice, the    bottom right  the thumbs' buttons (controls/touch.ts)
//                  prompt, the hotbar
// Regions never overlap: when the top centre has no room between the sides, live its caption goes above them and the
// toasts under them, in play both under them; when the bottom centre has none, it goes beside the chat, or above the
// chat row with the chat log above it. The breath (only in the water) and the Old Beaver's speech box (only to a
// beaver on land) share one home above the hints: the speech box is the breath's box grown upwards as far as there is
// room, short of the middle and of the sides' columns.
export interface Box { x: number; y: number; w: number; h: number }
export interface Inset { top: number; right: number; bottom: number; left: number }

/** Text in cream, the accent in orange, dark ink on orange or cream; QUIET and FAINT are the cream at 60% and 50%. */
export const PAPER = "#FFF6E4", INK = "#2B1D12", GOLD = "#F2A53A", QUIET = "rgba(255,246,228,0.6)", FAINT = "rgba(255,246,228,0.5)";
/** Every HUD backing: panels, pills, toasts, the menu card, the name tags. Babylon GUI has no backdrop blur. */
export const PANEL = "rgba(30,21,14,0.8)";
/** A backing lit up a moment, for a number that just went up (the Experience). */
export const GLOW = "rgba(120,78,24,0.9)";
/** The empty part of a progress bar; a line between rows of a card. */
export const TRACK = "rgba(255,255,255,0.12)";
/** Corners of a card (panels, the menu); a pill takes half its height. */
export const RADIUS = 16;
/** The one face of the HUD, bundled (assets/nunito.woff2, loaded in overlay.ts); weights 600 … 900. */
export const FONT = "Nunito, system-ui, sans-serif";
/** A key cap ([E], [M], [T]): a raised key, its cream top over a darker side `depth` of its height deep, with a dark
 *  outline and a drop shadow, the key in dark ink on the top. */
export const CAP = { back: PAPER, side: "#B09670", edge: "rgba(43,29,18,0.55)", shine: "rgba(255,255,255,0.85)", ink: INK, radius: 5, depth: 0.2 };
/** The hotbar (src/features/trade, src/player): HOTBAR slots in a row in its box, each `slot` px square. */
export const HOTBAR = 5;
export const SLOT = { back: "rgba(255,246,228,0.06)", edge: "rgba(255,246,228,0.16)", chosen: GOLD, radius: 10 };
/** The players on the map and its legend. */
export const PLAYERS = "#7FC8F8", STICKS = "#E8D3A8", BROWN = "#8B5A2B", FLOWER = "#F29BB8";
/** The one shadow under HUD text, backed or not. */
export const SHADOW = { color: "rgba(12,8,4,0.85)", blur: 4 };

/** The text size everything is measured in, px. Live (a stream viewers watch scaled down) 1/80 of the picture's
 *  width: 17 for the stream's 1366×772 main view, 24 at 1920, never under 12 for a 640×360 tile; playing 13 … 18. */
export function unit(w: number, h: number, live: boolean) {
  const span = Math.min(w, h * 16 / 9);
  return live ? Math.max(12, Math.round(span / 80)) : Math.max(13, Math.min(18, Math.round(span / 80)));
}

export interface Layout {
  u: number; small: number; gap: number; pad: number; compact: boolean;
  pause?: Box;
  /** The quest tracker: the room it may grow into; it takes at least TRACKER units of it. */
  goals: Box;
  /** The player card (src/features/shop): name, level and Experience, over the goals. */
  player: Box;
  caption: Box; toast: Box;
  /** The map card: its header row (`status`: hour, weather, place), the map, the legend under it (0 high when compact). */
  card: Box; map?: Box; status: Box; legend: Box; fps: Box;
  /** The hotbar under the prompt: HOTBAR square slots `slot` px wide, `gap` apart, `pad` inside its edge. */
  hotbar: Box; slot: number;
  chat: Box; chatRow: Box; log: Box;
  breath: Box; hints: Box; prompt: Box;
  /** The Old Beaver's speech box (src/features/old-beaver): the breath's home, grown upwards; its bottom is the breath's. */
  speech: Box;
  touch?: Box;
  /** Between the top regions and the bottom ones: what floats over the world (the marker) stays in here. */
  middle: { top: number; bottom: number };
}

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });
/** The quest tracker's least height, in units: its header, the goal at hand, its bar and the line saying how. */
export const TRACKER = 7.2;

export function layout(w: number, h: number, inset: Inset, { touch, live }: { touch: boolean; live: boolean }): Layout {
  const u = unit(w, h, live), small = Math.max(11, Math.round(u * 0.8)), gap = Math.round(u * 0.5), pad = Math.round(u * 0.6);
  const m = Math.max(8, Math.round(u * 0.75)), compact = w < 650 || h < 530;
  const L = inset.left + m, R = w - inset.right - m, T = inset.top + m, B = h - inset.bottom - m;
  const row = Math.round(u * 1.9);

  // Top right: the map card, left of the touch screen's Pause and Photo (controls/touch.ts): the hour and weather on
  // top, the map, the legend under it; the fps under the card.
  const mapSize = live && compact ? 0 : Math.round(u * (live ? 9 : compact ? 7 : 12)); // a stream tile's map is too small to read
  const rightW = Math.max(mapSize + 2 * pad, u * 9), right = touch ? w - inset.right - 59 - gap : R;
  // Top left: as wide as the goals need, at most half the screen.
  const leftW = Math.min(u * 16, Math.floor((R - L - gap) / 2));
  // Top centre, centred on the screen between the sides; on its own row above them when there is no room.
  const free = 2 * Math.min(w / 2 - (L + leftW + gap), right - rightW - gap - w / 2);
  // No room: live, the caption is the first thing a viewer reads and goes above the sides; the toasts (and the caption
  // while playing, which has none but the tour's) go under them.
  const stacked = free < u * 14, centreW = Math.min(u * 24, stacked ? R - L : free), toastH = Math.round(u * 4.6);
  const top = stacked && live ? T + row + gap : T;
  const status = box(right - rightW, top, rightW, row);
  const map = mapSize ? box(right - rightW + (rightW - mapSize) / 2, top + row, mapSize, mapSize) : undefined;
  const legend = box(right - rightW, top + row + (mapSize ? mapSize : 0), rightW, mapSize && !compact ? Math.round(small * 2.2) : 0);
  const card = box(right - rightW, top, rightW, legend.y + legend.h + (mapSize ? pad : 0) - top);
  const fps = box(right - rightW, card.y + card.h + gap, rightW, small * 2);
  const pause = !touch && !live ? box(L, top, 68, 36) : undefined;
  const player = box(L, pause ? pause.y + pause.h + gap : top, leftW, Math.round(u * (compact ? 3 : 3.6)));
  const goalsY = player.y + player.h + gap;
  const under = Math.max(fps.y + fps.h, goalsY + u * TRACKER) + gap; // the tracker: header, the goal at hand, its bar, how
  const caption = box((w - centreW) / 2, stacked && !live ? under : T, centreW, row);
  const toast = box(caption.x, stacked && live ? under : caption.y + row + gap, centreW, toastH);
  const goals = box(L, goalsY, leftW, Math.max(row, (stacked ? caption.y - gap : B - u * 10) - goalsY));

  // Bottom right: the thumbs' buttons; bottom left the stick's resting place under the chat (controls/touch.ts).
  const thumbs = touch ? box(w - inset.right - 214, h - inset.bottom - 156, 214, 156) : undefined;
  const rowH = touch ? 44 : 30, chatW = live ? 0 : Math.min(R - L, w < 640 ? Math.round(w * 0.66) : u * 22);
  const chatBottom = thumbs ? thumbs.y - gap : B;
  const chatRow = box(L, chatBottom - rowH, chatW, live ? 0 : rowH);
  const logH = live ? 0 : Math.round(small * 1.3 * (h < 500 ? 2 : 5) + small * 2.2); // the last lines and the connection's line
  // Bottom centre, bottom up: the hotbar, the prompt, the hints, the breath. Centred when there is room between chat
  // and thumbs, else beside the chat, else above the chat row.
  const slot = Math.round(u * (compact ? 2.6 : 3.2)), slotGap = Math.round(u * 0.35);
  const hotbarW = HOTBAR * slot + (HOTBAR + 1) * slotGap, hotbarH = slot + 2 * slotGap;
  const promptH = Math.round(u * 1.15 * 1.3 + pad * 1.6), hintsH = Math.round(u * 1.3 * (compact ? 1 : 2) + pad * 1.2), breathH = 48;
  const lo = live ? L : L + chatW + gap, hi = thumbs ? thumbs.x - gap : R, least = Math.max(u * 18, hotbarW);
  const centred = 2 * Math.min(w / 2 - lo, hi - w / 2), beside = centred < least && hi - lo >= least, roomy = centred >= least || beside;
  const centreBottom = roomy ? B : chatRow.y - gap;
  const bottomW = centred >= least ? Math.min(u * 36, centred) : beside ? hi - lo : R - L;
  const colX = beside ? lo : (w - bottomW) / 2;
  const hotbar = box(Math.round(colX + (bottomW - hotbarW) / 2), centreBottom - hotbarH, hotbarW, hotbarH);
  const prompt = box(colX, hotbar.y - gap - promptH, bottomW, promptH);
  const hints = box(prompt.x, prompt.y - gap - hintsH, bottomW, hintsH);
  const breath = box(prompt.x, hints.y - gap - breathH, bottomW, breathH);
  // The speech box: the breath's home grown upwards to a name and two rows of text, as far as there is room under the
  // middle's top (some of the middle stays free) and clear of the side columns it would reach under.
  const middleTop = Math.max(fps.y, goalsY + u * 4, stacked ? toast.y + toast.h : 0) + gap;
  const across = (x: number, bw: number) => prompt.x < x + bw && x < prompt.x + bottomW;
  const ceiling = Math.max(middleTop + u * 2, across(right - rightW, rightW) ? fps.y + fps.h + gap : 0, across(L, leftW) ? goalsY + u * TRACKER + gap : 0);
  const speechH = Math.max(breathH, Math.min(Math.round(small * 1.3 + u * 1.3 * 2 + pad * 1.2), breath.y + breathH - ceiling));
  const speech = box(prompt.x, breath.y + breathH - speechH, bottomW, speechH);
  // The log over the chat row; with the bottom centre above the chat row, over that.
  const logBottom = live ? chatRow.y : roomy ? chatRow.y - gap : speech.y - gap;
  const log = box(L, logBottom - logH, chatW, logH);
  const chat = box(L, Math.min(log.y, chatRow.y), chatW, live ? 0 : chatBottom - Math.min(log.y, chatRow.y));
  return {
    u, small, gap, pad, compact, pause, player, goals, caption, toast, card, map, status, legend, fps, hotbar, slot, chat, chatRow, log, breath, hints, prompt, speech, touch: thumbs,
    middle: { top: middleTop, bottom: speech.y - gap },
  };
}

/** A bold character is about this much of its type wide; a line never shrinks below SMALLEST of its type. */
const WIDE = 0.58, SMALLEST = 0.7;
/** The type, px, that keeps a line of `chars` bold characters on one row `across` px wide (with some room to spare
 *  at the ends): `type` when it fits, smaller when not, never below SMALLEST of it (a small screen wraps instead). */
export const fitType = (type: number, across: number, chars: number) =>
  Math.floor(Math.max(SMALLEST * type, Math.min(type, (across - type) / (WIDE * Math.max(1, chars)))));

/** The boxes that hold something at all times, to test that none lies on another. The goals' box is the room they may
 *  grow into, the map's and the caption's what they take. */
export function homes(l: Layout): [string, Box][] {
  const all: [string, Box | undefined][] = [["pause", l.pause], ["player", l.player], ["goals", { ...l.goals, h: Math.min(l.goals.h, l.u * TRACKER) }], ["caption", l.caption], ["toast", l.toast],
    ["map card", l.card], ["fps", l.fps], ["hotbar", l.hotbar], ["chat row", l.chatRow], ["log", l.log], ["breath and speech", l.speech], ["hints", l.hints],
    ["prompt", l.prompt], ["touch", l.touch]];
  return all.filter((e): e is [string, Box] => !!e[1] && e[1].w > 0 && e[1].h > 0);
}
