// How the animals of the deep basin decide: pure simulation, as brain.ts, for what a diving beaver meets down there.
//
//   const deep = makeDeep(land, bed, counts, random);   stepDeep(deep, land, bed, threat, dt, random, { bed: true });
//   startleDeep(deep, land, bed, at, reach, random)      a tail slap heard under water: everything at once
//
// - a school of small fish that moves as one (cohesion, alignment, separation) through the deep water, parts round
//   the beaver and closes behind it, scatters at a slap and reforms;
// - a hunter (pike-like) that hangs still beside the sunken log and darts at a fish now and then; the beaver close or a
//   slap: it bolts into the weed, stays hidden a while, and glides back;
// - a grazer (carp-like) that roams the bed and noses into it, and swims off from the beaver;
// - crayfish by the rocks, walking and resting, backing away with raised claws when the beaver comes close;
// - mussels on the slope that shut when it passes and open again slowly; snails creeping along the log;
// - water striders at the surface along the edges, skating off from the beaver.
// The threat is the beaver (Threat: its feet; its body is THREAT_UP above them). On land it is no threat down here; at
// the surface it is, but only to what is near it in three dimensions, so the deep stays calm when it swims over.
import { depthAt, headingOf, type Land, type Threat } from "./brain.ts";

type Random = () => number;
export interface Point { x: number; y: number; z: number }
/** What lies down there: the basin (middle, reach), the top of the sunken log at points along it, the rocks on the
 *  bed (their middle and rough radius), the tufts of weed. */
export interface Bed {
  basin: { x: number; z: number; r: number };
  log: Point[];
  rocks: { x: number; z: number; r: number }[];
  weed: { x: number; z: number }[];
}
export interface DeepCounts { school: number; carp: number; crayfish: number; mussels: number; snails: number; striders: number }

const TAU = Math.PI * 2, THREAT_UP = 0.25;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const turnTo = (a: number, b: number) => { const d = (b - a) % TAU; return d > Math.PI ? d - TAU : d < -Math.PI ? d + TAU : d; };
/** How far the beaver's body is from a point, in three dimensions; Infinity while it is on land. */
export const reachOf = (t: Threat, p: Point) => t.swimming ? Math.hypot(p.x - t.x, p.y - t.y - THREAT_UP, p.z - t.z) : Infinity;

/** A point in the deep water: over at least `depth` of it, at a height between the bed and the surface. */
export function deepPoint(land: Land, bed: Bed, random: Random, depth = SCHOOL_DEPTH + 0.3, near = bed.basin): Point {
  for (let i = 0; i < 60; i++) {
    const a = random() * TAU, r = Math.sqrt(random()) * near.r, x = near.x + Math.cos(a) * r, z = near.z + Math.sin(a) * r;
    if (depthAt(land, x, z) > depth) {
      const floor = land.heightAt(x, z);
      return { x, y: lerp(floor + 0.45, land.water - 0.6, random()), z };
    }
  }
  return { x: bed.basin.x, y: land.heightAt(bed.basin.x, bed.basin.z) + 0.6, z: bed.basin.z };
}

// ---- the school --------------------------------------------------------------------------------------------------

export interface Minnow {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  heading: number; pitch: number; phase: number;
  /** 0 calm … 1 scattered: weaker pull to the others, faster. */
  fear: number;
  /** How fast it turns, rad/s: it rolls into the turn and its flank catches the light. */
  turn: number;
}
export interface DeepSchool { fish: Minnow[]; goal: Point; goalTime: number }

const SCHOOL_DEPTH = 1.3; // the least water the school swims over
const PART = 1.0; // m round the beaver's body the school parts
const KEEP = 0.11; // m between two fish
const BODY = 0.3; // m round the beaver's body no fish ever comes

export function makeDeepSchool(land: Land, bed: Bed, count: number, random: Random): DeepSchool {
  const at = deepPoint(land, bed, random);
  const fish = Array.from({ length: count }, () => {
    const x = at.x + (random() - 0.5) * 0.6, z = at.z + (random() - 0.5) * 0.6, heading = random() * 0.6;
    return { x, y: at.y + (random() - 0.5) * 0.3, z, vx: Math.sin(heading) * 0.2, vy: 0, vz: Math.cos(heading) * 0.2, heading, pitch: 0, phase: random() * TAU, fear: 0, turn: 0 };
  });
  return { fish, goal: deepPoint(land, bed, random), goalTime: 0 };
}

