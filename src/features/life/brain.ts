// How the animals decide: pure simulation over positions and velocities.
//
//   const land: Land = { heightAt, water: 0, rim: 14, pond: { x, z, radius } };
//   const school = makeSchool(land, 10, random);   stepSchool(school, land, threat, dt, random);
//   …the same for birds, flyers (butterflies, dragonflies), frogs and ducks.
//
// Every step function moves its animals by dt seconds and keeps them where they belong: fish under the surface and
// above the floor, birds and insects above the ground, frogs and ducks at or in the pond, everything inside the rim.
// The `threat` is the beaver; each kind flees from it in its own way. Splashes (frog jumps, fish darting, ducks
// rushing) are pushed into `splashes` for whoever draws rings. startle() is a tail slap's alarm: all of them at once.

export interface Land {
  heightAt(x: number, z: number): number;
  /** Height of the pond's surface. */
  water: number;
  /** Animals stay this close to the middle of the world. */
  rim: number;
  pond: { x: number; z: number; radius: number };
}

/** The beaver, as the animals see it. */
export interface Threat { x: number; y: number; z: number; speed: number; swimming: boolean }

export interface Splash { x: number; z: number; size: number }

type Random = () => number;
const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** The shortest turn from heading a to heading b. */
const turnTo = (a: number, b: number) => { const d = (b - a) % TAU; return d > Math.PI ? d - TAU : d < -Math.PI ? d + TAU : d; };
/** Heading of a direction, as the animals face: +z is heading 0, turning towards +x. */
export const headingOf = (dx: number, dz: number) => Math.atan2(dx, dz);

export const depthAt = (land: Land, x: number, z: number) => land.water - land.heightAt(x, z);
const dry = (land: Land, x: number, z: number) => land.heightAt(x, z) > land.water + 0.05;
const inside = (land: Land, x: number, z: number) => Math.hypot(x, z) < land.rim;
const far = (t: Threat, x: number, z: number) => Math.hypot(x - t.x, z - t.z);

/** A random point in the pond at least `depth` deep, or the pond's middle. */
export function pondPoint(land: Land, random: Random, depth: number, near?: { x: number; z: number; r: number }) {
  const c = near ?? { x: land.pond.x, z: land.pond.z, r: land.pond.radius };
  for (let i = 0; i < 60; i++) {
    const a = random() * TAU, r = Math.sqrt(random()) * c.r, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    if (depthAt(land, x, z) > depth) return { x, z };
  }
  return { x: land.pond.x, z: land.pond.z };
}

/** A random point of dry, fairly flat ground inside the rim, kept `away` metres from the threat when given. */
export function meadowPoint(land: Land, random: Random, around?: { x: number; z: number; r: number }, threat?: Threat, away = 0) {
  const c = around ?? { x: 0, z: 0, r: land.rim - 1 };
  let best = { x: 0, z: 0 }, bestScore = -Infinity;
  for (let i = 0; i < 40; i++) {
    const a = random() * TAU, r = Math.sqrt(random()) * c.r, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    if (!inside(land, x, z) || !dry(land, x, z)) continue;
    const steep = Math.abs(land.heightAt(x + 0.3, z) - land.heightAt(x - 0.3, z)) + Math.abs(land.heightAt(x, z + 0.3) - land.heightAt(x, z - 0.3));
    if (steep > 0.35) continue;
    const score = threat ? Math.min(far(threat, x, z), away) : 0;
    if (score >= away) return { x, z };
    if (score > bestScore) { bestScore = score; best = { x, z }; }
  }
  return bestScore > -Infinity ? best : { x: 0, z: 0 };
}

// ---- fish --------------------------------------------------------------------------------------------------------

export interface Fish { x: number; y: number; z: number; vx: number; vz: number; heading: number; phase: number; fear: number }
export interface School { fish: Fish[]; goal: { x: number; z: number }; goalTime: number }

const FISH_DEPTH = 0.28; // the least water a fish swims in

export function makeSchool(land: Land, count: number, random: Random): School {
  const at = pondPoint(land, random, 0.6);
  const fish = Array.from({ length: count }, () => {
    const p = pondPoint(land, random, FISH_DEPTH, { ...at, r: 0.8 });
    return { x: p.x, y: land.water - 0.2, z: p.z, vx: 0, vz: 0, heading: random() * TAU, phase: random() * TAU, fear: 0 };
  });
  return { fish, goal: pondPoint(land, random, 0.6), goalTime: 0 };
}

/** Boids in the plane: stay together, swim the same way, keep apart, follow a wandering goal, dart from the beaver. */
export function stepSchool(school: School, land: Land, threat: Threat, dt: number, random: Random, splashes: Splash[] = []) {
  const { fish } = school;
  school.goalTime -= dt;
  if (school.goalTime <= 0 || Math.hypot(school.goal.x - mean(fish, "x"), school.goal.z - mean(fish, "z")) < 0.5) {
    school.goal = pondPoint(land, random, 0.6);
    school.goalTime = 6 + random() * 8;
  }
  const cx = mean(fish, "x"), cz = mean(fish, "z"), vx = mean(fish, "vx"), vz = mean(fish, "vz");
  // Near a swimming beaver the water is dangerous; from the shore it is only a shadow, noticed closer.
  const reach = threat.swimming ? 2.6 : threat.y < land.water + 0.5 ? 1.4 : 0;
  for (const f of fish) {
    let ax = (cx - f.x) * 0.6 + (vx - f.vx) * 0.9 + (school.goal.x - f.x) * 0.15;
    let az = (cz - f.z) * 0.6 + (vz - f.vz) * 0.9 + (school.goal.z - f.z) * 0.15;
    for (const o of fish) {
      if (o === f) continue;
      const dx = f.x - o.x, dz = f.z - o.z, d = Math.hypot(dx, dz);
      if (d < 0.22 && d > 1e-4) { ax += dx / d * (0.22 - d) * 25; az += dz / d * (0.22 - d) * 25; }
    }
    const d = far(threat, f.x, f.z);
    if (d < reach) {
      if (f.fear < 0.3) splashes.push({ x: f.x, z: f.z, size: 0.25 });
      f.fear = 1;
      const away = d > 1e-3 ? 1 / d : 0;
      ax += (f.x - threat.x) * away * 14 * (1 - d / reach + 0.3);
      az += (f.z - threat.z) * away * 14 * (1 - d / reach + 0.3);
    }
    f.fear = Math.max(0, f.fear - dt * 0.6);
    // Shallow water ahead: turn back to the middle.
    const speed = Math.hypot(f.vx, f.vz), lx = f.x + (speed > 1e-3 ? f.vx / speed : 0) * 0.5, lz = f.z + (speed > 1e-3 ? f.vz / speed : 0) * 0.5;
    if (depthAt(land, lx, lz) < FISH_DEPTH + 0.15) { ax += (land.pond.x - f.x) * 3; az += (land.pond.z - f.z) * 3; }
    f.vx += ax * dt; f.vz += az * dt;
    const top = lerp(0.3, 1.8, f.fear), low = 0.08, s = Math.hypot(f.vx, f.vz);
    const k = s > top ? top / s : s < low && s > 1e-6 ? low / s : 1;
    f.vx *= k; f.vz *= k;
    const nx = f.x + f.vx * dt, nz = f.z + f.vz * dt;
    if (depthAt(land, nx, nz) > FISH_DEPTH && inside(land, nx, nz)) { f.x = nx; f.z = nz; }
    else { f.vx = (land.pond.x - f.x) * 0.3; f.vz = (land.pond.z - f.z) * 0.3; }
    if (Math.hypot(f.vx, f.vz) > 0.02) f.heading += turnTo(f.heading, headingOf(f.vx, f.vz)) * Math.min(1, dt * 8);
    // Deeper when afraid; never through the floor, never out of the water.
    const floor = land.heightAt(f.x, f.z);
    const want = land.water - lerp(0.16, 0.4, f.fear) - 0.05 * Math.sin(f.phase * 0.3) - 0.45 * Math.max(0, land.water - floor - 1); // down into the deep basin
    f.y = clamp(lerp(f.y, want, Math.min(1, dt * 2)), floor + 0.08, land.water - 0.08);
    f.phase += dt * (6 + Math.hypot(f.vx, f.vz) * 30);
  }
}

