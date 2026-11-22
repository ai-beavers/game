import { holdInHand, holdInView } from "./grip.ts";
// Who steers the beaver: keyboard input, a kinematic capsule (mover.ts), carrying sticks, swimming and diving, sitting
// and crawling, riding (sitting in a canoe someone else draws, src/features/canoe), the tail slap, the follow camera, and the Motion report the animator draws from.
//
//   const player = createPlayer(stage, { spawn, hand: beaver.hand, sticks: world.sticks, waterLevel: world.waterLevel });
//   beaver.root.parent = player.node;
//   player.camera.eyes = beaver.eyes;
//   run(stage, (dt) => player.step(dt), (dt, alpha) => { beaver.pose(animator.pose(player.motion, dt)); player.update(dt, alpha); });
//
// The object returned has a few more fields than Player (see PlayerControls) for labs and tests; anger is set with
// `player.motion.anger = …` or `setAnger`, the player never changes it.
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { RUN_SPEED, WALK_SPEED, type CreatePlayer, type Player, type PlayerOptions, type Stick } from "../contracts.ts";
import type { Stage } from "../engine.ts";
import { ALL, CREATURE, GROUND, HEAVY, PLAYER, SOLID, ball, capsule, enable, isEnabled, place, PhysicsMotionType, type PhysicsBody } from "../physics.ts";
import { SHORE_SLOPE } from "../world/terrain.ts";
import { waterOf } from "../world/water.ts";
import { followCamera, type FollowCamera } from "./camera.ts";
import { createMover, type Collision } from "./mover.ts";
import { keyboard, newInput, type Input, type Keyboard } from "./input.ts";
import { BREATH, CRAWL_SPEED, RIDE_SPEED, SLOPE, SWIM_SPEED, rideKeys, turnTowards, jumpStarts, newAction, newDive, newJump, newMotion, newSlap, newSteering, steer, stepAction, stepDive, stepLow, stepSlap, trackMotion, type SwimMotion } from "./state.ts";