export const centre = (list: { x: number; y: number; z: number }[]) => {
  const c = { x: 0, y: 0, z: 0 };
  for (const o of list) { c.x += o.x; c.y += o.y; c.z += o.z; }
  const n = Math.max(1, list.length);
  return { x: c.x / n, y: c.y / n, z: c.z / n };
};
/** How far the fish are from their middle, on average: small when they swim as one. */
export const spread = (list: Point[]) => { const c = centre(list); return list.reduce((s, o) => s + Math.hypot(o.x - c.x, o.y - c.y, o.z - c.z), 0) / Math.max(1, list.length); };

/** Boids in three dimensions: towards the others' middle, the way they swim, apart from the nearest; a wandering goal
 *  in the deep water; round the beaver's body (they part and, past it, close again). */
export function stepDeepSchool(school: DeepSchool, land: Land, bed: Bed, threat: Threat, dt: number, random: Random) {
  const { fish } = school, c = centre(fish);
  school.goalTime -= dt;
  if (school.goalTime <= 0 || Math.hypot(school.goal.x - c.x, school.goal.y - c.y, school.goal.z - c.z) < 0.5) {
    school.goal = deepPoint(land, bed, random);
    school.goalTime = 5 + random() * 7;
  }
  let vx = 0, vy = 0, vz = 0;
  for (const f of fish) { vx += f.vx; vy += f.vy; vz += f.vz; }
  vx /= fish.length || 1; vy /= fish.length || 1; vz /= fish.length || 1;
  const body = { x: threat.x, y: threat.y + THREAT_UP, z: threat.z };
  for (const f of fish) {
    const calm = 1 - f.fear * 0.85;
    let ax = ((c.x - f.x) * 1.6 + (vx - f.vx) * 1.4) * calm + (school.goal.x - f.x) * 0.3;
    let ay = ((c.y - f.y) * 3 + (vy - f.vy) * 1.4) * calm + (school.goal.y - f.y) * 0.15; // flatter than it is wide, as schools are
    let az = ((c.z - f.z) * 1.6 + (vz - f.vz) * 1.4) * calm + (school.goal.z - f.z) * 0.3;
    for (const o of fish) {
      if (o === f) continue;
      const dx = f.x - o.x, dy = f.y - o.y, dz = f.z - o.z, d = Math.hypot(dx, dy, dz);
      if (d < KEEP && d > 1e-5) { const k = (KEEP - d) / d * 60; ax += dx * k; ay += dy * k; az += dz * k; }
    }
    // Round the beaver: pushed off its body, harder the closer; frightened a little, so they speed past.
    const d = reachOf(threat, f);
    if (d < PART) {
      const push = 1 - d / PART, k = 14 * push / Math.max(d, 0.05);
      ax += (f.x - body.x) * k; ay += (f.y - body.y) * k * 0.6; az += (f.z - body.z) * k;
      f.fear = Math.max(f.fear, 0.4 * push);
    }
    // Over the bed, under the surface; out of shallow water ahead, back to the basin.
    const floor = land.heightAt(f.x, f.z);
    if (f.y < floor + 0.35) ay += (floor + 0.35 - f.y) * 8;
    if (f.y > land.water - 0.5) ay -= (f.y - land.water + 0.5) * 8;
    const speed = Math.hypot(f.vx, f.vz) || 1, lx = f.x + f.vx / speed * 0.6, lz = f.z + f.vz / speed * 0.6;
    if (depthAt(land, lx, lz) < SCHOOL_DEPTH) { ax += (bed.basin.x - f.x) * 3; az += (bed.basin.z - f.z) * 3; }
    f.vx += ax * dt; f.vy += ay * dt; f.vz += az * dt;
    const s = Math.hypot(f.vx, f.vy, f.vz), top = 0.42 + f.fear * 1.6, low = 0.12;
    const k = s > top ? top / s : s < low && s > 1e-6 ? low / s : 1;
    f.vx *= k; f.vz *= k; f.vy = clamp(f.vy * k, -0.25 - f.fear * 0.5, 0.25 + f.fear * 0.5);
    const nx = f.x + f.vx * dt, nz = f.z + f.vz * dt;
    if (depthAt(land, nx, nz) > 0.6) { f.x = nx; f.z = nz; } else { f.vx = (bed.basin.x - f.x) * 0.3; f.vz = (bed.basin.z - f.z) * 0.3; }
    f.y = clamp(f.y + f.vy * dt, land.heightAt(f.x, f.z) + 0.1, land.water - 0.15);
    keepOut(f, threat, body);
    const was = f.heading;
    if (Math.hypot(f.vx, f.vz) > 0.03) f.heading += turnTo(f.heading, headingOf(f.vx, f.vz)) * Math.min(1, dt * 9);
    f.turn = lerp(f.turn, turnTo(was, f.heading) / Math.max(dt, 1e-4), Math.min(1, dt * 6));
    f.pitch = clamp(Math.atan2(f.vy, Math.hypot(f.vx, f.vz)), -0.6, 0.6);
    f.fear = Math.max(0, f.fear - dt * 0.3);
    f.phase += dt * (9 + Math.hypot(f.vx, f.vz) * 45);
  }
}