const mean = <T extends Record<K, number>, K extends string>(list: T[], key: K) => list.reduce((s, o) => s + o[key], 0) / Math.max(1, list.length);

// ---- birds on the ground -----------------------------------------------------------------------------------------

/** A place to sit: on the ground (y is the ground's height there) or on top of a log. */
export interface Perch { x: number; y: number; z: number }

export interface Bird {
  x: number; y: number; z: number; heading: number;
  state: "ground" | "fly";
  /** Seconds left in the current hop, peck or flight; and how long it is. */
  t: number; length: number;
  from: Perch; to: Perch;
  /** 0 standing … 1 head down. */
  peck: number;
  /** Wings: 0 folded … 1 spread; and how hard they beat. */
  spread: number; flap: number; phase: number;
  /** Seconds until it flies up because the others did; Infinity: no alarm. */
  alarm: number;
  /** Seconds until it moves to another place by itself. */
  restless: number;
}

export function makeBirds(land: Land, count: number, perches: Perch[], random: Random): Bird[] {
  return Array.from({ length: count }, (_, i) => {
    const p = i < perches.length && i % 2 === 0 ? perches[i]! : groundPerch(land, meadowPoint(land, random));
    return { x: p.x, y: p.y, z: p.z, heading: random() * TAU, state: "ground", t: random(), length: 1, from: p, to: p,
      peck: 0, spread: 0, flap: 0, phase: random() * TAU, alarm: Infinity, restless: 10 + random() * 30 };
  });
}

const groundPerch = (land: Land, p: { x: number; z: number }): Perch => ({ x: p.x, y: land.heightAt(p.x, p.z), z: p.z });

/** Where a bird lands: a free perch or open ground, well away from the beaver. */
const FLY_REACH = 28; // m: the farthest a small bird flies at once (across the first, smaller clearing)

export function pickLanding(land: Land, perches: Perch[], threat: Threat, random: Random, taken: Perch[] = [], from?: { x: number; z: number }): Perch {
  // A flight of a few seconds at most, however big the clearing: a perch or a patch of meadow within reach.
  const reach = (p: { x: number; z: number }) => !from || Math.hypot(p.x - from.x, p.z - from.z) < FLY_REACH;
  const freePerches = perches.filter((p) => far(threat, p.x, p.z) > 7 && reach(p) && taken.every((t) => Math.hypot(t.x - p.x, t.z - p.z) > 0.3));
  if (freePerches.length && random() < 0.6) return freePerches[Math.floor(random() * freePerches.length)]!;
  return groundPerch(land, meadowPoint(land, random, from && { ...from, r: FLY_REACH / 2 }, threat, 8));
}

export function stepBirds(birds: Bird[], land: Land, perches: Perch[], threat: Threat, dt: number, random: Random) {
  for (const b of birds) {
    if (b.state === "ground") {
      const d = far(threat, b.x, b.z), scare = threat.speed > 1.2 ? 4 : 2.8;
      b.alarm -= dt;
      b.restless -= dt;
      if (d < scare || b.alarm <= 0 || b.restless <= 0) {
        if (d < scare || b.alarm <= 0) for (const o of birds) if (o !== b && o.state === "ground" && Math.hypot(o.x - b.x, o.z - b.z) < 3)
          o.alarm = Math.min(o.alarm, 0.1 + random() * 0.35);
        takeOff(b, land, pickLanding(land, perches, threat, random, birds.filter((o) => o !== b).map((o) => o.to), b));
        continue;
      }
      // Pecking and hopping about.
      b.t -= dt;
      if (b.t <= 0) {
        const onPerch = Math.abs(b.y - land.heightAt(b.x, b.z)) > 0.05;
        if (random() < 0.45) { b.length = b.t = 0.5 + random() * 0.6; b.peck = 1; } // a peck
        else {
          b.peck = 0;
          b.heading += (random() - 0.5) * 2.4;
          const hop = onPerch ? 0 : 0.07 + random() * 0.1, nx = b.x + Math.sin(b.heading) * hop, nz = b.z + Math.cos(b.heading) * hop;
          b.from = { x: b.x, y: b.y, z: b.z };
          b.to = hop && dry(land, nx, nz) && inside(land, nx, nz) ? groundPerch(land, { x: nx, z: nz }) : { ...b.from };
          b.length = b.t = 0.18;
        }
      }
      const k = 1 - Math.max(0, b.t) / b.length;
      if (b.peck) b.peck = Math.sin(Math.min(1, k) * Math.PI);
      else {
        b.x = lerp(b.from.x, b.to.x, k); b.z = lerp(b.from.z, b.to.z, k);
        b.y = lerp(b.from.y, b.to.y, k) + Math.sin(k * Math.PI) * 0.04;
      }
      b.spread = Math.max(0, b.spread - dt * 4);
      b.flap = 0;
    } else {
      b.t -= dt;
      const k = clamp(1 - b.t / b.length, 0, 1), dist = Math.hypot(b.to.x - b.from.x, b.to.z - b.from.z);
      b.x = lerp(b.from.x, b.to.x, k); b.z = lerp(b.from.z, b.to.z, k);
      const arc = Math.sin(k * Math.PI) * (1.2 + dist * 0.12);
      b.y = Math.max(lerp(b.from.y, b.to.y, k) + arc, land.heightAt(b.x, b.z) + 0.03);
      b.heading += turnTo(b.heading, headingOf(b.to.x - b.from.x, b.to.z - b.from.z)) * Math.min(1, dt * 10);
      b.spread = Math.min(1, b.spread + dt * 8);
      // Beat hard to rise and to land, glide in bounds between.
      b.flap = k < 0.3 || k > 0.8 ? 1 : Math.sin(k * 40) > 0 ? 1 : 0.1;
      if (b.t <= 0) {
        Object.assign(b, { ...b.to, state: "ground", t: 0.3, length: 0.3, peck: 0, flap: 0, alarm: Infinity, restless: 15 + random() * 40 });
        b.from = { ...b.to };
      }
    }
    b.phase += dt * (b.flap > 0.5 ? 70 : 8);
  }
}

