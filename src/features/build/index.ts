// The build feature: what a beaver does. Hold E at a tree to gnaw it until it falls; hold E at the fallen tree to
// break it into logs and sticks; carry sticks to the building site by the pond and press E there to build each into
// the dam (30 sticks). A small goals panel leads through it; the pond rises with each stick, and at the end a lodge
// rises out of it.
//
//   import { create as build } from "./features/build/index.ts";     createGame(canvas, [build])
//
// Everything that changes the world lives in one plain state object (rules.ts), changed only by named changes
// through commit(): those are saved in localStorage ("beaver.build") and told to others as the event "buildChange"
// (remote false); a change from another player comes back in the same event with remote true.
//
// Debug, for bun shot --eval (window.build): build.at(i) stands at tree i facing it · build.fell(i) · build.split(i)
// · build.fill(n) puts n sticks into the dam · build.toSite() stands at the dam with a stick in hand · build.reset()
// forgets everything and reloads · build.state · build.trees() lists them by distance · build.keepLying() keeps where
// the loose wood lies now (it is also kept every few seconds and when the page goes).
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Scalar } from "@babylonjs/core/Maths/math.scalar.js";
import type { Stick } from "../../contracts.ts";
import type { CreateFeature } from "../../game.ts";
import type { Offer } from "../../player/index.ts";
import { waterOf } from "../../world/water.ts";
import { apply, BITE_TIME, BITES_TO_SPLIT, bitesToFell, type BuildChange, DAM, goals, load, pondLevel, pondRise, SLOTS, woodFrom } from "./rules.ts";
import { createDam } from "./dam.ts";
import { goalsPanel } from "./panel.ts";
import { BITE_HEIGHT, measure, takeTree, type TreeView } from "./tree.ts";

// The tour (src/features/tour) plays a saved game of its own, so it never uses up the one someone plays.
const KEY = new URLSearchParams(location.search).has("tour") ? "beaver.build.tour" : "beaver.build";
// Where the loose wood lies (the world's sticks, and the logs and sticks of felled trees), by name: kept apart from
// the state, because physics moves it every step (no named change) and each player's copy rolls its own way.
const LOOSE_KEY = `${KEY}.loose`;
const KEEP_EVERY = 3; // s between keeping where the loose wood lies
const BUILD_TIME = 1.3; // s for laying one stick; it leaves the hand half way
const FLIGHT = 0.45; // s from the hand to its place
const REACH = 0.6; // m from the beaver's body to the bark it can gnaw