/** The beaver's body is solid to them: a fish it swims into (onto the bed, against the slope, or in one long step)
 *  ends at its edge, sideways where bed or surface are in the way, and swims on from there, not into it. */
function keepOut(f: Minnow, threat: Threat, body: Point) {
  const d = reachOf(threat, f);
  if (d >= BODY) return;
  let dx = f.x - body.x, dy = f.y - body.y, dz = f.z - body.z;
  // Out the way it was: along the bed, or (if too close above or below for that) to the side it faces.
  const side = Math.sqrt(BODY * BODY - Math.min(dy * dy, BODY * BODY * 0.99)), h = Math.hypot(dx, dz);
  if (h < 1e-3) { dx = Math.sin(f.heading); dz = Math.cos(f.heading); } else { dx /= h; dz /= h; }
  f.x = body.x + dx * side; f.z = body.z + dz * side;
  const v = f.vx * dx + f.vz * dz;
  if (v < 0) { f.vx -= v * dx; f.vz -= v * dz; }
}

// ---- the hunter (pike-like) --------------------------------------------------------------------------------------

export interface Hunter extends Point {
  heading: number; pitch: number; speed: number; phase: number;
  /** lurk: hangs still at home beside the log; dart: a strike at a fish; back: glides home; bolt: off into the weed;
   *  hide: still in the weed. */
  state: "lurk" | "dart" | "back" | "bolt" | "hide";
  t: number; to: Point; home: Point & { heading: number };
}

const BOLT = 1.2; // m: the beaver this close and the hunter is off
const STRIKE = 1.4; // m: a fish this close in front of it may be struck at

export function makeHunter(land: Land, bed: Bed, random: Random): Hunter {
  const a = bed.log[0] ?? deepPoint(land, bed, random), b = bed.log[bed.log.length - 1] ?? a, along = headingOf(b.x - a.x, b.z - a.z);
  // Beside the middle of the log, on its deeper side, as high as the log's top.
  const mid = bed.log[Math.floor(bed.log.length / 2)] ?? a, side = [1, -1].map((s) => ({ x: mid.x + Math.cos(along) * 0.32 * s, z: mid.z - Math.sin(along) * 0.32 * s }))
    .sort((p, q) => land.heightAt(p.x, p.z) - land.heightAt(q.x, q.z))[0]!;
  const home = { x: side.x, y: Math.min(mid.y + 0.04, land.water - 0.6), z: side.z, heading: along + (random() < 0.5 ? 0 : Math.PI) };
  return { ...home, heading: home.heading, pitch: 0, speed: 0, phase: random() * TAU, state: "lurk", t: 2 + random() * 3, to: { ...home }, home };
}

/** Off into the weed: the tuft that is farthest from the beaver for the way there. */
export function bolt(h: Hunter, land: Land, bed: Bed, from: Point) {
  let best: Point = { x: bed.basin.x, y: 0, z: bed.basin.z }, score = -Infinity;
  for (const w of bed.weed) {
    const s = Math.hypot(w.x - from.x, w.z - from.z) - 0.4 * Math.hypot(w.x - h.x, w.z - h.z);
    if (s > score && depthAt(land, w.x, w.z) > 0.8) { score = s; best = { x: w.x, y: 0, z: w.z }; }
  }
  best.y = land.heightAt(best.x, best.z) + 0.3;
  h.to = best; h.state = "bolt"; h.t = 3;
}