function takeOff(b: Bird, _land: Land, to: Perch) {
  const dist = Math.hypot(to.x - b.x, to.z - b.z);
  b.from = { x: b.x, y: b.y, z: b.z };
  b.to = to;
  b.state = "fly";
  b.length = b.t = Math.max(1.4, dist / 4.5);
  b.peck = 0;
  b.alarm = Infinity;
}

/** A bird of prey circling high over the clearing: where it is at a time. Pure, so nothing to keep. */
export function circling(time: number, i: number) {
  const r = 9 + i * 4, speed = 0.11 + i * 0.03, a = time * speed * (i % 2 ? -1 : 1) + i * 2.1;
  const cx = Math.sin(time * 0.013 + i) * 3, cz = Math.cos(time * 0.017 + i * 3) * 3;
  return {
    x: cx + Math.cos(a) * r, y: 17 + i * 5 + Math.sin(time * 0.2 + i) * 1.5, z: cz + Math.sin(a) * r,
    heading: headingOf(-Math.sin(a), Math.cos(a)) + (i % 2 ? Math.PI : 0),
    bank: 0.35 * (i % 2 ? 1 : -1),
    flap: Math.sin(time * 0.6 + i * 4) > 0.93 ? 1 : 0,
  };
}

// ---- butterflies and dragonflies ---------------------------------------------------------------------------------

export interface Flyer {
  x: number; y: number; z: number; vx: number; vy: number; vz: number; heading: number; phase: number;
  target: { x: number; y: number; z: number };
  /** Seconds until it picks a new target (or, for a dragonfly, darts off). */
  t: number;
}

const above = (land: Land, x: number, z: number) => Math.max(land.heightAt(x, z), land.water);

export function makeFlyers(land: Land, count: number, kind: "butterfly" | "dragonfly", reeds: { x: number; z: number }[], random: Random): Flyer[] {
  return Array.from({ length: count }, () => {
    const p = kind === "butterfly" ? meadowPoint(land, random) : dragonflySpot(land, reeds, random);
    const y = above(land, p.x, p.z) + 0.6;
    return { x: p.x, y, z: p.z, vx: 0, vy: 0, vz: 0, heading: random() * TAU, phase: random() * TAU, target: { x: p.x, y, z: p.z }, t: random() * 2 };
  });
}

function dragonflySpot(land: Land, reeds: { x: number; z: number }[], random: Random) {
  if (reeds.length && random() < 0.5) {
    const r = reeds[Math.floor(random() * reeds.length)]!;
    return { x: r.x + (random() - 0.5) * 0.8, z: r.z + (random() - 0.5) * 0.8 };
  }
  return pondPoint(land, random, 0.1);
}

/** Butterflies flutter from flower to flower over the meadow, erratic, and flutter off from the beaver. */
export function stepButterflies(list: Flyer[], land: Land, threat: Threat, dt: number, random: Random) {
  for (const f of list) {
    f.t -= dt;
    const scared = far(threat, f.x, f.z) < 1.6;
    if (f.t <= 0 || scared || Math.hypot(f.target.x - f.x, f.target.z - f.z) < 0.15) {
      const p = scared ? meadowPoint(land, random, { x: f.x, z: f.z, r: 4 }, threat, 3) : meadowPoint(land, random, { x: f.x, z: f.z, r: 2.5 });
      f.target = { x: p.x, y: land.heightAt(p.x, p.z) + 0.25 + random() * 0.8, z: p.z };
      f.t = scared ? 1.5 : 1.5 + random() * 4;
    }
    const speed = scared ? 2.2 : 0.8;
    steer(f, speed, 3, dt);
    // The flutter: little jumps up and sideways.
    f.vy += Math.sin(f.phase * 0.31) * 2.5 * dt;
    f.vx += Math.cos(f.phase * 0.23) * 1.5 * dt;
    move(f, land, 0.15, 2.2, dt);
    f.phase += dt * 62;
  }
}

/** Dragonflies hover still, then dart to another point over the reeds or the water; the beaver sends them off at once. */
export function stepDragonflies(list: Flyer[], land: Land, reeds: { x: number; z: number }[], threat: Threat, dt: number, random: Random) {
  for (const f of list) {
    f.t -= dt;
    const scared = far(threat, f.x, f.z) < 1.5;
    if (f.t <= 0 || (scared && f.t > 0.3)) {
      let p = dragonflySpot(land, reeds, random);
      for (let i = 0; i < 8 && far(threat, p.x, p.z) < 3; i++) p = dragonflySpot(land, reeds, random);
      f.target = { x: p.x, y: above(land, p.x, p.z) + 0.25 + random() * 0.7, z: p.z };
      f.t = scared ? 0.3 : 1 + random() * 3;
    }
    // Fast and stiff: close in on the target and stop dead.
    const dx = f.target.x - f.x, dy = f.target.y - f.y, dz = f.target.z - f.z;
    const k = Math.min(1, dt * 6);
    f.vx = lerp(f.vx, dx * 4, k); f.vy = lerp(f.vy, dy * 4, k); f.vz = lerp(f.vz, dz * 4, k);
    move(f, land, 0.15, 4, dt);
    if (Math.hypot(dx, dz) > 0.3) f.heading += turnTo(f.heading, headingOf(dx, dz)) * Math.min(1, dt * 12);
    f.phase += dt * 90;
  }
}

function steer(f: Flyer, speed: number, grip: number, dt: number) {
  const dx = f.target.x - f.x, dy = f.target.y - f.y, dz = f.target.z - f.z, d = Math.hypot(dx, dy, dz) || 1;
  const k = Math.min(1, dt * grip);
  f.vx = lerp(f.vx, dx / d * speed, k); f.vy = lerp(f.vy, dy / d * speed, k); f.vz = lerp(f.vz, dz / d * speed, k);
  if (Math.hypot(f.vx, f.vz) > 0.05) f.heading += turnTo(f.heading, headingOf(f.vx, f.vz)) * Math.min(1, dt * 6);
}

/** Moves a flyer, never lower than `low` over ground or water, never out of the rim. */
function move(f: Flyer, land: Land, low: number, top: number, dt: number) {
  const s = Math.hypot(f.vx, f.vy, f.vz);
  if (s > top) { f.vx *= top / s; f.vy *= top / s; f.vz *= top / s; }
  f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
  const r = Math.hypot(f.x, f.z);
  if (r > land.rim) { f.x *= land.rim / r; f.z *= land.rim / r; f.vx *= -0.5; f.vz *= -0.5; }
  const floor = above(land, f.x, f.z) + low;
  if (f.y < floor) { f.y = floor; f.vy = Math.max(0, f.vy); }
}

