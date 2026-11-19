// What the tour's stations play with (src/features/tour/stations): the beaver's own way in (want), waiting in the
// game's time, walking and reaching, the events that happened, and the dam work in parts. index.ts makes one Kit, hands
// it to every station file, and drives it: resume(dt) once a picture lets every waiter go on.
//
// A station file destructures what it uses at its top. Two things are written through the kit itself, not a copy:
// kit.subject (what the live camera brings into the picture; the round loop clears it after each station) and
// kit.usedUp (read by the round loop: the saved game has no wood left).
import { Scalar } from "@babylonjs/core/Maths/math.scalar.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { TextBlock } from "@babylonjs/gui";
import type { Stick } from "../../contracts.ts";
import type { Game } from "../../game.ts";
import type { GameEvents } from "../../events.ts";
import type { Offer } from "../../player/index.ts";
import { newInput, type Input } from "../../player/input.ts";
import type { SkyState } from "../sky/index.ts";
import { LODGE, live as standing, SLOTS, type BuildState } from "../build/rules.ts";
import { FIRST_RIM } from "../../world/terrain.ts";

const STUCK_TIME = 2.5; // s: moving less than STUCK_MOVE in this long means something is in the way
const STUCK_MOVE = 0.25;
const HOP = 1.5; // m: in fast mode a way to the next thing longer than this is jumped over (teleport), but the last metre

/** What the build feature puts on window for tools (src/features/build/index.ts); only the part the tour needs. */
export interface BuildDebug {
  state: BuildState;
  dam: { frame: { origin: Vector3; across: Vector3 }; lodgeAt: Vector3; cacheAt: Vector3 };
  fill(n: number): number;
  views: Map<number, { trunkLine(): { from: Vector3; along: Vector3 } | undefined }>;
  saplings: Map<number, unknown>;
  age(i: number, seconds: number): number | false;
  split(i: number): boolean;
  reset(): void;
}
/** Thrown by skip(): the station does not apply now (no pond, the dam is full); not a failure. */
export class Skip extends Error {}
export function skip(why: string): never { throw new Skip(why); }
const fmt = (v: Vector3) => `${v.x.toFixed(1)}, ${v.z.toFixed(1)}`;

const NAMES = ["footstep", "jump", "land", "enterWater", "leaveWater", "pickup", "treeFalls", "treeLands", "treeSplits", "stickPlaced", "damFinished", "tailSlap", "startled", "goodTraded"] as const;
export type EventName = (typeof NAMES)[number];

/** The tour's helpers: everything a station needs besides the game's own modules. */
export interface Kit {
  game: Game;
  player: Game["player"];
  world: Game["world"];
  stage: Game["stage"];
  beaver: Game["beaver"];
  /** ?tour=fast: the world runs faster than real time, long ways are hopped over. */
  fast: boolean;
  /** ?tour=live: real-time activities for the stream, never with named stations. */
  live: boolean;
  /** The stations named in the address (?station=Name, repeated), in order; empty for the whole tour. */
  requested: string[];
  /** What the tour holds down, read once per physics step: where to walk (to; side: a step aside), run, the keys. */
  want: { to: Vector3 | undefined; side: number; run: number; jump: boolean; act: boolean; slap: boolean; dive: boolean; crawl: boolean };
  /** What the beaver works on, for the live picture: a tree, the dam, a deer. Write it as kit.subject. */
  subject: (() => { x: number; z: number }) | undefined;
  /** No wood left in the saved game (set by fetchStick): the round loop starts it anew. */
  readonly usedUp: boolean;
  /** The next frame of the world; its dt. */
  frame(): Promise<number>;
  /** A picture, also while paused (frame() waits for the world). */
  paint(): Promise<unknown>;
  /** Seconds of the game's time. */
  wait(seconds: number): Promise<void>;
  /** Until done() is true; throws why after limit s. */
  until(done: () => boolean, limit: number, why: string): Promise<void>;
  /** Holds a key the tour's input has for hold s. */
  tap(key: "act" | "jump" | "slap", hold?: number): Promise<void>;
  /** A keyboard event on window, as a person's key. */
  press(code: string, type: "keydown" | "keyup"): void;
  /** A key pressed and let go. */
  key(code: string): void;
  /** m on the ground from the beaver's feet to x, z. */
  flat(x: number, z: number): number;
  walkTo(x: number, z: number, options?: { run?: number; near?: number; arrived?: () => boolean; limit?: number; hop?: boolean }): Promise<void>;
  reach(action: Offer["action"], where: (attempt: number) => { x: number; z: number }, hop?: boolean): Promise<void>;
  /** The last of each event the tour counts. */
  last: Partial<GameEvents>;
  /** Throws why unless ok. */
  expect(ok: boolean, why: string): void;
  /** A check whether the event has happened since this call. */
  after(name: EventName): () => boolean;
  /** The text of a HUD TextBlock by name, "" if none. */
  hudText(name: string): string;
  build(): BuildDebug | undefined;
  /** build(), or skip the station. */
  needBuild(): BuildDebug;
  pond: Game["world"]["pond"];
  /** game.sky, or skip the station. */
  sky(): SkyState;
  /** m south of the pond's middle to swim to (clear of the lodge). */
  clear(): number;
  standingTrees(b: BuildDebug): number[];
  fell(i: number): Promise<void>;
  split(i: number): Promise<void>;
  /** Sticks lying about, not in the hand nor built in. */
  loose(): Stick[];
  pickUp(): Promise<void>;
  fetchStick(): Promise<void>;
  buildUpTo(upTo: number, lodge: boolean): Promise<void>;
  regrowing(): { i: number; what: "stands" | "lies" | "sapling" } | undefined;
  /** For index.ts only: lets every waiter go on with this frame's dt. */
  resume(dt: number): void;
}