export function stepHunter(h: Hunter, land: Land, bed: Bed, school: DeepSchool, threat: Threat, dt: number, random: Random) {
  const d = reachOf(threat, h);
  if (d < BOLT && (h.state === "lurk" || h.state === "dart" || h.state === "back")) bolt(h, land, bed, { x: threat.x, y: threat.y, z: threat.z });
  h.t -= dt;
  let want = 0;
  if (h.state === "lurk") {
    // Holds its place with the fins, nose along the log; now and then a strike at a fish that comes close in front.
    h.x = lerp(h.x, h.home.x, Math.min(1, dt)); h.y = lerp(h.y, h.home.y, Math.min(1, dt)); h.z = lerp(h.z, h.home.z, Math.min(1, dt));
    h.heading += turnTo(h.heading, h.home.heading) * Math.min(1, dt * 0.8);
    if (h.t <= 0) {
      const prey = school.fish.find((f) => {
        const dx = f.x - h.x, dz = f.z - h.z, r = Math.hypot(dx, f.y - h.y, dz);
        return r < STRIKE && Math.abs(turnTo(h.heading, headingOf(dx, dz))) < 0.9;
      });
      if (prey) { h.state = "dart"; h.to = { x: prey.x, y: prey.y, z: prey.z }; h.t = 0.45; }
      else h.t = 1.5 + random() * 3;
    }
  } else if (h.state === "dart") {
    want = 2.8;
    if (h.t <= 0 || Math.hypot(h.to.x - h.x, h.to.y - h.y, h.to.z - h.z) < 0.08) { h.state = "back"; h.t = 20; }
  } else if (h.state === "back") {
    h.to = h.home; want = 0.35;
    if (Math.hypot(h.home.x - h.x, h.home.y - h.y, h.home.z - h.z) < 0.08 || h.t <= 0) { h.state = "lurk"; h.t = 3 + random() * 5; }
  } else if (h.state === "bolt") {
    want = 2.4;
    if (Math.hypot(h.to.x - h.x, h.to.z - h.z) < 0.15 || h.t <= 0) { h.state = "hide"; h.t = 8 + random() * 6; }
  } else { // hide: still in the weed until the beaver has gone; found there, off again
    if (d < BOLT * 0.6) bolt(h, land, bed, { x: threat.x, y: threat.y, z: threat.z });
    else if (h.t <= 0 && d > BOLT * 1.6) { h.state = "back"; h.t = 20; }
  }
  if (want > 0) {
    const dx = h.to.x - h.x, dy = h.to.y - h.y, dz = h.to.z - h.z, r = Math.hypot(dx, dy, dz);
    h.speed = lerp(h.speed, want, Math.min(1, dt * (want > 1 ? 10 : 2)));
    const step = Math.min(r, h.speed * dt);
    if (r > 1e-4) {
      const nx = h.x + dx / r * step, nz = h.z + dz / r * step;
      if (depthAt(land, nx, nz) > 0.5) { h.x = nx; h.z = nz; }
      h.y += dy / r * step;
      h.heading += turnTo(h.heading, headingOf(dx, dz)) * Math.min(1, dt * (want > 1 ? 14 : 3));
      h.pitch = lerp(h.pitch, clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.5, 0.5), Math.min(1, dt * 4));
    }
  } else { h.speed = lerp(h.speed, 0, Math.min(1, dt * 3)); h.pitch = lerp(h.pitch, 0, Math.min(1, dt * 2)); }
  h.y = clamp(h.y, land.heightAt(h.x, h.z) + 0.12, land.water - 0.25);
  h.phase += dt * (3 + h.speed * 9);
}

// ---- the grazer (carp-like) --------------------------------------------------------------------------------------

export interface Grazer extends Point {
  heading: number; pitch: number; speed: number; phase: number;
  /** swim: to the next spot; graze: nose in the mud; flee: off from the beaver. */
  state: "swim" | "graze" | "flee";
  t: number; to: { x: number; z: number };
}

