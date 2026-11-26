// The trade feature: a trading post in the clearing (post.ts, place.ts) where sticks buy goods for the backpack (a
// viewer's wish). Carry a stick to a good's spot and press E: the beaver lays it on that good's pile, and the stick
// leaves the world for everyone (a "trade" build change, through the build feature: buildOf(scene).trade). When the
// pile reaches the good's price, the pile goes, the beaver takes the good, reaches over its shoulder and puts it in
// its backpack (the lantern's reach, Motion.reachBack), and the hotbar on the HUD counts it. Goods can be
// bought again and again; a traded stick comes back when its tree grows back (rules.ts "grow").
// The hotbar (hotbar.ts, hold.ts): slot 1 is what the beaver carries, 2 … 6 the goods. Keys 1 … 6, the d-pad's left
// and right or a tap on a slot select one: a good comes out of the backpack with the same reach into the left paw (a
// stick carried is put down first); slot 1 or the same slot again puts it back. E at a stick puts it back first
// (Player.hold). A good in the paw does nothing else yet, and only this player sees it: nothing of it is sent.
//
//   import { create as trade } from "./features/trade/index.ts";     after build: it shares E with it (firstOf)
//
// The piles and the goods are the player's own (docs/adr/0003): kept in localStorage ("beaver.trade", the tour's own
// under "beaver.trade.tour"), never sent. Event goodTraded { good, count } when a good goes into the backpack.
//
// The bakery (src/features/bakery) pays into the same ledger, and the workbench (src/features/workbench) makes goods
// in it: tradeOf(scene) gives them the ledger, save(), the goods still on their way to the backpack (not yet counted
// on the hotbar), whether their reach is under way, and useUp (the paw emptied of a good about to be used up).
//
// Debug, for bun shot --eval (window.trade): trade.at("feather") stands at the feather's spot facing it (with no
// stick in the hand, one is put down right beside it: E picks it up, E again pays) · trade.state the ledger ·
// trade.held the good in the paw · trade.reset() forgets every good and pile and reloads.
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Node } from "@babylonjs/core/node.js";
import type { CreateFeature } from "../../game.ts";
import { firstOf } from "../../player/actors.ts";
import type { Actor, Offer } from "../../player/index.ts";
import { BUILD_TIME, buildOf } from "../build/index.ts";
import { OWN_LAYER } from "../../player/camera.ts";
import { busy, reachAt, RISE, HOLD, FALL } from "../lantern/stow.ts";
import { full, newHold, shelf, SLOTS, stepHold, useUp } from "./hold.ts";
import { createHotbar, type SlotView } from "./hotbar.ts";
import { goodOf, load, offerText, pay, POST_GOODS } from "./ledger.ts";
import { FACING, spotFor, standAt } from "./place.ts";
import { createPost, goodModel } from "./post.ts";
import type { Scene } from "@babylonjs/core/scene.js";
import type { Ledger } from "./ledger.ts";
import { isEnabled, place } from "../../physics.ts";

const KEY = new URLSearchParams(location.search).has("tour") ? "beaver.trade.tour" : "beaver.trade";
const FLIGHT = 0.45; // s from the hand onto the pile
const TAKE = 0.4; // s for the good from its spot into the paw
const REACH = RISE + HOLD + FALL; // s of the reach to the backpack and back

/** What the trade feature shares with the bakery: one ledger, one backpack. */
export interface Trade {
  readonly ledger: Ledger;
  save(): void;
  /** Goods paid for but not yet in the backpack, by id: the hotbar leaves them out until they go in. */
  coming: Record<string, number>;
  /** Another feature's reach over the shoulder under way: the hotbar's reach waits. */
  reaching: boolean;
  /** Goods about to be used up (at the workbench): one of them in the paw or selected empties the paw (slot 1). */
  useUp(goods: readonly string[]): void;
}
/** The trade feature's ledger, once it runs (as buildOf). */
export const tradeOf = (scene: Scene) => scene.metadata?.trade as Trade | undefined;

