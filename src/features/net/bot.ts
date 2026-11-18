// Bots: players without a browser that join over the WebSocket and do what beavers do, through the same messages and
// rules as a real client, so the server admits every change they make. Each picks a job from the shared world
// (botmind.ts): walk to a standing tree and gnaw it down bite by bite, gnaw a fallen one into wood, carry a stick to
// the dam's next slot or, once the dam holds, swim it out to the lodge; between jobs it wanders, swims and now and
// then slaps its tail. It walks, runs, swims and turns as a player does (player/state.ts steer), follows the ground and
// the dam, and its Motion shows what it does (gnaw, pickup, build, drop, the slap), so browsers animate it. Several
// bots share the work by what each sees of the others; with a real player in, they slow down and only help.
//
//   bun src/features/net/bot.ts                                   one bot on ws://localhost:5180/net
//   bun src/features/net/bot.ts ws://192.168.1.20:5180/net --count 3 --name Bot --pace auto --quiet
//   bun src/features/net/bot.ts --idle --count 2 --radius 3 --at -1.5,-3     the old bots: walk in circles, jump, chat
//
// --pace auto (default): busy while only bots are in, calm while a real player is (one the server could make host);
// calm: walk, rest between jobs, fetch sticks and leave them at the dam, never build; busy: run and build.
// Each says a line from LINES after a few seconds, then every 12–25 s (--quiet: never). Ctrl-C ends them.
import { RUN_SPEED, WALK_SPEED } from "../../contracts.ts";
import { heightAt, POND } from "../../world/terrain.ts";
import { DROP_TIME, newMotion, newSlap, newSteering, PICKUP_TIME, steer, stepSlap, trackMotion, type ActionState } from "../../player/state.ts";
import { apply, BITE_TIME, BITES_TO_SPLIT, live, LODGE, newState, REGROW, SLOTS, type BuildChange } from "../build/rules.ts";
import { decide, type Job, type Loose, type Other, type Spot } from "./botmind.ts";
import { heading, loadWorld, type BotWorld } from "./botworld.ts";
import { ACTIONS, CRATES, packMotion, PIECES, replay, SEND_RATE, WOOD, type ClientMessage, type ServerMessage } from "./protocol.ts";

const LINES = ["Hello!", "Nice pond.", "Anyone seen a good stick?", "I am building a dam.", "Race you to the hill!", "Brr, the water is cold."];
const JUMP_SPEED = 4.8, GRAVITY = 18;
// As src/player/index.ts and src/features/build/index.ts have them (not exported there).
const ACCEL = 6, BRAKE = 9, SWIM_SPEED = 0.5, SWIM_ACCEL = 2, FLOAT_DEPTH = 0.45, HOLD_DEPTH = 0.3, BUILD_TIME = 1.3, GRACE = 5;
const FALL_TIME = 4; // s a tree takes to fall and lie still, about
const NOBODY_LAID = 15; // s after which a bot lays down a fallen tree nobody laid down
const STUCK = 90; // s on the way to a job before giving it up

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args.splice(at, 2)[1]!;
};
const flag = (name: string) => args.includes(`--${name}`) ? (args.splice(args.indexOf(`--${name}`), 1), true) : false;
const quiet = flag("quiet"), idle = flag("idle");
const count = Number(option("count", "1")), base = option("name", "Bot"), radius = Number(option("radius", "3"));
const pace = option("pace", "auto");
if (!["auto", "calm", "busy"].includes(pace)) throw new Error(`--pace is auto, calm or busy, not ${pace}`);
const [cx, cz] = option("at", "-1.5,-3").split(",").map(Number) as [number, number];
const url = args[0] ?? "ws://localhost:5180/net";
const dt = 1 / SEND_RATE;

/** A stick's name in the build feature, from its id (protocol.ts stickId the other way). */
const nameOf = (id: number) => id < CRATES ? `w${id}` : `t${Math.floor((id - WOOD) / PIECES)}:${(id - WOOD) % PIECES}`;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ---- the old bots: circles, jumps and chat ------------------------------------------------------------------------