const GRAZE_DEPTH = 0.9;

export function makeGrazer(land: Land, bed: Bed, random: Random): Grazer {
  const p = deepPoint(land, bed, random, GRAZE_DEPTH, { x: land.pond.x, z: land.pond.z, r: land.pond.radius });
  return { x: p.x, y: land.heightAt(p.x, p.z) + 0.15, z: p.z, heading: random() * TAU, pitch: 0, speed: 0, phase: random() * TAU, state: "graze", t: random() * 4, to: p };
}

export function stepGrazer(g: Grazer, land: Land, bed: Bed, threat: Threat, dt: number, random: Random) {
  const d = reachOf(threat, g);
  if (d < 1.5 && g.state !== "flee") flight(g, land, bed, threat, random);
  g.t -= dt;
  let want = 0;
  if (g.state === "graze") {
    g.heading += Math.sin(g.phase * 0.4) * dt * 0.25; // rooting about
    if (g.t <= 0) {
      g.to = deepPoint(land, bed, random, GRAZE_DEPTH, { x: g.x, z: g.z, r: 2.5 });
      g.state = "swim"; g.t = 15;
    }
  } else {
    want = g.state === "flee" ? 1.1 : 0.22;
    const dx = g.to.x - g.x, dz = g.to.z - g.z, r = Math.hypot(dx, dz);
    if (r < 0.3 || g.t <= 0) { g.state = "graze"; g.t = 4 + random() * 7; }
    else g.heading += turnTo(g.heading, headingOf(dx, dz)) * Math.min(1, dt * (g.state === "flee" ? 5 : 1.5));
  }
  g.speed = lerp(g.speed, want, Math.min(1, dt * (want > 0.5 ? 4 : 1)));
  const nx = g.x + Math.sin(g.heading) * g.speed * dt, nz = g.z + Math.cos(g.heading) * g.speed * dt;
  if (depthAt(land, nx, nz) > GRAZE_DEPTH - 0.2) { g.x = nx; g.z = nz; }
  else { g.to = deepPoint(land, bed, random, GRAZE_DEPTH, { x: land.pond.x, z: land.pond.z, r: land.pond.radius }); g.state = "swim"; g.t = 15; }
  const grazing = g.state === "graze" ? 1 : 0;
  g.pitch = lerp(g.pitch, 0.45 * grazing, Math.min(1, dt * 1.5)); // nose down to the bed
  const floor = land.heightAt(g.x, g.z);
  g.y = Math.max(floor + 0.08, lerp(g.y, Math.min(floor + 0.16 + 0.12 * (1 - grazing), land.water - 0.3), Math.min(1, dt * 2)));
  g.phase += dt * (2 + g.speed * 10);
}

function flight(g: Grazer, land: Land, bed: Bed, from: { x: number; z: number }, random: Random) {
  let best = g.to, score = -1;
  for (let k = 0; k < 8; k++) {
    const p = deepPoint(land, bed, random, GRAZE_DEPTH, { x: land.pond.x, z: land.pond.z, r: land.pond.radius }), s = Math.hypot(p.x - from.x, p.z - from.z);
    if (s > score) { score = s; best = p; }
  }
  g.to = best; g.state = "flee"; g.t = 6;
}

// ---- crayfish, mussels, snails -----------------------------------------------------------------------------------

export interface Crayfish extends Point {
  heading: number; phase: number;
  /** walk: a few steps about its rock; rest; back: backing away from the beaver, claws up. */
  state: "walk" | "rest" | "back";
  t: number; to: { x: number; z: number }; home: { x: number; z: number; r: number };
  /** 0 … 1 the claws raised; -1 … 1 the legs walking backwards … forwards. */
  raise: number; walk: number;
}

const CLAWS = 1.3; // m: the beaver this close and a crayfish backs off

export function makeCrayfish(land: Land, bed: Bed, count: number, random: Random): Crayfish[] {
  return Array.from({ length: count }, (_, i) => {
    const rock = bed.rocks[i % Math.max(1, bed.rocks.length)] ?? { x: bed.basin.x, z: bed.basin.z, r: 0.3 };
    const a = random() * TAU, r = rock.r + 0.2, x = rock.x + Math.cos(a) * r, z = rock.z + Math.sin(a) * r;
    const home = { x: rock.x, z: rock.z, r: rock.r + 0.6 };
    return { x, y: land.heightAt(x, z), z, heading: headingOf(rock.x - x, rock.z - z) + Math.PI, phase: random() * TAU, state: "rest", t: random() * 3, to: { x, z }, home, raise: 0, walk: 0 };
  });
}