// The body: a capsule 1 m tall and 0.45 m wide, its bottom at the feet.
export const HEIGHT = 1.0, RADIUS = 0.225;
const HALF = HEIGHT / 2 - RADIUS, OFFSET = 0.02; // the mover keeps this gap to everything
// Moving.
const ACCEL = 6, BRAKE = 9, AIR_ACCEL = 2.5; // m/s²: quick, but with weight
const STEP_UP = 0.15, STEP_WIDTH = 0.1; // m: highest step it walks up, and the least room it needs on top
// Climbing out of the water onto the shore, m: the highest ledge of ground it climbs onto from swimming depth, and how
// far in over the land it goes as it climbs. Measured all round the shore at levels from the low pond to the full one
// (shore.test.ts): the most it must rise is 0.35 m, at the low pond's south shore, over the lip of the basin's wall.
// Under half the body, so the rocks, the lodge and the dam (never ground anyway) stay out of reach.
const CLIMB_OUT = 0.4, CLIMB_IN = 2 * RADIUS;
const LIFT_EASE = 18; // 1/s: how fast the picture follows a step up
const SWIM_ACCEL = 2;
const RIDE_ACCEL = 1.6, RIDE_BRAKE = 1.1; // m/s²: a canoe gets going slowly and glides on
// Jumping: up to JUMP_HEIGHT while Space is held; letting go early cuts the rise.
const GRAVITY = 18, CUT = 3.5; // m/s², and how much harder it pulls once Space is let go on the way up
export const JUMP_HEIGHT = 0.6;
const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT) + GRAVITY / 120; // the half step the fixed steps lose
const MAX_FALL = 20;
// The leaping tail slap at a foe (PlayerControls.foe): m/s up, so it is in the air for about 0.8 s, nearly the whole
// slap, 1.3 m high; rad/s it turns to face the foe as it leaps.
export const LEAP_SPEED = 7;
const LEAP_TURN = 12;
// Water: afloat once the feet are FLOAT_DEPTH deep, then held at HOLD_DEPTH, where the animator's swimming pose
// has head and back above the surface; back on foot when it touches ground there.
const FLOAT_DEPTH = 0.45, HOLD_DEPTH = 0.3;
// Diving (C held while afloat): down at DIVE_SPEED, up again with Space, never shallower than DIVE_TOP (feet below the
// surface, m), where the long diving body is just under; the head counts as under from HEAD_UNDER. Let go, it comes up
// no faster than RISE. The capsule stays as it is: upright, its top in the water, which stops nothing.
const DIVE_SPEED = 0.6, DIVE_TOP = 0.62, HEAD_UNDER = 0.5, RISE = 0.9;
// Carrying.
export const REACH = 0.6, REACH_RADIUS = 0.45; // m in front of the feet, and how far from that point a stick may lie
export interface PlayerControls extends Player {
  keys: Keyboard;
  /** What the player wanted in the last step, from every device. Features read their own buttons here (the flash). */
  readonly input: Readonly<Input>;
  camera: FollowCamera;
  /** The capsule's body (it moves only where the player puts it), and what its last move ran into. */
  body: PhysicsBody;
  collisions: readonly Collision[];
  /** Where the feet are after the last step, and the horizontal velocity, m/s. */
  feet: Vector3;
  velocity: Vector3;
  facing: number;
  afloat: boolean;
  /** m/s the beaver swims at, SWIM_SPEED unless something sets it (src/features/shop: the Swimmer class). Walking,
   *  running, crawling and the canoe keep their own. */
  swimSpeed: number;
  /** Under the surface on purpose (the dive key held while swimming), and the breath left, 0 … 1. */
  readonly diving: boolean;
  readonly breath: number;
  /** The water's surface height the player swims by, now (it moves: src/world/water.ts); undefined: no water. */
  readonly waterLevel: number | undefined;
  setAnger(value: number): void;
  /** Puts the feet here at once, standing still. */
  teleport(x: number, y: number, z: number, facing?: number): void;
  /** The stick in the hand, if any (src/features/net shares it with other players). */
  readonly carrying: Stick | undefined;
  /** Lets go of the stick at once, without the drop motion (someone else got it first). */
  drop(): void;
  /** Throws the beaver (src/features/bear: a Swipe): along the ground at x, z m/s on top of its own walking, and up
   *  at `up` m/s, until it lands; a lasting action (gnaw, build) ends. Nothing happens in a canoe. */
  toss(x: number, z: number, up: number): void;
  /** What a tail slap on land goes for, or undefined (src/features/bear: the Bear while they fight). With one, the
   *  slap is a leap: the beaver jumps, faces it and turns once round in the air, so its back is turned and the tail
   *  comes down on the foe as the slap strikes; it lands facing it again. Only where it is counts (x, z, read live). */
  foe: { x: number; z: number } | undefined;
  /** Puts the carried stick down with the drop motion, as E does; false when it cannot now (nothing carried, another
   *  action under way, in the air, in the canoe). */
  putDown(): boolean;
  /** Something another part puts in the paws instead of a stick (src/features/trade: a good from the hotbar). E at a
   *  stick while it is full calls free() and starts the pickup once it no longer is. */
  hold: { readonly full: boolean; free(): void } | undefined;
  /** A part that uses the context key for lasting actions (gnaw, build); see Actor. */
  actor: Actor | undefined;
  /** Gives the carried stick away (into the dam) without putting it down: no longer carried, its body stays
   *  disabled and its mesh in the hand, for the taker to move. */
  handOver(): Stick | undefined;
  /** What a press of the context key would do right now, in words for the screen; undefined: nothing. */
  offer(): Offer | undefined;
  /** Sits the beaver in a ride where it is (src/features/canoe: a canoe): from the next step on it does not walk, swim,
   *  jump, dive, crawl, slap nor pick up; the move keys steer it at RIDE_SPEED with the feet held at `seat` m above the
   *  live water level, only where the water is at least `depth` m deep at the feet and, `bow` m ahead, `draft` m deep:
   *  it stops at the shore. undefined: the ride is over, it stands where it is (teleport it out). teleport ends it too. */
  ride(ride: Ride | undefined): void;
  readonly riding: boolean;
  /** How many times the player has touched any control: a step with a key, button, stick or finger held, a key
   *  pressed, a camera turn or zoom, a press on the picture. Only rises (src/features/stare watches it). */
  readonly touched: number;
  /** A slow turn on the spot another part asks for (src/features/stare): each step while nothing steers it, no action
   *  runs and it stands on land, the facing turns towards heading (radians, as facing) by at most rate rad/s. It is not
   *  told as turning in the Motion, so the feet stay planted. With a speed (m/s) it also walks forward along its facing
   *  at that speed, under its normal movement and physics, told in the Motion as an ordinary slow walk; it stops where
   *  a step would take it into the water. undefined: none. */
  turnTo: { heading: number; rate: number; speed?: number } | undefined;
  /** Sits the beaver down where it stands on land, as the sit key does, for `seconds` from the next step, turning to
   *  face (radians, as facing) if given (src/features/droppings). Moving, a jump, an action or leaving the ground gets it
   *  up early. */
  sit(seconds: number, face?: number): void;
  /** Seconds the sit asked for by sit() still lasts; 0 once it is over or cut short. */
  readonly sitting: number;
  /** Slaps the tail once in the next step, as the slap key does, when it may (src/features/droppings). */
  slap(): void;
}

