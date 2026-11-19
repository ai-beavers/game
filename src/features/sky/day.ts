// The day as plain time, without the renderer: when it starts, how long it lasts, and the clock the sky keeps. The
// server (server.ts, through src/features/net/protocol.ts) counts the shared day with the same numbers.
//
//   hourAt(16, then, now)        the hour now, 16:00 having been at `then` (ms)
//   const clock = newClock();    clock.hour; clock.step(dt) runs its own day (dt in s of play, times clock.speed)
//   clock.follow(hour)           from now on the shared day: that hour plus the real time since, whatever the steps say
//   clock.alone()                its own day again, on from the hour it shows; setHour or running = false do so too
export const START = 16; // the hour the game was tuned for
export const DAY_SECONDS = 720; // one day in seconds of play

export const wrap = (hour: number) => ((hour % 24) + 24) % 24;
/** The hour at `now` (ms) when it was `hour` at `at` (ms), at one day every DAY_SECONDS. */
export const hourAt = (hour: number, at: number, now: number) => wrap(hour + ((now - at) / 1000) * 24 / DAY_SECONDS);

export interface Clock {
  readonly hour: number;
  /** false: the clock stands still (and stops following the shared day). */
  running: boolean;
  /** Days per DAY_SECONDS of play, for the own day only. */
  speed: number;
  setHour(hour: number): void;
  follow(hour: number): void;
  alone(): void;
  step(dt: number): void;
}

/** now: the real clock in ms (performance.now in the browser); only time elapsed on it counts, never its time of day. */
export function newClock(hour = START, speed = 1, running = true, now = () => performance.now()): Clock {
  let own = wrap(hour), on = running, shared: { hour: number; at: number } | undefined;
  return {
    get hour() { return shared ? hourAt(shared.hour, shared.at, now()) : own; },
    get running() { return on; },
    set running(value) { if (!value) this.alone(); on = value; },
    speed,
    setHour(value) { if (Number.isFinite(value)) { shared = undefined; own = wrap(value); } },
    follow(value) { if (Number.isFinite(value)) { shared = { hour: wrap(value), at: now() }; on = true; } },
    alone() { if (shared) { own = this.hour; shared = undefined; } },
    step(dt) { if (on && !shared) own = wrap(own + dt * 24 * this.speed / DAY_SECONDS); },
  };
}
