// The workbench feature (a viewer's wish): a tree-stump bench in the open beside the trading post (bench.ts,
// place.ts), where goods from the backpack are made into a new one. With a feather and a shell in the backpack, walk
// up to it with empty paws and press E ("Make a charm (feather + shell)"): the beaver faces the bench, takes the two
// goods out of its backpack and lays them on the top, ties them together for one build time, then takes the charm
// into its left paw, reaches over its shoulder and puts it in its backpack (the lantern's reach, Motion.reachBack).
// The feather and the shell are used up, the hotbar counts the charm. Lacking one, the bench says what its recipe
// needs ("Needs a shell") and E there does nothing. Charms can be made as long as there are pairs.
//
//   import { create as workbench } from "./features/workbench/index.ts";   after trade (and the bakery): it shares E
//                                                                           (firstOf) and makes goods in trade's ledger
//
// What is made is the player's own (docs/adr/0003): the trade feature's ledger (src/features/trade/ledger.ts, the
// recipe beside the goods), saved under its key, never sent; crafting takes no sticks and changes nothing in the
// world. The craft happens all at once when the work starts: the goods are used up, the charm counted and the ledger
// saved, and the charm is left off the hotbar (trade's "coming") until it goes into the backpack. A reload mid-craft
// keeps the charm. A good of the recipe in the paw is put away at once (the paw empties, slot 1). Event goodTraded
// { good: "charm", count } when it goes into the backpack.
//
// Debug, for bun shot --eval (window.workbench): workbench.at() stands at the bench facing it · workbench.state
// { charms, making } · workbench.place (where the bench stands, for the HUD's map).
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Node } from "@babylonjs/core/node.js";
import type { CreateFeature } from "../../game.ts";
import { firstOf } from "../../player/actors.ts";
import type { Actor, Offer } from "../../player/index.ts";
import { BUILD_TIME } from "../build/index.ts";
import { reachAt, RISE, HOLD, FALL } from "../lantern/stow.ts";
import { tradeOf } from "../trade/index.ts";
import { craft, craftText, goodOf, missing } from "../trade/ledger.ts";
import { GOOD_SIZE, goodModel } from "../trade/post.ts";
import { createBench } from "./bench.ts";
import { atBench, BENCH, FACING, STAND } from "./place.ts";

const CHARM = "charm";
const OUT = 0.35; // s: the goods from the paw onto the bench, the first part of the work
const TIE = 0.75; // of the work: the goods drawn together, then the charm lies there in their place
const TAKE = 0.4; // s for the charm from the bench into the paw
const REACH = RISE + HOLD + FALL;
const ease = (k: number) => k * k * (3 - 2 * k);