// ---- frogs -------------------------------------------------------------------------------------------------------

export interface Frog {
  x: number; y: number; z: number; heading: number;
  state: "sit" | "jump" | "swim";
  t: number; length: number;
  from: Perch; to: Perch;
  /** The shore spot it swims back to. */
  home: Perch;
  /** 0 … 1 how far the hind legs are stretched. */
  stretch: number;
  phase: number;
}

/** Spots at the water's edge, just above the surface, all round the pond. */
export function shoreSpots(land: Land, count: number, random: Random): Perch[] {
  const out: Perch[] = [];
  for (let i = 0; out.length < count && i < count * 20; i++) {
    const a = random() * TAU, cx = land.pond.x, cz = land.pond.z;
    for (let r = 0.5; r < land.pond.radius * 2; r += 0.05) {
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, h = land.heightAt(x, z);
      if (h > land.water + 0.03) {
        if (h < land.water + 0.25 && inside(land, x, z) && out.every((o) => Math.hypot(o.x - x, o.z - z) > 0.8)) out.push({ x, y: h, z });
        break;
      }
    }
  }
  return out;
}

export function makeFrogs(land: Land, spots: Perch[], count: number, random: Random): Frog[] {
  return spots.slice(0, count).map((p) => ({
    ...p, heading: headingOf(land.pond.x - p.x, land.pond.z - p.z) + (random() - 0.5) * 0.8, state: "sit", t: 2 + random() * 5, length: 1,
    from: p, to: p, home: p, stretch: 0, phase: random() * TAU,
  }));
}

export function stepFrogs(frogs: Frog[], land: Land, spots: Perch[], threat: Threat, dt: number, random: Random, splashes: Splash[] = []) {
  for (const f of frogs) {
    f.phase += dt;
    f.t -= dt;
    if (f.state === "sit") {
      f.stretch = Math.max(0, f.stretch - dt * 5);
      if (far(threat, f.x, f.z) < (threat.speed > 1.2 ? 3 : 2.2)) leap(f, land, threat);
    } else if (f.state === "jump") {
      const k = clamp(1 - f.t / f.length, 0, 1);
      f.x = lerp(f.from.x, f.to.x, k); f.z = lerp(f.from.z, f.to.z, k);
      f.y = Math.max(lerp(f.from.y, f.to.y, k) + Math.sin(k * Math.PI) * 0.35, land.heightAt(f.x, f.z) + 0.01);
      f.stretch = Math.min(1, f.stretch + dt * 12);
      if (f.t <= 0) {
        splashes.push({ x: f.x, z: f.z, size: 0.5 });
        f.state = "swim";
        f.t = 4 + random() * 5; // stays down a while before it heads back
        f.home = pickShore(spots, frogs, threat, random) ?? f.home;
      }
    } else {
      // Swims under the surface; once it is time, back to a shore spot away from the beaver, and out.
      if (f.t <= 0 && far(threat, f.home.x, f.home.z) > 4) {
        const dx = f.home.x - f.x, dz = f.home.z - f.z, d = Math.hypot(dx, dz);
        if (d < 0.05) { Object.assign(f, { ...f.home, state: "sit", t: 3 + random() * 6 }); f.heading = headingOf(land.pond.x - f.x, land.pond.z - f.z); continue; }
        const step = Math.min(d, dt * 0.35);
        f.x += dx / d * step; f.z += dz / d * step;
        f.heading += turnTo(f.heading, headingOf(dx, dz)) * Math.min(1, dt * 5);
        f.stretch = 0.5 + 0.5 * Math.sin(f.phase * 9);
      } else f.stretch = Math.max(0, f.stretch - dt * 2);
      if (f.t <= 0 && far(threat, f.home.x, f.home.z) <= 4) f.home = pickShore(spots, frogs, threat, random) ?? f.home;
      f.y = Math.max(land.heightAt(f.x, f.z) + 0.01, Math.min(land.water - 0.07, f.y));
    }
  }
}

/** Into the water: a long jump the way the water is deepest, turned away from the threat. */
function leap(f: Frog, land: Land, threat: { x: number; z: number }) {
  const toPond = headingOf(land.pond.x - f.x, land.pond.z - f.z), awayBeaver = headingOf(f.x - threat.x, f.z - threat.z);
  const heading = toPond + clamp(turnTo(toPond, awayBeaver), -0.7, 0.7);
  let len = 1.1, tx = f.x, tz = f.z;
  for (; len < 2.2; len += 0.2) { tx = f.x + Math.sin(heading) * len; tz = f.z + Math.cos(heading) * len; if (depthAt(land, tx, tz) > 0.12) break; }
  f.from = { x: f.x, y: f.y, z: f.z };
  f.to = { x: tx, y: Math.max(land.heightAt(tx, tz) + 0.02, land.water - 0.07), z: tz };
  f.heading = heading;
  f.state = "jump";
  f.length = f.t = 0.5;
}

function pickShore(spots: Perch[], frogs: Frog[], threat: Threat, random: Random) {
  const free = spots.filter((s) => far(threat, s.x, s.z) > 4 && frogs.every((o) => o.home === s ? false : Math.hypot(o.home.x - s.x, o.home.z - s.z) > 0.3));
  return free.length ? free[Math.floor(random() * free.length)]! : undefined;
}

// ---- ducks -------------------------------------------------------------------------------------------------------

export interface Duck {
  x: number; z: number; heading: number; speed: number; goal: { x: number; z: number }; t: number; phase: number; wake: number;
  /** Seconds of flight left (0: on the water) and how long it is; metres above the water; wings 0 folded … 1 spread. */
  flying: number; flight: number; air: number; wings: number;
}

const DUCK_DEPTH = 0.3;

export function makeDucks(land: Land, count: number, random: Random): Duck[] {
  const at = pondPoint(land, random, 0.7);
  return Array.from({ length: count }, (_, i) => ({
    x: at.x + i * 0.6, z: at.z, heading: random() * TAU, speed: 0, goal: at, t: 0, phase: random() * TAU, wake: 0, flying: 0, flight: 0, air: 0, wings: 0,
  })).map((d) => (depthAt(land, d.x, d.z) > DUCK_DEPTH ? d : { ...d, x: at.x, z: at.z + 0.01 }));
}

