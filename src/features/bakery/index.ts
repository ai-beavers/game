// The bakery feature (a viewer's wish): a small hut in the clearing with a stone oven and a chimney (hut.ts,
// place.ts), where sticks bake a loaf. Carry a stick to the oven and press E ("Bake a loaf, 1/3"): the beaver throws
// it into the fire, and the stick leaves the world for everyone (a "trade" build change, buildOf(scene).trade, as at
// the trading post). The fire grows with each stick; on the third it flares, smoke rises from the chimney, and after
// a bake of BAKE s of game time the loaf slides out onto the ledge. The beaver takes it, reaches over its shoulder and
// puts it in its backpack (the lantern's reach, Motion.reachBack), and the hotbar counts it ("Loaf ×1"). Loaves can be
// baked again and again; a stick fed in comes back when its tree grows back.
//
//   import { create as bakery } from "./features/bakery/index.ts";     after trade: it shares E with build and trade
//                                                                       (firstOf) and pays into trade's ledger
//
// The sticks fed towards a loaf and the loaves are the player's own (docs/adr/0003): one ledger with the trading
// post's goods (src/features/trade/ledger.ts, tradeOf(scene)), saved under the trade feature's key, never sent. The
// loaf is counted the moment its third stick is paid: a reload mid-bake loses nothing. Event goodTraded
// { good: "loaf", count } when it goes into the backpack.
//
// Debug, for bun shot --eval (window.bakery): bakery.at() stands at the oven facing it (with no stick in the hand,
// one is put down right beside it: E picks it up, E again feeds it) · bakery.state { paid, loaves, baking } ·
// bakery.place (where the hut stands, for the HUD's map).
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { PointLight } from "@babylonjs/core/Lights/pointLight.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Node } from "@babylonjs/core/node.js";
import type { CreateFeature } from "../../game.ts";
import { firstOf } from "../../player/actors.ts";
import type { Actor, Offer } from "../../player/index.ts";
import { isEnabled, place } from "../../physics.ts";
import { BUILD_TIME, buildOf } from "../build/index.ts";
import { fxOf } from "../fx/index.ts";
import { reachAt, RISE, HOLD, FALL } from "../lantern/stow.ts";
import { tradeOf } from "../trade/index.ts";
import { goodOf, offerText, pay } from "../trade/ledger.ts";
import { goodModel } from "../trade/post.ts";
import { createHut } from "./hut.ts";
import { atOven, FACING, FRONT, HUT, STAND } from "./place.ts";

const LOAF = "loaf";
const FLIGHT = 0.5; // s from the paw into the oven's mouth
const BAKE = 3; // s of game time the loaf bakes once its last stick is in
const SLIDE = 0.8; // s for the loaf out of the mouth onto the ledge
const TAKE = 0.4; // s for the loaf from the ledge into the paw
const REACH = RISE + HOLD + FALL;
const WARM = new Color3(1, 0.6, 0.3);

