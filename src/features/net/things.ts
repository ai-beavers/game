import { holdInHand } from "../../player/grip.ts";
// The loose things (sticks, crates, logs) shared between players. One player, the host, simulates them and sends
// where they are; everyone else turns their copies into kinematic bodies that follow, so the local beaver still bumps
// into them. Alone (no server, or the connection lost) every copy is dynamic again, as in the single-player game.
//
//   const things = createThings(game, buildState);
//   things.setMode("host" | "guest" | "alone");
//   host:  things.places(all) → Place[] to send;  things.push(id, nx, nz, speed, from) for a guest pushing a crate
//   guest: things.receive(places) on each update; things.update() once a frame moves the copies
//   host:  things.receive(places) puts them there at once (the server's, to a host that followed nobody)
//   things.hold(id, holder) / things.release(place, velocity)   a stick in another player's hand, and where it went
//   things.split(tree, state)   after a tree broke into wood (event treeSplits): the new things get their ids
//   things.sync()               after anything may have taken a stick out of the world (into the dam, or traded)
//
// Things come and go while playing: the build feature adds wood (world.addLoose) and takes sticks into the dam
// (world.removeLoose). Each has the same id in every browser (protocol.ts: the world's sticks, crates, then each
// tree's wood piece by piece), worked out from the build state: which sticks went into the dam, which trees are
// wood, in the order the build feature adds them.
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Stick } from "../../contracts.ts";
import { dynamic, enable, isEnabled, place, PhysicsShapeType, simulate, type PhysicsBody } from "../../physics.ts";
import type { Game } from "../../game.ts";
import type { BuildState } from "../build/rules.ts";
import { used, woodFrom } from "../build/rules.ts";
import { measure } from "../build/tree.ts";
import { CRATES, woodId, type Place } from "./protocol.ts";
import { DELAY, Track } from "./track.ts";

export type Mode = "alone" | "host" | "guest";
/** Another player's beaver: its hand, and the node that turns it the way it faces. */
export interface Holder { hand: TransformNode; node: TransformNode }

const MOVED = 0.002; // m (or quaternion units): less than this since the last send is not sent again
const PUSH_REACH = 1.5; // m from the pusher's feet to the crate's middle, at most

/** A dynamic body bound to a mesh with one box shape: half extents, or undefined. */
const box = (body: PhysicsBody) => {
  if (!dynamic(body) || body.shape?.type !== PhysicsShapeType.BOX) return undefined;
  return body.shape.getBoundingBox().extendSize;
};
/** Crates are not in World: they are the bound boxes of 0.5 m. */
const isCrate = (h: Vector3) => [h.x, h.y, h.z].every((v) => Math.abs(v - 0.25) < 0.01);

/** The wood a split tree gives, as ids in the order the build feature adds it: sticks (those not in the dam nor
 *  traded), logs. */
function woodOf(game: Game, tree: number, state: BuildState) {
  const sticks: number[] = [], logs: number[] = [], t = game.world.trees?.[tree];
  if (!t) return { sticks, logs };
  const m = measure(t);
  woodFrom(tree, m.trunk, m.radius).forEach((piece, k) => {
    if (piece.kind === "log") logs.push(woodId(tree, k));
    else if (!used(state, `t${tree}:${k}`)) sticks.push(woodId(tree, k));
  });
  return { sticks, logs };
}