export function stepCrayfish(list: Crayfish[], land: Land, threat: Threat, dt: number, random: Random) {
  for (const c of list) {
    const d = reachOf(threat, c);
    if (d < CLAWS) { c.state = "back"; c.t = Math.max(c.t, 1); }
    c.t -= dt;
    let speed = 0;
    if (c.state === "back") {
      // Faces the beaver, claws up, and backs off.
      c.heading += turnTo(c.heading, headingOf(threat.x - c.x, threat.z - c.z)) * Math.min(1, dt * 4);
      c.raise = Math.min(1, c.raise + dt * 4);
      speed = -0.22;
      if (c.t <= 0) { c.state = "rest"; c.t = 3 + random() * 3; }
    } else {
      c.raise = Math.max(0, c.raise - dt * 0.4); // the claws come down slowly: settled again
      if (c.state === "rest" && c.t <= 0) {
        const a = random() * TAU, r = Math.sqrt(random()) * c.home.r;
        c.to = { x: c.home.x + Math.cos(a) * r, z: c.home.z + Math.sin(a) * r };
        c.state = "walk"; c.t = 8;
      }
      if (c.state === "walk") {
        const dx = c.to.x - c.x, dz = c.to.z - c.z;
        c.heading += turnTo(c.heading, headingOf(dx, dz)) * Math.min(1, dt * 2);
        speed = 0.07;
        if (Math.hypot(dx, dz) < 0.05 || c.t <= 0) { c.state = "rest"; c.t = 2 + random() * 5; }
      }
    }
    const nx = c.x + Math.sin(c.heading) * speed * dt, nz = c.z + Math.cos(c.heading) * speed * dt;
    if (depthAt(land, nx, nz) > 0.7 && Math.hypot(nx - c.home.x, nz - c.home.z) < c.home.r + 1) { c.x = nx; c.z = nz; }
    c.y = land.heightAt(c.x, c.z);
    c.walk = lerp(c.walk, Math.sign(speed), Math.min(1, dt * 6));
    c.phase += dt * 14 * Math.abs(c.walk);
  }
}

export interface Mussel extends Point {
  /** Downhill, and how steep it lies. */
  heading: number; tilt: number;
  /** 0 shut … 1 open; seconds it stays shut after the beaver has gone. */
  open: number; shut: number;
}

/** Mussels on the basin's slope: where it is steep, spread apart. */
export function makeMussels(land: Land, bed: Bed, count: number, random: Random): Mussel[] {
  const out: Mussel[] = [];
  for (let i = 0; out.length < count && i < 600; i++) {
    const a = random() * TAU, r = (0.4 + 0.8 * Math.sqrt(random())) * bed.basin.r, x = bed.basin.x + Math.cos(a) * r, z = bed.basin.z + Math.sin(a) * r;
    const depth = depthAt(land, x, z), e = 0.15;
    const gx = (land.heightAt(x + e, z) - land.heightAt(x - e, z)) / (2 * e), gz = (land.heightAt(x, z + e) - land.heightAt(x, z - e)) / (2 * e);
    const slope = Math.hypot(gx, gz);
    if (depth < 1.1 || depth > 2.8 || slope < 0.3 || out.some((m) => Math.hypot(m.x - x, m.z - z) < 0.35) || bed.rocks.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + 0.2)) continue;
    out.push({ x, y: land.heightAt(x, z), z, heading: headingOf(-gx, -gz), tilt: Math.atan(slope) * 0.7, open: 1, shut: 0 });
  }
  return out;
}

export function stepMussels(list: Mussel[], threat: Threat, dt: number) {
  for (const m of list) {
    if (reachOf(threat, m) < 1.2) m.shut = 4;
    if (m.shut > 0) { m.shut -= dt; m.open = Math.max(0, m.open - dt * 6); }
    else m.open = Math.min(1, m.open + dt * 0.15);
  }
}