export const create: CreateFeature = (game) => {
  const { stage, world, player, events, beaver } = game;
  const { scene } = stage;
  const trade = tradeOf(scene), recipe = goodOf(CHARM)?.recipe;
  if (!trade || !recipe) return {};
  const bench = createBench(stage, world);

  const paw = beaver.leftHand, chain: TransformNode[] = [];
  for (let n: Node | null = paw; n; n = n.parent) if (n instanceof TransformNode) chain.unshift(n);
  const pawAt = () => { for (const node of chain) node.computeWorldMatrix(true); return paw.getAbsolutePosition().clone(); };

  // ---- E at the bench: the goods used up, the charm made ---------------------------------------------------------
  const feet = player.feet;
  let job: { progress: number } | undefined;
  /** The charm under way: t s since the work began; the goods on their way to the bench and tied there, then the
   *  charm on the bench, in the paw, into the backpack. */
  let making: { t: number; inputs: { mesh: Mesh; from: Vector3; to: Vector3 }[]; charm?: Mesh; from?: Vector3; done: boolean } | undefined;
  // Empty paws (no stick), dry land, nothing under way. Head under water or afloat: nothing is offered.
  const here = (carrying: boolean) => !carrying && !job && !making && !player.afloat && !player.diving && atBench(feet.x, feet.z);
  const actor: Actor = {
    begin(carrying) {
      if (!here(carrying) || missing(trade.ledger, CHARM).length) return undefined;
      trade.useUp(recipe); // a feather in the paw is put away first: the hotbar never selects a good that is gone
      if (!craft(trade.ledger, CHARM)) return undefined;
      trade.coming[CHARM] = (trade.coming[CHARM] ?? 0) + 1;
      trade.save();
      const from = pawAt();
      making = {
        t: 0, done: false,
        inputs: recipe.map((id, i) => {
          const mesh = goodModel(id, scene);
          mesh.rotation.y = bench.yaw + (i ? 0.6 : -0.4);
          mesh.scaling.setAll(GOOD_SIZE); // larger than life on the bench, as the goods on the trading post
          return { mesh, from, to: bench.spot(i ? 1 : -1) };
        }),
      };
      job = { progress: 0 };
      return { action: "build", face: FACING };
    },
    offer(carrying): Offer | undefined {
      return here(carrying) ? { action: "use", text: craftText(trade.ledger, CHARM) } : undefined;
    },
    step(dt) {
      if (!job) return undefined;
      job.progress = Math.min(1, job.progress + dt / BUILD_TIME);
      if (job.progress >= 1) return (job = undefined);
      return job.progress;
    },
  };
  player.actor = player.actor ? firstOf(player.actor, actor) : actor;

  const intoBackpack = () => {
    if (!making || making.done) return;
    making.charm?.dispose();
    making.done = true;
    trade.coming[CHARM] = Math.max(0, (trade.coming[CHARM] ?? 0) - 1);
    events.emit("goodTraded", { good: CHARM, count: trade.ledger.owned[CHARM] ?? 0 });
  };

  // ---- debug ----------------------------------------------------------------------------------------------------------
  Object.assign(window, {
    workbench: {
      place: { x: BENCH.x, z: BENCH.z },
      get state() { return { charms: trade.ledger.owned[CHARM] ?? 0, making: !!making }; },
      at() {
        player.teleport(STAND.x, world.heightAt(STAND.x, STAND.z), STAND.z, FACING);
        player.camera.yaw = FACING + Math.PI - 0.6; // over the shoulder away from the trading post, which would hide it
        return { at: [+STAND.x.toFixed(2), +STAND.z.toFixed(2)] };
      },
      bench,
    },
  });

  let reached = 0;
  return {
    update(dt) {
      const moving = stage.paused ? 0 : dt;
      let reach = 0;
      if (making) {
        const t = (making.t += moving), work = BUILD_TIME;
        if (!making.charm) {
          // Out of the paw onto the bench, a little arc; then drawn together to the middle, turning, as they are tied.
          const middle = bench.spot(0);
          for (const g of making.inputs) {
            if (t < OUT) {
              const k = ease(t / OUT);
              Vector3.LerpToRef(g.from, g.to, k, g.mesh.position).y += Math.sin(Math.PI * k) * 0.12;
            } else {
              const k = ease(Math.min(1, (t - OUT) / (work * TIE - OUT)));
              Vector3.LerpToRef(g.to, middle, k * 0.75, g.mesh.position);
              g.mesh.rotation.y += moving * 2.5 * k;
            }
          }
          if (t >= work * TIE) {
            for (const g of making.inputs) g.mesh.dispose();
            making.charm = goodModel(CHARM, scene);
            making.charm.position.copyFrom(middle);
            making.charm.rotation.y = bench.yaw;
            making.charm.scaling.setAll(GOOD_SIZE);
          }
        } else if (!making.done) {
          // Lying on the bench till the work is done, then into the paw, then over the shoulder.
          const out = t - work;
          making.from ??= making.charm.position.clone();
          if (out >= 0 && out < TAKE) {
            const k = ease(out / TAKE);
            Vector3.LerpToRef(making.from, pawAt(), k, making.charm.position).y += Math.sin(Math.PI * k) * 0.12;
            making.charm.scaling.setAll(GOOD_SIZE - 0.6 * k);
            making.charm.rotation.y = bench.yaw + (player.facing - bench.yaw) * k;
          } else if (out >= TAKE) { making.charm.position.copyFrom(pawAt()); making.charm.rotation.y = player.facing; }
          if (out - TAKE >= RISE) intoBackpack();
        }
        const reachT = t - work - TAKE;
        if (reachT >= 0 && reachT < REACH) reach = reachAt(reachT);
        else if (reachT >= REACH) making = undefined;
      }
      // The trade feature's hotbar reach waits while this one is under way (the bakery's flag too: shared).
      if (reach > 0) trade.reaching = true;
      else if (reached) trade.reaching = false;
      // The reach over the shoulder, as the trading post's: the larger of the others' and this one is drawn.
      if (reach > 0) player.motion.reachBack = reached = Math.max(player.motion.reachBack ?? 0, reach);
      else if (reached) { if (player.motion.reachBack === reached) player.motion.reachBack = 0; reached = 0; }
    },
  };
};
