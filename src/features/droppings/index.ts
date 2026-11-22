// Droppings (a viewer's wish): once the dam's mud shows, E by its land side with empty paws offers "Leave a dropping".
// The beaver turns its back to the dam and sits down for a moment, a small brown Dropping lands on the crest's land
// side, and it pats it flat with a tail slap (the thump on land). Up to MOST lie there at once; the next dawn washes
// them off, and so does the dam emptying as the world starts anew. They build nothing and earn nothing.
//
//   import { create as droppings } from "./features/droppings/index.ts";     after build and flag in FEATURES (it reads
//                                                                             the dam, and shares the Use key)
//
// Droppings are the player's own, as the Flag is (docs/adr/0003): never sent, never saved, gone after a reload, and
// no one else sees them. Events droppingLeft and droppingsWashed. rules.ts holds them as plain numbers.
//
// Debug, for bun shot --eval (window.droppings): droppings.count · droppings.most · droppings.text (what E offers) ·
// droppings.at() (stands by the dam's land side facing it, empty-pawed).
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh.js";
import "@babylonjs/core/Meshes/instancedMesh.js";
import type { CreateFeature } from "../../game.ts";
import type { Actor, Offer } from "../../player/index.ts";
import { SLAP_COOLDOWN } from "../../player/state.ts";
import { material } from "../../world/models.ts";
import { buildOf } from "../build/index.ts";
import { DAM, MUD_SINK, SLOTS } from "../build/rules.ts";
import { dawnCame } from "../flag/state.ts";
import { MOST, next, offered, spot, type Happening } from "./rules.ts";

const LEAVE: Offer = { action: "use", text: "Leave a dropping" };
/** s from E to the dropping landing (sitting with its back to the dam), and the sit, the slap that pats it included.
 *  BUSY, s from E: no next one is offered before the tail may slap again (SLAP_COOLDOWN), so its slap goes too. */
const DROP_AT = 1.0, SIT = 1.6, BUSY = DROP_AT + SLAP_COOLDOWN + 0.1;
/** s after it lands that it is patted flat if no tail slap came (the slap still cooling down from the last one). */
const PAT_LATEST = 0.7;
/** How flat a patted dropping is, of its height. */
const FLAT = 0.55;
/** Where the feet may stand to leave one, m in the dam's frame: on its land side, beside the crest (x from the crest's
 *  land edge out past the mound's foot; z along it). Short, so the Flag's pole nearby keeps its own E. */
const REACH = { from: -(DAM.base + 0.45), to: 0, along: DAM.length / 2 - 0.1 };