function idleBot(n: number) {
  const name = count > 1 ? `${base} ${n + 1}` : base;
  const ring = radius + n * 0.8, centre = { x: cx + Math.cos(n * 2.1) * 0.5, z: cz + Math.sin(n * 2.1) * 0.5 };
  const motion = newMotion();
  let angle = n * 1.3, y = 0, vy = 0, nextJump = 3 + n, nextLine = 3 + Math.random() * 5 + n * 4, running = false;
  const net = connect(name, () => {});

  setInterval(() => {
    motion.time += dt;
    if (Math.floor(motion.time / 8) % 3 === 2 !== running) running = !running; // runs a third of the time
    const speed = running ? RUN_SPEED : WALK_SPEED, turn = speed / ring;
    angle += turn * dt;
    const x = centre.x + Math.cos(angle) * ring, z = centre.z + Math.sin(angle) * ring, ground = heightAt(x, z);
    // A jump now and then: up and down on its own, the ground under it as it goes.
    if ((nextJump -= dt) <= 0 && y <= ground + 1e-3) { vy = JUMP_SPEED; nextJump = 4 + Math.random() * 4; }
    const wasGrounded = motion.grounded;
    y = Math.max(ground, y + vy * dt);
    if (vy <= 0 && y - ground < 0.1) y = ground; // walking downhill keeps the feet on the ground
    vy = y <= ground ? 0 : vy - GRAVITY * dt;
    motion.grounded = y <= ground + 1e-3;
    motion.vertical = motion.grounded ? 0 : vy;
    motion.airTime = motion.grounded ? 0 : motion.airTime + dt;
    if (motion.grounded && !wasGrounded) { motion.sinceLanding = 0; motion.landingSpeed = 3; } else motion.sinceLanding += dt;
    motion.speed = speed;
    motion.distance += speed * dt;
    motion.turning = turn;
    // Facing along the circle, counter-clockwise: the tangent (-sin, cos) as an angle from +z.
    const facing = Math.atan2(-Math.sin(angle), Math.cos(angle));
    if (net.open()) {
      net.send({ t: "state", p: [x, y, z], f: facing, m: packMotion(motion), c: -1 });
      if (!quiet && (nextLine -= dt) <= 0) {
        nextLine = 12 + Math.random() * 13;
        net.send({ t: "chat", text: LINES[Math.floor(Math.random() * LINES.length)]! });
      }
    }
  }, 1000 * dt);
}

/** The socket, opened again 2 s after it closes. */
function connect(name: string, receive: (m: ServerMessage) => void, closed = () => {}) {
  let socket: WebSocket | undefined;
  const open = () => {
    const ws = socket = new WebSocket(url);
    ws.onopen = () => { ws.send(JSON.stringify({ t: "hello", name, bot: true } satisfies ClientMessage)); console.log(`${name}: in`); };
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as ServerMessage;
      if (m.t === "chat" && !quiet) console.log(`${name} hears: ${m.text}`);
      receive(m);
    };
    ws.onclose = () => { console.log(`${name}: connection closed, again in 2 s`); socket = undefined; closed(); setTimeout(open, 2000); };
    ws.onerror = () => {};
  };
  open();
  return {
    open: () => socket?.readyState === WebSocket.OPEN,
    send: (m: ClientMessage) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m)); },
  };
}

// ---- the working bots -----------------------------------------------------------------------------------------------

/** What the bot is doing now: the job, where it goes for it, and the action once there. */
interface Doing {
  job: Job; since: number; phase: "go" | "act" | "pause";
  to?: Spot; face?: number; run?: boolean;
  action?: "gnaw" | "pickup" | "build" | "drop"; progress: number; timer: number;
  slap?: boolean; until?: number;
}

