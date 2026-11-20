// The Bear: met on its ground in the outer meadow and driven off, as a player would. First the beaver stands its
// ground: the bear comes running out of the far forest straight for it, rears up and growls, its Health bar shows
// "Bear" and 100, a tail slap from out of reach takes nothing, and the Swipe tosses the beaver (unharmed, furious) a
// few metres; then the beaver runs home, where the bear never follows: the Health bar goes and the bear turns to its
// own business (nosing in the ground, looking about or sitting). Then the fight: tail slaps from within reach take
// the bar from 100 to 80 and on to nothing (each a leap, once round in the air, the tail coming down on the bear), "Bear driven off" is announced and the bear runs all the way back into
// the far forest.
//
// With ?tour the bear comes only when a station calls it (window.bear.come: by itself it comes once a Day, which no
// station could wait for); from there on the beaver's own keys play, and the checks read the HUD, the game's events
// and the beaver. The bear's state and where it is come from the feature's debug handle: nothing on screen says them.
import { after as chasing, DEN, HEALTH, INNER, onGround, OUTER, SLAP_DAMAGE, SLAP_REACH, type Doing, type State } from "../../bear/rules.ts";
import { NAME } from "../../bear/panel.ts";
import { skip, type Kit } from "../kit.ts";
import type { Station } from "../live.ts";

/** What the feature puts on window for tools (src/features/bear/index.ts). */
interface BearDebug { state: State; doing: Doing; health: number; x: number; z: number; swipes: number; come(x: number, z: number): void; reset(): void }

const RING = (INNER + OUTER) / 2; // m from the middle: the middle of the bear's ground, room to be tossed about
const APART = 6.5; // m between the beaver and where the bear comes out, along the ring: a Swipe tosses along it too

