// The tour: with ?tour in the address the beaver plays by itself, one feature after the other, round after round, and
// checks each one as it goes. To watch the game grow (the "Tour" tab of /watch), and as a test that keeps running.
//
//   http://localhost:5180/?play&tour                       in a browser: watch it
//   bun shot "http://localhost:5180/?play&tour" --wait 240000 --out shots/tour.png        headless, filmed, logged
//   ?play&tour&station=Map                                 play only the named station (repeat station for prerequisites)
//   ?tour=fast                                             the test: FAST times real time, long ways hopped over
//   /?play&tour=live                                        real-time activities chosen from the current world
//   bun run tour                                           the test without end, headless (tools/tour.ts)
//   bun run tour --once [--station Name ...]               one round as a check: a line per station, exit 0 or 1
//   ?play&touch&tour=fast&station=Touch controls           the touch station needs touch controls on the page
//
// It plays through the keyboard's own way in (player.keys.add): a Source that walks to a place, runs, jumps and
// holds E, the same Input a person would give, so the real rules decide what happens. Each station ends with a
// check on what the game did (its events, the sky, the HUD); a station that fails, throws, or gets stuck on the way
// is written to the console as "[tour] FAIL <station>: <why>", one that works as "[tour] ok <station>", and every
// round as "[tour] round <n>: <ok>/<all> ok". window.tour holds the same for --eval.
//
// The tour plays its own saved game (the build feature keeps it under "beaver.build.tour") and stays off the
// network, so it never touches a game someone plays. The saved game lives on across rounds: the dam grows a few
// sticks a visit (in fast mode half a dam a round), then the lodge; only when the lodge stands, or (not live) no wood
// is left, it starts anew (a reload). A station whose feature is missing (a lab page without sky) is skipped.
// Stations marked stream false test the player's controls (menus, a pad): the live stream leaves them out.
import { Scalar } from "@babylonjs/core/Maths/math.scalar.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { TextBlock } from "@babylonjs/gui";
import { MapDisplay } from "../hud/map-display.ts";
import { Overlay, onViewport, box, hudLayout } from "../hud/overlay.ts";
import type { Stick } from "../../contracts.ts";
import type { CreateFeature } from "../../game.ts";
import type { GameEvents } from "../../events.ts";
import type { Offer } from "../../player/index.ts";
import { newInput, type Input } from "../../player/input.ts";
import { bodyPoints, direct, enter, eyeAt, framing, glide, inside, KEEP_OUT, liveDirector, newHold, shotFor, sight, type Choice, type Station, type Volume, type XYZ } from "./live.ts";
import { fader, occluders } from "./clearview.ts";
import { RAPIER } from "../../engine.ts";
import { live as standing, LODGE, REGROW, SLOTS, SPROUT, type BuildState } from "../build/rules.ts";
import { deerHours, type Deer } from "../life/brain.ts";
import { centre, spread, type Deep } from "../life/deep.ts";
import { BASIN } from "../../world/terrain.ts";
import { dayAt } from "../sky/clock.ts";

const STUCK_TIME = 2.5; // s: moving less than STUCK_MOVE in this long means something is in the way
const STUCK_MOVE = 0.25;
const PAUSE = 1.2; // s between stations
const FAST = 4; // ?tour=fast: the world runs this many times faster than real time (stage.timeScale)
const HOP = 1.5; // m: in fast mode a way to the next thing longer than this is jumped over (teleport), but the last metre
// The live camera glides to its next shot, eased in and out, never faster than these: calm on a stream.
const GLIDE = 0.8, TURN = 0.4, TILT = 0.15, DOLLY = 0.8, PAN = 0.6; // 1/s; rad/s round and up, m/s in and out, m/s of its aim
const LOOK = 0.7; // m above the feet the live camera turns round (src/player/camera.ts LOOK_HEIGHT)
const TOWARD = 0.45, REACH = 1.2; // the live picture is moved this share towards what the beaver works on, at most m
const LEAD = 1.2; // m: the live camera looks this far ahead of a walking beaver
const BATCH = 3; // sticks built per visit, live and plain; fast builds to the next half of the dam, then the lodge
const DUCKS_BACK = 120; // s after animals were startled until the ducks count as back on the pond

/** What the build feature puts on window for tools (src/features/build/index.ts); only the part the tour needs. */
interface BuildDebug {
  state: BuildState;
  dam: { frame: { origin: Vector3; across: Vector3 }; lodgeAt: Vector3 };
  fill(n: number): number;
  views: Map<number, { trunkLine(): { from: Vector3; along: Vector3 } | undefined }>;
  saplings: Map<number, unknown>;
  age(i: number, seconds: number): number | false;
  split(i: number): boolean;
  reset(): void;
}
class Skip extends Error {}

