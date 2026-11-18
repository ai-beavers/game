// The three ways to play and what each control is called on them, for the hints, the prompt and the controls page.
// The buttons are those src/features/controls gives them (standard gamepad mapping, the touch overlay), plus the
// HUD's own: M / Y for the map, Tab for the players, and the photo mode's P (features/post; Back and Photo send it).
//
//   CONTROLS.pad      [{ caps: ["A"], what: "Jump" }, …]
//   USE.touch         "Use": the cap the prompt shows for the context action
export type Device = "keys" | "pad" | "touch";
export interface Control {
  caps: string[];
  what: string;
  /** Only when playing on the network. */
  net?: boolean;
}

export const DEVICE_NAMES: Record<Device, string> = { keys: "Keyboard and mouse", pad: "Gamepad", touch: "Touch" };

export const CONTROLS: Record<Device, Control[]> = {
  keys: [
    { caps: ["W", "A", "S", "D"], what: "Move" }, { caps: ["Shift"], what: "Run" },
    { caps: ["Space"], what: "Jump" }, { caps: ["E"], what: "Use" },
    { caps: ["Q"], what: "Slap the tail" }, { caps: ["C"], what: "Dive (hold, swimming)" },
    { caps: ["Drag"], what: "Look around" }, { caps: ["Wheel"], what: "Zoom" },
    { caps: ["M"], what: "Map" }, { caps: ["Tab"], what: "Players", net: true },
    { caps: ["Enter"], what: "Chat", net: true }, { caps: ["P"], what: "Photo mode" }, { caps: ["Esc"], what: "Pause" },
  ],
  pad: [
    { caps: ["L"], what: "Move" }, { caps: ["LB"], what: "Run" }, { caps: ["A"], what: "Jump" },
    { caps: ["X"], what: "Use" }, { caps: ["RB"], what: "Slap the tail" }, { caps: ["B"], what: "Dive (hold, swimming)" },
    { caps: ["R"], what: "Look around" }, { caps: ["R", "click"], what: "Zoom" },
    { caps: ["Y"], what: "Map" }, { caps: ["Back"], what: "Photo mode" }, { caps: ["Start"], what: "Pause" },
  ],
  touch: [
    { caps: ["Left side"], what: "Move" }, { caps: ["Right side"], what: "Look around" },
    { caps: ["Pinch"], what: "Zoom" }, { caps: ["Jump"], what: "Jump" }, { caps: ["Use"], what: "Use: gnaw, carry, build" },
    { caps: ["Run"], what: "Run, until you let go" }, { caps: ["Slap"], what: "the tail" }, { caps: ["Dive"], what: "Hold to dive, swimming" },
    { caps: ["Map"], what: "Tap to enlarge" }, { caps: ["Photo"], what: "Photo mode" }, { caps: ["Pause"], what: "Menu: settings, players" },
  ],
};

/** The cap of the context action on each device. */
export const USE: Record<Device, string> = { keys: "E", pad: "X", touch: "Use" };

/** What the first minute teaches, one at a time, in this order, each when it is of use (hud/index.ts). */
export type Step = "move" | "look" | "use" | "slap";
export const TEACH: Record<Device, Record<Step, string>> = {
  keys: { move: "W A S D   walk      Shift   run", look: "Drag with the mouse   look around", use: "E   pick up, gnaw, build", slap: "Q   slap your tail on the water" },
  pad: { move: "Left stick   walk      LB   run", look: "Right stick   look around", use: "X   pick up, gnaw, build", slap: "RB   slap your tail on the water" },
  touch: { move: "Drag on the left side   walk", look: "Drag on the right side   look around", use: "Use   pick up, gnaw, build", slap: "Slap   your tail on the water" },
};

/** Pressing and holding the context action, for the line under the goal: "press E", "hold Use". */
export const PRESS: Record<Device, { press: string; hold: string }> = {
  keys: { press: "press E", hold: "hold E" }, pad: { press: "press X", hold: "hold X" }, touch: { press: "tap Use", hold: "hold Use" },
};
