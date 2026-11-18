// The trade feature: a trading post in the clearing (post.ts, place.ts) where sticks buy goods for the backpack (a
// viewer's wish). Carry a stick to a good's spot and press E: the beaver lays it on that good's pile, and the stick
// leaves the world for everyone (a "trade" build change, through the build feature: buildOf(scene).trade). When the
// pile reaches the good's price, the pile goes, the beaver takes the good, reaches over its shoulder and puts it in
// its backpack (the lantern's reach, Motion.reachBack), and the backpack row on the HUD counts it. Goods can be
// bought again and again; a traded stick comes back when its tree grows back (rules.ts "grow").
//
//   import { create as trade } from "./features/trade/index.ts";     after build: it shares E with it (firstOf)
//
// The piles and the goods are the player's own (docs/adr/0003): kept in localStorage ("beaver.trade", the tour's own
// under "beaver.trade.tour"), never sent. Event goodTraded { good, count } when a good goes into the backpack.
//
// Debug, for bun shot --eval (window.trade): trade.at("feather") stands at the feather's spot facing it (with no
// stick in the hand, one is put down right beside it: E picks it up, E again pays) · trade.state the ledger ·
// trade.reset() forgets every good and pile and reloads.
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Node } from "@babylonjs/core/node.js";
import type { CreateFeature } from "../../game.ts";
import { firstOf } from "../../player/actors.ts";
import type { Actor, Offer } from "../../player/index.ts";
import { BUILD_TIME, buildOf } from "../build/index.ts";
import { hudLayout, onViewport, Overlay } from "../hud/overlay.ts";
import { reachAt, RISE, HOLD, FALL } from "../lantern/stow.ts";
import { backpackLine, GOODS, load, offerText, pay } from "./ledger.ts";
import { FACING, spotFor, standAt } from "./place.ts";
import { createPost } from "./post.ts";

const KEY = new URLSearchParams(location.search).has("tour") ? "beaver.trade.tour" : "beaver.trade";
const FLIGHT = 0.45; // s from the hand onto the pile
const TAKE = 0.4; // s for the good from its spot into the paw
const REACH = RISE + HOLD + FALL; // s of the reach to the backpack and back