export const create: CreateFeature = (game) => {
  const params = new URLSearchParams(location.search);
  const mode = params.get("tour");
  if (mode === null) return {};
  const { player, world, stage, events, beaver } = game, fast = mode === "fast";
  if (fast) stage.timeScale = FAST;
  const build = () => (window as { build?: BuildDebug }).build;

  // ---- what the tour wants, read once per physics step like any other device ----
  const want = { to: undefined as Vector3 | undefined, side: 0, run: 0, jump: false, act: false, slap: false, dive: false }, aimAt = new Vector3();
  let subject: (() => { x: number; z: number }) | undefined; // what the beaver works on, for the live picture: a tree, the dam, a deer
  player.keys.add({
    read(into: Input) {
      Object.assign(into, newInput(), { run: want.run, jump: want.jump, act: want.act, slap: want.slap, dive: want.dive });
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
  const NAMES = ["footstep", "jump", "land", "enterWater", "leaveWater", "pickup", "treeFalls", "treeLands", "treeSplits", "stickPlaced", "damFinished", "tailSlap", "startled"] as const;
  const count = {} as Record<(typeof NAMES)[number], number>, last: Partial<GameEvents> = {};
  for (const name of NAMES) {
    count[name] = 0;
    events.on(name, (e) => { count[name]++; (last as Record<string, unknown>)[name] = e; });
  }
  const expect = (ok: boolean, why: string) => { if (!ok) throw new Error(why); };
  const after = (name: (typeof NAMES)[number]) => { const n = count[name]; return () => count[name] > n; };
  let clock = 0, startledAt = -Infinity; // s of the game's time; when animals last fled (the ducks fly off)
  events.on("startled", () => { startledAt = clock; });
  const hudText = (name: string) => (stage.hud.getControlByName(name) as TextBlock | null)?.text ?? "";

  // ---- dam work, in parts the stations share: fell a tree, gnaw it into wood, pick up a stick, build it in ----
  const needBuild = () => build() ?? skip("no build feature");
  const pond = world.pond, sky = () => game.sky ?? skip("no sky feature");
  // m south of the pond's middle to swim to: the lodge rises in the middle once the dam holds (and the pond is full).
  const clear = () => (build()?.state.dam.length ?? 0) >= SLOTS ? 1.8 : 0;
  /** Trees standing now, the first ones or grown back, nearest the building site first. */
  const standingTrees = (b: BuildDebug) => {
    const site = world.site!, from = (i: number) => Math.hypot(world.trees![i]!.place.x - site.x, world.trees![i]!.place.z - site.z);
    return world.trees!.map((_, i) => i).filter((i) => standing(b.state.trees[i])?.fell === undefined && !!standing(b.state.trees[i])).sort((a, c) => from(a) - from(c));
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

  // ---- the stations, in order ----
  let felled = -1;
  const stations: Station[] = [
    ["Walk", async () => {
      const steps = after("footstep");
      await walkTo(world.spawn.x + 1, world.spawn.z + 3);
      expect(steps(), "walked without a footstep");
    }, "Around the clearing"],
    ["Run", async () => {
      let top = 0;
      const fast = () => { top = Math.max(top, player.motion.speed); return false; };
      await walkTo(world.spawn.x + 4, world.spawn.z + 1, { run: 1, arrived: fast });
      expect(top > 1.5, `top speed ${top.toFixed(2)} m/s, not running`);
    }, "Around the clearing"],
    ["Jump", async () => {
      const jumped = after("jump"), landed = after("land");
      for (let i = 0; i < 3; i++) { await tap("jump", 0.3); await wait(0.7); }
      expect(jumped() && landed(), "no jump, or no landing");
    }, "Around the clearing"],
    ["Fell a tree", async () => {
      const i = standingTrees(needBuild())[0] ?? skip("no tree left");
      await fell(i);
      felled = i;
    }, "Dam work"],
    ["Gnaw it into wood", async () => {
      if (felled < 0) return skip("no tree felled this round");
      await split(felled);
      felled = -1;
    }, "Dam work"],
    // Live: time is real, so the beaver comes back to the stumps as they grow: it looks at a sapling, or fells the
    // tree grown back and gnaws it into wood. Otherwise the tree just gone into wood grows back, its clock wound on
    // (build.age): a sapling, half grown, the tree; then it is gnawed down again and its wood, the same pieces,
    // gathered where it lies.
    ["Regrow a tree", async () => {
      const b = needBuild();
      if (live) {
        const r = regrowing() ?? skip("nothing grows back yet");
        const tree = world.trees![r.i]!, out = new Vector3(-tree.place.x, 0, -tree.place.z).normalize(), back = tree.place.add(out.scale(2.5));
        if (r.what === "sapling") {
          await walkTo(back.x, back.z, { near: 0.6, limit: 60 });
          expect(b.saplings.has(r.i), `no sapling on stump ${r.i} any more, and no tree`);
          return wait(8); // a look at it growing
        }
        if (r.what === "stands") await fell(r.i);
        return split(r.i);
      }
      const i = last.treeSplits?.tree, t = () => b.state.trees[i!];
      if (i === undefined || !t()?.split || t()!.grown) return skip("no tree went into wood this round");
      const tree = world.trees![i]!, toAge = (seconds: number) => b.age(i, Math.max(0, seconds - (b.age(i, 0) || 0)));
      // A few steps back on the clearing's side, so the camera over the shoulder sees the stump.
      const out = new Vector3(-tree.place.x, 0, -tree.place.z).normalize(), back = tree.place.add(out.scale(3)), facing = Math.atan2(-out.x, -out.z);
      player.teleport(back.x, world.heightAt(back.x, back.z), back.z, facing);
      player.camera.yaw = facing + Math.PI + 0.5;
      for (const age of [SPROUT + 10, (SPROUT + REGROW) / 2]) {
        toAge(age);
        await wait(3);
        expect(b.saplings.has(i), `no sapling on stump ${i} ${age} s after its wood went`);
      }
      toAge(REGROW + 10);
      await until(() => !!t()?.grown, 3, `tree ${i} never grew back`);
      await wait(3);
      await fell(i);
      await until(() => !!t()?.grown?.rest, 10, `tree ${i} never came to rest again`);
      const splits = after("treeSplits");
      b.split(i);
      expect(splits() && last.treeSplits!.logs + last.treeSplits!.sticks > 0 && !t()?.grown, `tree ${i} grown back gave no wood`);
    }, "Regrowth"],
    ["Carry a stick", () => player.carrying ? skip("a stick is in the hand already") : fetchStick(), "Dam work"],
    // A few sticks a visit (fast: up to half the dam, then the rest), so the dam grows across rounds; the saved game
    // lives on, so the lodge follows it.
    ["Build the dam", async () => {
      const n = needBuild().state.dam.length;
      if (n >= SLOTS) return skip("the dam is full");
      await buildUpTo(Math.min(SLOTS, fast ? (n * 2 < SLOTS ? SLOTS / 2 : SLOTS) : n + BATCH), false);
    }, "Dam work"],
    // After the dam: swim sticks out to the lodge. Run alone (station=Build the lodge) it finishes the tour's own dam
    // first, so the lodge is there; in the whole tour it waits for a full dam.
    ["Build the lodge", async () => {
      const b = needBuild();
      if (b.state.dam.length < SLOTS) {
        if (!requested.includes("Build the lodge")) return skip("the dam is not finished yet");
        b.fill(SLOTS);
      }
      const n = b.state.dam.length;
      if (n >= SLOTS + LODGE) return skip("the lodge is finished");
      await buildUpTo(fast ? SLOTS + LODGE : Math.min(SLOTS + LODGE, n + BATCH), true);
      if (live && b.state.dam.length >= SLOTS + LODGE) await wait(10); // the lodge standing, before the world starts anew
    }, "Dam work"],
    ["Swim", async () => {
      if (!pond) return skip("no pond");
      if (player.afloat) await walkTo(world.spawn.x, world.spawn.z, { arrived: () => !player.afloat, limit: 40 }); // out first, from the lodge
      const wet = after("enterWater");
      await walkTo(pond.x, pond.z - clear(), { arrived: wet, limit: 30 });
      expect(wet(), "walked into the pond, never afloat");
      const dry = after("leaveWater");
      await walkTo(pond.x + pond.radius + 1.5, pond.z, { arrived: dry, limit: 40 });
      expect(dry(), "swam across, never out again");
    }, "Pond patrol"],
    // On land Q thumps the tail on the ground: a tail slap, not on the water.
    ["Tail slap on land", async () => {
      if (player.afloat) await walkTo(world.spawn.x, world.spawn.z, { arrived: () => !player.afloat, limit: 40 });
      await wait(0.6);
      expect(!player.afloat, "wanted to slap on land, still afloat");
      const slapped = after("tailSlap");
      await tap("slap");
      await until(slapped, 2, "pressed Q on land, the tail never came down");
      expect(!last.tailSlap!.water, "slapped on land, but it came down on water");
      await wait(2);
    }, "Tail slap"],
    // Out on the pond, the alarm: Q slaps the tail; the crack (tailSlap) must send at least one animal off (startled).
    ["Tail slap", async () => {
      if (!pond) return skip("no pond");
      await walkTo(pond.x - 0.5, pond.z - clear(), { near: 0.8, limit: 40 });
      expect(player.afloat, "out in the pond, yet not afloat");
      await wait(0.4);
      const slapped = after("tailSlap"), startled = after("startled");
      await tap("slap");
      await until(slapped, 2, "pressed Q afloat, the tail never came down");
      expect(last.tailSlap!.water, "slapped in the pond, but not on the water");
      await until(startled, 1, "the tail came down, no animal heard it");
      expect(last.startled!.count > 0, "the tail came down, no animal fled");
      await wait(4); // the ducks circle, the fish dart off: something to see
    }, "Tail slap"],
    // Out in the middle, C held takes the beaver under: below the surface with the under-water picture (live, the
    // stream's camera stays above and watches it go down); a swim down there, then let go and up again.
    ["Dive", async () => {
      if (!pond) return skip("no pond");
      const look = () => (stage.scene.metadata.underwater as { on: boolean } | undefined)?.on, depth = () => (player.waterLevel ?? 0) - player.feet.y;
      await walkTo(pond.x, pond.z - clear(), { near: 0.5, limit: 40 });
      expect(player.afloat, "out in the pond, yet not afloat");
      want.dive = true;
      try {
        await until(() => player.diving && depth() > 0.6, 4, `held C afloat, never went under (${depth().toFixed(2)} m deep)`);
        if (!live && look() !== undefined) await until(() => !!look(), 3, "the beaver is under, the picture is not");
        want.to = new Vector3(pond.x + 1.2, 0, pond.z - clear() + 0.4); // a look round down there
        await wait(2.5);
        want.to = undefined;
        expect(depth() > 0.6 && player.diving, `swimming under, it came up (${depth().toFixed(2)} m deep)`);
      } finally { want.dive = false; want.to = undefined; }
      await until(() => !player.diving && depth() < 0.45, 4, "let go of C, it never came up");
      if (!live && look() !== undefined) await until(() => !look(), 3, "up again, the picture stays under water");
    }, "Pond patrol"],
    // Down into the deep basin: the school is there and parts round the beaver as it swims into it (C held while above
    // the school's depth, let go below it, so it stays level with them); up again, a tail slap scatters it.
    ["Life in the deep", async () => {
      if (!pond) return skip("no pond");
      const deep = (window as { life?: { animals: { deep?: Deep } } }).life?.animals.deep ?? skip("no life in the deep");
      const fish = () => deep.school.fish, depth = () => (player.waterLevel ?? 0) - player.feet.y;
      const body = () => ({ x: player.feet.x, y: player.feet.y + 0.25, z: player.feet.z });
      expect(fish().length > 0, "no school in the deep basin");
      await walkTo(BASIN.x, BASIN.z, { near: 0.6, limit: 40, hop: true });
      expect(player.afloat, "over the deep basin, yet not afloat");
      let met = 0, closest = Infinity;
      try {
        want.dive = true;
        await until(() => player.diving && depth() > 1, 6, `held C over the basin, never went down (${depth().toFixed(2)} m deep)`);
        for (let t = 0; t < 12 && met < 1.5;) {
          const c = centre(fish()), b = body();
          want.dive = b.y > c.y - 0.1;
          want.to = new Vector3(c.x, 0, c.z);
          t += await frame();
          if (Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z) < 0.6) {
            met += 1 / 60;
            closest = Math.min(closest, ...fish().map((f) => Math.hypot(f.x - b.x, f.y - b.y, f.z - b.z)));
          }
        }
        expect(met > 0, "swam after the school for 12 s, never got into it");
        expect(closest > 0.25, `in the school, a fish swam ${closest.toFixed(2)} m from the beaver: it did not part`);
      } finally { want.dive = false; want.to = undefined; }
      await until(() => !player.diving && depth() < 0.45, 6, "let go of C, it never came up");
      await wait(0.5);
      const before = spread(fish()), slapped = after("tailSlap");
      await tap("slap");
      await until(slapped, 2, "pressed Q over the basin, the tail never came down");
      await wait(1);
      expect(spread(fish()) > before * 1.5, `slapped, the school stayed together (${before.toFixed(2)} → ${spread(fish()).toFixed(2)} m)`);
      await wait(3); // it gathers again
    }, "Pond patrol"],
    ["Animals at the pond", async () => {
      if (!pond) return skip("no pond");
      expect(stage.scene.meshes.some((o) => o.name.startsWith("life-")), "no animals in the scene");
      for (const angle of [0.6, 1.3, 2.0]) {
        const r = pond.radius + 1.6;
        await walkTo(pond.x + Math.cos(angle) * r, pond.z + Math.sin(angle) * r, { near: 0.6 });
      }
    }, "Pond patrol"],
    ["Furious beaver", async () => {
      player.setAnger(1);
      try {
        // Live it runs home from wherever it is; otherwise it starts at home (settle) and runs out over the grass.
        await walkTo(world.spawn.x + (live ? 0 : 3), world.spawn.z + (live ? 0 : 3), { run: 1, limit: 25 });
        expect(beaver.anger > 0.9, `anger ${beaver.anger.toFixed(2)}, not furious`);
      } finally { player.setAnger(0); }
    }],
    ["A day passes", async () => {
      const s = sky(), hour = s.hour, running = s.running;
      s.running = false;
      try {
        for (const h of [19.3, 20.5, 23, 5.6]) { s.setHour(h); await wait(3.5); if (h === 23) expect(s.dark > 0.5, `dark ${s.dark.toFixed(2)} at 23:00`); }
      } finally { s.setHour(hour); s.running = running; }
    }, "Sky watch"],
    // Dusk: deer come out of the forest's edge to graze (src/features/life); the beaver runs at one, it bounds off into
    // the trees. Live it plays only in the deer's hours and never sets the clock (the tour has no way to keep a station
    // out of the stream by the hour, so it skips itself); otherwise it sets the hour, fair weather, and starts at spawn.
    ["Deer at dusk", async () => {
      const s = sky(), deer = (window as { life?: { animals: { deer: Deer[] } } }).life?.animals.deer ?? skip("no deer");
      if (live && !deerHours(dayAt(s.hour).sunHeight)) return skip(`no deer about at ${s.hour.toFixed(1)} h`);
      const hour = s.hour, running = s.running;
      try {
        if (!live) {
          s.running = false;
          s.setHour(19.6);
          s.setWeather("fair");
          player.teleport(world.spawn.x, world.heightAt(world.spawn.x, world.spawn.z), world.spawn.z);
        }
        await until(() => deer.some((d) => d.state === "graze"), 60, "no deer came out to graze at dusk");
        const d = deer.find((o) => o.state === "graze")!;
        subject = () => d;
        expect(!!stage.scene.getMeshByName("life-deer")?.isEnabled(), "a deer grazes, none is drawn");
        await wait(2); // a look at it grazing
        await walkTo(d.x, d.z, { run: 1, near: 2, arrived: () => d.state === "flee", limit: 25 });
        expect(d.state === "flee", `ran at a deer, it stayed (${d.state}, ${flat(d.x, d.z).toFixed(1)} m off)`);
        const from = flat(d.x, d.z);
        await until(() => d.state === "away", 12, "the deer bounded off but never reached the trees");
        expect(flat(d.x, d.z) > from + 3, "the deer fled, but not away from the beaver");
      } finally {
        if (!live) { s.setHour(hour); s.running = running; s.setWeather("auto"); }
      }
    }, "Sky watch"],
    ["Weather", async () => {
      const s = sky();
      try {
        s.setWeather("rain");
        await until(() => s.rain > 0.3, 12, "asked for rain, none came");
        await wait(3);
        s.setWeather("fog");
        await until(() => s.fog > 0.3, 12, "asked for fog, none came");
        await wait(3);
      } finally { s.setWeather("auto"); }
    }, "Sky watch"],
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
    // A standard gamepad (a stand-in for navigator.getGamepads): the left stick walks, A jumps.
    ["Gamepad", async () => {
      const pad = { connected: true, index: 0, mapping: "standard", axes: [0, -1, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      Object.defineProperty(navigator, "getGamepads", { value: () => [pad], configurable: true });
      try {
        const from = player.feet.clone(), steps = after("footstep");
        await wait(1.5);
        const moved = Vector3.Distance(from, player.feet);
        expect(moved > 0.5 && steps(), `the left stick pushed for 1.5 s, the beaver went ${moved.toFixed(2)} m`);
        pad.axes[1] = 0;
        await wait(0.5);
        const jumped = after("jump");
        pad.buttons[0]!.pressed = true;
        await wait(0.3);
        pad.buttons[0]!.pressed = false;
        await until(jumped, 1, "A pressed on the pad, no jump");
      } finally { delete (navigator as { getGamepads?: unknown }).getGamepads; }
      await wait(1);
    }, undefined, false],
    // With a touch screen (or ?touch): a thumb on the left half walks, the Jump button jumps.
    ["Touch controls", async () => {
      const jump = document.querySelector<HTMLButtonElement>('#touch-controls button[aria-label="Jump"]') ?? skip("no touch controls (add &touch)");
      const touch = (type: string, x: number, y: number) => (type === "pointerdown" ? stage.canvas : window).dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: "touch", clientX: x, clientY: y, bubbles: true, cancelable: true }));
      const x = stage.canvas.clientWidth * 0.2, y = stage.canvas.clientHeight * 0.7, from = player.feet.clone();
      touch("pointerdown", x, y);
      try { touch("pointermove", x, y - 60); await wait(1.5); } finally { touch("pointerup", x, y - 60); }
      const moved = Vector3.Distance(from, player.feet);
      expect(moved > 0.5, `a thumb pushed up for 1.5 s, the beaver went ${moved.toFixed(2)} m`);
      await wait(0.5);
      const jumped = after("jump");
      jump.click(); // a tap without a pointer (detail 0) counts once, as from a screen reader
      await until(jumped, 1, "Jump tapped, no jump");
      await wait(1);
    }, undefined, false],
    // A visitor who has never played (src/features/hud): the walk hint, then the look hint, each gone once done; a
    // marker over the nearest stick until one is picked up.
    ["First steps", async () => {
      const hud = (window as { hud?: { fresh(steps?: string[]): void } }).hud ?? skip("no HUD");
      if (player.carrying) { await tap("act"); await until(() => !player.carrying, 3, "could not let go of the stick in the hand"); }
      hud.fresh();
      await frame(); await frame();
      const marker = () => stage.hud.getControlByName("first-marker"), hint = () => hudText("input-hints");
      expect(hint().includes("walk"), `a new player is shown "${hint()}", not how to walk`);
      if (loose().length) expect(player.offer() ? !marker()?.isVisible : !!marker()?.isVisible && hudText("first-marker").startsWith("Stick"), "no marker over a stick for a new player");
      await walkTo(player.feet.x + 2.5, player.feet.z + 2.5);
      await until(() => !hint().includes("walk"), 2, "walked 3 m, the walk hint stays");
      // The tour's camera swings round behind a walking beaver, which counts as a look: the look is asked for afresh.
      hud.fresh(["look"]);
      await frame(); await frame();
      expect(hint().includes("look around"), `walked, then "${hint()}" instead of how to look around`);
      player.camera.turn(1, 0);
      await until(() => !hint().includes("look around"), 2, "looked around, the look hint stays");
      if (!loose().length) return; // every stick is in the dam and the lodge: nothing to mark or pick up
      await pickUp();
      await frame(); await frame();
      expect(!marker()?.isVisible || !hudText("first-marker").startsWith("Stick"), "a stick in the hand, the stick marker stays");
    }, undefined, false],
  ];

  // A feature run may request prerequisite stations followed by the new behavior.
  const requested = params.getAll("station");
  const focused = requested.length ? requested.map(name => {
    const station = stations.find(([candidate]) => candidate === name);
    if (!station) throw new Error("Unknown tour station: " + name);
    return station;
  }) : undefined;
  const live = mode === "live" && !focused, shown: Record<string, number> = {};
  // Low over open water but never under it; on land above the grass, and highest over the pond's edge, above the
  // reeds there (place.ts). None of them stops the camera's cast. Smooth in the ground's height, so never a jump.
  if (live) player.camera.floor = (x, z) => {
    const ground = world.heightAt(x, z), edge = Math.max(0, 1 - Math.abs(ground - world.waterLevel) / 0.8);
    return Math.max(world.waterLevel + 0.3, ground + 1.6 + 0.9 * edge);
  };
  // What can hide the beaver without a collider the camera sees (clearview.ts), taken before the first picture; the
  // camera stays out of the crowns and bushes among them, and the director keeps a clear view (live.ts: direct).
  const near = live ? occluders(stage.scene, player.node) : undefined, fade = fader(stage.scene);
  let volumes: Volume[] = [], hold = newHold(), looked = 0, yawV = 0, pitchV = 0, distanceV = 0;
  const aimV = new Vector3();
  /** How far (0 … 1) the camera gets from `from` towards `to` before a crown or bush (with room to spare). */
  const room = (from: XYZ, to: XYZ) => {
    let t = Infinity;
    for (const v of volumes) if (v.round && !inside(v, from)) t = Math.min(t, enter(v, from, to, KEEP_OUT));
    return Math.min(1, t);
  };
  if (live) player.camera.room = (from, direction, distance) => Math.max(0.05, room(from, from.add(direction.scale(distance))) * distance);
  // The ground, trunks, rocks, fallen trees in between (not the beaver, nor sticks).
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), FLAGS = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC;
  const heavy = (c: RAPIER.Collider) => !c.parent()?.isDynamic() || c.parent()!.mass() > 1;
  const solid = (from: XYZ, to: XYZ) => {
    const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    ray.origin = from; ray.dir = { x: (to.x - from.x) / d, y: (to.y - from.y) / d, z: (to.z - from.z) / d };
    return d > 0.15 && !!stage.physics.castRay(ray, d - 0.1, true, FLAGS, undefined, undefined, undefined, heavy);
  };

  // ---- on screen: where the tour is; live, a caption big enough for a 1080p stream, top centre, clear of the
  // corners and the bottom third where stream overlays (webcam, chat, alerts) usually sit ----
  const overlay = new Overlay(stage,"tour",false,12);
  const backing = live ? overlay.rect("station-backing",box(0,0,1,1)) : undefined;
  const label = overlay.text("station","",box(0,0,1,1),14,"center");
  label.fontWeight = "bold";
  label.outlineWidth = 3;
  label.outlineColor = "#182723";
  onViewport(stage,(w,h) => {
    if (!backing) return overlay.move(label,hudLayout(stage).caption);
    const { caption: at, u: size } = hudLayout(stage); // the HUD's top centre and its type (hud/style.ts)
    label.fontSize = size;
    overlay.move(backing, at);
    overlay.move(label, at);
  });

  /** Live: the activity and its station, and how far the long work is, so viewers see the dam grow over the hour. */
  const caption = () => {
    const a = tour.activity, name = tour.station, n = build()?.state.dam.length ?? 0, line = a === name ? name : a + " · " + name;
    if (a !== "Dam work") return line;
    return line + (n < SLOTS ? ` · ${n} of ${SLOTS}` : ` · lodge ${n - SLOTS} of ${LODGE}`);
  };

  /** Not live: every station starts calm on land at the spawn, facing the pond over open grass, hands free unless it
   *  builds; so none depends on where the one before left the beaver (in the water, against the lodge, angry). */
  const settle = async (name: string) => {
    const { x, z } = world.spawn, facing = pond ? Math.atan2(pond.x - x, pond.z - z) : 0;
    player.setAnger(0);
    player.teleport(x, world.heightAt(x, z), z, facing);
    player.camera.yaw = facing + Math.PI;
    if (player.carrying && !name.startsWith("Build the")) player.drop();
    await wait(0.3); // on its feet before the station acts
  };

  // ---- the rounds ----
  const errors: string[] = [];
  window.addEventListener("error", (e) => errors.push(e.message));
  window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));
  const results: { round: number; station: string; ok: boolean | "skipped"; why?: string; seconds: number }[] = [];
  const tour = { round: 0, results, station: "", activity: "", clock: 0 }; // clock: s of game time, for tools/tour.ts
  Object.assign(window, { tour });

  void (async () => {
    await wait(1.5); // the first pictures, the HUD's start
    for (;;) {
      tour.round++;
      const b = build(), placed = b?.state.dam.length ?? 0, canFell = !!b && standingTrees(b).length > 0;
      // Live: what can be played now; the dam work only while there is something to build, its stations as they apply.
      const itinerary = live ? liveDirector(stations.filter(([name, , activity, stream]) => {
        if (stream === false) return false;
        if (name === "Regrow a tree") return !!regrowing();
        if (activity !== "Dam work") return true;
        if (!b || placed >= SLOTS + LODGE) return false;
        if (name === "Build the dam") return placed < SLOTS;
        if (name === "Build the lodge") return placed >= SLOTS;
        if (player.carrying) return false;
        if (name === "Carry a stick") return loose().length > 0;
        return canFell; // fell a tree and gnaw it into wood
      }), { now: clock, shown, previous: tour.activity, hour: game.sky?.hour, weather: game.sky?.weather, ducks: clock - startledAt > DUCKS_BACK, carrying: !!player.carrying }) : focused ?? stations;
      if (live) shown[tour.activity = itinerary[0]![2] ?? itinerary[0]![0]] = clock;
      let ok = 0, failed = false;
      for (const [n, [name, run]] of itinerary.entries()) {
        tour.station = name;
        label.text = live ? caption() : `Tour · round ${tour.round} · ${n + 1}/${itinerary.length} · ${name}`;
        const t0 = performance.now();
        errors.length = 0;
        let result: (typeof results)[number];
        try {
          if (!live) await settle(name);
          await run();
          if (errors.length) throw new Error(`the page threw: ${errors[0]}`);
          result = { round: tour.round, station: name, ok: true, seconds: 0 };
        } catch (e) {
          const skipped = e instanceof Skip;
          result = { round: tour.round, station: name, ok: skipped ? "skipped" : false, why: (e as Error).message, seconds: 0 };
          if (!skipped) failed = true;
        }
        want.act = want.jump = want.slap = want.dive = false;
        subject = undefined;
        result.seconds = +((performance.now() - t0) / 1000).toFixed(1);
        results.push(result);
        if (results.length > 500) results.shift();
        if (result.ok === true) { ok++; console.log(`[tour] ok ${name} (${result.seconds} s)`); }
        else if (result.ok === "skipped") console.log(`[tour] skipped ${name}: ${result.why}`);
        else console.error(`[tour] FAIL ${name}: ${result.why} (round ${tour.round})`);
        if (failed) {
          // A second of real time as it went wrong, for a screenshot (tools/tour.ts); then free again at the start.
          await new Promise((done) => setTimeout(done, 1000));
          player.teleport(world.spawn.x, world.heightAt(world.spawn.x, world.spawn.z), world.spawn.z);
          failed = false;
        }
        await wait(PAUSE);
      }
      console.log(`[tour] round ${tour.round}: ${ok}/${itinerary.length} ok`);
      // Its own saved game: start it anew once the lodge stands; in a test also once no wood is left (live waits for
      // the trees to grow back).
      if (b && (b.state.dam.length >= SLOTS + LODGE || (!live && !player.carrying && (usedUp || (!loose().length && !standingTrees(b).length))))) {
        console.log(`[tour] the saved game is ${b.state.dam.length >= SLOTS + LODGE ? "done: the lodge stands" : "used up"}: starting it anew`);
        b.reset();
        return;
      }
    }
  })();

  return {
    update(dt) {
      // Photo mode pauses the world but not the tour; the pause menu holds both.
      if (stage.paused && !document.body.classList.contains("photo")) return;
      if (!stage.paused) tour.clock = clock += dt;
      if (live && tour.activity === "Dam work") label.text = caption();
      if (live && !stage.paused) {
        // Live: every activity has its shot (live.ts); yaw, height, distance and aim glide there over seconds, so a
        // new activity or a stop to gnaw is a slow camera move, never a cut. Rounds alternate the side it films from.
        // Four times a second the director looks whether the beaver is seen, and if not takes another angle (or fades).
        const walking = !!want.to, shot = shotFor(tour.activity, walking), cam = player.camera, feet = player.feet;
        volumes = near!(feet, dt);
        const look = { x: feet.x, y: feet.y + LOOK, z: feet.z }, points = bodyPoints(feet), behind = player.facing + Math.PI;
        const sign = tour.round % 2 ? 1 : -1;
        if ((looked += dt) >= 0.25) {
          const now = sight(stage.camera.position, points, volumes, solid);
          // Clear from there, and the camera can get there: no collider, crown or bush between it and the beaver pulls it in.
          const shows = (c: Choice) => {
            const eye = eyeAt(look, framing(behind, shot, sign, c), cam.floor);
            return room(look, eye) === 1 && !solid(look, eye) && sight(eye, points, volumes, solid).seen;
          };
          const next = direct(hold, looked, !now.seen, shows);
          hold = next.hold;
          if (next.fade) fade.want(now.by);
          looked = 0;
        }
        fade.update(dt);
        const goal = framing(behind, shot, sign, hold.choice), s = subject?.(), lead = walking ? LEAD : 0; // looks a little ahead of where it walks
        let tx = 0, tz = 0;
        if (s) { // what it works on comes into the picture too
          const dx = s.x - feet.x, dz = s.z - feet.z, k = Math.min(TOWARD, REACH / Math.max(1e-6, Math.hypot(dx, dz)));
          tx = dx * k; tz = dz * k;
        }
        [cam.yaw, yawV] = glide(cam.yaw, yawV, cam.yaw + Math.atan2(Math.sin(goal.yaw - cam.yaw), Math.cos(goal.yaw - cam.yaw)), GLIDE, TURN, dt);
        [cam.pitch, pitchV] = glide(cam.pitch, pitchV, goal.pitch, GLIDE, TILT, dt);
        [cam.distance, distanceV] = glide(cam.distance, distanceV, goal.distance + Math.hypot(tx, tz), GLIDE, DOLLY, dt);
        aimAt.set(Math.sin(player.facing) * lead + tx, shot.lift, Math.cos(player.facing) * lead + tz);
        [cam.aim.x, aimV.x] = glide(cam.aim.x, aimV.x, aimAt.x, GLIDE, PAN, dt);
        [cam.aim.y, aimV.y] = glide(cam.aim.y, aimV.y, aimAt.y, GLIDE, PAN, dt);
        [cam.aim.z, aimV.z] = glide(cam.aim.z, aimV.z, aimAt.z, GLIDE, PAN, dt);
      } else if (want.to && !stage.paused) {
        // The camera swings round behind the beaver while it goes somewhere, so the way ahead is in the picture.
        const behind = player.facing + Math.PI, turn = Math.atan2(Math.sin(behind - player.camera.yaw), Math.cos(behind - player.camera.yaw));
        player.camera.yaw += turn * Math.min(1, dt * 1.2);
      }
      const now = waiters;
      waiters = [];
      for (const done of now) done(dt);
    },
  };
};

function skip(why: string): never { throw new Skip(why); }
const fmt = (v: Vector3) => `${v.x.toFixed(1)}, ${v.z.toFixed(1)}`;
