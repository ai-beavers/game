// The tour: with ?tour in the address the beaver plays by itself, one feature after the other, round after round, and
// checks each one as it goes. To watch the game grow (the "Tour" tab of /watch), and as a test that keeps running.
//
//   http://localhost:5180/?play&tour                       in a browser: watch it
//   bun shot "http://localhost:5180/?play&tour" --wait 240000 --out shots/tour.png        headless, filmed, logged
//   ?tour=fast                                             the test: FAST times real time, long ways hopped over
//   bun run tour                                           the test without end, headless (tools/tour.ts)
//
// It plays through the keyboard's own way in (player.keys.add): a Source that walks to a place, runs, jumps and
// holds E, the same Input a person would give, so the real rules decide what happens. Each station ends with a
// check on what the game did (its events, the sky, the HUD); a station that fails, throws, or gets stuck on the way
// is written to the console as "[tour] FAIL <station>: <why>", one that works as "[tour] ok <station>", and every
// round as "[tour] round <n>: <ok>/<all> ok". window.tour holds the same for --eval.
//
// The tour plays its own saved game (the build feature keeps it under "beaver.build.tour") and stays off the
// network, so it never touches a game someone plays. When the dam is full or no tree is left, it starts that saved
// game anew (a reload). A station whose feature is missing (a lab page without sky) is skipped.
import * as THREE from "three";
import type { CreateFeature } from "../../game.ts";
import type { GameEvents } from "../../events.ts";
import type { Offer } from "../../player/index.ts";
import { newInput, type Input } from "../../player/input.ts";
import { SLOTS } from "../build/rules.ts";

const STUCK_TIME = 2.5; // s: moving less than STUCK_MOVE in this long means something is in the way
const STUCK_MOVE = 0.25;
const PAUSE = 1.2; // s between stations
const FAST = 4; // ?tour=fast: the world runs this many times faster than real time (stage.timeScale)
const HOP = 1.5; // m: in fast mode a way to the next thing longer than this is jumped over (teleport), but the last metre

/** What the build feature puts on window for tools (src/features/build/index.ts); only the part the tour needs. */
interface BuildDebug {
  state: { dam: string[]; trees: Record<number, { fell?: number; split?: boolean; rest?: unknown } | undefined> };
  dam: { frame: { origin: THREE.Vector3; across: THREE.Vector3 } };
  views: Map<number, { trunkLine(): { from: THREE.Vector3; along: THREE.Vector3 } | undefined }>;
  reset(): void;
}
class Skip extends Error {}

