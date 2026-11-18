// What the player wants, in one small object that any device can fill: the keyboard, and other sources added to it.
//
//   const keys = keyboard();        listens on window
//   keys.read(input);               once per physics step: fills input, forgets presses already seen
//   keys.hold(["KeyW"]);            tests and labs: pretend these keys are held (empty array: back to real keys)
//   keys.add(source);               another device (gamepad, touch): source.read(into) fills its own Input each step
//
// WASD or arrows move (x to the right, y forward, relative to the camera), Shift runs, Space jumps (rises under water),
// E acts, Q slaps the tail, C held dives.
// run is 0 … 1: walking speed at 0, running speed at 1, between them in between (a stick pushed part of the way).
// A press shorter than a step still counts once: presses are kept until the next read.
// With several sources the last one used steers (move); buttons of all of them count, so an idle source never
// cancels the one in use.

export interface Input { move: { x: number; y: number }; run: number; jump: boolean; act: boolean; slap?: boolean; dive?: boolean }
export const newInput = (): Input => ({ move: { x: 0, y: 0 }, run: 0, jump: false, act: false, slap: false, dive: false });
/** Another device that fills an Input, once per physics step. move may be shorter than 1 (a stick half pushed). */
export interface Source { read(into: Input): Input }

/** One source's reading and when it was last used (a step count; higher is later). */
export interface Reading { input: Input; used: number; last: string }
export const newReading = (): Reading => ({ input: newInput(), used: 0, last: "" });

/** Marks the reading used at `tick` when it holds something and changed since the last step. */
export function notice(reading: Reading, tick: number) {
  const { move, run, jump, act, slap, dive } = reading.input, now = `${move.x},${move.y},${run},${jump},${act},${!!slap},${!!dive}`;
  const idle = !move.x && !move.y && !run && !jump && !act && !slap && !dive;
  if (!idle && now !== reading.last) reading.used = tick;
  reading.last = now;
}

/** Fills `into` from all readings: move from the last used one that moves, buttons from any, run the most of any. */
export function merge(into: Input, readings: Reading[]): Input {
  let steer: Reading | undefined;
  for (const r of readings) if ((r.input.move.x || r.input.move.y) && (!steer || r.used > steer.used)) steer = r;
  into.move.x = steer?.input.move.x ?? 0;
  into.move.y = steer?.input.move.y ?? 0;
  into.run = Math.max(0, ...readings.map((r) => r.input.run));
  into.jump = readings.some((r) => r.input.jump);
  into.act = readings.some((r) => r.input.act);
  into.slap = readings.some((r) => r.input.slap);
  into.dive = readings.some((r) => r.input.dive);
  return into;
}

const GAME_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyE", "KeyQ", "KeyC", "ShiftLeft", "ShiftRight"]);

export function keyboard(target: Window = window) {
  const held = new Set<string>(), pressed = new Set<string>();
  let forced: Set<string> | undefined, tick = 0;
  const own = newReading(), others: { source: Source; reading: Reading }[] = [];
  const down = (e: KeyboardEvent) => {
    if (!GAME_KEYS.has(e.code)) return;
    e.preventDefault();
    if (!e.repeat) { held.add(e.code); pressed.add(e.code); }
  };
  const up = (e: KeyboardEvent) => void held.delete(e.code);
  const blur = () => held.clear();
  target.addEventListener("keydown", down);
  target.addEventListener("keyup", up);
  target.addEventListener("blur", blur);
  return {
    read(into: Input): Input {
      if (!others.length) return readKeys(into);
      tick++;
      readKeys(own.input);
      notice(own, tick);
      for (const { source, reading } of others) { source.read(reading.input); notice(reading, tick); }
      return merge(into, [own, ...others.map((o) => o.reading)]);
    },
    add(source: Source) {
      const entry = { source, reading: newReading() };
      others.push(entry);
      return () => void others.splice(others.indexOf(entry), 1);
    },
    hold(codes: string[]) { forced = codes.length ? new Set(codes) : undefined; },
    dispose() {
      target.removeEventListener("keydown", down);
      target.removeEventListener("keyup", up);
      target.removeEventListener("blur", blur);
    },
  };
  function readKeys(into: Input): Input {
    const on = (...codes: string[]) => codes.some((c) => forced ? forced.has(c) : held.has(c) || pressed.has(c));
    const x = +on("KeyD", "ArrowRight") - +on("KeyA", "ArrowLeft"), y = +on("KeyW", "ArrowUp") - +on("KeyS", "ArrowDown");
    const length = Math.hypot(x, y) || 1;
    into.move.x = x / length;
    into.move.y = y / length;
    into.run = +on("ShiftLeft", "ShiftRight");
    into.jump = on("Space");
    into.act = on("KeyE");
    into.slap = on("KeyQ");
    into.dive = on("KeyC");
    pressed.clear();
    return into;
  }
}
export type Keyboard = ReturnType<typeof keyboard>;