/** state: the build feature's world as it was put back when the game started; undefined without that feature. */
export function createThings(game: Game, state?: BuildState) {
  const { stage, world } = game;
  const things = new Map<number, Stick>(), ids = new Map<PhysicsBody, number>(), sticks = new Map<Stick, number>();
  const tracks = new Map<number, Track>(), sent = new Map<number, number[]>();
  const held = new Map<number, Holder>(); // stick id → the other player holding it
  let mode: Mode = "alone";

  const follower = (thing: Stick) => {
    simulate(thing.body, mode !== "guest");
  };
  const add = (id: number, thing: Stick, pickable: boolean) => {
    things.set(id, thing); ids.set(thing.body, id);
    if (pickable) sticks.set(thing, id);
    tracks.set(id, new Track({ quaternion: 3 }));
    sent.set(id, []);
    if (mode === "guest") follower(thing);
  };
  /** Boxes bound to a mesh that are not yet known, not sticks, not crates: logs, in the order they were added. */
  const newLogs = () => [...stage.bound.values()].filter((body) => {
    const h = box(body);
    return h && !ids.has(body) && !isCrate(h) && Math.abs(h.x - h.y) < 1e-3 && !world.sticks.some((s) => s.body === body);
  });
  const meshOf = (body: PhysicsBody) => [...stage.bound].find(([, b]) => b === body)?.[0];

  // What the game started with: the world's sticks not in the dam, then the wood of each split tree; the crates.
  {
    const wood = { sticks: [] as number[], logs: [] as number[] };
    if (state) for (const [key, t] of Object.entries(state.trees)) if (t.split) {
      const w = woodOf(game, +key, state);
      wood.sticks.push(...w.sticks); wood.logs.push(...w.logs);
    }
    const own = world.sticks.length - wood.sticks.length;
    if (own < 0) console.warn("net: the sticks do not match the build state; wood is not shared");
    const inDam = new Set([...state?.dam ?? [], ...state?.traded ?? []].map((n) => /^w(\d+)$/.exec(n)?.[1]).filter((n) => n !== undefined).map(Number));
    const order: number[] = [];
    for (let i = 0; order.length < Math.max(0, own); i++) if (!inDam.has(i)) order.push(i);
    if (own >= 0) order.push(...wood.sticks);
    order.forEach((id, j) => add(id, world.sticks[j]!, true));
    const crates = [...stage.bound].filter(([, body]) => { const h = box(body); return h && isCrate(h); }); // as the world made them
    crates.forEach(([mesh, body], c) => add(CRATES + c, { mesh, body }, false));
    const logs = newLogs();
    if (logs.length === wood.logs.length) logs.forEach((body, k) => add(wood.logs[k]!, { mesh: meshOf(body)!, body }, false));
    else if (logs.length) console.warn("net: the logs do not match the build state; they are not shared");
  }

  const placeOf = (id: number): Place => {
    const node = things.get(id)!.body.transformNode, at = node.position, q = node.rotationQuaternion!, r = (v: number) => Math.round(v * 1e4) / 1e4;
    return [id, r(at.x), r(at.y), r(at.z), r(q.x), r(q.y), r(q.z), r(q.w)];
  };
  const turn = new Quaternion();
  const put = (thing: Stick, p: ArrayLike<number>, from = 1) => {
    place(thing.body, { x: p[from]!, y: p[from + 1]!, z: p[from + 2]! }, turn.set(p[from + 3]!, p[from + 4]!, p[from + 5]!, p[from + 6]!)); // its mesh with it
  };

  const shown = [0, 0, 0, 0, 0, 0, 0];
  return {
    get mode() { return mode; },
    get size() { return things.size; },
    get: (id: number) => things.get(id),
    has: (id: number) => things.has(id),
    /** The id of a stick that can be picked up, -1 for none. */
    idOf: (stick: Stick | undefined) => (stick && sticks.get(stick)) ?? -1,
    idOfBody: (body: PhysicsBody | null | undefined) => (body && ids.get(body)) ?? -1,
    setMode(next: Mode) {
      if (next === mode) return;
      mode = next;
      for (const [id, thing] of things) {
        follower(thing);
        if (mode !== "guest") { thing.body.setLinearVelocity(Vector3.ZeroReadOnly); thing.body.setAngularVelocity(Vector3.ZeroReadOnly); }
        tracks.get(id)!.clear();
        sent.set(id, []);
      }
    },

    /** A tree just broke into wood: the things it gave get their ids (state: the build state after the split). */
    split(tree: number, state: BuildState) {
      // A tree grown back breaks into its first one's pieces, moved, not new (build/index.ts): those keep their ids.
      const all = woodOf(game, tree, state), wood = { sticks: all.sticks.filter((id) => !things.has(id)), logs: all.logs.filter((id) => !things.has(id)) };
      const fresh = world.sticks.filter((s) => !sticks.has(s) && !s.mesh.metadata?.local), logs = newLogs();
      if (fresh.length !== wood.sticks.length || logs.length !== wood.logs.length) console.warn("net: the wood of tree", tree, "does not match; partly shared");
      fresh.forEach((thing, k) => { if (wood.sticks[k] !== undefined) add(wood.sticks[k]!, thing, true); });
      logs.forEach((body, k) => { if (wood.logs[k] !== undefined) add(wood.logs[k]!, { mesh: meshOf(body)!, body }, false); });
    },
    /** Forgets every stick that is no longer in the world (built into the dam, or traded): its body is gone. Returns
     *  their ids. */
    sync() {
      const here = new Set(world.sticks), gone: number[] = [];
      for (const [thing, id] of sticks) if (!here.has(thing)) {
        sticks.delete(thing); things.delete(id); ids.delete(thing.body); tracks.delete(id); sent.delete(id); held.delete(id);
        gone.push(id);
      }
      return gone;
    },
    /** A stick another player holds goes into the dam: out of the hand into the scene where it is, for the build
     *  feature to take. */
    letGo(id: number) {
      const thing = things.get(id);
      if (!thing || !held.delete(id)) return;
      thing.mesh.setParent(null);
    },

    /** Host: what moved since the last call (every thing with `all`), except things in someone's hand. */
    places(all: boolean): Place[] {
      const out: Place[] = [];
      for (const [id, thing] of things) {
        if (!isEnabled(thing.body) || held.has(id)) continue;
        const p = placeOf(id), last = sent.get(id)!;
        if (!all && last.length && p.every((v, i) => i === 0 || Math.abs(v - last[i]!) < MOVED)) continue;
        sent.set(id, p);
        out.push(p);
      }
      return out;
    },

    /** Guest: the host says where things are. */
    receive(places: Place[], now = performance.now()) {
      // To a host only the server speaks: where the things lay before this player came in as the first.
      if (mode === "host") for (const p of places) { const thing = things.get(p[0]); if (thing && isEnabled(thing.body) && !held.has(p[0])) put(thing, p); }
      if (mode !== "guest") return;
      for (const p of places) tracks.get(p[0])?.push(now, p.slice(1));
    },

    /** Host: a guest at `from` pushes crate id towards (nx, nz) at `speed` m/s; given once a physics step. */
    push(id: number, nx: number, nz: number, speed: number, from: Vector3) {
      const thing = things.get(id), length = Math.hypot(nx, nz);
      if (mode !== "host" || !thing || !dynamic(thing.body) || !isEnabled(thing.body) || length < 0.1) return;
      const at = thing.body.transformNode.position;
      if (Math.hypot(at.x - from.x, at.z - from.z) > PUSH_REACH) return; // only what is next to the pusher
      const v = thing.body.getLinearVelocity(), along = (v.x * nx + v.z * nz) / length, more = Math.min(3, speed) - along;
      if (more <= 0) return;
      const impulse = (thing.body.getMassProperties().mass ?? 1) * more;
      thing.body.applyImpulse(new Vector3(nx / length * impulse, 0, nz / length * impulse), at);
    },

    /** Another player holds stick id in this hand: out of the simulation, drawn in the hand until release. */
    hold(id: number, holder: Holder) {
      const thing = things.get(id);
      if (!thing) return;
      enable(thing.body, false);
      stage.unbind(thing.mesh);
      held.set(id, holder);
      thing.mesh.parent = holder.hand;
    },
    /** It was let go here: back in the world, simulated by the host, followed by guests. */
    release(place: Place, velocity?: [number, number, number]) {
      const id = place[0], thing = things.get(id);
      if (!thing) return;
      if (held.has(id)) { held.delete(id); thing.mesh.parent = null; thing.mesh.scaling.setAll(1); }
      enable(thing.body, true);
      put(thing, place);
      stage.bind(thing.mesh, thing.body);
      tracks.get(id)!.clear();
      if (mode === "guest") tracks.get(id)!.push(performance.now() - DELAY, place.slice(1));
      else if (velocity) thing.body.setLinearVelocity(new Vector3(velocity[0], velocity[1], velocity[2]));
    },
    /** Where a held stick is now, to let it go there (its holder left). */
    placeInHand(id: number): Place | undefined {
      const mesh = things.get(id)?.mesh;
      if (!mesh || !held.has(id)) return;
      mesh.computeWorldMatrix(true);
      const p = mesh.absolutePosition, q = mesh.absoluteRotationQuaternion;
      return [id, p.x, Math.max(p.y, game.world.heightAt(p.x, p.z) + 0.1), p.z, q.x, q.y, q.z, q.w];
    },
    isHeld: (id: number) => held.has(id),

    /** Once a frame: guests' copies follow, held sticks sit in their hands. */
    update() {
      const now = performance.now() - DELAY;
      if (mode === "guest") for (const [id, thing] of things) {
        const track = tracks.get(id)!;
        if (!isEnabled(thing.body) || held.has(id) || !track.samples.length) continue;
        put(thing, track.at(now, shown), 0);
      }
      for (const [id, { hand, node }] of held) {
        holdInHand(things.get(id)!.mesh, hand, node);
      }
    },
  };
}
export type Things = ReturnType<typeof createThings>;