/** The first duck leads and wanders; the others follow it. All paddle away from the beaver, staying on the water. */
export function stepDucks(ducks: Duck[], land: Land, threat: Threat, dt: number, random: Random, splashes: Splash[] = []) {
  ducks.forEach((d, i) => {
    d.wings = clamp(d.wings + (d.flying > 0 ? dt : -dt) * 4, 0, 1);
    if (d.flying > 0) { fly(d, land, dt, splashes); return; }
    const danger = far(threat, d.x, d.z), scared = danger < (threat.swimming ? 4.5 : 3.2);
    d.t -= dt;
    if (scared && (d.t <= 0 || far(threat, d.goal.x, d.goal.z) < 4)) {
      // The open water farthest from the beaver.
      let best = d.goal, score = -1;
      for (let k = 0; k < 16; k++) {
        const p = pondPoint(land, random, DUCK_DEPTH + 0.1), s = far(threat, p.x, p.z) - Math.hypot(p.x - d.x, p.z - d.z) * 0.2;
        if (s > score) { score = s; best = p; }
      }
      d.goal = best; d.t = 1.5;
    } else if (!scared && i === 0 && (d.t <= 0 || Math.hypot(d.goal.x - d.x, d.goal.z - d.z) < 0.3)) {
      d.goal = pondPoint(land, random, DUCK_DEPTH + 0.2); d.t = 8 + random() * 10;
    }
    let gx = d.goal.x, gz = d.goal.z;
    if (i > 0 && !scared) { const lead = ducks[i - 1]!; gx = lead.x - Math.sin(lead.heading) * 0.7; gz = lead.z - Math.cos(lead.heading) * 0.7; }
    const dx = gx - d.x, dz = gz - d.z, dist = Math.hypot(dx, dz);
    const want = scared ? 0.75 : dist > 0.25 ? Math.min(0.22, dist * 0.3) : 0;
    d.speed = lerp(d.speed, want, Math.min(1, dt * (scared ? 3 : 1)));
    if (dist > 0.05) d.heading += turnTo(d.heading, headingOf(dx, dz)) * Math.min(1, dt * (scared ? 4 : 1.2));
    let nx = d.x + Math.sin(d.heading) * d.speed * dt, nz = d.z + Math.cos(d.heading) * d.speed * dt;
    for (const o of ducks) if (o !== d) {
      const ox = nx - o.x, oz = nz - o.z, od = Math.hypot(ox, oz);
      if (od < 0.45 && od > 1e-4) { nx += ox / od * (0.45 - od) * 0.5; nz += oz / od * (0.45 - od) * 0.5; }
    }
    if (depthAt(land, nx, nz) > DUCK_DEPTH && inside(land, nx, nz)) { d.x = nx; d.z = nz; }
    else { d.speed *= 0.5; d.heading += turnTo(d.heading, headingOf(land.pond.x - d.x, land.pond.z - d.z)) * Math.min(1, dt * 3); }
    d.wake -= dt * d.speed;
    if (d.wake <= 0 && d.speed > 0.4) { splashes.push({ x: d.x, z: d.z, size: 0.35 }); d.wake = 0.4; }
    d.phase += dt * (1 + d.speed * 12);
  });
}

const FLIGHT_HEIGHT = 3.5, FLIGHT_SPEED = 3.2, CIRCLE = 0.75; // m over the water, m/s, rad/s it turns while circling
const COMING_DOWN = 2.5; // s at the end of a flight in which it glides to its landing place

/** Up off the water for `seconds`, to circle the clearing and come down on the pond at `to`. */
export function takeOffDuck(d: Duck, to: { x: number; z: number }, seconds: number, splashes: Splash[] = []) {
  d.flying = d.flight = seconds;
  d.goal = to;
  splashes.push({ x: d.x, z: d.z, size: 0.6 });
}

/** A flight: up in a second, round the clearing, then a glide that ends on the water at the goal, with a splash. */
function fly(d: Duck, land: Land, dt: number, splashes: Splash[]) {
  d.flying = Math.max(0, d.flying - dt);
  const dx = d.goal.x - d.x, dz = d.goal.z - d.z, dist = Math.hypot(dx, dz);
  if (d.flying > COMING_DOWN) {
    // Circling; near the rim it turns in towards the middle.
    const turn = Math.hypot(d.x, d.z) > land.rim - 3 ? turnTo(d.heading, headingOf(-d.x, -d.z)) * 2 : CIRCLE;
    d.heading += turn * dt;
    d.speed = lerp(d.speed, FLIGHT_SPEED, Math.min(1, dt * 2));
  } else {
    // Coming down: towards the goal, at the pace that gets it there as the flight ends.
    d.heading += turnTo(d.heading, headingOf(dx, dz)) * Math.min(1, dt * 4);
    d.speed = clamp(dist / Math.max(d.flying, 0.2), 0.3, FLIGHT_SPEED * 1.3);
  }
  d.x += Math.sin(d.heading) * d.speed * dt;
  d.z += Math.cos(d.heading) * d.speed * dt;
  const up = clamp((d.flight - d.flying) / 1.2, 0, 1), down = clamp(d.flying / COMING_DOWN, 0, 1);
  d.air = FLIGHT_HEIGHT * up * up * (3 - 2 * up) * down * down * (3 - 2 * down); // eased in and out: no jolt at either end
  d.phase += dt * 40;
  if (d.flying > 0) return;
  // Down: on the water at the goal, sliding on a little, the way it came.
  if (depthAt(land, d.x, d.z) <= DUCK_DEPTH) { d.x = d.goal.x; d.z = d.goal.z; }
  d.air = 0; d.speed = 0.4; d.t = 3;
  splashes.push({ x: d.x, z: d.z, size: 0.6 });
}

// ---- the larger animals, by the hour -----------------------------------------------------------------------------

/** When they are about, by the sun's height in degrees: deer at dusk and dawn, the owl at night. */
export const deerHours = (sunHeight: number) => sunHeight > -10 && sunHeight < 12;
export const owlHours = (sunHeight: number) => sunHeight < -6;

/** The hours as the animals feel them: whether it is their time, and whether it rains. */
export interface Hours { out: boolean; rain: boolean }

export interface Deer {
  x: number; y: number; z: number; heading: number; speed: number;
  /** away: in the forest, not drawn; walk: to goal, then `then`; graze, drink, shelter (under the trees in rain): standing;
   *  flee: bounding into the forest. */
  state: "away" | "walk" | "graze" | "drink" | "shelter" | "flee";
  then: "graze" | "drink" | "shelter" | "away";
  goal: { x: number; z: number };
  /** Where at the forest's edge it comes out and goes back in, as an angle round the clearing. */
  home: number;
  /** Seconds: until it comes out (away), until the head goes up or down (standing); and until it moves on. */
  t: number; left: number;
  /** 0 … 1: the head lifted to look at the beaver; seconds it has looked; seconds until it flees because another did. */
  alert: number; watched: number; alarm: number;
  /** The pose: gait phase, 0 … 1 walking, 0 … 1 bounding, metres off the ground, head 0 up … 1 down (and where it
   *  wants it), the head turned (radians), the ears' flicks, the white tail up. */
  phase: number; stride: number; bound: number; air: number; head: number; headWant: number; look: number;
  ears: [number, number]; earT: number; tail: number;
  /** Has been down to the water this time out. */
  drank: boolean;
}