/** How a ride sits on the water, m: the feet above the level, the least water under them, how far ahead the bow is
 *  and how deep it goes. */
export interface Ride { seat: number; depth: number; bow: number; draft: number }

/** What the context key would do: pick up, drop, gnaw (a standing tree), split (gnaw a lying tree into wood), build,
 *  trade (pay the stick at the trading post), use (talk to someone: the Shopkeeper, src/features/shop). */
export interface Offer { action: "pickup" | "drop" | "gnaw" | "build" | "split" | "trade" | "use"; text: string }

/** Lasting actions another part runs with the context key (src/features/build: gnaw, build; src/features/trade: pay
 *  a stick). Several parts share the key through firstOf (actors.ts). */
export interface Actor {
  /** On a press of the context key that picks nothing up: an action to start here (instead of dropping what is
   *  carried), and which way to turn for it (radians, as facing), or undefined. */
  begin(carrying: boolean): { action: "gnaw" | "build"; face?: number } | undefined;
  /** What begin(carrying) would start now, without starting it (for Player.offer). */
  offer?(carrying: boolean): Offer | undefined;
  /** Once per step while it runs; held is the context key. Returns its progress 0 … 1, or undefined: over. */
  step(dt: number, held: boolean): number | undefined;
}

export const createPlayer: CreatePlayer = (stage, options) => createPlayerControls(stage, options);