export const create: CreateFeature = (game) => {
  const { world, stage, player, events } = game;
  if (!world.trees || !world.site || !world.pond || !world.addLoose || !world.removeLoose || !world.props) return {};
  const addLoose = world.addLoose, removeLoose = world.removeLoose;
  const water = waterOf(stage.scene), full = world.waterLevel;
  const pondTo = (placed: number, smooth = true) => water?.setLevel(pondLevel(full, placed), smooth);
  let state = load(localStorage.getItem(KEY));
  pondTo(state.dam.length, false); // at once, before the features after this one look at the water
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* not kept, still played */ } };
  const panel = goalsPanel(), dam = createDam(stage, world), views = new Map<number, TreeView>();
  const view = (i: number) => views.get(i) ?? views.set(i, takeTree(stage, world, i)).get(i)!;

  // Every stick has a name, so the dam can say which ones it holds: the world's own by their order, the wood of a
  // tree by tree and number (logs too, so where they lie can be kept).
  const names = new Map<Stick, string>(), byName = new Map<string, Stick>();
  const name = (stick: Stick, id: string) => { names.set(stick, id); byName.set(id, stick); };
  world.sticks.forEach((stick, i) => name(stick, `w${i}`));

  const UP = new Vector3(0, 1, 0);
  const pose = (along: Vector3, yaw: number) => Quaternion.RotationAxis(UP, Math.atan2(along.x, along.z) + yaw);

  /** The wood a lying tree breaks into, as loose things: logs to push, sticks to carry (those not in the dam). */
  const spawnWood = (i: number, line: { from: Vector3; along: Vector3 }) => {
    const m = measure(world.trees![i]!), flat = new Vector3(line.along.x, 0, line.along.z).normalize(), side = new Vector3(-flat.z, 0, flat.x);
    let logs = 0, sticks = 0;
    woodFrom(i, m.trunk, m.radius).forEach((piece, k) => {
      const id = `t${i}:${k}`;
      if (piece.kind === "stick" && state.dam.includes(id)) return;
      const at = line.from.add(flat.scale(piece.along)).add(side.scale(piece.side));
      at.y = world.heightAt(at.x, at.z) + piece.thickness / 2 + 0.03;
      const size = new Vector3(piece.thickness, piece.thickness, piece.length);
      const thing = addLoose(piece.kind, piece.variant, size, at, pose(flat, piece.turn), piece.kind === "log" ? 25 * piece.length : 0.3);
      name(thing, id);
      if (piece.kind === "stick") sticks++; else logs++;
    });
    return { logs, sticks };
  };

  /** A stick mesh for a name, taken out of the world (it is going into the dam). */
  const stickMesh = (id: string) => {
    let stick = byName.get(id);
    if (!stick || !world.sticks.includes(stick)) {
      const [, tree, k] = id.match(/^t(\d+):(\d+)$/) ?? [];
      const piece = tree !== undefined ? woodFrom(+tree, measure(world.trees![+tree]!).trunk, 0.2)[+k!] : undefined;
      const size = piece ? new Vector3(piece.thickness, piece.thickness, piece.length) : new Vector3(0.04, 0.04, 0.65);
      stick = addLoose("stick", piece?.variant ?? 0, size, new Vector3(0, -50, 0), new Quaternion(), 0.3);
    }
    removeLoose(stick);
    return stick.mesh;
  };

  // ---- what each change does to the world ---------------------------------------------------------------------------
  let flight: { mesh: TransformNode; from: Vector3; turn: Quaternion; slot: number; t: number } | undefined;
  let finishing = -1; // seconds since the dam was finished, while the lodge rises; -1 before

  const placed = (slot: number) => {
    dam.shape(slot + 1);
    const count = slot + 1, place = dam.slot(slot).position;
    events.emit("stickPlaced", { place, slot, count, total: SLOTS });
    pondTo(count);
    events.emit("pondLevel", { level: pondLevel(full, count), rise: pondRise(count) });
    if (count === SLOTS) {
      events.emit("damFinished", { place });
      finishing = 0;
      panel.praise("The dam holds!", "The pond is yours, and a lodge rises out of it.");
    }
  };

  const react = (c: BuildChange, handed?: TransformNode) => {
    if (c.type === "bite") {
      const t = state.trees[c.tree]!, lying = t.rest !== undefined, m = measure(world.trees![c.tree]!);
      const place = lying ? view(c.tree).crown() : world.trees![c.tree]!.place.add(new Vector3(0, BITE_HEIGHT, 0));
      events.emit("gnaw", { place, tree: c.tree, progress: lying ? t.splitBites / BITES_TO_SPLIT : Math.min(1, t.bites / bitesToFell(m.radius)) });
    } else if (c.type === "fell") {
      const direction = new Vector3(Math.sin(c.direction), 0, Math.cos(c.direction));
      view(c.tree).fall(direction);
      events.emit("treeFalls", { place: world.trees![c.tree]!.place.clone(), tree: c.tree, direction });
    } else if (c.type === "rest") {
      view(c.tree).lie(new Vector3(...c.at), new Quaternion(...c.turn));
    } else if (c.type === "split") {
      const v = view(c.tree), line = v.trunkLine(), place = v.crown();
      v.dispose();
      const { logs, sticks } = line ? spawnWood(c.tree, line) : { logs: 0, sticks: 0 };
      events.emit("treeSplits", { place, tree: c.tree, logs, sticks });
    } else if (c.type === "place") {
      const slot = state.dam.length - 1, mesh = handed ?? stickMesh(c.stick);
      if (handed) {
        mesh.setParent(null); // keeps where the hand held it
        flight = { mesh, from: mesh.position.clone(), turn: mesh.rotationQuaternion!.clone(), slot, t: 0 };
      } else {
        dam.fit(mesh, slot);
        dam.freeze(mesh);
        placed(slot);
      }
    }
  };

  /** The one way the world of this feature changes. False: the change did not fit the state and did nothing. */
  const commit = (c: BuildChange, remote = false, handed?: TransformNode) => {
    const before = goals(state);
    if (!apply(state, c)) return false;
    save();
    react(c, handed);
    if (!remote) events.emit("buildChange", { change: c, remote: false });
    goals(state).forEach((g, k) => { if (g.done && !before[k]!.done) events.emit("goalDone", { goal: g.id, text: g.text }); });
    panel.show(goals(state));
    return true;
  };
  events.on("buildChange", ({ change, remote }) => { if (remote) commit(change, true); });
  events.on("pickup", () => void commit({ type: "find" }));

  // ---- the saved game, put back ---------------------------------------------------------------------------------
  const restore = () => {
    for (const [key, t] of Object.entries(state.trees)) {
      const i = +key;
      if (t.fell === undefined) continue; // bites only: drawn by update()
      const v = view(i);
      if (t.rest) v.lie(new Vector3(...t.rest.at), new Quaternion(...t.rest.turn));
      else v.fall(new Vector3(Math.sin(t.fell), 0, Math.cos(t.fell))); // saved mid-fall: it falls again
      if (t.split) { const line = v.trunkLine(); v.dispose(); if (line) spawnWood(i, line); }
    }
    state.dam.forEach((id, slot) => {
      const mesh = stickMesh(id);
      dam.fit(mesh, slot);
      dam.freeze(mesh);
    });
    dam.shape(state.dam.length);
    if (state.dam.length >= SLOTS) { dam.lodge(1); finishing = 99; }
    panel.show(goals(state));
  };
  restore();

  // Where the loose wood lay at the last visit: put back (wood in the dam or in a hand is left out).
  type Lying = Record<string, [number, number, number, number, number, number, number]>;
  const keepLying = () => {
    const lying: Lying = {};
    for (const [thing, id] of names) if (!state.dam.includes(id) && thing !== player.carrying && thing.body.isEnabled()) {
      const t = thing.body.translation(), q = thing.body.rotation();
      lying[id] = [t.x, t.y, t.z, q.x, q.y, q.z, q.w];
    }
    try { localStorage.setItem(LOOSE_KEY, JSON.stringify(lying)); } catch { /* not kept, still played */ }
  };
  try {
    const lying = JSON.parse(localStorage.getItem(LOOSE_KEY) ?? "{}") as Lying;
    for (const [id, pose] of Object.entries(lying)) {
      const thing = byName.get(id), [x, y, z, qx, qy, qz, qw] = pose;
      if (!thing || state.dam.includes(id) || pose.length !== 7 || !pose.every(Number.isFinite)) continue;
      thing.body.setTranslation({ x, y, z }, true);
      thing.body.setRotation({ x: qx, y: qy, z: qz, w: qw }, true);
      thing.mesh.position.set(x, y, z);
      thing.mesh.rotationQuaternion!.set(qx, qy, qz, qw);
    }
  } catch { /* nothing kept, or broken: where the world puts them */ }
  addEventListener("pagehide", keepLying);
  let sinceKept = 0;

  // ---- E: gnaw and build ------------------------------------------------------------------------------------------
  type Job = { kind: "gnaw"; tree: number; timer: number } | { kind: "build"; progress: number };
  let job: Job | undefined;
  const feet = player.feet;

  /** The nearest tree in reach to gnaw: standing, or lying still and not yet wood. */
  const gnawTarget = () => {
    let best: { tree: number; face: number; gap: number } | undefined;
    world.trees!.forEach((tree, i) => {
      const t = state.trees[i];
      if (t?.split) return;
      let point: Vector3, radius: number;
      if (t?.fell === undefined) { point = tree.place; radius = measure(tree).radius; }
      else {
        const line = t.rest ? views.get(i)?.trunkLine() : undefined;
        if (!line) return; // still falling
        const k = Scalar.Clamp(feet.clone().subtract(line.from).dot(line.along), 0, measure(tree).trunk);
        point = line.from.add(line.along.scale(k));
        if (point.y - feet.y > 1.1 || point.y - feet.y < -0.4) return;
        radius = measure(tree).radius;
      }
      const gap = Math.hypot(point.x - feet.x, point.z - feet.z) - radius;
      if (gap < REACH && (!best || gap < best.gap)) best = { tree: i, face: Math.atan2(point.x - feet.x, point.z - feet.z), gap };
    });
    return best;
  };
  const atDam = () => {
    const local = feet.clone().subtract(dam.frame.origin).applyRotationQuaternion(Quaternion.Inverse(dam.frame.turn));
    return Math.abs(local.x) < DAM.base + 1 && Math.abs(local.z) < DAM.length / 2 + 0.7;
  };

  /** What E starts here: building in the carried stick, or gnawing the nearest tree (standing, or lying: split). */
  const choice = (carrying: boolean) => {
    if (carrying) return state.dam.length >= SLOTS || flight || !atDam() ? undefined : { kind: "build" as const };
    const target = gnawTarget();
    return target && { kind: "gnaw" as const, target, lying: state.trees[target.tree]?.fell !== undefined };
  };
  player.actor = {
    begin(carrying) {
      const c = choice(carrying);
      if (!c) return undefined;
      if (c.kind === "build") {
        job = { kind: "build", progress: 0 };
        const to = dam.slot(state.dam.length).position;
        return { action: "build", face: Math.atan2(to.x - feet.x, to.z - feet.z) };
      }
      job = { kind: "gnaw", tree: c.target.tree, timer: 0 };
      return { action: "gnaw", face: c.target.face };
    },
    offer(carrying): Offer | undefined {
      const c = choice(carrying);
      if (!c) return undefined;
      if (c.kind === "build") return { action: "build", text: "Build into dam" };
      return c.lying ? { action: "split", text: "Gnaw into wood" } : { action: "gnaw", text: "Gnaw tree" };
    },
    step(dt, held) {
      if (job?.kind === "gnaw") {
        const i = job.tree, before = state.trees[i];
        if (!held || before?.split || (before?.fell !== undefined && !before.rest)) return (job = undefined);
        if ((job.timer += dt) < BITE_TIME) return progressOf(i);
        job.timer -= BITE_TIME;
        commit({ type: "bite", tree: i });
        const t = state.trees[i]!;
        if (t.fell === undefined && t.bites >= bitesToFell(measure(world.trees![i]!).radius)) {
          const at = world.trees![i]!.place;
          commit({ type: "fell", tree: i, direction: Math.atan2(at.x - feet.x, at.z - feet.z) });
          return (job = undefined);
        }
        if (t.rest && t.splitBites >= BITES_TO_SPLIT) { commit({ type: "split", tree: i }); return (job = undefined); }
        return progressOf(i);
      }
      if (job?.kind === "build") {
        const before = job.progress;
        job.progress = Math.min(1, before + dt / BUILD_TIME);
        if (before < 0.5 && job.progress >= 0.5) {
          const stick = player.handOver();
          if (stick) {
            const id = names.get(stick) ?? `x${Date.now().toString(36)}`;
            removeLoose(stick);
            commit({ type: "place", slot: state.dam.length, stick: id }, false, stick.mesh);
          }
        }
        if (job.progress >= 1) return (job = undefined);
        return job.progress;
      }
      return undefined;
    },
  };

  /** How far tree i is towards falling (standing) or breaking (lying), with the bite under way. */
  const progressOf = (i: number) => {
    const t = state.trees[i], timer = job?.kind === "gnaw" && job.tree === i ? job.timer / BITE_TIME : 0;
    if (t?.rest) return Math.min(1, (t.splitBites + timer) / BITES_TO_SPLIT);
    return Math.min(1, ((t?.bites ?? 0) + timer) / bitesToFell(measure(world.trees![i]!).radius));
  };

  // ---- debug --------------------------------------------------------------------------------------------------------
  const standAt = (i: number) => {
    const tree = world.trees![i]!, m = measure(tree);
    // from the side facing the clearing, so it falls outwards
    const toMiddle = new Vector3(-tree.place.x, 0, -tree.place.z).normalize();
    const at = tree.place.add(toMiddle.scale(m.radius + 0.3));
    player.teleport(at.x, world.heightAt(at.x, at.z), at.z, Math.atan2(-toMiddle.x, -toMiddle.z));
    player.camera.yaw = Math.atan2(-toMiddle.x, -toMiddle.z) + Math.PI + 0.6;
    return { tree: i, at: at.asArray().map((v) => +v.toFixed(2)) };
  };
  Object.assign(window, {
    build: {
      get state() { return state; },
      commit,
      at: standAt,
      fell(i: number) {
        const at = world.trees![i]!.place, need = bitesToFell(measure(world.trees![i]!).radius);
        while ((state.trees[i]?.bites ?? 0) < need) commit({ type: "bite", tree: i });
        return commit({ type: "fell", tree: i, direction: Math.atan2(at.x - feet.x, at.z - feet.z) });
      },
      /** Lays a falling tree down where it is now, and breaks it into wood. */
      split(i: number) {
        const v = views.get(i), body = v?.body;
        if (body && !state.trees[i]?.rest) {
          const p = body.translation(), q = body.rotation();
          commit({ type: "rest", tree: i, at: [p.x, p.y, p.z], turn: [q.x, q.y, q.z, q.w] });
        }
        return commit({ type: "split", tree: i });
      },
      fill(n: number) { while (state.dam.length < Math.min(SLOTS, n)) commit({ type: "place", slot: state.dam.length, stick: `d${state.dam.length}` }); return state.dam.length; },
      toSite() {
        const o = dam.frame.origin.add(dam.frame.across.scale(-1.25));
        player.teleport(o.x, world.heightAt(o.x, o.z), o.z, Math.atan2(dam.frame.across.x, dam.frame.across.z));
        player.camera.yaw = Math.atan2(dam.frame.across.x, dam.frame.across.z) + Math.PI + 0.7;
      },
      trees: () => world.trees!.map((t, i) => ({ i, d: +Math.hypot(t.place.x - feet.x, t.place.z - feet.z).toFixed(1), r: +measure(t).radius.toFixed(2), trunk: +measure(t).trunk.toFixed(1), ...state.trees[i] })).sort((a, b) => a.d - b.d),
      reset() { removeEventListener("pagehide", keepLying); localStorage.removeItem(KEY); localStorage.removeItem(LOOSE_KEY); state = load(null); location.reload(); },
      keepLying,
      dam,
      views,
    },
  });

  return {
    step(dt) {
      for (const [i, v] of views) {
        const event = v.step(dt);
        if (event === "landed") {
          const b = v.body!.angvel();
          events.emit("treeLands", { place: v.crown(), tree: i, speed: Math.hypot(b.x, b.y, b.z) * measure(world.trees![i]!).crownHeight });
        } else if (event === "rest") {
          const p = v.body!.translation(), q = v.body!.rotation();
          commit({ type: "rest", tree: i, at: [p.x, p.y, p.z], turn: [q.x, q.y, q.z, q.w] });
        }
      }
    },
    update(dt) {
      const moving = stage.paused ? 0 : dt;
      if ((sinceKept += moving) > KEEP_EVERY) { sinceKept = 0; keepLying(); }
      // The bite in each standing tree that has been bitten, growing smoothly while the beaver gnaws.
      for (const [key, t] of Object.entries(state.trees)) if (t.fell === undefined && (t.bites > 0 || (job?.kind === "gnaw" && job.tree === +key)))
        view(+key).bite(progressOf(+key));
      if (job?.kind === "gnaw" && !views.has(job.tree) && state.trees[job.tree]?.fell === undefined) view(job.tree).bite(progressOf(job.tree));
      // The stick on its way from the hand to its place: a little arc, turning into place.
      if (flight) {
        flight.t = Math.min(1, flight.t + moving / FLIGHT);
        const to = dam.slot(flight.slot), e = flight.t * flight.t * (3 - 2 * flight.t);
        Vector3.LerpToRef(flight.from, to.position, e, flight.mesh.position).y += Math.sin(Math.PI * flight.t) * 0.15;
        Quaternion.SlerpToRef(flight.turn, to.quaternion, e, flight.mesh.rotationQuaternion!);
        Vector3.LerpToRef(Vector3.One(), dam.laid, e, flight.mesh.scaling);
        if (flight.t >= 1) { dam.fit(flight.mesh, flight.slot); dam.freeze(flight.mesh); const slot = flight.slot; flight = undefined; placed(slot); }
      }
      if (finishing >= 0 && finishing < 4) { finishing += moving; dam.lodge(finishing / 3.5); }
    },
  };
};
