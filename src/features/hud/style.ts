// One look for everything the HUD draws, and one place on screen for each thing. Pure, tested in style.test.ts;
// overlay.ts draws the shapes (panel, label, pill, toast) from these tokens and hudLayout() feeds this the screen.
//
//   layout(1440, 810, inset, { touch: false, live: true })   → { u: 24, goals: Box, caption: Box, map: Box, … }
//
// The screen's regions, each element with one home in one of them:
//   top left       pause (play, desktop), Experience, goals  top centre    the tour's caption, toasts under it
//   top right      map, hour and weather, fps, backpack      bottom left   chat log, connection, chat row
//   bottom centre  breath, hints and advice, prompt          bottom right  the thumbs' buttons (controls/touch.ts)
// Regions never overlap: when the top centre has no room between the sides, live its caption goes above them and the
// toasts under them, in play both under them; when the bottom centre has none, it goes beside the chat, or above the
// chat row with the chat log above it.
export interface Box { x: number; y: number; w: number; h: number }
export interface Inset { top: number; right: number; bottom: number; left: number }

export const PAPER = "#f6f2e7", INK = "#182825", GOLD = "#f7ca77", QUIET = "#bccbbb";
/** Every HUD backing: panels, pills, toasts, the menu card, the name tags. */
export const PANEL = "rgba(18,32,31,0.8)";
/** A backing lit up a moment, for a number that just went up (the Experience). */
export const GLOW = "rgba(120,86,24,0.85)";
export const RADIUS = 10;
/** The one shadow under HUD text, backed or not. */
export const SHADOW = { color: "rgba(5,12,12,0.85)", blur: 4 };

/** The text size everything is measured in, px. Live (a stream viewers watch scaled down) 1/60 of the picture's
 *  width: 24 at 1440, 32 at 1920, never under 12 for a 640×360 tile; playing 13 … 18. */
export function unit(w: number, h: number, live: boolean) {
  const span = Math.min(w, h * 16 / 9);
  return live ? Math.max(12, Math.round(span / 60)) : Math.max(13, Math.min(18, Math.round(span / 80)));
}

export interface Layout {
  u: number; small: number; gap: number; pad: number; compact: boolean;
  pause?: Box; goals: Box;
  /** The player's Experience (src/features/shop), a short row over the goals. */
  experience: Box;
  caption: Box; toast: Box;
  map?: Box; status: Box; fps: Box;
  /** The goods in the backpack (src/features/trade), one row under the fps. */
  backpack: Box;
  chat: Box; chatRow: Box; log: Box;
  breath: Box; hints: Box; prompt: Box;
  touch?: Box;
  /** Between the top regions and the bottom ones: what floats over the world (the marker) stays in here. */
  middle: { top: number; bottom: number };
}

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });

export function layout(w: number, h: number, inset: Inset, { touch, live }: { touch: boolean; live: boolean }): Layout {
  const u = unit(w, h, live), small = Math.max(11, Math.round(u * 0.8)), gap = Math.round(u * 0.5), pad = Math.round(u * 0.6);
  const m = Math.max(8, Math.round(u * 0.75)), compact = w < 650 || h < 530;
  const L = inset.left + m, R = w - inset.right - m, T = inset.top + m, B = h - inset.bottom - m;
  const row = Math.round(u * 1.9);

  // Top right: the map, then the hour and weather under it, left of the touch screen's Pause and Photo (controls/touch.ts).
  const mapSize = live && compact ? 0 : Math.round(u * (live ? 7 : 7.5)); // a stream tile's map is too small to read
  const rightW = Math.max(mapSize, u * 9), right = touch ? w - inset.right - 59 - gap : R;
  // Top left: as wide as the goals need, at most half the screen.
  const leftW = Math.min(u * 16, Math.floor((R - L - gap) / 2));
  // Top centre, centred on the screen between the sides; on its own row above them when there is no room.
  const free = 2 * Math.min(w / 2 - (L + leftW + gap), right - rightW - gap - w / 2);
  // No room: live, the caption is the first thing a viewer reads and goes above the sides; the toasts (and the caption
  // while playing, which has none but the tour's) go under them.
  const stacked = free < u * 14, centreW = Math.min(u * 24, stacked ? R - L : free), toastH = Math.round(u * 4.6);
  const top = stacked && live ? T + row + gap : T;
  const map = mapSize ? box(right - rightW + (rightW - mapSize) / 2, top, mapSize, mapSize) : undefined;
  const status = box(right - rightW, top + (mapSize ? mapSize + gap : 0), rightW, row);
  const fps = box(right - rightW, status.y + row + gap, rightW, small * 2);
  const backpack = box(right - rightW, fps.y + fps.h + gap, rightW, row);
  const pause = !touch && !live ? box(L, top, 68, 36) : undefined;
  const experience = box(L, pause ? pause.y + pause.h + gap : top, Math.min(leftW, u * 10), Math.round(u * 1.5));
  const goalsY = experience.y + experience.h + gap;
  const under = Math.max(backpack.y + backpack.h, goalsY + u * 6.5) + gap; // a short goals list: the goal at hand, how, one done
  const caption = box((w - centreW) / 2, stacked && !live ? under : T, centreW, row);
  const toast = box(caption.x, stacked && live ? under : caption.y + row + gap, centreW, toastH);
  const goals = box(L, goalsY, leftW, Math.max(row, (stacked ? caption.y - gap : B - u * 10) - goalsY));

  // Bottom right: the thumbs' buttons; bottom left the stick's resting place under the chat (controls/touch.ts).
  const thumbs = touch ? box(w - inset.right - 214, h - inset.bottom - 156, 214, 156) : undefined;
  const rowH = touch ? 44 : 30, chatW = live ? 0 : Math.min(R - L, w < 640 ? Math.round(w * 0.66) : u * 22);
  const chatBottom = thumbs ? thumbs.y - gap : B;
  const chatRow = box(L, chatBottom - rowH, chatW, live ? 0 : rowH);
  const logH = live ? 0 : Math.round(small * 1.3 * (h < 500 ? 2 : 5) + small * 2.2); // the last lines and the connection's line
  // Bottom centre, bottom up: the prompt, the hints, the breath. Centred when there is room between chat and thumbs,
  // else beside the chat, else above the chat row.
  const promptH = Math.round(u * 1.15 * 1.3 + pad * 1.2), hintsH = Math.round(u * 1.3 * 2 + pad * 1.2), breathH = 48;
  const lo = live ? L : L + chatW + gap, hi = thumbs ? thumbs.x - gap : R, least = u * 18;
  const centred = 2 * Math.min(w / 2 - lo, hi - w / 2), beside = centred < least && hi - lo >= least, roomy = centred >= least || beside;
  const centreBottom = roomy ? B : chatRow.y - gap;
  const bottomW = centred >= least ? Math.min(u * 36, centred) : beside ? hi - lo : R - L;
  const prompt = box(beside ? lo : (w - bottomW) / 2, centreBottom - promptH, bottomW, promptH);
  const hints = box(prompt.x, prompt.y - gap - hintsH, bottomW, hintsH);
  const breath = box(prompt.x, hints.y - gap - breathH, bottomW, breathH);
  // The log over the chat row; with the bottom centre above the chat row, over that.
  const logBottom = live ? chatRow.y : roomy ? chatRow.y - gap : breath.y - gap;
  const log = box(L, logBottom - logH, chatW, logH);
  const chat = box(L, Math.min(log.y, chatRow.y), chatW, live ? 0 : chatBottom - Math.min(log.y, chatRow.y));
  return {
    u, small, gap, pad, compact, pause, experience, goals, caption, toast, map, status, fps, backpack, chat, chatRow, log, breath, hints, prompt, touch: thumbs,
    middle: { top: Math.max(fps.y, goalsY + u * 4, stacked ? toast.y + toast.h : 0) + gap, bottom: breath.y - gap },
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
  const all: [string, Box | undefined][] = [["pause", l.pause], ["experience", l.experience], ["goals", { ...l.goals, h: Math.min(l.goals.h, l.u * 6.5) }], ["caption", l.caption], ["toast", l.toast],
    ["map", l.map], ["status", l.status], ["fps", l.fps], ["backpack", l.backpack], ["chat row", l.chatRow], ["log", l.log], ["breath", l.breath], ["hints", l.hints],
    ["prompt", l.prompt], ["touch", l.touch]];
  return all.filter((e): e is [string, Box] => !!e[1] && e[1].w > 0 && e[1].h > 0);
}
