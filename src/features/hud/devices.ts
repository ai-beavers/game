// The three ways to play and what each control is called on them, for the hints, the prompt and the controls page.
// The buttons are those src/features/controls gives them (standard gamepad mapping, the touch overlay), plus the
// HUD's own: M / Y for the map, Tab for the players.
//
//   CONTROLS.pad      [{ caps: ["A"], what: "Jump", hint: true }, …]
//   USE.touch         "Use": the cap the prompt shows for the context action
export type Device = "keys" | "pad" | "touch";
export interface Control {
  caps: string[];
  what: string;
  /** Shown in the hints during the first seconds of play. */
  hint?: boolean;
  /** Only when playing on the network. */
  net?: boolean;
}

export const DEVICE_NAMES: Record<Device, string> = { keys: "Keyboard and mouse", pad: "Gamepad", touch: "Touch" };

export const CONTROLS: Record<Device, Control[]> = {
  keys: [
    { caps: ["W", "A", "S", "D"], what: "Move", hint: true }, { caps: ["Shift"], what: "Run", hint: true },
    { caps: ["Space"], what: "Jump", hint: true }, { caps: ["E"], what: "Use", hint: true },
    { caps: ["Drag"], what: "Look around", hint: true }, { caps: ["Wheel"], what: "Zoom" },
    { caps: ["M"], what: "Map", hint: true }, { caps: ["Tab"], what: "Players", net: true },
    { caps: ["Enter"], what: "Chat", net: true }, { caps: ["P"], what: "Photo mode" }, { caps: ["Esc"], what: "Pause", hint: true },
  ],
  pad: [
    { caps: ["L"], what: "Move", hint: true }, { caps: ["LB"], what: "Run", hint: true }, { caps: ["A"], what: "Jump", hint: true },
    { caps: ["X"], what: "Use (B too)", hint: true }, { caps: ["R"], what: "Look around", hint: true },
    { caps: ["Y"], what: "Map", hint: true }, { caps: ["Start"], what: "Pause", hint: true },
  ],
  touch: [
    { caps: ["Left side"], what: "Move", hint: true }, { caps: ["Right side"], what: "Look around", hint: true },
    { caps: ["Pinch"], what: "Zoom" }, { caps: ["Jump"], what: "Jump" }, { caps: ["Use"], what: "Use: gnaw, carry, build" },
    { caps: ["Run"], what: "Run, until you let go" }, { caps: ["Map"], what: "Tap to enlarge", hint: true }, { caps: ["Pause"], what: "Menu: settings, players" },
  ],
};

/** The cap of the context action on each device. */
export const USE: Record<Device, string> = { keys: "E", pad: "X", touch: "Use" };