export const create: CreateFeature = (game) => {
  const { stage, world, player, events } = game, { scene } = stage;
  const build = buildOf(scene);
  if (!build) return {};
  const { dam } = build, placed = () => Math.min(SLOTS, build.state.dam.length); // the dam's own, not the lodge's or the cache's
  const toFrame = Quaternion.Inverse(dam.frame.turn);
  const local = (at: Vector3) => at.subtract(dam.frame.origin).applyRotationQuaternion(toFrame);

  // ---- the look: one small rounded pile, three blobs stacked, drawn as instances of one mesh ----------------------
  const blobs = [[0.1, 0.046, 0.02], [0.07, 0.04, 0.047], [0.038, 0.034, 0.072]].map(([d, h, y], i) => {
    const b = MeshBuilder.CreateSphere(`dropping ${i}`, { diameterX: d, diameterZ: d, diameterY: h, segments: 8 }, scene);
    b.position.set(i * 0.006, y!, -i * 0.004);
    return b;
  });
  const pile = Mesh.MergeMeshes(blobs, true)!;
  pile.name = "dropping";
  pile.material = material(scene, "dropping", 0x3a2213);
  pile.receiveShadows = true;
  pile.isPickable = false;
  const shown: InstancedMesh[] = Array.from({ length: MOST }, (_, n) => {
    const m = pile.createInstance(`dropping ${n}`);
    m.isPickable = false;
    m.rotation.y = n * 2.1;
    m.setEnabled(false);
    return m;
  });
  pile.isVisible = false; // the template draws nothing itself; its instances do

  let count = 0, sitting: { t: number; face: number; patAt: number } | undefined, patting: { n: number; t: number } | undefined;
  /** Puts dropping n on the dam's top where its spot is now (it rises with the crest). */
  const lay = (n: number) => {
    const s = spot(n, placed()), at = dam.at(s.x, s.z), m = shown[n]!;
    at.y = dam.top(at) ?? world.heightAt(at.x, at.z) - MUD_SINK + s.y;
    m.position.copyFrom(at).y -= 0.004;
  };
  let settle = 0; // pictures left to lay them again: a stick or the mud just moved is in its new place a picture later
  const layAll = () => { for (let n = 0; n < count; n++) lay(n); };

  const happen = (what: Happening) => {
    const was = count;
    count = next(count, what);
    if (what === "left") {
      const m = shown[was]!;
      m.scaling.set(1, 1, 1);
      m.setEnabled(true);
      lay(was);
      events.emit("droppingLeft", { place: m.position.clone(), count });
    } else if (was > 0) {
      for (const m of shown) m.setEnabled(false);
      events.emit("droppingsWashed", { why: what });
    }
  };

  // ---- E by the dam's land side: turn round, sit, leave one ---------------------------------------------------------
  const near = () => {
    const at = local(player.feet);
    return at.x > REACH.from && at.x < REACH.to && Math.abs(at.z) < REACH.along;
  };
  const canLeave = (carrying: boolean) => offered(placed(), carrying, count) && !sitting
    && !player.diving && !player.riding && !player.afloat && near();
  const before = player.actor;
  const actor: Actor = {
    begin(carrying) {
      if (!canLeave(carrying)) return before?.begin(carrying);
      const s = spot(count, placed()), at = dam.at(s.x, s.z);
      const face = Math.atan2(player.feet.x - at.x, player.feet.z - at.z); // its back, and its tail, to the spot
      sitting = { t: 0, face, patAt: Infinity };
      player.sit(SIT, face);
      return undefined; // no lasting action: the beaver sits (player.sit), the feature times it
    },
    offer(carrying) { return canLeave(carrying) ? LEAVE : before?.offer?.(carrying); },
    step(dt, held) { return before?.step(dt, held); },
  };
  player.actor = actor;

  events.on("tailSlap", ({ remote }) => { if (!remote && patting && patting.t < PAT_LATEST) patting.t = PAT_LATEST; });

  Object.assign(window, {
    droppings: {
      get count() { return count; },
      most: MOST,
      text: LEAVE.text,
      /** Stands on the dam's land side, beside the middle of its crest, facing it, with empty paws. */
      at() {
        player.drop();
        const at = dam.at(REACH.from + 0.2, 0), to = dam.frame.origin, face = Math.atan2(to.x - at.x, to.z - at.z);
        player.teleport(at.x, world.heightAt(at.x, at.z), at.z, face);
        player.camera.yaw = face + Math.PI + 0.6;
        return { at: [+at.x.toFixed(2), +at.z.toFixed(2)] };
      },
    },
  });

  let hour = game.sky?.hour ?? 12, sticks = build.state.dam.length;
  events.on("stickPlaced", () => { settle = 2; });
  return {
    step(dt) {
      const now = game.sky?.hour ?? hour;
      if (dawnCame(hour, now)) happen("dawn");
      hour = now;
      const n = build.state.dam.length;
      if (n < sticks) happen("emptied"); // the world started anew
      if (n !== sticks) settle = 2;
      sticks = n;
      if (sitting) {
        sitting.t += dt;
        // Got up before it landed (moved, jumped): nothing is left.
        if (sitting.t < DROP_AT && player.sitting === 0) sitting = undefined;
        else if (sitting.t >= DROP_AT && sitting.patAt === Infinity) {
          sitting.patAt = sitting.t;
          if (offered(placed(), !!player.carrying, count)) {
            happen("left");
            patting = { n: count - 1, t: 0 };
            player.slap();
          }
        } else if (sitting.t >= BUSY) sitting = undefined;
      }
    },
    update(dt) {
      if (settle > 0) { settle--; layAll(); }
      if (!patting || stage.paused) return;
      // The pat: squashed flat and a little wider, quickly, as the tail comes down (or late without a slap).
      patting.t += dt;
      const m = shown[patting.n]!, k = Math.min(1, Math.max(0, (patting.t - PAT_LATEST) / 0.08));
      m.scaling.set(1 + 0.25 * k, 1 - (1 - FLAT) * k, 1 + 0.25 * k);
      if (k >= 1) patting = undefined;
    },
  };
};