function workBot(n: number, world: BotWorld) {
  const name = count > 1 ? `${base} ${n + 1}` : base;
  let state = newState(), me = -1, host = -1, carry = -1, time = 0, nextLine = 3 + Math.random() * 5 + n * 4;
  const others = new Map<number, Other>(), lying = new Map<number, [number, number, number]>(); // stick id → where
  const touched = new Map<number, { at: number; by: number }>(), falling = new Map<number, { since: number; mine: boolean }>(), asked = new Map<number, number>();
  const body = { x: cx + Math.cos(n * 2.1) * 1.2, z: cz + Math.sin(n * 2.1) * 1.2, y: 0, afloat: false, steering: newSteering(), motion: newMotion(), slap: newSlap() };
  body.y = heightAt(body.x, body.z);
  body.steering.facing = n * 1.3;
  const act: ActionState = { action: "none", progress: 0, carrying: false };
  let doing: Doing | undefined;
  const say = (text: string) => console.log(`${name}: ${text}`);

  const forget = () => { doing = undefined; act.action = "none"; act.progress = 0; };
  const pause = (s: number) => { forget(); doing = { job: { kind: "wander" }, since: time, phase: "pause", progress: 0, timer: 0, until: time + s }; };
  const changed = (by: number, c: BuildChange) => {
    if ("tree" in c && by !== me) touched.set(c.tree, { at: time, by });
    if (c.type === "fell") falling.set(c.tree, { since: time, mine: by === me });
    if (c.type === "rest") falling.delete(c.tree);
    if (c.type === "split") for (const piece of world.woodOf(c.tree, state.trees[c.tree]!.rest!)) lying.delete(piece.id); // laid out afresh
  };
  const net = connect(name, (m) => {
    switch (m.t) {
      case "welcome":
        me = m.id; host = m.host; state = replay(m.build); carry = -1;
        pause(1 + n * 0.4); // first sees where the others are, as their states come in; not all of them at once
        others.clear();
        for (const p of m.players) others.set(p.id, { id: p.id, x: Infinity, z: Infinity, carry: -1, action: "none" });
        for (const [id, stick] of m.carried) { const o = others.get(id); if (o) o.carry = stick; }
        return;
      case "join": others.set(m.id, { id: m.id, x: Infinity, z: Infinity, carry: -1, action: "none" }); return;
      case "leave": others.delete(m.id); return;
      case "host": host = m.id; return;
      case "state": {
        const o = others.get(m.id);
        if (o) Object.assign(o, { x: m.p[0], z: m.p[2], carry: m.c, action: ACTIONS[m.m[9]!] ?? "none" });
        return;
      }
      case "things": for (const p of m.l) lying.set(p[0], [p[1], p[2], p[3]]); return;
      case "drop": { lying.set(m.s[0], [m.s[1], m.s[2], m.s[3]]); const o = others.get(m.id); if (o) o.carry = -1; return; }
      case "deny": if (carry === m.s) { carry = -1; forget(); say("someone else has that stick"); } return;
      case "build":
        if (m.id === me) return; // made here, applied already
        for (const c of m.c) { apply(state, c); changed(m.id, c); }
        return;
      case "world": state = replay(m.build); say("the server refused a change: took its world"); return;
      case "reset": state = newState(); lying.clear(); carry = -1; forget(); return;
    }
  }, () => { me = host = -1; carry = -1; forget(); });

  /** Makes a change here and sends it, as a browser does: only one that fits the world as this bot knows it. */
  const commit = (c: BuildChange) => {
    if (!apply(state, c)) return false;
    changed(me, c);
    net.send({ t: "build", c: [c] });
    return true;
  };

  const calm = () => pace === "calm" || (pace === "auto" && host >= 0);
  const held = () => new Set([carry, ...[...others.values()].map((o) => o.carry)]);
  const loose = (): Loose[] => {
    const hands = held(), out: Loose[] = [];
    const add = (id: number, at: [number, number, number]) => { if (!hands.has(id) && !state.dam.includes(nameOf(id))) { const p = lying.get(id) ?? at; out.push({ id, x: p[0], z: p[2] }); } };
    world.sticks.forEach((at, id) => add(id, at));
    for (const [key, t] of Object.entries(state.trees)) if (t.split && t.rest) for (const piece of world.woodOf(+key, t.rest)) add(piece.id, piece.at);
    return out;
  };
  /** Where the work on each tree is: its foot, or the middle of its trunk while it lies. */
  const spots = () => world.trees.map((t, i): Spot => {
    const rest = live(state.trees[i])?.rest;
    if (!rest) return { x: t.x, z: t.z };
    const { from, along } = world.lineOf(rest), k = t.trunk / 2;
    return { x: from.x + along.x * k, z: from.z + along.z * k };
  });

  /** Where to go and what to do there for a job. */
  const plan = (job: Job): Doing => {
    const d: Doing = { job, since: time, phase: "go", progress: 0, timer: 0, run: !calm() };
    if (job.kind === "fell") {
      const t = world.trees[job.tree]!, a = world.fallDirection(job.tree), off = t.radius + 0.3;
      Object.assign(d, { to: { x: t.x - Math.sin(a) * off, z: t.z - Math.cos(a) * off }, face: a, action: "gnaw" });
    } else if (job.kind === "split") {
      const t = world.trees[job.tree]!, { from, along } = world.lineOf(live(state.trees[job.tree])!.rest!);
      const flat = Math.hypot(along.x, along.z), k = t.trunk * 0.45, px = from.x + along.x * k, pz = from.z + along.z * k;
      const sx = -along.z / flat * (t.radius + 0.35), sz = along.x / flat * (t.radius + 0.35);
      const sides = [{ x: px + sx, z: pz + sz }, { x: px - sx, z: pz - sz }].sort((a, b) => Math.hypot(a.x - body.x, a.z - body.z) - Math.hypot(b.x - body.x, b.z - body.z));
      const to = sides.find((s) => heightAt(s.x, s.z) > -0.2) ?? sides[0]!;
      Object.assign(d, { to, face: Math.atan2(px - to.x, pz - to.z), action: "gnaw" });
    } else if (job.kind === "fetch") d.action = "pickup"; // where it lies now: each step
    else if (job.kind === "build") {
      const { origin, across, along, lodgeAt } = world.dam;
      if (state.dam.length < SLOTS) {
        const side = ((n % 3) - 1) * 0.5, to = { x: origin.x - across.x * 1.25 + along.x * side, z: origin.z - across.z * 1.25 + along.z * side };
        const slot = world.dam.slot(state.dam.length);
        Object.assign(d, { to, face: Math.atan2(slot.x - to.x, slot.z - to.z), action: "build" });
      } else {
        const a = Math.atan2(-across.x, -across.z) + ((n % 3) - 1) * 0.6, to = { x: lodgeAt.x + Math.sin(a) * 1.7, z: lodgeAt.z + Math.cos(a) * 1.7 };
        Object.assign(d, { to, face: Math.atan2(lodgeAt.x - to.x, lodgeAt.z - to.z), action: "build" });
      }
    } else if (job.kind === "leave") {
      const { origin, across, along } = world.dam, side = rand(-0.9, 0.9);
      const to = { x: origin.x - across.x * 1.9 + along.x * side, z: origin.z - across.z * 1.9 + along.z * side };
      Object.assign(d, { to, face: Math.atan2(across.x, across.z), action: "drop" });
    } else { // wander: somewhere in the clearing, or out into the pond for a swim; there, maybe a slap of the tail
      const swim = Math.random() < 0.3, a = rand(0, Math.PI * 2), r = swim ? rand(0, 2.2) : rand(2, 11);
      const to = swim ? { x: POND.x + Math.cos(a) * r, z: POND.z + Math.sin(a) * r } : { x: Math.cos(a) * r, z: Math.sin(a) * r };
      Object.assign(d, { to, run: false, slap: Math.random() < 0.4 });
    }
    return d;
  };

  /** Whether the job can still be done, as the world is now. */
  const valid = (d: Doing) => {
    const j = d.job, t = "tree" in j ? live(state.trees[j.tree]) : undefined;
    // Two on one tree: on the way, the one who bit first has it; both gnawing already, the one who came in first.
    const last = "tree" in j ? touched.get(j.tree) : undefined, other = !!last && time - last.at < 1.5 && (d.phase === "go" || last.by < me);
    switch (j.kind) {
      case "fell": return !!t && t.fell === undefined && !other;
      case "split": return !!t?.rest && !other;
      case "fetch": return d.progress >= 0.5 || loose().some((s) => s.id === j.stick);
      case "build": return (carry >= 0 || d.progress >= 0.5) && state.dam.length < SLOTS + LODGE;
      case "leave": return carry >= 0 || d.progress >= 0.5;
      case "wander": return true;
    }
  };

  /** One step of the action under way; true when it is done. */
  const work = (d: Doing): boolean => {
    const j = d.job;
    if (d.action === "gnaw" && "tree" in j) {
      const t = live(state.trees[j.tree])!, need = world.trees[j.tree]!.need;
      // Work someone left at its end: finish it without a bite the server would refuse.
      if (j.kind === "fell" && t.bites >= need) return commit({ type: "fell", tree: j.tree, direction: d.face! }), true;
      if (j.kind === "split" && t.splitBites >= BITES_TO_SPLIT) return commit({ type: "split", tree: j.tree }), true;
      if ((d.timer += dt) >= BITE_TIME) {
        d.timer -= BITE_TIME;
        commit({ type: "bite", tree: j.tree });
        if (j.kind === "fell" && t.bites >= need) { commit({ type: "fell", tree: j.tree, direction: d.face! }); say(`felled tree ${j.tree}`); return true; }
        if (j.kind === "split" && t.splitBites >= BITES_TO_SPLIT) { commit({ type: "split", tree: j.tree }); say(`gnawed tree ${j.tree} into wood`); return true; }
      }
      d.progress = j.kind === "fell" ? Math.min(1, (t.bites + d.timer / BITE_TIME) / need) : Math.min(1, (t.splitBites + d.timer / BITE_TIME) / BITES_TO_SPLIT);
      return false;
    }
    const before = d.progress, length = d.action === "pickup" ? PICKUP_TIME : d.action === "drop" ? DROP_TIME : BUILD_TIME;
    d.progress = Math.min(1, before + dt / length);
    const half = before < 0.5 && d.progress >= 0.5;
    if (half && j.kind === "fetch") {
      if (!loose().some((s) => s.id === j.stick)) return true; // gone from under the nose
      carry = j.stick;
      if (!state.found) commit({ type: "find" });
    }
    if (half && j.kind === "build") {
      const placed = state.dam.length;
      if (!(placed < SLOTS ? world.atDam(body.x, body.z) : world.atLodge(body.x, body.z))) return true; // the dam filled meanwhile: think again
      if (commit({ type: "place", slot: placed, stick: nameOf(carry) })) say(`laid ${nameOf(carry)} into the ${placed < SLOTS ? "dam" : "lodge"} (${placed + 1})`);
      carry = -1;
    }
    if (half && j.kind === "leave") {
      const f = body.steering.facing, x = body.x + Math.sin(f) * 0.5, z = body.z + Math.cos(f) * 0.5, y = world.groundAt(x, z, state.dam.length) + 0.05;
      net.send({ t: "drop", s: [carry, r3(x), r3(y), r3(z), 0, r3(Math.sin(f / 2)), 0, r3(Math.cos(f / 2))], v: [0, 0, 0] });
      lying.set(carry, [x, y, z]);
      carry = -1;
    }
    if (d.action) act.progress = d.progress;
    return d.progress >= 1;
  };

  /** Moves the body one step towards `to` (round what stands in the way), or turns it to `face` where it stands. */
  const move = (to: Spot | undefined, face: number | undefined, run: boolean) => {
    const placed = state.dam.length, gap = to ? Math.hypot(to.x - body.x, to.z - body.z) : 0, going = !!to && gap > 0.08;
    const want = going ? heading(body, to!, world.obstacles(state)) : face, top = body.afloat ? SWIM_SPEED : run && gap > 3 ? RUN_SPEED : WALK_SPEED;
    const [accel, brake] = body.afloat ? [SWIM_ACCEL, SWIM_ACCEL] : [ACCEL, BRAKE], facing = body.steering.facing;
    steer(body.steering, want, going ? Math.min(1, 0.3 + gap / 0.5) : 0, top, accel, brake, dt);
    const s = body.steering, x = body.x + Math.sin(s.facing) * s.speed * dt, z = body.z + Math.cos(s.facing) * s.speed * dt;
    const ground = world.groundAt(x, z, placed), level = world.level(placed), y0 = body.y;
    if (!body.afloat && level - ground > FLOAT_DEPTH) body.afloat = true;
    else if (body.afloat && level - ground < FLOAT_DEPTH - 0.02) body.afloat = false;
    body.x = x; body.z = z;
    body.y = body.afloat ? Math.max(ground, body.y + (level - HOLD_DEPTH - body.y) * Math.min(1, 5 * dt)) : ground;
    act.carrying = carry >= 0;
    trackMotion(body.motion, dt, {
      moved: s.speed * dt, vertical: (body.y - y0) / dt, turning: (s.facing - facing) / dt,
      grounded: !body.afloat, afloat: body.afloat, act, slap: body.slap.progress,
    });
  };

  /** What any client would do for the world: lay down a tree that fell where no browser is to find where it lies, and
   *  ask for a tree back once its time is up (build/index.ts, with the same grace). */
  const keep = () => {
    for (const [tree, f] of falling) {
      const t = live(state.trees[tree]);
      if (t?.fell === undefined || t.rest) { falling.delete(tree); continue; }
      // The one who felled it, at once alone, else after the browsers had their time; the others later, one by one.
      const wait = f.mine ? (host < 0 ? FALL_TIME : NOBODY_LAID) : 2 * NOBODY_LAID + n * 3;
      if (time - f.since > wait) {
        commit({ type: "rest", tree, ...world.restFor(tree, t.fell) });
        falling.delete(tree);
      }
    }
    for (const [key, t] of Object.entries(state.trees)) {
      if (!t.split || t.grown || t.gone === undefined || Date.now() - t.gone < (REGROW + GRACE + n * 3) * 1000) continue;
      if (time - (asked.get(+key) ?? -Infinity) > 30) { asked.set(+key, time); commit({ type: "grow", tree: +key }); }
    }
  };

  setInterval(() => {
    time += dt;
    if (!net.open() || me < 0) return;
    keep();
    if (doing && (!valid(doing) || (doing.phase === "go" && time - doing.since > STUCK))) forget();
    if (!doing) {
      const job = decide({ state, trees: spots(), loose: loose(), others: [...others.values()], touched: Object.fromEntries([...touched].map(([t, { at }]) => [t, time - at])),
        me: { x: body.x, z: body.z, carry }, calm: calm(), site: { x: world.dam.origin.x, z: world.dam.origin.z, radius: 2.6 } });
      doing = plan(job);
      if (job.kind !== "wander") say(job.kind === "fetch" ? `fetches ${nameOf(job.stick)}` : "tree" in job ? `${job.kind}s tree ${job.tree}` : `${job.kind}s its stick`);
    }
    const d = doing!;
    let to = d.to, face = d.face;
    if (d.job.kind === "fetch") { // up to the stick, wherever it lies now, and face it
      const s = loose().find((l) => l.id === (d.job as { stick: number }).stick);
      if (s) {
        const gap = Math.hypot(s.x - body.x, s.z - body.z);
        face = Math.atan2(s.x - body.x, s.z - body.z);
        to = d.phase === "go" && gap > 0.6 ? { x: s.x - Math.sin(face) * 0.45, z: s.z - Math.cos(face) * 0.45 } : undefined;
        if (!to && d.phase === "go") d.phase = "act";
      }
    } else if (d.phase === "go" && to && Math.hypot(to.x - body.x, to.z - body.z) < 0.15) {
      d.phase = d.action ? "act" : "pause";
      d.until = time + (calm() ? rand(3, 8) : rand(0.5, 2.5));
    }
    if (d.phase === "act") {
      to = undefined;
      const facing = body.steering.facing, aimed = Math.abs(Math.atan2(Math.sin(face! - facing), Math.cos(face! - facing))) < 0.2;
      if (act.action === "none" && aimed) { act.action = d.action!; act.progress = 0; }
      if (act.action !== "none" && work(d)) {
        // A breath before the next job; after a fall, until the tree lies, to gnaw it into wood next.
        pause(Math.max(d.job.kind === "fell" ? FALL_TIME + 0.5 : 0, calm() ? rand(3, 8) : rand(0.3, 1.2)));
      }
    } else if (d.phase === "pause") {
      to = undefined;
      stepSlap(body.slap, dt, !!d.slap && body.slap.wait === 0, true);
      d.slap = false;
      if (time >= d.until!) forget();
    } else stepSlap(body.slap, dt, false, true);
    move(to, face, !!d.run);
    const r = r3;
    net.send({ t: "state", p: [r(body.x), r(body.y), r(body.z)], f: r(body.steering.facing), m: packMotion(body.motion), c: carry });
    if (!quiet && (nextLine -= dt) <= 0) {
      nextLine = 12 + Math.random() * 13;
      net.send({ t: "chat", text: LINES[Math.floor(Math.random() * LINES.length)]! });
    }
  }, 1000 * dt);
}

if (import.meta.main) {
  const world = idle ? undefined : await loadWorld();
  for (let n = 0; n < count; n++) if (world) workBot(n, world); else idleBot(n);
  console.log(`${count} ${idle ? "idle " : ""}bot(s) on ${url}${idle ? "" : `, pace ${pace}`}`);
}