const WALK = 0.9, BOUND = 5.5; // m/s
const DEER_ALERT = 10, DEER_NEAR = 5.5, DEER_RUN = 13; // m: heads up; too close; a beaver running at them
const HERD_ALARM = 1.3; // a fleeing deer alarms the others this many times the clearing's radius away: one drinking at the pond too
const DEER_HEAR = 1.8; // a tail slap carries for a deer this many times the clearing's radius: across it
/** Radii from the middle: they graze at the meadow's rim, wait under the trees in rain, vanish into the forest. */
const graze = (land: Land) => [land.rim - 3.5, land.rim - 0.5] as const;
const SHELTER = 4, COVER = 8; // m beyond the rim
const SPACING = 4.8, SPREAD = 8.4; // m between the ways out of a herd's deer; m along the rim a deer grazes round its own

const ring = (angle: number, r: number) => ({ x: Math.cos(angle) * r, z: Math.sin(angle) * r });
type Spot = { x: number; z: number };

/** No tree trunk in the way and dry ground all along, but the last `wet` metres (to drink). */
export function clearWay(land: Land, trunks: Spot[], a: Spot, b: Spot, wet = 0) {
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / 0.5);
  for (let i = 1; i <= n; i++) {
    const x = lerp(a.x, b.x, i / n), z = lerp(a.z, b.z, i / n);
    if (trunks.some((t) => Math.hypot(t.x - x, t.z - z) < 0.9)) return false;
    if (d * (1 - i / n) > wet && !dry(land, x, z)) return false;
  }
  return true;
}

/** A place to graze at the meadow's rim near its own way out, on fair ground, reached without a trunk in the way and
 *  well away from the beaver. */
export function grazeSpot(land: Land, trunks: Spot[], herd: Deer[], d: Deer, threat: Threat, random: Random, near = 0): Spot {
  const [inner, outer] = graze(land);
  let best: Spot = ring(d.home, outer), score = -Infinity;
  for (let i = 0; i < 16; i++) {
    const p = near ? { x: d.x + (random() - 0.5) * near * 2, z: d.z + (random() - 0.5) * near * 2 } : ring(d.home + (random() - 0.5) * SPREAD / inner, lerp(inner, outer, random()));
    const r = Math.hypot(p.x, p.z);
    if (r < inner - 1 || r > outer + 0.5 || !dry(land, p.x, p.z)) continue;
    const steep = Math.abs(land.heightAt(p.x + 0.5, p.z) - land.heightAt(p.x - 0.5, p.z)) + Math.abs(land.heightAt(p.x, p.z + 0.5) - land.heightAt(p.x, p.z - 0.5));
    const crowded = herd.some((o) => o !== d && o.state !== "away" && Math.hypot(o.goal.x - p.x, o.goal.z - p.z) < 1.8);
    const s = Math.min(far(threat, p.x, p.z), 14) - steep * 10 - (clearWay(land, trunks, d, p) ? 0 : 20) - (crowded ? 8 : 0);
    if (s > score) { score = s; best = p; }
  }
  return best;
}

export function makeDeer(land: Land, count: number, random: Random): Deer[] {
  const start = random() * TAU;
  return Array.from({ length: count }, (_, i) => {
    // A small herd: they come out near each other, one after the other.
    const home = start + (i - (count - 1) / 2) * SPACING / (land.rim + COVER), at = ring(home, land.rim + COVER);
    return {
      ...at, y: land.heightAt(at.x, at.z), heading: home + Math.PI, speed: 0, state: "away", then: "graze", goal: at, home,
      t: 1 + i * 2.5 + random() * 3, left: 0, alert: 0, watched: 0, alarm: Infinity, phase: random() * TAU, stride: 0, bound: 0, air: 0,
      head: 0, headWant: 0, look: 0, ears: [0, 0], earT: random() * 3, tail: 0, drank: false,
    };
  });
}

const walkTo = (d: Deer, goal: Spot, then: Deer["then"]) => { d.state = "walk"; d.goal = goal; d.then = then; };

/** Off into the forest, away from `from`: bounding, the white tail up. */
export function flee(d: Deer, land: Land, from: { x: number; z: number }) {
  const ax = d.x - from.x, az = d.z - from.z, a = Math.hypot(ax, az) || 1, r = Math.hypot(d.x, d.z) || 1;
  const vx = ax / a + d.x / r, vz = az / a + d.z / r;
  d.home = Math.atan2(d.z + vz * 6, d.x + vx * 6);
  d.goal = ring(d.home, land.rim + COVER);
  d.state = "flee";
  d.alarm = Infinity;
}

/** The deer by the hour. Out of the forest at dusk and dawn (each in turn), to graze at the meadow's rim; one walks down
 *  to the pond to drink. Shy: within DEER_ALERT metres of the beaver the head comes up and turns to it (and after a while
 *  it moves off); a beaver running at them, coming too close or (startle) slapping its tail sends them bounding into
 *  the trees, the others after it. They come back once it has been calm a while. In rain they stay under the trees;
 *  when their hours end they walk back in. `shore`: places at the water's edge, to drink. */