export const create: CreateFeature = (game) => {
  const { stage, world, player, events, beaver } = game;
  const build = buildOf(stage.scene);
  if (!build) return {};
  let ledger = load(localStorage.getItem(KEY));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ledger)); } catch { /* not kept, still played */ } };
  const post = createPost(stage, world);
  GOODS.forEach((good, i) => post.fill(i, ledger.paid[good.id] ?? 0));

  // ---- the backpack row on the HUD: what is in it, hidden while nothing is ------------------------------------------
  const overlay = new Overlay(stage, "backpack-row");
  let row: ReturnType<Overlay["pill"]> | undefined, shown = backpackLine(ledger);
  onViewport(stage, () => {
    overlay.clear();
    const at = hudLayout(stage);
    row = overlay.pill("backpack", at.backpack, at.small, "top");
    row.set(shown);
  });
  const showBackpack = () => { shown = backpackLine(ledger); row?.set(shown); };

  // ---- E at a spot: lay the stick on its pile -----------------------------------------------------------------------
  const feet = player.feet;
  // Head under water or afloat: the post stands on dry land, nothing is offered there.
  const spotHere = (carrying: boolean) => carrying && !job && !player.afloat ? spotFor(feet.x, feet.z) : undefined;
  let job: { spot: number; progress: number } | undefined;
  type Flight = { mesh: TransformNode; spot: number; from: Vector3; turn: Quaternion; scale: Vector3; to: ReturnType<typeof post.pileSlot>; t: number; bought: boolean };
  const flights: Flight[] = [];
  const actor: Actor = {
    begin(carrying) {
      const spot = spotHere(carrying);
      if (spot === undefined) return undefined;
      job = { spot, progress: 0 };
      return { action: "build", face: FACING };
    },
    offer(carrying): Offer | undefined {
      const spot = spotHere(carrying);
      return spot === undefined ? undefined : { action: "trade", text: offerText(ledger, GOODS[spot]!.id) };
    },
    step(dt) {
      if (!job) return undefined;
      const before = job.progress;
      job.progress = Math.min(1, before + dt / BUILD_TIME);
      if (before < 0.5 && job.progress >= 0.5) {
        const stick = player.handOver();
        if (stick && build.trade(stick)) {
          const spot = job.spot, k = post.pileSize(spot) + flights.filter((f) => f.spot === spot).length;
          const paid = pay(ledger, GOODS[spot]!.id)!;
          save();
          const mesh = stick.mesh;
          mesh.computeWorldMatrix(true);
          const from = new Vector3(), turn = new Quaternion(), scale = new Vector3();
          mesh.getWorldMatrix().decompose(scale, turn, from);
          mesh.setParent(null);
          flights.push({ mesh, spot, from, turn, scale, to: post.pileSlot(spot, k), t: 0, bought: paid.bought });
        } else stick?.mesh.dispose(); // used up already (someone else's change): gone
      }
      if (job.progress >= 1) return (job = undefined);
      return job.progress;
    },
  };
  player.actor = player.actor ? firstOf(player.actor, actor) : actor;

  // ---- a good taken: from its spot into the left paw, then over the shoulder into the backpack ---------------------------
  const paw = beaver.leftHand, chain: TransformNode[] = [];
  for (let n: Node | null = paw; n; n = n.parent) if (n instanceof TransformNode) chain.unshift(n);
  const pawAt = () => { for (const node of chain) node.computeWorldMatrix(true); return paw.getAbsolutePosition(); };
  let reached = 0; // the reach written last
  let taking: { spot: number; mesh: Mesh; from: Vector3; t: number; done: boolean } | undefined;
  const intoBackpack = (spot: number) => {
    if (!taking) return;
    taking.mesh.dispose();
    taking.done = true;
    const good = GOODS[spot]!.id;
    showBackpack();
    events.emit("goodTraded", { good, count: ledger.owned[good] ?? 0 });
  };
  const take = (spot: number) => {
    if (taking && !taking.done) intoBackpack(taking.spot); // the one before goes in at once
    const mesh = post.copy(spot);
    taking = { spot, mesh, from: mesh.position.clone(), t: 0, done: false };
  };

  // ---- debug ----------------------------------------------------------------------------------------------------------
  Object.assign(window, {
    trade: {
      get state() { return ledger; },
      at(good: string) {
        const i = GOODS.findIndex((g) => g.id === good);
        if (i < 0) return `no good "${good}": ${GOODS.map((g) => g.id).join(", ")}`;
        const s = standAt(i);
        player.teleport(s.x, world.heightAt(s.x, s.z), s.z, FACING);
        player.camera.yaw = FACING + Math.PI + 0.5;
        if (!player.carrying) {
          const stick = world.sticks.filter((w) => w.body.isEnabled()).sort((a, b) => Vector3.Distance(a.mesh.position, feet) - Vector3.Distance(b.mesh.position, feet))[0];
          const x = s.x + Math.sin(FACING) * 0.3 + Math.cos(FACING) * 0.3, z = s.z + Math.cos(FACING) * 0.3 - Math.sin(FACING) * 0.3;
          stick?.body.setTranslation({ x, y: world.heightAt(x, z) + 0.05, z }, true);
        }
        return { good, at: [+s.x.toFixed(2), +s.z.toFixed(2)] };
      },
      reset() { localStorage.removeItem(KEY); location.reload(); },
      post,
    },
  });

  return {
    update(dt) {
      const moving = stage.paused ? 0 : dt;
      // Sticks on their way from the hand onto a pile: a little arc, shrinking to their length there.
      for (const f of [...flights]) {
        f.t = Math.min(1, f.t + moving / FLIGHT);
        const e = f.t * f.t * (3 - 2 * f.t);
        Vector3.LerpToRef(f.from, f.to.position, e, f.mesh.position).y += Math.sin(Math.PI * f.t) * 0.2;
        f.mesh.rotationQuaternion ??= new Quaternion();
        Quaternion.SlerpToRef(f.turn, f.to.quaternion, e, f.mesh.rotationQuaternion);
        Vector3.LerpToRef(f.scale, new Vector3(1, 1, 1), e, f.mesh.scaling);
        if (f.t < 1) continue;
        flights.splice(flights.indexOf(f), 1);
        if (!f.bought) { post.lay(f.spot, f.mesh); continue; }
        f.mesh.dispose(); // the last stick of the price: the pile is taken in, the good comes off its spot
        post.empty(f.spot);
        take(f.spot);
      }
      if (taking) {
        const t = (taking.t += moving);
        if (!taking.done) {
          const hand = pawAt();
          if (t < TAKE) {
            const e = t / TAKE, k = e * e * (3 - 2 * e);
            Vector3.LerpToRef(taking.from, hand, k, taking.mesh.position).y += Math.sin(Math.PI * e) * 0.15;
            taking.mesh.scaling.setAll(1.6 - 0.6 * k); // the toy-sized good on the post, life-sized in the paw
          } else taking.mesh.position.copyFrom(hand);
          if (t - TAKE >= RISE) intoBackpack(taking.spot); // at the backpack: in it goes
        }
        // The reach over the shoulder, as the lantern's: the left paw up to the backpack and back down. The lantern
        // feature writes reachBack before this one each picture; the larger reach is drawn.
        const motion = player.motion;
        if (t >= TAKE && t < TAKE + REACH) motion.reachBack = reached = Math.max(motion.reachBack ?? 0, reachAt(t - TAKE));
        else if (t >= TAKE + REACH) {
          if (motion.reachBack === reached) motion.reachBack = 0;
          taking = undefined;
        }
      }
    },
  };
};