export const create: CreateFeature = (game) => {
  const { stage, world, player, events, beaver, settings } = game;
  const { scene } = stage;
  const build = buildOf(scene), trade = tradeOf(scene);
  if (!build || !trade || !goodOf(LOAF)) return {};
  const price = goodOf(LOAF)!.price;
  const hut = createHut(stage, world);

  // ---- light: one warm point light in the mouth, on the hut and the ground only; dark while the oven is cold ----------
  // Made once and always on at intensity 0 (as the Flag's and the Lantern's): switching a light on recompiles the
  // materials that take it. Left out at low quality.
  const light = new PointLight("bakery-fire", hut.fire.add(new Vector3(FRONT.x * 0.45, 0.25, FRONT.z * 0.45)), scene);
  light.diffuse.copyFrom(WARM);
  light.specular.copyFrom(WARM).scaleInPlace(0.15);
  light.range = 2.8;
  light.falloffType = PointLight.FALLOFF_STANDARD;
  light.intensity = 0;
  const groundMesh = scene.getMeshByName("ground");
  light.includedOnlyMeshes = [...hut.meshes, ...(groundMesh ? [groundMesh] : [])];
  scene.onDisposeObservable.add(settings.on(({ quality }) => light.setEnabled(quality !== "low")));

  // ---- E at the oven: a stick into the fire ------------------------------------------------------------------------
  const feet = player.feet;
  let job: { progress: number } | undefined;
  type Flight = { mesh: TransformNode; from: Vector3; turn: Quaternion; scale: Vector3; t: number; bought: boolean };
  const flights: Flight[] = [];
  /** The loaf after its last stick: baking (t up to BAKE), sliding out, taken into the paw, into the backpack. */
  let loaf: { t: number; mesh?: Mesh; done: boolean } | undefined;
  let fed = trade.ledger.paid[LOAF] ?? 0; // sticks burning in the oven now (those still in flight not yet)
  // Not while a loaf is under way: the oven is busy until it is in the backpack. On dry land only.
  const here = (carrying: boolean) => carrying && !job && !loaf && !player.afloat && atOven(feet.x, feet.z);
  const actor: Actor = {
    begin(carrying) {
      if (!here(carrying)) return undefined;
      job = { progress: 0 };
      return { action: "build", face: FACING };
    },
    offer(carrying): Offer | undefined {
      return here(carrying) ? { action: "trade", text: offerText(trade.ledger, LOAF) } : undefined;
    },
    step(dt) {
      if (!job) return undefined;
      const before = job.progress;
      job.progress = Math.min(1, before + dt / BUILD_TIME);
      if (before < 0.5 && job.progress >= 0.5) {
        const stick = player.handOver();
        if (stick && build.trade(stick)) {
          const paid = pay(trade.ledger, LOAF)!;
          if (paid.bought) trade.coming[LOAF] = (trade.coming[LOAF] ?? 0) + 1;
          trade.save();
          const mesh = stick.mesh;
          mesh.computeWorldMatrix(true);
          const from = new Vector3(), turn = new Quaternion(), scale = new Vector3();
          mesh.getWorldMatrix().decompose(scale, turn, from);
          mesh.setParent(null);
          flights.push({ mesh, from, turn, scale, t: 0, bought: paid.bought });
        } else stick?.mesh.dispose(); // used up already (someone else's change): gone
      }
      if (job.progress >= 1) return (job = undefined);
      return job.progress;
    },
  };
  player.actor = player.actor ? firstOf(player.actor, actor) : actor;

  // ---- the loaf: out of the oven, into the left paw, over the shoulder into the backpack -----------------------------
  const paw = beaver.leftHand, chain: TransformNode[] = [];
  for (let n: Node | null = paw; n; n = n.parent) if (n instanceof TransformNode) chain.unshift(n);
  const pawAt = () => { for (const node of chain) node.computeWorldMatrix(true); return paw.getAbsolutePosition(); };
  const intoBackpack = () => {
    if (!loaf || loaf.done) return;
    loaf.mesh?.dispose();
    loaf.done = true;
    trade.coming[LOAF] = Math.max(0, (trade.coming[LOAF] ?? 0) - 1);
    events.emit("goodTraded", { good: LOAF, count: trade.ledger.owned[LOAF] ?? 0 });
  };

  // ---- debug ----------------------------------------------------------------------------------------------------------
  Object.assign(window, {
    bakery: {
      place: { x: HUT.x, z: HUT.z },
      get state() {
        return { paid: trade.ledger.paid[LOAF] ?? 0, loaves: trade.ledger.owned[LOAF] ?? 0, baking: !!loaf && loaf.t < BAKE, fed };
      },
      at() {
        player.teleport(STAND.x, world.heightAt(STAND.x, STAND.z), STAND.z, FACING);
        player.camera.yaw = FACING + Math.PI + 0.5;
        if (!player.carrying) {
          const stick = world.sticks.filter((w) => isEnabled(w.body)).sort((a, b) => Vector3.Distance(a.mesh.position, feet) - Vector3.Distance(b.mesh.position, feet))[0];
          const x = STAND.x + FRONT.x * 0.3 + FRONT.z * 0.3, z = STAND.z + FRONT.z * 0.3 - FRONT.x * 0.3;
          if (stick) place(stick.body, { x, y: world.heightAt(x, z) + 0.05, z });
        }
        return { at: [+STAND.x.toFixed(2), +STAND.z.toFixed(2)] };
      },
      hut,
    },
  });

  let reached = 0, level = fed / price, time = 0, flicker = 1;
  return {
    update(dt) {
      const moving = stage.paused ? 0 : dt;
      time += moving;
      let reach = 0;
      // Sticks on their way from the paw into the mouth: an arc, shrinking into the fire.
      for (const f of [...flights]) {
        f.t = Math.min(1, f.t + moving / FLIGHT);
        const e = f.t * f.t * (3 - 2 * f.t);
        Vector3.LerpToRef(f.from, hut.fire, e, f.mesh.position).y += Math.sin(Math.PI * f.t) * 0.3;
        f.mesh.rotationQuaternion ??= new Quaternion();
        f.mesh.rotationQuaternion.copyFrom(f.turn);
        f.mesh.scaling.copyFrom(f.scale).scaleInPlace(1 - 0.6 * e);
        if (f.t < 1) continue;
        flights.splice(flights.indexOf(f), 1);
        f.mesh.dispose();
        if (f.bought) { fed = 0; loaf = { t: 0, done: false }; }
        else fed = Math.min(price - 1, fed + 1);
      }
      // The bake: the fire flared, then the loaf slides out, is taken, and goes into the backpack.
      if (loaf) {
        const t = (loaf.t += moving);
        if (t >= BAKE && !loaf.mesh && !loaf.done) {
          loaf.mesh = goodModel(LOAF, scene);
          loaf.mesh.rotation.y = hut.yaw;
        }
        if (loaf.mesh && !loaf.done) {
          const out = t - BAKE;
          if (out < SLIDE) {
            const k = out / SLIDE, e = k * k * (3 - 2 * k);
            Vector3.LerpToRef(hut.inside, hut.ledge, e, loaf.mesh.position);
            loaf.mesh.scaling.setAll(1.4);
          } else if (out < SLIDE + TAKE) {
            const k = (out - SLIDE) / TAKE, e = k * k * (3 - 2 * k);
            Vector3.LerpToRef(hut.ledge, pawAt(), e, loaf.mesh.position).y += Math.sin(Math.PI * k) * 0.15;
            loaf.mesh.scaling.setAll(1.4 - 0.4 * e);
          } else loaf.mesh.position.copyFrom(pawAt());
          if (out - SLIDE - TAKE >= RISE) intoBackpack();
        }
        const reachT = t - BAKE - SLIDE - TAKE;
        if (reachT >= 0 && reachT < REACH) reach = reachAt(reachT);
        else if (reachT >= REACH) loaf = undefined;
      }
      trade.reaching = reach > 0;
      // The fire: brighter with each stick towards the loaf, flared while it bakes, dying down after.
      const baking = !!loaf && loaf.t < BAKE;
      const want = baking ? 1.5 : flights.length && !fed ? 0.2 : fed / price;
      level += (want - level) * Math.min(1, moving * 2.5);
      if (!stage.paused) flicker = 0.8 + 0.2 * Math.sin(time * 19) * Math.sin(time * 6.1 + 1) + 0.1 * Math.random();
      hut.glow(level * flicker);
      light.intensity = level < 0.02 ? 0 : (0.25 + 0.3 * (game.sky?.dark ?? 0)) * Math.min(1.2, level) * flicker;
      const fx = fxOf(scene);
      if (fx && moving && level > 0.05) {
        fx.fire(hut.fire, moving * 30 * level, 0); // the oven's own smoke goes up the chimney
        if (baking || level > 0.3) fx.smoke(hut.chimney, moving * (baking ? 14 : 2) * level);
      }
      // The reach over the shoulder, as the trading post's: the larger of the lantern's and this one is drawn.
      if (reach > 0) player.motion.reachBack = reached = Math.max(player.motion.reachBack ?? 0, reach);
      else if (reached) { if (player.motion.reachBack === reached) player.motion.reachBack = 0; reached = 0; }
    },
  };
};