export interface Snail extends Point {
  /** 0 … 1 along the log's top; which way it creeps; 0 out … 1 drawn into its shell. */
  along: number; way: number; heading: number; hide: number; phase: number;
}

export function makeSnails(bed: Bed, count: number, random: Random): Snail[] {
  if (bed.log.length < 2) return [];
  return Array.from({ length: count }, () => {
    const s = { along: random(), way: random() < 0.5 ? -1 : 1, x: 0, y: 0, z: 0, heading: 0, hide: 0, phase: random() * TAU };
    return placeSnail(s, bed);
  });
}

function placeSnail(s: Snail, bed: Bed) {
  const k = clamp(s.along, 0, 1) * (bed.log.length - 1), i = Math.min(bed.log.length - 2, Math.floor(k)), a = bed.log[i]!, b = bed.log[i + 1]!, t = k - i;
  s.x = lerp(a.x, b.x, t); s.y = lerp(a.y, b.y, t); s.z = lerp(a.z, b.z, t);
  s.heading = headingOf((b.x - a.x) * s.way, (b.z - a.z) * s.way);
  return s;
}

export function stepSnails(list: Snail[], bed: Bed, threat: Threat, dt: number) {
  const length = bed.log.reduce((s, p, i) => i ? s + Math.hypot(p.x - bed.log[i - 1]!.x, p.z - bed.log[i - 1]!.z) : 0, 0) || 1;
  for (const s of list) {
    s.hide = clamp(s.hide + (reachOf(threat, s) < 0.7 ? dt * 3 : -dt * 0.3), 0, 1);
    if (s.hide < 0.2) s.along += s.way * 0.008 * dt / length; // 8 mm a second
    if (s.along < 0.05 || s.along > 0.95) s.way = s.along < 0.5 ? 1 : -1;
    s.phase += dt * (1 - s.hide);
    placeSnail(s, bed);
  }
}

// ---- water striders ----------------------------------------------------------------------------------------------

export interface Strider { x: number; z: number; vx: number; vz: number; heading: number; t: number; phase: number; stroke: number }

const EDGE = { low: 0.04, high: 0.45 }; // m of water under the striders: they keep to the edges

export function makeStriders(land: Land, count: number, random: Random): Strider[] {
  const out: Strider[] = [];
  for (let i = 0; out.length < count && i < count * 200; i++) {
    const a = random() * TAU, r = land.pond.radius * (0.6 + random() * 0.6), x = land.pond.x + Math.cos(a) * r, z = land.pond.z + Math.sin(a) * r;
    const depth = depthAt(land, x, z);
    if (depth > EDGE.low + 0.03 && depth < EDGE.high - 0.1) out.push({ x, z, vx: 0, vz: 0, heading: random() * TAU, t: random(), phase: 0, stroke: 0 });
  }
  return out;
}

/** Glides with strokes of the long middle legs; off at once from the beaver, back from open or too shallow water. */
export function stepStriders(list: Strider[], land: Land, threat: Threat, dt: number, random: Random) {
  for (const s of list) {
    s.t -= dt;
    const near = Math.hypot(s.x - threat.x, s.z - threat.z) < (threat.swimming ? 1.2 : 0.8) && threat.y < land.water + 0.6;
    if (near || s.t <= 0) {
      const depth = depthAt(land, s.x, s.z);
      let heading = s.heading + (random() - 0.5) * 2.5;
      if (near) heading = headingOf(s.x - threat.x, s.z - threat.z) + (random() - 0.5) * 0.8;
      else if (depth > EDGE.high) heading = headingOf(s.x - land.pond.x, s.z - land.pond.z); // out towards the edge
      else if (depth < EDGE.low + 0.02) heading = headingOf(land.pond.x - s.x, land.pond.z - s.z);
      const push = near ? 1.1 : 0.25 + random() * 0.3;
      s.heading = heading; s.vx = Math.sin(heading) * push; s.vz = Math.cos(heading) * push;
      s.t = near ? 0.3 : 0.5 + random() * 1.5; s.stroke = 1;
    }
    const drag = Math.exp(-dt * 3);
    s.vx *= drag; s.vz *= drag;
    const nx = s.x + s.vx * dt, nz = s.z + s.vz * dt;
    if (depthAt(land, nx, nz) > EDGE.low) { s.x = nx; s.z = nz; } else { s.vx = 0; s.vz = 0; }
    s.stroke = Math.max(0, s.stroke - dt * 4);
    s.phase += dt;
  }
}

