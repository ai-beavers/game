// The HUD's few icons as inline SVG, 24 units square, drawn in one colour: no font and no file to fetch.
//
//   overlay.icon("avatar-paw", "paw", box, PAPER)     icon("sun", GOLD) → a data: URL for a Babylon Image
export type Icon = "paw" | "sun" | "moon" | "cloud" | "rain" | "fog" | "flower" | "stick" | "chat" | "chevron";

const STROKE = 'fill="none" stroke="C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const SHAPES: Record<Icon, string> = {
  paw: '<g fill="C"><ellipse cx="12" cy="16" rx="5" ry="4.2"/><circle cx="5.5" cy="10.5" r="2.2"/><circle cx="9.5" cy="6" r="2.3"/><circle cx="14.5" cy="6" r="2.3"/><circle cx="18.5" cy="10.5" r="2.2"/></g>',
  sun: `<g ${STROKE}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></g>`,
  moon: `<path ${STROKE} d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>`,
  cloud: `<path ${STROKE} d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 18z"/>`,
  rain: `<g ${STROKE}><path d="M7 14h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 14z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></g>`,
  fog: `<g ${STROKE}><path d="M4 9h16M3 13h18M5 17h14"/></g>`,
  flower: '<g fill="C"><circle cx="12" cy="6.5" r="3.3"/><circle cx="17.5" cy="12" r="3.3"/><circle cx="12" cy="17.5" r="3.3"/><circle cx="6.5" cy="12" r="3.3"/></g><circle cx="12" cy="12" r="2.4" fill="#FFF6E4"/>',
  stick: `<g ${STROKE}><path d="M3 18L20 7M12 12.5l1.5 4M8 15l-3-1.5M16 9.5l3.5 1"/></g>`,
  chat: `<path ${STROKE} d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>`,
  chevron: `<path ${STROKE} d="M9 6l6 6-6 6"/>`,
};

/** A data: URL of the icon in `color` (any CSS colour). */
export const icon = (which: Icon, color: string) =>
  "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48">${SHAPES[which].replaceAll('"C"', `"${color}"`)}</svg>`);