export const create: CreateFeature = (game) => {
  const mode = new URLSearchParams(location.search).get("tour");
  if (mode === null) return {};
  const { player, world, stage, events, beaver } = game, fast = mode === "fast";
  if (fast) stage.timeScale = FAST;
  const build = () => (window as { build?: BuildDebug }).build;

  // ---- what the tour wants, read once per physics step like any other device ----
  const want = { to: undefined as THREE.Vector3 | undefined, side: 0, run: 0, jump: false, act: false };
  player.keys.add({
    read(into: Input) {
      Object.assign(into, newInput(), { run: want.run, jump: want.jump, act: want.act });
      if (!want.to) return into;
      const d = new THREE.Vector3(want.to.x - player.feet.x, 0, want.to.z - player.feet.z);
      if (d.lengthSq() < 1e-4) return into;
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
  const wait = async (seconds: number) => { for (let t = 0; t < seconds;) t += await frame(); };
  const until = async (done: () => boolean, limit: number, why: string) => {
    for (let t = 0; !done();) if ((t += await frame()) > limit) throw new Error(why);
  };
  const tap = async (key: "act" | "jump", hold = 0.15) => { want[key] = true; await wait(hold); want[key] = false; };
  const key = (code: string) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
  };
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
    want.to = new THREE.Vector3(x, 0, z);
    want.run = run;
    let t = 0, since = 0, from = player.feet.clone(), dodges = 0;
    try {
      while (!arrived() && flat(x, z) > near) {
        const dt = await frame();
        if ((t += dt) > limit) throw new Error(`stuck at ${fmt(player.feet)} on the way to ${x.toFixed(1)}, ${z.toFixed(1)}`);
        if ((since += dt) < STUCK_TIME) continue;
        if (player.feet.distanceTo(from) < STUCK_MOVE) {
          want.side = dodges++ % 2 ? -1 : 1;
          await wait(0.9);
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
  const NAMES = ["footstep", "jump", "land", "enterWater", "leaveWater", "pickup", "treeFalls", "treeLands", "treeSplits", "stickPlaced"] as const;
  const count = {} as Record<(typeof NAMES)[number], number>, last: Partial<GameEvents> = {};
  for (const name of NAMES) {
    count[name] = 0;
    events.on(name, (e) => { count[name]++; (last as Record<string, unknown>)[name] = e; });
  }
  const expect = (ok: boolean, why: string) => { if (!ok) throw new Error(why); };
  const after = (name: (typeof NAMES)[number]) => { const n = count[name]; return () => count[name] > n; };

  // ---- the stations, in order ----
  const pond = world.pond, sky = () => game.sky ?? skip("no sky feature");
  const needBuild = () => build() ?? skip("no build feature");
  let felled = -1;
  const stations: [string, () => Promise<void>][] = [
    ["Walk", async () => {
      const steps = after("footstep");
      await walkTo(world.spawn.x + 1, world.spawn.z + 3);
      expect(steps(), "walked without a footstep");
    }],
    ["Run", async () => {
      let top = 0;
      const fast = () => { top = Math.max(top, player.motion.speed); return false; };
      await walkTo(world.spawn.x + 4, world.spawn.z + 1, { run: 1, arrived: fast });
      expect(top > 1.5, `top speed ${top.toFixed(2)} m/s, not running`);
    }],
    ["Jump", async () => {
      const jumped = after("jump"), landed = after("land");
      for (let i = 0; i < 3; i++) { await tap("jump", 0.3); await wait(0.7); }
      expect(jumped() && landed(), "no jump, or no landing");
    }],
    ["Fell a tree", async () => {
      const b = needBuild(), site = world.site!, trees = world.trees!;
      const standing = trees.map((t, i) => ({ t, i })).filter(({ i }) => b.state.trees[i]?.fell === undefined);
      if (!standing.length) return skip("no tree left");
      const fromSite = (t: (typeof trees)[number]) => Math.hypot(t.place.x - site.x, t.place.z - site.z);
      const { t: tree, i } = standing.sort((a, c) => fromSite(a.t) - fromSite(c.t))[0]!;
      // From the side facing the clearing's middle, as build.at(i) does, so it falls outwards.
      const out = new THREE.Vector3(-tree.place.x, 0, -tree.place.z).normalize();
      const stand = tree.place.clone().addScaledVector(out, tree.radius + 0.35);
      await reach("gnaw", (attempt) => attempt ? tree.place : stand, true).catch((e: Error) => { throw new Error(`tree ${i}: ${e.message}`); });
      const falls = after("treeFalls"), lands = after("treeLands");
      want.act = true;
      try { await until(falls, 15, "gnawed for 15 s, the tree still stands"); } finally { want.act = false; }
      await until(lands, 8, "the tree fell but never landed");
      felled = last.treeFalls!.tree;
    }],
    ["Gnaw it into wood", async () => {
      if (felled < 0) return skip("no tree felled this round");
      const b = needBuild(), i = felled;
      // Only a tree lying still can be gnawed (build: the "rest" change); one leaning on another may never be.
      await until(() => !!b.state.trees[i]?.rest, 8, `tree ${i} never came to rest after its fall (leaning on something?)`);
      // The nearest point of the trunk as it lies now, a little off its foot; then further along it.
      await reach("split", (attempt) => {
        const { from, along } = b.views.get(i)?.trunkLine() ?? { from: world.trees![i]!.place, along: new THREE.Vector3() };
        return from.clone().addScaledVector(along, attempt ? attempt : THREE.MathUtils.clamp(player.feet.clone().sub(from).dot(along), 0.3, 2));
      });
      const splits = after("treeSplits");
      want.act = true;
      try { await until(splits, 10, "gnawed the lying tree for 10 s, still whole"); } finally { want.act = false; }
      felled = -1;
    }],
    ["Carry a stick", async () => {
      const sticks = world.sticks.filter((s) => s.body.isEnabled() && s !== player.carrying);
      expect(sticks.length > 0, "no stick lies anywhere");
      // The nearest; when it cannot be got at (under a log), the next one, as a player would.
      sticks.sort((a, b) => flat(a.body.translation().x, a.body.translation().z) - flat(b.body.translation().x, b.body.translation().z));
      await reach("pickup", (attempt) => sticks[Math.min(attempt, sticks.length - 1)]!.body.translation(), true);
      const picked = after("pickup");
      await tap("act");
      await until(picked, 2, "pressed E at a stick, nothing in the hand");
    }],
    ["Build the dam", async () => {
      const b = needBuild();
      if (b.state.dam.length >= SLOTS) return skip("the dam is full");
      if (!player.carrying) return skip("nothing in the hand to build with");
      const { origin, across } = b.dam.frame, to = origin.clone().addScaledVector(across, -1.25);
      await reach("build", (attempt) => attempt ? origin : to, true);
      const placed = after("stickPlaced");
      await tap("act");
      await until(placed, 3, "pressed E at the dam, no stick placed");
    }],
    ["Swim", async () => {
      if (!pond) return skip("no pond");
      const wet = after("enterWater");
      await walkTo(pond.x, pond.z, { arrived: wet, limit: 30 });
      expect(wet(), "walked into the pond, never afloat");
      const dry = after("leaveWater");
      await walkTo(pond.x + pond.radius + 1.5, pond.z, { arrived: dry, limit: 40 });
      expect(dry(), "swam across, never out again");
    }],
    ["Animals at the pond", async () => {
      if (!pond) return skip("no pond");
      expect(stage.scene.children.some((o) => o.name.startsWith("life-")), "no animals in the scene");
      for (const angle of [0.6, 1.3, 2.0]) {
        const r = pond.radius + 1.6;
        await walkTo(pond.x + Math.cos(angle) * r, pond.z + Math.sin(angle) * r, { near: 0.6 });
      }
    }],
    ["Furious beaver", async () => {
      player.setAnger(1);
      try {
        await walkTo(world.spawn.x, world.spawn.z, { run: 1, limit: 25 });
        expect(beaver.anger > 0.9, `anger ${beaver.anger.toFixed(2)}, not furious`);
      } finally { player.setAnger(0); }
    }],
    ["A day passes", async () => {
      const s = sky(), hour = s.hour, running = s.running;
      s.running = false;
      try {
        for (const h of [19.3, 20.5, 23, 5.6]) { s.setHour(h); await wait(3.5); if (h === 23) expect(s.dark > 0.5, `dark ${s.dark.toFixed(2)} at 23:00`); }
      } finally { s.setHour(hour); s.running = running; }
    }],
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
    }],
    ["Map", async () => {
      const map = document.querySelector("#beaver-hud .map") ?? skip("no HUD");
      key("KeyM");
      expect(map.classList.contains("large"), "M did not enlarge the map");
      await wait(3);
      key("KeyM");
      expect(!map.classList.contains("large"), "M did not shrink the map");
    }],
    ["Photo mode", async () => {
      key("KeyP");
      if (!document.body.classList.contains("photo")) return skip("no photo mode");
      try { await wait(4); } finally { key("KeyP"); }
      expect(!document.body.classList.contains("photo") && !stage.paused, "P did not leave photo mode");
    }],
  ];

  // ---- on screen: where the tour is ----
  const label = document.createElement("div");
  label.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:20;pointer-events:none;"
    + "font:600 14px -apple-system,'Helvetica Neue',Arial,sans-serif;color:#fff;background:rgba(16,20,26,.7);padding:6px 14px;border-radius:999px";
  document.body.append(label);

  // ---- the rounds ----
  const errors: string[] = [];
  window.addEventListener("error", (e) => errors.push(e.message));
  window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));
  const results: { round: number; station: string; ok: boolean | "skipped"; why?: string; seconds: number }[] = [];
  const tour = { round: 0, results, station: "" };
  Object.assign(window, { tour });

  void (async () => {
    await wait(1.5); // the first pictures, the HUD's start
    for (;;) {
      tour.round++;
      player.teleport(world.spawn.x, world.heightAt(world.spawn.x, world.spawn.z), world.spawn.z);
      let ok = 0, failed = false;
      for (const [n, [name, run]] of stations.entries()) {
        tour.station = name;
        label.textContent = `Tour · round ${tour.round} · ${n + 1}/${stations.length} · ${name}`;
        const t0 = performance.now();
        errors.length = 0;
        let result: (typeof results)[number];
        try {
          await run();
          if (errors.length) throw new Error(`the page threw: ${errors[0]}`);
          result = { round: tour.round, station: name, ok: true, seconds: 0 };
        } catch (e) {
          const skipped = e instanceof Skip;
          result = { round: tour.round, station: name, ok: skipped ? "skipped" : false, why: (e as Error).message, seconds: 0 };
          if (!skipped) failed = true;
        }
        want.act = want.jump = false;
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
      console.log(`[tour] round ${tour.round}: ${ok}/${stations.length} ok`);
      // Its own saved game: start it anew once there is nothing left to build with or into.
      const b = build();
      if (b && (b.state.dam.length >= SLOTS || world.trees!.every((_, i) => b.state.trees[i]?.fell !== undefined))) {
        console.log("[tour] the saved game is used up: starting it anew");
        b.reset();
        return;
      }
    }
  })();

  return {
    update(dt) {
      // Photo mode pauses the world but not the tour; the pause menu holds both.
      if (stage.paused && !document.body.classList.contains("photo")) return;
      // The camera swings round behind the beaver while it goes somewhere, so the way ahead is in the picture.
      if (want.to && !stage.paused) {
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
const fmt = (v: THREE.Vector3) => `${v.x.toFixed(1)}, ${v.z.toFixed(1)}`;