// ---- all of them -------------------------------------------------------------------------------------------------

export interface Deep {
  school: DeepSchool; hunter: Hunter; carp: Grazer[]; crayfish: Crayfish[]; mussels: Mussel[]; snails: Snail[]; striders: Strider[];
}

export function makeDeep(land: Land, bed: Bed, n: DeepCounts, random: Random): Deep {
  return {
    school: makeDeepSchool(land, bed, n.school, random), hunter: makeHunter(land, bed, random),
    carp: Array.from({ length: n.carp }, () => makeGrazer(land, bed, random)),
    crayfish: makeCrayfish(land, bed, n.crayfish, random), mussels: makeMussels(land, bed, n.mussels, random), snails: makeSnails(bed, n.snails, random),
    striders: makeStriders(land, n.striders, random),
  };
}

/** One step for all; `onBed` false leaves the small things on the bed (unseen from above) as they are. */
export function stepDeep(deep: Deep, land: Land, bed: Bed, threat: Threat, dt: number, random: Random, onBed = true) {
  stepDeepSchool(deep.school, land, bed, threat, dt, random);
  stepHunter(deep.hunter, land, bed, deep.school, threat, dt, random);
  for (const g of deep.carp) stepGrazer(g, land, bed, threat, dt, random);
  stepStriders(deep.striders, land, threat, dt, random);
  if (!onBed) return;
  stepCrayfish(deep.crayfish, land, threat, dt, random);
  stepMussels(deep.mussels, threat, dt);
  stepSnails(deep.snails, bed, threat, dt);
}

/** A tail slap heard under water: the school scatters (and reforms by itself), the hunter bolts into the weed, the
 *  carp swims off, crayfish back off, mussels shut, snails draw in, striders skate away. How many took fright. */
export function startleDeep(deep: Deep, land: Land, bed: Bed, at: { x: number; z: number }, reach: number, random: Random) {
  const near = (o: { x: number; z: number }) => Math.hypot(o.x - at.x, o.z - at.z) < reach;
  const threat: Threat = { x: at.x, y: land.water - THREAT_UP, z: at.z, speed: 2, swimming: true };
  let count = 0;
  const c = centre(deep.school.fish);
  for (const f of deep.school.fish) if (near(f)) {
    // Out from the school's middle, every fish its own way, and away from the slap: the school bursts apart.
    const dx = f.x - at.x, dz = f.z - at.z, d = Math.max(0.1, Math.hypot(dx, dz)), ox = f.x - c.x, oz = f.z - c.z, o = Math.max(0.02, Math.hypot(ox, oz));
    const wx = ox / o + 0.5 * dx / d, wz = oz / o + 0.5 * dz / d, w = Math.max(1e-3, Math.hypot(wx, wz)), a = (random() - 0.5) * 1.2;
    const ux = wx / w, uz = wz / w, speed = 1.2 + random() * 0.8;
    f.vx = (ux * Math.cos(a) - uz * Math.sin(a)) * speed; f.vz = (uz * Math.cos(a) + ux * Math.sin(a)) * speed; f.vy = -0.3 - random() * 0.4;
    f.fear = 1;
    count++;
  }
  if (count) { deep.school.goal = deepPoint(land, bed, random); deep.school.goalTime = 8; }
  if (near(deep.hunter) && deep.hunter.state !== "hide") { bolt(deep.hunter, land, bed, threat); count++; }
  for (const g of deep.carp) if (near(g)) { flight(g, land, bed, at, random); count++; }
  for (const c of deep.crayfish) if (near(c)) { c.state = "back"; c.t = 2; count++; }
  for (const m of deep.mussels) if (near(m)) { m.shut = 6; count++; }
  for (const s of deep.snails) if (near(s)) s.hide = 1;
  for (const s of deep.striders) if (near(s)) {
    s.heading = headingOf(s.x - at.x, s.z - at.z);
    s.vx = Math.sin(s.heading) * 1.1; s.vz = Math.cos(s.heading) * 1.1; s.t = 0.4; s.stroke = 1;
    count++;
  }
  return count;
}
