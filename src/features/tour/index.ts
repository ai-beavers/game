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
// sticks a visit (in fast mode half a dam a round), then the lodge, then the food cache; only when the cache is
// stocked, or (not live) no wood is left, it starts anew (a reload). A station whose feature is missing (a lab page without sky) is skipped.
// Stations marked stream false test the player's controls (menus, a pad): the live stream leaves them out.
//
// Where the stations live: src/features/tour/stations/, one file per feature or activity, each a function that takes
// the Kit (kit.ts: walkTo, reach, until, expect, after, the dam work, ...) and returns its Station[] (live.ts). This
// file holds the round loop, the live camera and the label (live: the beaver's reason for what it does, live.ts), and STATIONS below puts the files together in order. A
// station for a feature that has a file goes into that file, where it belongs in the order; a new feature adds one
// file and one entry in STATIONS. Live, a station with an activity joins that activity; one without is its own.
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Overlay, onViewport, box, hudLayout } from "../hud/overlay.ts";
import type { CreateFeature } from "../../game.ts";
import { bodyPoints, direct, enter, eyeAt, framing, glide, inside, KEEP_OUT, liveDirector, newHold, reason, shotFor, sight, type Choice, type Moment, type Volume, type XYZ } from "./live.ts";
import { fader, occluders } from "./clearview.ts";
import { RAPIER } from "../../engine.ts";
import { CACHE, LODGE, SLOTS, STICKS } from "../build/rules.ts";
import { createKit, Skip } from "./kit.ts";
import { movement } from "./stations/movement.ts";
import { dam } from "./stations/dam.ts";
import { pondPatrol } from "./stations/pond.ts";
import { anger } from "./stations/anger.ts";
import { skyWatch } from "./stations/sky.ts";
import { hud } from "./stations/hud.ts";
import { controls } from "./stations/controls.ts";
import { views } from "./stations/views.ts";
import { firstSteps } from "./stations/first-steps.ts";
import { hat } from "./stations/hat.ts";
import { trading } from "./stations/trade.ts";
import { sitAndCrawl } from "./stations/sit-crawl.ts";
import { shopping } from "./stations/shop.ts";

// ---- the stations, in order ----
const STATIONS = [movement, dam, trading, pondPatrol, anger, hat, sitAndCrawl, shopping, skyWatch, hud, controls, views, firstSteps];

const PAUSE = 1.2; // s between stations
const FAST = 4; // ?tour=fast: the world runs this many times faster than real time (stage.timeScale)
// The live camera glides to its next shot, eased in and out, never faster than these: calm on a stream.
const GLIDE = 0.8, TURN = 0.4, TILT = 0.15, DOLLY = 0.8, PAN = 0.6; // 1/s; rad/s round and up, m/s in and out, m/s of its aim
const LOOK = 0.7; // m above the feet the live camera turns round (src/player/camera.ts LOOK_HEIGHT)
const TOWARD = 0.45, REACH = 1.2; // the live picture is moved this share towards what the beaver works on, at most m
const LEAD = 1.2; // m: the live camera looks this far ahead of a walking beaver
const DUCKS_BACK = 120; // s after animals were startled until the ducks count as back on the pond

export const create: CreateFeature = (game) => {
  const params = new URLSearchParams(location.search);
  const mode = params.get("tour");
  if (mode === null) return {};
  const { player, world, stage, events } = game, fast = mode === "fast";
  if (fast) stage.timeScale = FAST;
  // A feature run may request prerequisite stations followed by the new behavior.
  const requested = params.getAll("station");
  const kit = createKit(game, mode, requested);
  const { want, build, pond, standingTrees, loose, regrowing, wait } = kit, aimAt = new Vector3();

  let clock = 0, startledAt = -Infinity; // s of the game's time; when animals last fled (the ducks fly off)
  events.on("startled", () => { startledAt = clock; });

  const stations = STATIONS.flatMap((group) => group(kit));
  const focused = requested.length ? requested.map(name => {
    const station = stations.find(([candidate]) => candidate === name);
    if (!station) throw new Error("Unknown tour station: " + name);
    return station;
  }) : undefined;
  const live = kit.live, shown: Record<string, number> = {};
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

  /** Live: why the beaver does this now, in its own words (live.ts: reason), and how far the long work is, so viewers
   *  see the dam grow over the hour. */
  let why = "";
  const caption = () => {
    const n = build()?.state.dam.length ?? 0, line = why;
    if (tour.activity !== "Dam work") return line;
    return line + (n < SLOTS ? ` · ${n} of ${SLOTS}` : n < SLOTS + LODGE ? ` · lodge ${n - SLOTS} of ${LODGE}` : ` · cache ${n - SLOTS - LODGE} of ${CACHE}`);
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
      const moment: Moment = { now: clock, shown, previous: tour.activity, hour: game.sky?.hour, weather: game.sky?.weather, ducks: clock - startledAt > DUCKS_BACK, carrying: !!player.carrying, day: Date.now() };
      const itinerary = live ? liveDirector(stations.filter(([name, , activity, stream]) => {
        if (stream === false) return false;
        if (name === "Regrow a tree") return !!regrowing();
        if (activity !== "Dam work") return true;
        if (!b || placed >= STICKS) return false;
        if (name === "Build the dam") return placed < SLOTS;
        if (name === "Build the lodge") return placed >= SLOTS && placed < SLOTS + LODGE;
        if (name === "Stock the cache") return placed >= SLOTS + LODGE;
        if (player.carrying) return false;
        if (name === "Carry a stick") return loose().length > 0;
        return canFell; // fell a tree and gnaw it into wood
      }), moment) : focused ?? stations;
      if (live) { shown[tour.activity = itinerary[0]![2] ?? itinerary[0]![0]] = clock; why = reason(tour.activity, moment); }
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
        kit.subject = undefined;
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
      // Its own saved game: start it anew once the cache is stocked; in a test also once no wood is left (live waits for
      // the trees to grow back).
      if (b && (b.state.dam.length >= STICKS || (!live && !player.carrying && (kit.usedUp || (!loose().length && !standingTrees(b).length))))) {
        console.log(`[tour] the saved game is ${b.state.dam.length >= STICKS ? "done: the cache is stocked" : "used up"}: starting it anew`);
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
        // Live: the camera is held as a player holds it, behind the beaver, and an activity turns it only to show what
        // it does (live.ts: its shot); yaw, height, distance and aim glide there over seconds, so a new activity or a
        // stop to gnaw is a slow camera move, never a cut. Rounds alternate the side a shot from the side is taken from.
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
        const goal = framing(behind, shot, sign, hold.choice), s = kit.subject?.(), lead = walking ? LEAD : 0; // looks a little ahead of where it walks
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
      kit.resume(dt);
    },
  };
};