export function stepDeer(herd: Deer[], land: Land, trunks: Spot[], shore: Perch[], threat: Threat, hours: Hours, dt: number, random: Random) {
  herd.forEach((d, i) => {
    if (d.state === "away") {
      d.x = Math.cos(d.home) * (land.rim + COVER); d.z = Math.sin(d.home) * (land.rim + COVER);
      if (!hours.out) return;
      // Not while the beaver is about where it would come out.
      d.t = far(threat, d.x, d.z) < 14 ? Math.max(d.t, 6) : d.t - dt;
      if (d.t > 0) return;
      Object.assign(d, { y: land.heightAt(d.x, d.z), heading: d.home + Math.PI, alert: 0, watched: 0, tail: 0, drank: false });
      if (hours.rain) walkTo(d, ring(d.home, land.rim + SHELTER), "shelter");
      else walkTo(d, grazeSpot(land, trunks, herd, d, threat, random), "graze");
    }
    const dist = far(threat, d.x, d.z), fleeing = d.state === "flee";
    if (!fleeing) {
      d.alarm -= dt;
      const scared = dist < DEER_NEAR || (threat.speed > 1.4 && dist < DEER_RUN) || d.alarm <= 0;
      if (scared) {
        flee(d, land, dist < DEER_RUN ? threat : { x: 0, z: 0 });
        for (const o of herd) if (o !== d && o.state !== "away" && o.state !== "flee" && Math.hypot(o.x - d.x, o.z - d.z) < HERD_ALARM * land.rim) o.alarm = Math.min(o.alarm, 0.2 + random() * 0.5);
      }
    }
    if (d.state === "flee") {
      d.tail = Math.min(1, d.tail + dt * 6);
      d.alert = 1;
      d.head = Math.max(0, d.head - dt * 4);
      if (go(d, land, BOUND, 5, dt) < 1) { d.state = "away"; d.t = 15 + random() * 15; d.speed = 0; }
      return d.state === "away" ? undefined : poseDeer(d, threat, dt, random);
    }
    d.tail = Math.max(0, d.tail - dt * 2);
    // The beaver near: the head comes up and follows it; a while of that and it moves off.
    const watching = dist < DEER_ALERT && d.state !== "shelter";
    d.alert = clamp(d.alert + (watching ? dt * 4 : -dt * 0.5), 0, 1);
    d.watched = watching ? d.watched + dt : 0;
    if (d.watched > 6 && d.state !== "walk") walkTo(d, grazeSpot(land, trunks, herd, d, threat, random), "graze");
    // The hours end: back into the forest; rain: under the trees; the rain over: out to graze again.
    if (!hours.out && d.then !== "away") walkTo(d, ring(d.home, land.rim + COVER), "away");
    else if (hours.out && hours.rain && d.then !== "shelter" && d.then !== "away") walkTo(d, ring(d.home, land.rim + SHELTER), "shelter");
    else if (hours.out && !hours.rain && d.state === "shelter") walkTo(d, grazeSpot(land, trunks, herd, d, threat, random), "graze");

    if (d.state === "walk") {
      d.headWant = 0.15;
      if (d.alert > 0.5 && d.watched < 6) d.speed = Math.max(0, d.speed - dt * 3); // stops to look
      else if (go(d, land, WALK, 2, dt) < 0.3) {
        d.state = d.then;
        d.speed = 0;
        if (d.state === "away") d.t = 2 + random() * 6;
        if (d.state === "drink") { d.left = 8 + random() * 6; d.heading = headingOf(land.pond.x - d.x, land.pond.z - d.z); }
        if (d.state === "graze") d.left = 8 + random() * 14;
        d.t = d.state === "away" ? d.t : 0;
      }
    } else if (d.state !== "away") {
      d.speed = 0;
      d.left -= d.alert > 0.5 ? 0 : dt;
      d.t -= dt;
      if (d.t <= 0) { // head down a few seconds, up a moment to look round and chew
        const down = d.headWant < 0.5;
        d.headWant = down ? 1 : 0;
        d.t = down ? (d.state === "drink" ? 4 : 3) + random() * 5 : 1.2 + random() * 2;
      }
      if (d.left <= 0 && d.state === "drink") { d.drank = true; walkTo(d, grazeSpot(land, trunks, herd, d, threat, random), "graze"); }
      else if (d.left <= 0 && d.state === "graze") {
        // The first deer out goes down to the water once, while the beaver is not near it; the others step on.
        const water = i === 0 && !d.drank ? drinkSpot(land, trunks, shore, d, threat) : undefined;
        if (water) walkTo(d, water, "drink");
        else walkTo(d, grazeSpot(land, trunks, herd, d, threat, random, 2.5), "graze");
        d.left = 8 + random() * 14;
      }
    }
    poseDeer(d, threat, dt, random);
  });
}

/** Where to drink: a spot at the water's edge reached on dry ground, far from the beaver; a step back on the land,
 *  facing the pond. */
export function drinkSpot(land: Land, trunks: Spot[], shore: Perch[], d: Deer, threat: Threat) {
  let best: Spot | undefined, score = Infinity;
  for (const s of shore) {
    const back = Math.hypot(s.x - land.pond.x, s.z - land.pond.z) || 1;
    const p = { x: s.x + (s.x - land.pond.x) / back * 0.5, z: s.z + (s.z - land.pond.z) / back * 0.5 };
    const k = Math.hypot(p.x - d.x, p.z - d.z);
    if (far(threat, p.x, p.z) < 10 || k > score || !clearWay(land, trunks, d, p, 0.8)) continue;
    best = p; score = k;
  }
  return best;
}

/** Turns towards the goal and goes at `pace`; returns how far the goal still is. */
function go(d: Deer, land: Land, pace: number, turnRate: number, dt: number) {
  const dx = d.goal.x - d.x, dz = d.goal.z - d.z, dist = Math.hypot(dx, dz);
  const turn = turnTo(d.heading, headingOf(dx, dz));
  d.heading += clamp(turn, -turnRate * dt, turnRate * dt);
  // Slows down to turn on the spot, and as it arrives.
  d.speed = lerp(d.speed, pace * clamp(1.4 - Math.abs(turn), 0.15, 1) * Math.min(1, dist / 0.6 + 0.2), Math.min(1, dt * 3));
  const step = Math.min(dist, d.speed * dt);
  d.x += Math.sin(d.heading) * step; d.z += Math.cos(d.heading) * step;
  d.y = land.heightAt(d.x, d.z);
  return dist - step;
}

function poseDeer(d: Deer, threat: Threat, dt: number, random: Random) {
  const bounding = d.state === "flee";
  d.stride = lerp(d.stride, bounding ? 0 : clamp(d.speed / WALK, 0, 1), Math.min(1, dt * 6));
  d.bound = lerp(d.bound, bounding ? clamp(d.speed / BOUND * 1.5, 0, 1) : 0, Math.min(1, dt * 6));
  d.phase += dt * TAU * (bounding ? 2.2 * d.bound : d.speed / 0.85);
  d.air = 0.45 * d.bound * Math.max(0, Math.sin(d.phase));
  const watching = d.alert > 0.3 && !bounding;
  d.head = lerp(d.head, watching ? 0 : d.headWant, Math.min(1, dt * (watching ? 5 : 1.5)));
  // The head turns to the beaver, as far as a neck turns; standing, the body follows for the rest.
  const turn = watching ? turnTo(d.heading, headingOf(threat.x - d.x, threat.z - d.z)) : 0;
  if (Math.abs(turn) > 1.2 && d.speed < 0.1) d.heading += clamp(turn, -1, 1) * dt;
  d.look = lerp(d.look, clamp(turn, -1.2, 1.2), Math.min(1, dt * (watching ? 6 : 2)));
  d.earT -= dt;
  if (d.earT <= 0) { d.ears[random() < 0.5 ? 0 : 1] = 1; d.earT = d.alert > 0.3 ? 0.4 + random() : 1.5 + random() * 4; }
  d.ears[0] = Math.max(0, d.ears[0] - dt * 5); d.ears[1] = Math.max(0, d.ears[1] - dt * 5);
}

// ---- the owl -----------------------------------------------------------------------------------------------------

export interface Owl {
  x: number; y: number; z: number; heading: number;
  /** away: not about; sit: on its branch; fly: on the way from `from` over `over` to `to`. */
  state: "away" | "sit" | "fly";
  from: Perch; over: Perch; to: Perch; perch: number;
  /** Seconds: of the flight left and its length; until it flies on; until it calls. */
  t: number; length: number; stay: number; call: number;
  /** How many times it has called (the sound follows this). */
  calls: number;
  /** Wings: beat phase, how hard they beat, 0 folded … 1 spread; the head turned (radians); banking in a turn. */
  phase: number; flap: number; spread: number; look: number; lookWant: number; bank: number;
}

