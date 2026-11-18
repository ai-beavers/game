// How the animals decide: pure simulation over positions and velocities.
//
//   const land: Land = { heightAt, water: 0, rim: 14, pond: { x, z, radius } };
//   const school = makeSchool(land, 10, random);   stepSchool(school, land, threat, dt, random);
//   …the same for birds, flyers (butterflies, dragonflies), frogs and ducks.
//
// Every step function moves its animals by dt seconds and keeps them where they belong: fish under the surface and
// above the floor, birds and insects above the ground, frogs and ducks at or in the pond, everything inside the rim.
// The `threat` is the beaver; each kind flees from it in its own way. Splashes (frog jumps, fish darting, ducks
// rushing) are pushed into `splashes` for whoever draws rings.

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
    const want = land.water - lerp(0.16, 0.4, f.fear) - 0.05 * Math.sin(f.phase * 0.3);
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
export function pickLanding(land: Land, perches: Perch[], threat: Threat, random: Random, taken: Perch[] = []): Perch {
  const freePerches = perches.filter((p) => far(threat, p.x, p.z) > 7 && taken.every((t) => Math.hypot(t.x - p.x, t.z - p.z) > 0.3));
  if (freePerches.length && random() < 0.6) return freePerches[Math.floor(random() * freePerches.length)]!;
  return groundPerch(land, meadowPoint(land, random, undefined, threat, 8));
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
        takeOff(b, land, pickLanding(land, perches, threat, random, birds.filter((o) => o !== b).map((o) => o.to)));
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
      if (far(threat, f.x, f.z) < (threat.speed > 1.2 ? 3 : 2.2)) {
        // Into the water: a long jump the way the water is deepest.
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

function pickShore(spots: Perch[], frogs: Frog[], threat: Threat, random: Random) {
  const free = spots.filter((s) => far(threat, s.x, s.z) > 4 && frogs.every((o) => o.home === s ? false : Math.hypot(o.home.x - s.x, o.home.z - s.z) > 0.3));
  return free.length ? free[Math.floor(random() * free.length)]! : undefined;
}

// ---- ducks -------------------------------------------------------------------------------------------------------

export interface Duck { x: number; z: number; heading: number; speed: number; goal: { x: number; z: number }; t: number; phase: number; wake: number }

const DUCK_DEPTH = 0.3;

export function makeDucks(land: Land, count: number, random: Random): Duck[] {
  const at = pondPoint(land, random, 0.7);
  return Array.from({ length: count }, (_, i) => ({
    x: at.x + i * 0.6, z: at.z, heading: random() * TAU, speed: 0, goal: at, t: 0, phase: random() * TAU, wake: 0,
  })).map((d) => (depthAt(land, d.x, d.z) > DUCK_DEPTH ? d : { ...d, x: at.x, z: at.z + 0.01 }));
}

/** The first duck leads and wanders; the others follow it. All paddle away from the beaver, staying on the water. */
export function stepDucks(ducks: Duck[], land: Land, threat: Threat, dt: number, random: Random, splashes: Splash[] = []) {
  ducks.forEach((d, i) => {
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