export function createPlayerControls(stage: Stage, options: PlayerOptions): PlayerControls {
  const { physics, scene } = stage, sticks = options.sticks ?? [];
  // The capsule's middle; its body follows it each step. A stick in the paws is out of every query (physics.enable).
  const centre = new Vector3(options.spawn.x, options.spawn.y + HEIGHT / 2 + OFFSET, options.spawn.z);
  const holder = new TransformNode("player body", scene);
  holder.position.copyFrom(centre);
  const body = physics.body(holder, PhysicsMotionType.ANIMATED, capsule(scene, HALF, RADIUS), PLAYER);
  const shape = capsule(scene, HALF, RADIUS), point = ball(scene, 0.005); // what the queries sweep and place
  const mover = createMover(physics, shape, { gap: OFFSET, slope: SLOPE, mass: 12 });
  // Solid to the bow of a ride and to the camera: everything but the beaver and the loose things.
  const SOLIDS = GROUND | SOLID | HEAVY | CREATURE;

  let carried: { stick: Stick; parent: TransformNode["parent"] } | undefined, target: Stick | undefined;
  const camera = followCamera(stage, SOLIDS);
  const keys = keyboard(), input = newInput(), jump = newJump(), act = newAction(), motion: SwimMotion = newMotion(), steering = newSteering(), slap = newSlap(), dive = newDive();

  const node = new TransformNode("player", stage.scene);
  const feet = options.spawn.clone(), before = feet.clone(), velocity = new Vector3();
  const lift = new Vector3(); // m the picture still lags behind the last steps up (and a climb out of the water)
  const push = new Vector3(); // m/s a toss still carries it over the ground, until it lands (toss())
  let facing = 0, facingBefore = 0, speed = 0, vy = 0, grounded = false, afloat = false, actHeld = false, slapHeld = false, under = false;
  let swimSpeed = SWIM_SPEED; // the Class may change it (PlayerControls.swimSpeed)
  let foe: PlayerControls["foe"], leaping = false, spin = 0, spinBefore = 0; // the leaping slap, and how far round it has turned, radians
  let actor: Actor | undefined, aim: number | undefined, ride: Ride | undefined; // aim: where a lasting action turns the beaver
  let hold: PlayerControls["hold"], freeing = false; // freeing: a pickup waits for the paws to be free
  let turnTo: PlayerControls["turnTo"], turned = 0; // turned: rad turnTo turned this step
  let sitFor = 0, sitFace: number | undefined, slapAsked = false; // sit() and slap(): asked for by another part
  const desired = new Vector3(), forward = new Vector3();

  // The live level: the pond rises with the dam (src/world/water.ts); options.waterLevel alone where there is no pond.
  const waterLevel = () => options.waterLevel === undefined ? undefined : waterOf(stage.scene)?.level ?? options.waterLevel;

  const inReach = () => {
    if (!options.hand) return undefined;
    const front = new Vector3(Math.sin(facing) * REACH, 0.1, Math.cos(facing) * REACH).add(feet);
    let best: Stick | undefined, bestDistance = REACH_RADIUS;
    for (const stick of sticks) {
      const at = stick.body.transformNode.position, d = Math.hypot(at.x - front.x, (at.y - front.y) * 0.5, at.z - front.z);
      if (d < bestDistance && stick !== carried?.stick) { best = stick; bestDistance = d; }
    }
    return best;
  };

  const down = { x: 0, y: -1, z: 0 }, up = { x: 0, y: 1, z: 0 }, still = Quaternion.Identity();
  // How deep the water is over the ground at x, z, 0 where the ground is above the level (only the ground: the lodge
  // or a rock in the way stops the mover). The ground is a single surface, found from above; the other solids by a
  // ray down from the level, and 0 when the level lies inside one (Havok's rays do not hit from inside).
  const depthAt = (x: number, z: number, level: number, mask = GROUND) => {
    const top = physics.ray({ x, y: level + 20, z }, down, 40, GROUND);
    const ground = top ? Math.max(0, top.distance - 20) : 20;
    if (mask === GROUND) return Math.min(20, ground);
    if (physics.overlaps(point, still, { x, y: level, z }, mask)) return 0;
    return Math.min(20, ground, physics.ray({ x, y: level, z }, down, 20, mask)?.distance ?? 20);
  };
  /** Whether a ride may be at x, z facing (dx, dz) (unit): deep enough at the seat, the bow in the water and clear.
   *  At the bow anything solid stops it: the lodge, the dam or a rock, not only the beaver's body behind it (else
   *  the bow would go a metre into the lodge). */
  const floats = (r: Ride, x: number, z: number, dx: number, dz: number, level: number) =>
    depthAt(x, z, level) > r.depth && depthAt(x + dx * r.bow, z + dz * r.bow, level, SOLIDS) > r.draft;

  // Whether the ground a step ahead along the facing lies under the water (a walk asked for by turnTo stops there).
  const wetAhead = () => {
    const level = waterLevel();
    if (level === undefined) return false;
    const x = feet.x + Math.sin(facing) * (RADIUS + 0.15), z = feet.z + Math.cos(facing) * (RADIUS + 0.15), top = Math.max(level, feet.y) + 1;
    return top - depthAt(x, z, top) < level;
  };

  const steep = () => {
    const hit = physics.ray({ x: feet.x, y: feet.y + 0.3, z: feet.z }, down, 0.5);
    return !!hit && hit.normal.y < Math.cos(SLOPE);
  };

  // Steps up onto a ledge up to STEP_UP high when walking is blocked: a ray just past the capsule's front finds the
  // ledge (walkable, not too high), then shape casts check for room above and STEP_WIDTH of room on top.
  // Returns how far to lift, or 0.
  type XYZ = { x: number; y: number; z: number };
  const cast = (at: XYZ, way: XYZ, distance: number, mask = ALL) => physics.cast(shape, still, at, way, distance, mask);
  const stepUp = (dx: number, dz: number) => {
    const length = Math.hypot(dx, dz), from = centre;
    if (length < 1e-6) return 0;
    const ahead = { x: dx / length, y: 0, z: dz / length }, top = STEP_UP + 0.01;
    const ledge = physics.ray({ x: feet.x + ahead.x * (RADIUS + 0.03), y: feet.y + top, z: feet.z + ahead.z * (RADIUS + 0.03) }, down, top);
    if (!ledge || ledge.normal.y < Math.cos(SLOPE)) return 0;
    const height = top - ledge.distance + 0.01;
    if (height <= OFFSET + 0.01 || height > STEP_UP + 0.01) return 0;
    if (cast(from, up, height)) return 0;
    return cast({ x: from.x, y: from.y + height, z: from.z }, ahead, STEP_WIDTH) ? 0 : height;
  };

  // Climbs out of the water when swimming is blocked: the same ray finds the shore's ground ahead (only the ground: the
  // lodge, the dam, a rock or a stick are never climbed onto from the water), walkable and up to CLIMB_OUT above the
  // feet. Then the body goes up, CLIMB_IN in over the land (rising with it, up to the steepest shore) and down onto it;
  // anything in the way on the way stops it. Returns how far up and in it goes, or undefined.
  const climbOut = (dx: number, dz: number) => {
    const length = Math.hypot(dx, dz), from = centre;
    if (length < 1e-6) return undefined;
    const ahead = { x: dx / length, y: 0, z: dz / length }, top = CLIMB_OUT + 0.01;
    // Just past the front, then further in: on the low pond's south shore the lip of the basin's wall is still steep there.
    let height = 0;
    for (const reach of [RADIUS + 0.03, CLIMB_IN, CLIMB_IN + RADIUS]) {
      const ledge = physics.ray({ x: feet.x + ahead.x * reach, y: feet.y + top, z: feet.z + ahead.z * reach }, down, top, GROUND);
      if (ledge && ledge.normal.y >= Math.cos(SLOPE)) { height = top - ledge.distance + 0.01; break; }
    }
    if (height <= OFFSET + 0.01) return undefined;
    const rise = height + (CLIMB_IN + STEP_WIDTH) * Math.tan(SHORE_SLOPE), over = { x: from.x, y: from.y + rise, z: from.z };
    if (cast(from, up, rise) || cast(over, ahead, CLIMB_IN + STEP_WIDTH)) return undefined;
    const inside = { x: over.x + ahead.x * CLIMB_IN, y: over.y, z: over.z + ahead.z * CLIMB_IN };
    const land = cast(inside, down, rise + 0.05);
    if (!land || land.shape?.filterMembershipMask !== GROUND) return undefined;
    const y = rise - (land.distance - OFFSET); // set down with the mover's gap
    return y > OFFSET ? { x: ahead.x * CLIMB_IN, y, z: ahead.z * CLIMB_IN } : undefined;
  };

  const grab = (stick: Stick) => {
    enable(stick.body, false); // out of the simulation and out of every query
    stage.unbind(stick.mesh);
    carried = { stick, parent: stick.mesh.parent };
    stick.mesh.parent = options.hand!;
  };

  // Where a dropped stick goes: DROP_AHEAD m in front, across the body; a wall nearer than that stops it short.
  // The stick's own box is cast from the beaver's middle; if it has no room across (a wall right beside), it is
  // tried along the facing, and the way with more room wins.
  const DROP_AHEAD = 0.5, DROP_HEIGHT = 0.2;
  const dropPlace = (stick: Stick) => {
    const ahead = { x: Math.sin(facing), y: 0, z: Math.cos(facing) }, from = { x: feet.x, y: feet.y + DROP_HEIGHT, z: feet.z };
    const box = stick.body.shape; // out of every query while carried: it never meets itself
    const roomFor = (yaw: number) => {
      const turn = Quaternion.RotationAxis(Vector3.Up(), yaw);
      if (!box) return { turn, room: DROP_AHEAD };
      const hit = physics.cast(box, turn, from, ahead, DROP_AHEAD);
      return { turn, room: hit ? Math.max(0, hit.distance - 0.02) : DROP_AHEAD };
    };
    let best = roomFor(facing + Math.PI / 2);
    if (best.room < DROP_AHEAD) { const along = roomFor(facing); if (along.room > best.room) best = along; }
    return { turn: best.turn, at: new Vector3(from.x + ahead.x * best.room, from.y, from.z + ahead.z * best.room) };
  };

  const release = () => {
    if (!carried) return;
    const { stick, parent } = carried;
    carried = undefined;
    const { at, turn } = dropPlace(stick);
    stick.mesh.parent = parent;
    stick.mesh.scaling.setAll(1);
    stick.mesh.position.copyFrom(at);
    stick.mesh.rotationQuaternion!.copyFrom(turn);
    place(stick.body, at, turn);
    enable(stick.body, true);
    stick.body.setLinearVelocity(new Vector3(velocity.x, vy, velocity.z));
    stage.bind(stick.mesh, stick.body);
  };

  const step = (dt: number) => {
    before.copyFrom(feet);
    facingBefore = facing;
    keys.read(input);
    if (ride) Object.assign(input, rideKeys(input));
    const tossed = push.lengthSquared() > 0;
    if (tossed) input.act = false; // thrown, it lets go of what it was at: a gnaw or a build ends by itself
    // Under water: no tail slap (it is the alarm on the surface); pickup and drop work, and the actor offers only what
    // can be done there (build/index.ts: wedging a stick into the food cache, no gnawing).
    const slapping = slap.progress > 0;
    stepSlap(slap, dt, (!!input.slap && !slapHeld) || slapAsked, (grounded || afloat) && act.action === "none" && !under);
    slapAsked = false;
    slapHeld = !!input.slap;
    const leaps = !slapping && slap.progress > 0 && !!foe && grounded && !afloat && !ride;
    if (leaps) leaping = true; else if (slap.progress === 0) leaping = false;
    const pressed = input.act && !actHeld && slap.progress === 0; // E waits while the tail is up
    actHeld = input.act;

    // The carry sequence. E at a stick with something else in the paws: that goes away first, then the pickup starts.
    if (act.action === "none" && pressed && !act.carrying) target = (grounded || afloat) && !ride ? inReach() : undefined;
    let pick = pressed && !freeing;
    if (target && pick && hold?.full) { hold.free(); freeing = true; pick = false; }
    else if (freeing && !hold?.full) {
      freeing = false;
      target = act.action === "none" && !act.carrying && (grounded || afloat) && !ride ? inReach() : undefined;
      pick = !!target;
    }
    // A lasting action of another part (gnaw, build) when there is nothing to pick up; it comes before a drop.
    const offer = act.action === "none" && pressed && !target && (grounded || afloat) ? actor?.begin(act.carrying) : undefined;
    if (offer) { act.action = offer.action; act.progress = 0; aim = offer.face; }
    else if (act.action === "gnaw" || act.action === "build") {
      const progress = actor?.step(dt, input.act);
      if (progress === undefined) { act.action = "none"; act.progress = 0; aim = undefined; } else act.progress = progress;
    }
    const event = stepAction(act, dt, pick && !offer && (grounded || afloat), !!target);
    if (event === "grab") {
      if (target && isEnabled(target.body)) grab(target); else act.carrying = false;
      target = undefined;
    } else if (event === "release") release();
    const busy = act.action !== "none";

    // Where it wants to go, relative to the camera; it turns there and walks along its facing.
    forward.set(-Math.sin(camera.yaw), 0, -Math.cos(camera.yaw)); // camera to look point, on the ground
    desired.set(forward.x * input.move.y - forward.z * input.move.x, 0, forward.z * input.move.y + forward.x * input.move.x);
    const moving = desired.lengthSquared() > 0.01, wants = !busy && moving;
    if (sitFor > 0) sitFor = moving || busy || input.jump || !grounded || afloat || ride ? 0 : Math.max(0, sitFor - dt);
    // On land the dive key sits and Y crawls, while held (sitting the beaver does not move: moving gets it up).
    const { low, slow } = stepLow(!!input.dive || sitFor > 0, !!input.crawl, { grounded, afloat, moving, acting: busy, jumping: vy > 0, riding: !!ride });
    const top = ride ? RIDE_SPEED : afloat ? swimSpeed : slow ? CRAWL_SPEED : WALK_SPEED + (RUN_SPEED - WALK_SPEED) * Math.max(0, Math.min(1, input.run));
    const [accel, brake] = ride ? [RIDE_ACCEL, RIDE_BRAKE] : afloat ? [SWIM_ACCEL, SWIM_ACCEL] : !grounded ? [AIR_ACCEL, AIR_ACCEL] : [ACCEL, BRAKE];
    const going = speed; // m/s before steering brakes it: a walk asked for by turnTo keeps it
    steering.facing = facing; steering.speed = speed;
    steer(steering, wants ? Math.atan2(desired.x, desired.z) : busy ? aim : sitFor > 0 ? sitFace : undefined, wants ? desired.length() : 0, top, accel, brake, dt);
    facing = steering.facing; speed = steering.speed;
    turned = 0;
    if (turnTo && !wants && !busy && !ride && grounded && !afloat) {
      const was = facing;
      facing = steering.facing = turnTowards(facing, turnTo.heading, turnTo.rate * dt);
      turned = facing - was;
      if (turnTo.speed) speed = wetAhead() ? 0 : Math.min(turnTo.speed, going + ACCEL * dt);
    }
    if (low === "sit" && !ride) speed = 0; // sitting, it does not slide on: it stops where it sat down
    if (leaping && foe) {
      const was = facing;
      facing = steering.facing = turnTowards(facing, Math.atan2(foe.x - feet.x, foe.z - feet.z), LEAP_TURN * dt);
      turned += facing - was;
    }
    // Once round over the whole slap, slow at both ends: half round, the tail towards the foe, as it strikes (SLAP_HIT 0.5).
    spinBefore = spin;
    spin = leaping ? 2 * Math.PI * slap.progress * slap.progress * (3 - 2 * slap.progress) : 0;
    if (spin < spinBefore) spinBefore = spin; // over: full round is where it began

    // Up and down: jump, gravity, or floating at the surface.
    const level = waterLevel();
    const depth = level === undefined ? -Infinity : level - feet.y;
    // In the water with the ground under the middle of the body deep enough to float: the capsule's rim caught on the
    // lip of the basin's wall holds the feet up, but there is nothing to stand on, so it floats.
    const overDeep = level !== undefined && depth > HOLD_DEPTH - 0.1 && depthAt(feet.x, feet.z, level) > FLOAT_DEPTH;
    if (ride) { afloat = false; vy = 0; } // held at the seat, below
    else if (!afloat && (depth > FLOAT_DEPTH || overDeep)) { afloat = true; vy = Math.max(vy, -DIVE_SPEED); } // the water stops a fall: off the basin's drop-off it would sink a metre
    else if (afloat && grounded && depth < FLOAT_DEPTH - 0.02 && !overDeep) afloat = false;
    if (jumpStarts(jump, dt, grounded, input.jump, !afloat && !busy && slap.progress === 0)) { vy = JUMP_SPEED; grounded = false; }
    if (leaps) { vy = LEAP_SPEED; grounded = false; }
    const diving = stepDive(dive, dt, !!input.dive && act.action !== "gnaw" && (act.action !== "build" || under) && slap.progress === 0, afloat, under);
    if (ride) { /* no gravity: the canoe holds it */ }
    else if (afloat) {
      // m/s: diving, down (or up with Space) but never up out of it; else up towards floating depth, calmly from deep
      const goal = diving ? Math.min(input.jump ? DIVE_SPEED : -DIVE_SPEED, (depth - DIVE_TOP) * 4) : Math.min(RISE, (depth - HOLD_DEPTH) * 4);
      vy += (goal - vy) * Math.min(1, 5 * dt);
    } else {
      // On walkable ground snap-to-ground keeps it down; pressing into the floor would make the controller stall.
      // On ground steeper than it can climb gravity stays on, and the controller lets it slide.
      if (grounded && vy <= 0 && !steep()) vy = 0;
      else vy = Math.max(-MAX_FALL, vy - GRAVITY * (vy > 0 && !input.jump && !tossed && !leaping ? CUT : 1) * dt); // a toss and a leap rise their whole arc
    }

    // Move the capsule through the world.
    const wish = { x: (Math.sin(facing) * speed + push.x) * dt, y: ride && level !== undefined ? level + ride.seat - feet.y : vy * dt, z: (Math.cos(facing) * speed + push.z) * dt };
    const { moved, grounded: standing, out } = mover.move(centre, wish, afloat || vy > 0 || ride ? 0 : 0.2, ALL, dt);
    // Diving down onto the sloping bed, the controller slides the push down along it: no further sideways than wished,
    // or it would glide down to the deepest point by itself.
    // (Not what pushed it off the bank to keep the gap: without that it would stick to a bank the basin narrows by.)
    const side = Math.hypot(moved.x - out.x, moved.z - out.z), wished = Math.hypot(wish.x, wish.z);
    if (diving && side > wished) { moved.x = out.x + (moved.x - out.x) * wished / side; moved.z = out.z + (moved.z - out.z) * wished / side; }
    // The round bottom of the capsule slides up the edge of a step too high to take, a little each step: such a
    // creep (steeper than SLOPE, smaller than an autostep) counts as a wall.
    if (grounded && wish.y <= 0 && moved.y > 0 && moved.y < 0.05 && moved.y > Math.tan(SLOPE) * Math.hypot(moved.x, moved.z)) moved.x = moved.y = moved.z = 0;
    // A ride stops where the water gets too shallow for it: the shore, the dam's mud. It goes on along its facing.
    // Turned on the spot at the shore, the bow over the shallows: it may only go where the water gets deeper.
    if (ride && level !== undefined && !floats(ride, feet.x + moved.x, feet.z + moved.z, Math.sin(facing), Math.cos(facing), level)
      && (floats(ride, feet.x, feet.z, Math.sin(facing), Math.cos(facing), level) || depthAt(feet.x + moved.x, feet.z + moved.z, level) <= depthAt(feet.x, feet.z, level))) { moved.x = moved.z = 0; speed = 0; }
    // Blocked while walking on the ground: maybe a step to go up.
    let stepped = 0, inX = 0, inZ = 0; // m: lifted by a step or a climb, and carried in by a climb
    const blocked = !ride && Math.hypot(moved.x, moved.z) < 0.5 * Math.hypot(wish.x, wish.z);
    if (blocked && grounded && wish.y <= 0) {
      const height = stepUp(wish.x, wish.z);
      if (height > 0) { moved.x = wish.x; moved.y = height; moved.z = wish.z; lift.y -= height; before.y += height; stepped = height; }
    }
    // Blocked in the water (swimming, or on foot as deep as it swims: caught on the lip of the basin's wall): maybe the
    // shore to climb out onto, on foot from here on.
    if (blocked && !stepped && !diving && level !== undefined && (afloat || level - feet.y > HOLD_DEPTH)) {
      const climb = climbOut(wish.x, wish.z);
      if (climb) {
        // Up and in, the middle of the body over the land: the picture follows both ways, as it does a step up.
        inX = climb.x - wish.x; inZ = climb.z - wish.z;
        moved.x = climb.x; moved.y = climb.y; moved.z = climb.z; stepped = climb.y;
        lift.x -= inX; lift.y -= climb.y; lift.z -= inZ;
        before.x += inX; before.y += climb.y; before.z += inZ;
        afloat = false; vy = 0;
      }
    }
    centre.addInPlace(moved);
    body.setTargetTransform(centre, still);
    feet.set(centre.x, centre.y - HEIGHT / 2 - OFFSET, centre.z);
    grounded = ride ? true : standing; // the canoe holds it up
    if (grounded || afloat) push.setAll(0); // a toss ends where it comes down
    if (vy > 0 && moved.y < wish.y * 0.5) vy = 0; // bumped the head
    velocity.set((moved.x - inX) / dt, 0, (moved.z - inZ) / dt); // a climb's way in is not a dash

    under = level !== undefined && level - feet.y > HEAD_UNDER;

    trackMotion(motion, dt, {
      moved: Math.hypot(moved.x - inX, moved.z - inZ), vertical: (moved.y - stepped) / dt, // a step up is not a leap
      turning: (facing - facingBefore - turned) / dt, grounded, afloat, act, slap: slap.progress, diving, low, ride: !!ride,
    });
  };

  const show = new Vector3();
  const update = (dt: number, alpha: number) => {
    Vector3.LerpToRef(before, feet, alpha, node.position);
    lift.scaleInPlace(Math.exp(-LIFT_EASE * dt)); // a step up shows as a quick rise, not a jump of the whole body
    node.position.addInPlace(lift);
    node.rotation.set(0, facingBefore + Math.atan2(Math.sin(facing - facingBefore), Math.cos(facing - facingBefore)) * alpha + spinBefore + (spin - spinBefore) * alpha, 0);
    camera.update(dt, show.copyFrom(node.position), { velocity, facing, afloat, busy: act.action === "gnaw" || act.action === "build", level: waterLevel(), diving: dive.diving });
    if (carried && options.hand) {
      // The first-person view's eyes look the camera's way: its yaw looks from +z round to -z (see camera.gaze).
      if (camera.view === "first-person") holdInView(carried.stick.mesh, options.hand, stage.camera.position, camera.yaw + Math.PI);
      else holdInHand(carried.stick.mesh, options.hand, node);
    }
  };

  return {
    node, motion, step, update, keys, input, camera, body, collisions: mover.collisions, feet, velocity,
    get facing() { return facing; },
    get afloat() { return afloat; },
    get swimSpeed() { return swimSpeed; },
    set swimSpeed(v: number) { swimSpeed = Number.isFinite(v) && v > 0 ? v : SWIM_SPEED; },
    get diving() { return dive.diving; },
    get breath() { return dive.breath / BREATH; },
    get waterLevel() { return waterLevel(); },
    get carrying() { return carried?.stick; },
    drop() { if (carried) { release(); act.carrying = false; } },
    toss(x, z, up) {
      if (ride) return;
      push.set(x, 0, z);
      vy = up; speed = 0; grounded = false;
    },
    get foe() { return foe; },
    set foe(value) { foe = value; },
    putDown() {
      if (!act.carrying || act.action !== "none" || !(grounded || afloat) || ride) return false;
      act.action = "drop";
      act.progress = 0;
      return true;
    },
    get hold() { return hold; },
    set hold(value) { hold = value; },
    get actor() { return actor; },
    set actor(value) { actor = value; },
    offer() {
      if (act.action !== "none" || !(grounded || afloat)) return undefined; // busy, or in the air: E does nothing
      if (ride) return actor?.offer?.(false); // in the canoe: only what the canoe offers (getting out)
      if (!act.carrying && inReach()) return { action: "pickup", text: "Pick up stick" };
      return actor?.offer?.(act.carrying) ?? (act.carrying ? { action: "drop", text: "Drop" } : undefined);
    },
    handOver() {
      const stick = carried?.stick;
      carried = undefined;
      act.carrying = false;
      return stick;
    },
    setAnger: (value) => { motion.anger = Math.max(0, Math.min(1, value)); },
    teleport(x, y, z, turnTo = facing) {
      // Set down on a steep wall (the basin's), the capsule would start inside the ground beside its feet and sink
      // through it (measured): lifted until it rests on the ground, up to a metre. Only the ground (src/world/terrain.ts:
      // its heightfield and trimesh): from inside the lodge or a rock it swims or walks out by itself.
      const at = { x, y: y + HEIGHT / 2 + OFFSET, z };
      if (physics.overlaps(shape, still, at, GROUND)) {
        const hit = cast({ x, y: at.y + 1, z }, down, 1, GROUND);
        at.y += 1 - (hit?.distance ?? 1);
      }
      centre.set(at.x, at.y, at.z);
      place(body, centre, still);
      body.setTargetTransform(centre, still);
      feet.set(x, at.y - HEIGHT / 2 - OFFSET, z); before.copyFrom(feet);
      facing = facingBefore = turnTo;
      speed = vy = steering.spin = 0;
      lift.setAll(0); push.setAll(0);
      ride = undefined;
      sitFor = 0;
    },
    ride(value) {
      ride = value;
      speed = vy = 0;
      if (value) { afloat = false; under = false; }
    },
    get riding() { return !!ride; },
    get touched() { return keys.touched + camera.touched; },
    sit(seconds, face) { sitFor = seconds; sitFace = face; },
    get sitting() { return sitFor; },
    slap() { slapAsked = true; },
    get turnTo() { return turnTo; },
    set turnTo(value) { turnTo = value; },
  };
}