export const create: CreateFeature = (game) => {
  const { stage, world, player, events, beaver } = game;
  const build = buildOf(stage.scene);
  if (!build) return {};
  let ledger = load(localStorage.getItem(KEY));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ledger)); } catch { /* not kept, still played */ } };
  const post = createPost(stage, world);
  const hold = newHold(), motion = player.motion;
  const shared: Trade = { get ledger() { return ledger; }, save, coming: {}, reaching: false, useUp: (goods) => useUp(hold, goods) };
  stage.scene.metadata.trade = shared;
  POST_GOODS.forEach((good, i) => post.fill(i, ledger.paid[good.id] ?? 0));

  // ---- the hotbar: a slot selected brings its good into the paw, or puts it back ----------------------------------
  player.hold = { get full() { return full(hold); }, free() { hold.want = undefined; } };
  // A good paid for but still on its way to the backpack (a loaf baking) is not on the hotbar yet: no slot selects it.
  const counted = (id: string) => (ledger.owned[id] ?? 0) - (shared.coming[id] ?? 0);
  const goods = () => shelf(ledger).filter((id) => counted(id) > 0);
  const selected = () => hold.want ? goods().indexOf(hold.want) + 2 : 1;
  const select = (n: number) => {
    const good = n === 1 ? undefined : goods()[n - 2];
    if (n !== 1 && !good) return; // an empty slot
    if (!good || good === hold.want) { hold.want = undefined; putting = false; return; }
    hold.want = good;
    putting = !!player.carrying; // the stick goes down first, as soon as it can
  };
  const bar = createHotbar(stage, select);
  let slotHeld = 0, shiftHeld = 0, putting = false;

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
      return spot === undefined ? undefined : { action: "trade", text: offerText(ledger, POST_GOODS[spot]!.id) };
    },
    step(dt) {
      if (!job) return undefined;
      const before = job.progress;
      job.progress = Math.min(1, before + dt / BUILD_TIME);
      if (before < 0.5 && job.progress >= 0.5) {
        const stick = player.handOver();
        if (stick && build.trade(stick)) {
          const spot = job.spot, k = post.pileSize(spot) + flights.filter((f) => f.spot === spot).length;
          const paid = pay(ledger, POST_GOODS[spot]!.id)!;
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
    const good = POST_GOODS[spot]!.id;
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
      get held() { return hold.held; },
      at(good: string) {
        const i = POST_GOODS.findIndex((g) => g.id === good);
        if (i < 0) return `no good "${good}": ${POST_GOODS.map((g) => g.id).join(", ")}`;
        const s = standAt(i);
        player.teleport(s.x, world.heightAt(s.x, s.z), s.z, FACING);
        player.camera.yaw = FACING + Math.PI + 0.5;
        if (!player.carrying) {
          const stick = world.sticks.filter((w) => isEnabled(w.body)).sort((a, b) => Vector3.Distance(a.mesh.position, feet) - Vector3.Distance(b.mesh.position, feet))[0];
          const x = s.x + Math.sin(FACING) * 0.3 + Math.cos(FACING) * 0.3, z = s.z + Math.cos(FACING) * 0.3 - Math.sin(FACING) * 0.3;
          if (stick) place(stick.body, { x, y: world.heightAt(x, z) + 0.05, z });
        }
        return { good, at: [+s.x.toFixed(2), +s.z.toFixed(2)] };
      },
      reset() { localStorage.removeItem(KEY); location.reload(); },
      post,
    },
  });

  let heldMesh: Mesh | undefined, inPaw: string | undefined; // the hotbar's good in the paw, and which good it is
  return {
    step() {
      // The moment a slot key or a d-pad side goes down, once per press (as the lantern's flash).
      const slot = player.input.slot ?? 0, shift = player.input.shift ?? 0;
      if (slot && slot !== slotHeld) select(slot);
      if (shift && shift !== shiftHeld) { const n = 1 + goods().length; select((selected() - 1 + shift + n) % n + 1); }
      slotHeld = slot; shiftHeld = shift;
    },
    update(dt) {
      const moving = stage.paused ? 0 : dt;
      let reach = 0;
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
        if (t >= TAKE && t < TAKE + REACH) reach = reachAt(t - TAKE);
        else if (t >= TAKE + REACH) taking = undefined;
      }
      // The hotbar's good: a stick selected away is put down, a stick picked up puts the good away; the reach waits
      // while the paws or the body are busy.
      if (!stage.paused) {
        if (!player.carrying) putting = false;
        else if (putting) player.putDown();
        else hold.want = undefined;
        stepHold(hold, dt, busy(motion, player.diving) || !!player.carrying || !!taking || shared.reaching);
      }
      if (inPaw !== hold.held) {
        heldMesh?.dispose();
        inPaw = hold.held;
        heldMesh = inPaw === undefined ? undefined : goodOf(inPaw)?.at === "post" ? post.copy(POST_GOODS.findIndex((g) => g.id === inPaw)) : goodModel(inPaw, stage.scene);
        if (heldMesh) { heldMesh.scaling.setAll(1); heldMesh.layerMask = OWN_LAYER; } // life-sized, out of the first-person picture
      }
      if (heldMesh) { heldMesh.position.copyFrom(pawAt()); heldMesh.rotation.y = player.facing; }
      // The reach over the shoulder, as the lantern's: the left paw up to the backpack and back down. The lantern
      // feature writes reachBack before this one each picture; the larger reach is drawn.
      reach = Math.max(reach, hold.reach);
      if (reach > 0) motion.reachBack = reached = Math.max(motion.reachBack ?? 0, reach);
      else if (reached) { if (motion.reachBack === reached) motion.reachBack = 0; reached = 0; }
      const shown = goods();
      bar.show(Array.from({ length: SLOTS }, (_, i): SlotView => i === 0 ? { icon: player.carrying ? "stick" : undefined }
        : { icon: shown[i - 1], count: shown[i - 1] ? counted(shown[i - 1]!) : undefined }), selected());
    },
  };
};