export function makeOwl(random: Random): Owl {
  const nowhere = { x: 0, y: 30, z: 0 };
  return { ...nowhere, heading: 0, state: "away", from: nowhere, over: nowhere, to: nowhere, perch: 0, t: 0, length: 1, stay: 0, call: 4 + random() * 6, calls: 0,
    phase: 0, flap: 0, spread: 0, look: 0, lookWant: 0, bank: 0 };
}

const OWL_SPEED = 7; // m/s gliding
/** A point far out beyond a perch, high: where the owl comes from and goes to. */
const beyond = (p: Perch): Perch => ({ x: p.x * 2.2, y: p.y + 10, z: p.z * 2.2 });

/** Off its branch, low over the clearing (`low` metres over the middle), to perch `to` (or out of sight). */
export function takeOffOwl(owl: Owl, land: Land, to: Perch, low = 4.5, perch = owl.perch) {
  owl.from = { x: owl.x, y: owl.y, z: owl.z };
  owl.to = to;
  owl.perch = perch;
  // A quadratic curve whose middle passes `low` metres over the ground halfway.
  const mx = (owl.x + to.x) / 2, mz = (owl.z + to.z) / 2, y = Math.max(land.heightAt(mx, mz), land.water) + low;
  owl.over = { x: mx, y: 2 * y - (owl.y + to.y) / 2, z: mz };
  owl.state = "fly";
  owl.length = owl.t = Math.max(2.5, Math.hypot(to.x - owl.x, to.z - owl.z) / OWL_SPEED);
}

/** The owl by night: flies in from the forest to a branch on one of the far trees, sits and turns its head, calls now
 *  and then, and every minute or so glides low across the clearing to another; at dawn it flies off. */
export function stepOwl(owl: Owl, land: Land, perches: Perch[], night: boolean, dt: number, random: Random) {
  if (!perches.length) return;
  if (owl.state === "away") {
    if (!night) return;
    const p = Math.floor(random() * perches.length);
    Object.assign(owl, beyond(perches[p]!));
    takeOffOwl(owl, land, perches[p]!, 8, p);
  }
  if (owl.state === "sit") {
    owl.spread = Math.max(0, owl.spread - dt * 3);
    owl.flap = 0;
    owl.bank = 0;
    if ((owl.call -= dt) <= 0) { owl.calls++; owl.call = 10 + random() * 18; }
    // Owls turn the head, not the body: now here, now there.
    if (random() < dt * 0.4) owl.lookWant = (random() - 0.5) * 3;
    owl.look = lerp(owl.look, owl.lookWant, Math.min(1, dt * 4));
    if (!night) takeOffOwl(owl, land, beyond(perches[owl.perch]!), 8);
    else if ((owl.stay -= dt) <= 0) {
      const next = (owl.perch + 1 + Math.floor(random() * (perches.length - 1))) % perches.length;
      takeOffOwl(owl, land, perches[next]!, 6 + random() * 2, next);
    }
    return;
  }
  // Flying: along the curve; beats hard off the branch and to land, glides between.
  owl.t -= dt;
  const k = clamp(1 - owl.t / owl.length, 0, 1), a = (1 - k) * (1 - k), b = 2 * k * (1 - k), c = k * k;
  const x = a * owl.from.x + b * owl.over.x + c * owl.to.x, z = a * owl.from.z + b * owl.over.z + c * owl.to.z;
  const turn = turnTo(owl.heading, headingOf(x - owl.x, z - owl.z));
  if (Math.hypot(x - owl.x, z - owl.z) > 1e-4) owl.heading += turn * Math.min(1, dt * 8);
  owl.bank = lerp(owl.bank, clamp(-turn * 8, -0.5, 0.5), Math.min(1, dt * 3));
  owl.x = x; owl.z = z;
  owl.y = Math.max(a * owl.from.y + b * owl.over.y + c * owl.to.y, Math.max(land.heightAt(x, z), land.water) + 1);
  owl.spread = Math.min(1, owl.spread + dt * 4);
  owl.flap = k < 0.12 || k > 0.88 ? 1 : 0;
  owl.look = lerp(owl.look, 0, Math.min(1, dt * 4));
  owl.phase += dt * (owl.flap ? 22 : 0);
  if (owl.t > 0) return;
  if (night && owl.to === perches[owl.perch]) {
    Object.assign(owl, { ...owl.to, state: "sit", stay: 40 + random() * 40, spread: 1, flap: 0 });
    owl.heading = headingOf(-owl.x, -owl.z); // facing the clearing
  } else owl.state = "away";
}

// ---- a tail slap: the alarm --------------------------------------------------------------------------------------

export interface Animals { school: School; birds: Bird[]; frogs: Frog[]; ducks: Duck[]; deer?: Deer[]; owl?: Owl }

/** A tail slap at `at`: everything within `reach` metres flees as from a beaver right there. Fish dart off, frogs on
 *  the shore leap in, birds on the ground fly up, ducks take off and circle the clearing. Each comes back by its own
 *  rules (frogs swim home, birds land away from it, ducks come down on the pond). Returns how many reacted. */
export function startle(animals: Animals, land: Land, perches: Perch[], at: { x: number; z: number }, reach: number, random: Random, splashes: Splash[] = []) {
  const threat: Threat = { x: at.x, y: land.water, z: at.z, speed: 2, swimming: true };
  const near = (o: { x: number; z: number }) => far(threat, o.x, o.z) < reach;
  let count = 0;
  const school = animals.school.fish.filter(near);
  for (const f of school) {
    const d = Math.max(0.1, far(threat, f.x, f.z));
    f.fear = 1;
    f.vx = (f.x - at.x) / d * 1.8; f.vz = (f.z - at.z) / d * 1.8;
    splashes.push({ x: f.x, z: f.z, size: 0.25 });
  }
  if (school.length) {
    let best = animals.school.goal, score = -1;
    for (let k = 0; k < 8; k++) { const p = pondPoint(land, random, 0.6), s = far(threat, p.x, p.z); if (s > score) { score = s; best = p; } }
    animals.school.goal = best; animals.school.goalTime = 6;
  }
  count += school.length;
  for (const f of animals.frogs) if (f.state === "sit" && near(f)) { leap(f, land, at); count++; }
  for (const b of animals.birds) if (b.state === "ground" && near(b)) {
    takeOff(b, land, pickLanding(land, perches, threat, random, animals.birds.filter((o) => o !== b).map((o) => o.to), b));
    count++;
  }
  for (const d of animals.ducks) if (d.flying <= 0 && near(d)) {
    let best = d.goal, score = -1;
    for (let k = 0; k < 12; k++) { const p = pondPoint(land, random, DUCK_DEPTH + 0.2), s = far(threat, p.x, p.z); if (s > score) { score = s; best = p; } }
    takeOffDuck(d, best, 7 + random() * 3, splashes);
    count++;
  }
  // Deer hear it far across the clearing.
  for (const d of animals.deer ?? []) if (d.state !== "away" && d.state !== "flee" && far(threat, d.x, d.z) < Math.max(reach, DEER_HEAR * land.rim)) { flee(d, land, at); count++; }
  return count;
}