export const createKit = (game: Game, mode: string, requested: string[]): Kit => {
  const { player, world, stage, events, beaver } = game, fast = mode === "fast";
  // Named stations are a test, never the live stream.
  const live = mode === "live" && !requested.length;
  const build = () => (window as { build?: BuildDebug }).build;

  // ---- what the tour wants, read once per physics step like any other device ----
  const want = { to: undefined as Vector3 | undefined, side: 0, run: 0, jump: false, act: false, slap: false, dive: false, crawl: false };
  let subject: (() => { x: number; z: number }) | undefined; // what the beaver works on, for the live picture: a tree, the dam, a deer
  player.keys.add({
    read(into: Input) {
      Object.assign(into, newInput(), { run: want.run, jump: want.jump, act: want.act, slap: want.slap, dive: want.dive, crawl: want.crawl });
      if (!want.to) return into;
      const d = new Vector3(want.to.x - player.feet.x, 0, want.to.z - player.feet.z);
      if (d.lengthSquared() < 1e-4) return into;
      d.normalize();
      if (want.side) d.set(-d.z * want.side, 0, d.x * want.side); // a step aside, around what is in the way
      // Back into the camera's terms (src/player/index.ts: forward is the camera's look, x to its right).
      const fx = -Math.sin(player.camera.yaw), fz = -Math.cos(player.camera.yaw);
      into.move.y = d.x * fx + d.z * fz;
      into.move.x = -d.x * fz + d.z * fx;
      return into;
    },
  });

  // ---- waiting, in the game's own time: update() hands every waiter the frame's dt ----
  let waiters: ((dt: number) => void)[] = [];
  const frame = () => new Promise<number>((done) => waiters.push(done));
  const paint = () => new Promise(requestAnimationFrame); // a picture, also while paused (frame() waits for the world)
  const wait = async (seconds: number) => { for (let t = 0; t < seconds;) t += await frame(); };
  const until = async (done: () => boolean, limit: number, why: string) => {
    for (let t = 0; !done();) if ((t += await frame()) > limit) throw new Error(why);
  };
  const tap = async (key: "act" | "jump" | "slap", hold = 0.15) => { want[key] = true; await wait(hold); want[key] = false; };
  const press = (code: string, type: "keydown" | "keyup") => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  const key = (code: string) => { press(code, "keydown"); press(code, "keyup"); };
  const flat = (x: number, z: number) => Math.hypot(x - player.feet.x, z - player.feet.z);

  /** Walks (or runs) to x, z until near it or `arrived` says so; steps aside when something is in the way. hop: in
   *  fast mode the way is not what is tested, so it starts HOP metres short of the goal instead. */
  const walkTo = async (x: number, z: number, { run = 0, near = 0.4, arrived = (): boolean => false, limit = 40, hop = false } = {}) => {
    const away = flat(x, z);
    if (fast && hop && away > HOP) {
      const k = 1 - HOP / away, hx = player.feet.x + (x - player.feet.x) * k, hz = player.feet.z + (z - player.feet.z) * k;
      const facing = Math.atan2(x - hx, z - hz);
      player.teleport(hx, world.heightAt(hx, hz), hz, facing);
      player.camera.yaw = facing + Math.PI;
    }
    want.to = new Vector3(x, 0, z);
    want.run = run;
    let t = 0, since = 0, from = player.feet.clone(), dodges = 0;
    try {
      while (!arrived() && flat(x, z) > near) {
        const dt = await frame();
        if ((t += dt) > limit) throw new Error(`stuck at ${fmt(player.feet)} on the way to ${x.toFixed(1)}, ${z.toFixed(1)}`);
        if ((since += dt) < STUCK_TIME) continue;
        if (Vector3.Distance(player.feet, from) < STUCK_MOVE) {
          // Right, left, right…, each step aside longer than the last, so it gets round a wide thing or out of a corner.
          want.side = dodges % 2 ? -1 : 1;
          await wait(0.9 * (1 + (dodges++ >> 1)));
          want.side = 0;
        }
        since = 0;
        from = player.feet.clone();
      }
    } finally { want.to = undefined; want.side = 0; want.run = 0; }
  };

  /** Goes to what `where` points at until E would do `action` there. where is asked anew for every try (try 0, 1,
   *  2): a stick or a fallen trunk may have rolled on since. */
  const reach = async (action: Offer["action"], where: (attempt: number) => { x: number; z: number }, hop = false) => {
    const offers = () => player.offer()?.action === action;
    let stuck = "";
    for (let attempt = 0; attempt < 3 && !offers(); attempt++) {
      const at = where(attempt);
      await walkTo(at.x, at.z, { near: 0.2, arrived: offers, limit: 15, hop: hop && attempt === 0 }).catch((e: Error) => { stuck = `; ${e.message}`; });
    }
    expect(offers(), `could not get to where E would ${action} (E would: ${player.offer()?.action ?? "nothing"}${stuck})`);
  };

  // ---- what happened: counts and the last of each event ----
  const count = {} as Record<EventName, number>, last: Partial<GameEvents> = {};
  for (const name of NAMES) {
    count[name] = 0;
    events.on(name, (e) => { count[name]++; (last as Record<string, unknown>)[name] = e; });
  }
  const expect = (ok: boolean, why: string) => { if (!ok) throw new Error(why); };
  const after = (name: EventName) => { const n = count[name]; return () => count[name] > n; };
  const hudText = (name: string) => (stage.hud.getControlByName(name) as TextBlock | null)?.text ?? "";

  // ---- dam work, in parts the stations share: fell a tree, gnaw it into wood, pick up a stick, build it in ----
  const needBuild = () => build() ?? skip("no build feature");
  const pond = world.pond, sky = () => game.sky ?? skip("no sky feature");
  // m south of the pond's middle to swim to: the lodge rises in the middle once the dam holds (and the pond is full).
  const clear = () => (build()?.state.dam.length ?? 0) >= SLOTS ? 1.8 : 0;
  /** Trees standing now in the first clearing round the pond, the first ones or grown back, nearest the building site
   *  first. The far meadow's trees are left for players: wood from there is a long walk, and the dam work stays short. */
  const standingTrees = (b: BuildDebug) => {
    const site = world.site!, from = (i: number) => Math.hypot(world.trees![i]!.place.x - site.x, world.trees![i]!.place.z - site.z);
    const near = (i: number) => Math.hypot(world.trees![i]!.place.x, world.trees![i]!.place.z) < FIRST_RIM;
    return world.trees!.map((_, i) => i).filter((i) => near(i) && standing(b.state.trees[i])?.fell === undefined && !!standing(b.state.trees[i])).sort((a, c) => from(a) - from(c));
  };
  const fell = async (i: number) => {
    const tree = world.trees![i]!;
    subject = () => tree.place;
    // From the side facing the clearing's middle, as build.at(i) does, so it falls outwards.
    const out = new Vector3(-tree.place.x, 0, -tree.place.z).normalize();
    const stand = tree.place.add(out.scale(tree.radius + 0.35));
    await reach("gnaw", (attempt) => attempt ? tree.place : stand, true).catch((e: Error) => { throw new Error(`tree ${i}: ${e.message}`); });
    const falls = after("treeFalls"), lands = after("treeLands");
    want.act = true;
    try { await until(falls, 15, `gnawed tree ${i} for 15 s, it still stands`); } finally { want.act = false; }
    expect(last.treeFalls!.tree === i, `tree ${last.treeFalls!.tree} fell, not ${i}`);
    // A crown caught in another tree, or a slow tall one, comes to rest without the "landed" moment; the build feature
    // lays every falling tree to rest within 10 s (tree.ts step), so either ends the fall.
    await until(() => lands() || !!standing(build()?.state.trees[i])?.rest, 12, "the tree fell but never landed nor came to rest");
  };
  const split = async (i: number) => {
    const b = needBuild();
    // Only a tree lying still can be gnawed (build: the "rest" change); one leaning on another may never be.
    await until(() => !!standing(b.state.trees[i])?.rest, 8, `tree ${i} never came to rest after its fall (leaning on something?)`);
    subject = () => b.views.get(i)?.trunkLine()?.from ?? world.trees![i]!.place;
    // The nearest point of the trunk as it lies now, a little off its foot; then further along it.
    await reach("split", (attempt) => {
      const { from, along } = b.views.get(i)?.trunkLine() ?? { from: world.trees![i]!.place, along: new Vector3() };
      return from.add(along.scale(attempt || Scalar.Clamp(Vector3.Dot(player.feet.subtract(from), along), 0.3, 2)));
    });
    const splits = after("treeSplits");
    want.act = true;
    try { await until(splits, 10, "gnawed the lying tree for 10 s, still whole"); } finally { want.act = false; }
  };
  const loose = () => world.sticks.filter((s) => s.body.isEnabled() && s !== player.carrying);
  /** Picks up the nearest stick; one that cannot be got at (under a log) is left for the next, as a player would, and
   *  not tried again on this page (a saved game may hold many such). */
  const passed = new Set<Stick>();
  const pickUp = async () => {
    const away = (s: Stick) => flat(s.body.translation().x, s.body.translation().z);
    for (let tries = 0; ; tries++) {
      const sticks = loose().filter((s) => !passed.has(s)).sort((a, c) => away(a) - away(c));
      if (!sticks.length) throw new Error(passed.size ? "no stick lies anywhere that can be got at" : "no stick lies about");
      try { await reach("pickup", (attempt) => sticks[Math.min(attempt, sticks.length - 1)]!.body.translation(), true); break; } catch (e) {
        sticks.slice(0, 3).forEach((s) => passed.add(s));
        if (tries >= 2) throw e;
      }
    }
    const picked = after("pickup");
    await tap("act");
    await until(picked, 2, "pressed E at a stick, nothing in the hand");
  };
  // The sticks left may all lie where no beaver gets at them (under a log, in deep water): then a tree is felled for
  // wood, and with none standing the saved game is used up, started anew after the round.
  let usedUp = false;
  /** A stick into the hand: one lying about, or, when none can be got at, from a tree felled and gnawed into wood. */
  const fetchStick = async () => {
    if (player.carrying) return;
    let why = "no stick lies about";
    if (loose().length) {
      try { return await pickUp(); } catch (e) { why = (e as Error).message; }
    }
    const i = standingTrees(needBuild())[0];
    if (i === undefined) { usedUp = true; skip(`no wood left: ${why}, no tree stands`); }
    await fell(i);
    await split(i);
    await pickUp();
  };
  /** Builds sticks into the dam (or onto the lodge) until it holds `upTo`, fetching each; checks every stick goes in
   *  and the moments a player sees: half a dam, the dam finished, the lodge standing. */
  const buildUpTo = async (upTo: number, lodge: boolean) => {
    const b = needBuild();
    while (b.state.dam.length < upTo) {
      await fetchStick();
      const { origin, across } = b.dam.frame, to = origin.subtract(across.scale(1.25)), from = b.dam.lodgeAt.subtract(across.scale(1.7));
      subject = () => lodge ? b.dam.lodgeAt : origin;
      await reach("build", (attempt) => lodge ? (attempt ? b.dam.lodgeAt : from) : attempt ? origin : to, true);
      const placed = after("stickPlaced"), finished = after("damFinished"), n = b.state.dam.length + 1;
      await tap("act");
      await until(placed, 3, `pressed E at the ${lodge ? "lodge" : "dam"}, no stick placed`);
      expect(b.state.dam.length === n, `the dam and lodge hold ${b.state.dam.length} sticks, not ${n}`);
      const moment = n * 2 === SLOTS ? "Half a dam!" : n === SLOTS ? "The dam holds!" : n === SLOTS + LODGE ? "The lodge stands!" : "";
      if (moment) await until(() => hudText("announcement").startsWith(moment), 2, `${n} sticks in, but no "${moment}" on screen`);
      if (n === SLOTS) expect(finished(), "the dam's last stick went in, the dam never finished");
    }
  };
  /** What regrows: a tree grown back standing (to fell), or lying (to gnaw into wood), else a sapling on a stump. */
  const regrowing = () => {
    const b = build();
    let found: { i: number; what: "stands" | "lies" | "sapling" } | undefined;
    for (const [key, t] of Object.entries(b?.state.trees ?? {})) {
      const i = +key, g = t.split ? t.grown : undefined;
      if (g?.fell === undefined && g) return { i, what: "stands" as const };
      if (g?.rest) found = { i, what: "lies" };
      else if (!g && t.split && b!.saplings.has(i)) found ??= { i, what: "sapling" };
    }
    return found;
  };

  const resume = (dt: number) => {
    const now = waiters;
    waiters = [];
    for (const done of now) done(dt);
  };

  return {
    game, player, world, stage, beaver, fast, live, requested, want,
    get subject() { return subject; },
    set subject(at) { subject = at; },
    get usedUp() { return usedUp; },
    frame, paint, wait, until, tap, press, key, flat, walkTo, reach, last, expect, after, hudText,
    build, needBuild, pond, sky, clear, standingTrees, fell, split, loose, pickUp, fetchStick, buildUpTo, regrowing, resume,
  };
};