export const bear = (kit: Kit): Station[] => {
  const { player, world, beaver, live, fast, frame, wait, until, walkTo, tap, expect, hudText, stage, after, flat } = kit;
  const need = () => (window as { bear?: BearDebug }).bear ?? skip("no bear feature");
  const barShown = () => !!stage.hud.getControlByName("bear-health-bar")?.isVisible;
  const ring = (angle: number) => ({ x: Math.sin(angle) * RING, z: Math.cos(angle) * RING });
  /** Where to meet it: the stretch of its ground with the most room from the trees, the beaver at one end and the
   *  bear at the other. */
  const lane = () => {
    const trees = world.trees ?? [], room = (p: { x: number; z: number }) => Math.min(...trees.map((t) => Math.hypot(t.place.x - p.x, t.place.z - p.z)), 99);
    let best = { stand: ring(0), from: ring(APART / RING) }, most = -1;
    for (let k = 0; k < 24; k++) {
      const angle = k * Math.PI / 12, spots = [0, 0.5, 1, -0.6].map((f) => ring(angle + f * APART / RING));
      const clear = spots.every((s) => onGround(s.x, s.z)) ? Math.min(...spots.map(room)) : -1;
      if (clear > most) { most = clear; best = { stand: spots[0]!, from: spots[2]! }; }
    }
    return best;
  };
  /** The beaver out on the bear's ground and the bear called: it comes running out of the far forest, and notices. */
  const meet = async (b: BearDebug) => {
    b.reset();
    const { stand, from } = lane();
    await walkTo(stand.x, stand.z, { near: 0.5, limit: 120, hop: true, run: live ? 1 : 0 });
    // Watched, a bear still on its way home is let go first: it is never there at once.
    if (!fast) await until(() => b.state === "away", 40, `the bear sent home is still ${b.state}, ${Math.hypot(b.x, b.z).toFixed(0)} m from the middle`);
    const notices = after("bearNotices");
    b.come(from.x, from.z);
    expect(b.state === "arrive" && Math.hypot(b.x, b.z) > DEN - 0.1 && flat(b.x, b.z) > 25, `called, the bear is ${b.state}, ${Math.hypot(b.x, b.z).toFixed(0)} m from the middle and ${flat(b.x, b.z).toFixed(0)} m from the beaver: not far off in the forest`);
    await until(notices, 15, `the bear came running from the forest and never noticed the beaver on its ground (it is ${b.state}, ${flat(b.x, b.z).toFixed(1)} m off)`);
    expect(flat(b.x, b.z) > SLAP_REACH && onGround(b.x, b.z), `it noticed the beaver ${flat(b.x, b.z).toFixed(1)} m off${onGround(b.x, b.z) ? "" : ", off its ground"}`);
    await until(() => barShown() && hudText("bear-health") === String(HEALTH), 1, `noticed, yet the Health bar ${barShown() ? `reads "${hudText("bear-health")}"` : "is hidden"}`);
    expect(hudText("bear-name") === NAME, `the Health bar is headed "${hudText("bear-name")}", not "${NAME}"`);
  };
  return [
    ["A bear's swipe", async () => {
      const b = need();
      try {
        expect(!barShown(), "no bear about, yet its Health bar shows");
        await meet(b);
        if (!live) expect(hudText("input-hints").includes("bear"), `the bear is coming, the advice reads "${hudText("input-hints")}"`);
        // A tail slap from out of reach is only the alarm.
        const slapped = after("tailSlap");
        await tap("slap");
        await until(slapped, 2, "pressed slap, the tail never came down");
        expect(b.health === HEALTH && hudText("bear-health") === String(HEALTH), `a tail slap ${flat(b.x, b.z).toFixed(1)} m from the bear took its health to ${b.health}`);
        // Standing its ground: the Swipe tosses it away from the bear, furious and unharmed.
        const stood = player.feet.clone(), hits = b.swipes;
        await until(() => b.swipes > hits, 15, `the bear never swiped at the beaver standing ${flat(b.x, b.z).toFixed(1)} m off (it is ${b.state})`);
        const near = flat(b.x, b.z);
        await until(() => !player.motion.grounded, 0.5, "swiped, the beaver stayed on the ground");
        await until(() => player.motion.grounded, 3, "tossed, the beaver never landed");
        expect(flat(stood.x, stood.z) > 1.5, `the Swipe tossed the beaver only ${flat(stood.x, stood.z).toFixed(1)} m`);
        expect(flat(b.x, b.z) > near, "the Swipe tossed the beaver towards the bear");
        expect(beaver.anger > 0.9, `tossed, the beaver's anger is ${beaver.anger.toFixed(2)}, not furious`);
        // Home is safe: the bear stays on its ground, gives up, and its Health bar goes.
        const r = Math.hypot(player.feet.x, player.feet.z), home = { x: player.feet.x / r * (INNER - 3), z: player.feet.z / r * (INNER - 3) };
        await walkTo(home.x, home.z, { run: 1, near: 0.6, limit: 60 });
        await until(() => !chasing(b), 3, `the beaver is home, the bear is still after it (${b.state})`);
        expect(Math.hypot(b.x, b.z) >= INNER - 0.05, `the bear left its ground: ${Math.hypot(b.x, b.z).toFixed(1)} m from the middle`);
        // At once it turns to its own business, where it stands: nosing in the ground, looking about or sitting.
        await until(() => b.state === "roam" && b.doing !== "amble", 1, `left alone, the bear does nothing of its own (it is ${b.state}, ${b.doing})`);
        await until(() => !barShown(), 8, "the bear gave up, its Health bar still shows");
        expect(player.motion.grounded && !player.afloat, "after the Swipe the beaver does not stand on its feet");
      } finally { b.reset(); }
    }, "Drive off the bear"],
    ["Drive off the bear", async () => {
      const b = need();
      try {
        await meet(b);
        /** Slaps whenever the bear is in reach, and goes for it when it lets the beaver be, until `over`. */
        const fight = async (over: () => boolean, limit: number, why: () => string) => {
          for (let t = 0; !over();) {
            if (t > limit) throw new Error(why());
            if (b.state === "roam") await walkTo(b.x, b.z, { run: 1, near: SLAP_REACH - 0.4, limit: 30, arrived: () => chasing(b) });
            // The key let go between presses, as a finger does: held down, it would slap only once.
            if (player.motion.grounded && flat(b.x, b.z) <= SLAP_REACH - 0.1) { await tap("slap"); await wait(0.05); t += 0.2; }
            else t += await frame();
          }
        };
        const landed = after("bearSlapped");
        await fight(landed, 30, () => `no tail slap landed on the bear in 30 s (it is ${b.state}, ${flat(b.x, b.z).toFixed(1)} m off)`);
        // The slap at the bear is a leap, once round: as the tail lands the beaver is in the air, its back to the bear.
        const round = player.node.rotation.y - Math.atan2(b.x - player.feet.x, b.z - player.feet.z);
        expect(!player.motion.grounded && player.feet.y - world.heightAt(player.feet.x, player.feet.z) > 0.5, `the tail landed on the bear with the beaver ${(player.feet.y - world.heightAt(player.feet.x, player.feet.z)).toFixed(2)} m up: no leap`);
        expect(Math.cos(round) < -0.3, `as the tail landed the beaver was turned ${(Math.acos(Math.cos(round)) * 180 / Math.PI).toFixed(0)}° from the bear: not its back`);
        expect(b.health === HEALTH - SLAP_DAMAGE, `one tail slap landed, its health is ${b.health}`);
        await until(() => hudText("bear-health") === String(HEALTH - SLAP_DAMAGE), 1, `one tail slap landed, the Health bar reads "${hudText("bear-health")}"`);
        await fight(() => b.health === 0, 120, () => `after 120 s of fighting the bear still has ${b.health} health (it is ${b.state})`);
        await until(() => hudText("announcement").startsWith("✓ Bear driven off"), 2, `the bear is driven off, the announcement reads "${hudText("announcement")}"`);
        await until(() => !barShown(), 2, "the bear is driven off, its Health bar still shows");
        expect(b.state === "leave", `driven off, the bear is ${b.state}`);
        // It is seen to run: gone only deep in the far forest, never at once.
        await until(() => b.state === "away", 20, `driven off, the bear never reached the forest (it is ${b.state}, ${Math.hypot(b.x, b.z).toFixed(0)} m from the middle)`);
        expect(Math.hypot(b.x, b.z) > DEN - 1.5 && flat(b.x, b.z) > 25, `the bear was gone ${Math.hypot(b.x, b.z).toFixed(0)} m from the middle, ${flat(b.x, b.z).toFixed(0)} m from the beaver`);
      } finally { b.reset(); }
    }, "Drive off the bear"],
  ];
};
