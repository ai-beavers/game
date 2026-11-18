import { holdInHand } from "./grip.ts";
// Who steers the beaver: keyboard input, a Rapier kinematic character, carrying sticks, swimming and diving, sitting
// and crawling, the tail slap, the follow camera, and the Motion report the animator draws from.
//
//   const player = createPlayer(stage, { spawn, hand: beaver.hand, sticks: world.sticks, waterLevel: world.waterLevel });
//   beaver.root.parent = player.node;
//   run(stage, (dt) => player.step(dt), (dt, alpha) => { player.update(dt, alpha); beaver.pose(animator.pose(player.motion, dt)); });
//
// The object returned has a few more fields than Player (see PlayerControls) for labs and tests; anger is set with
// `player.motion.anger = …` or `setAnger`, the player never changes it.
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { RUN_SPEED, WALK_SPEED, type CreatePlayer, type Player, type PlayerOptions, type Stick } from "../contracts.ts";
import { RAPIER, type Stage } from "../engine.ts";
import { waterOf } from "../world/water.ts";
import { followCamera, type FollowCamera } from "./camera.ts";
import { keyboard, newInput, type Keyboard } from "./input.ts";
import { BREATH, CRAWL_SPEED, jumpStarts, newAction, newDive, newJump, newMotion, newSlap, newSteering, steer, stepAction, stepDive, stepLow, stepSlap, trackMotion, type SwimMotion } from "./state.ts";

// The body: a capsule 1 m tall and 0.45 m wide, its bottom at the feet.
export const HEIGHT = 1.0, RADIUS = 0.225;
const HALF = HEIGHT / 2 - RADIUS, OFFSET = 0.02; // the controller keeps this gap to everything
// Moving.
const ACCEL = 6, BRAKE = 9, AIR_ACCEL = 2.5; // m/s²: quick, but with weight
const SLOPE = 40 * Math.PI / 180; // steepest ground it walks up; steeper ground it slides down
const STEP_UP = 0.15, STEP_WIDTH = 0.1; // m: highest step it walks up, and the least room it needs on top
const LIFT_EASE = 18; // 1/s: how fast the picture follows a step up
const SWIM_SPEED = 0.5, SWIM_ACCEL = 2;
// Jumping: up to JUMP_HEIGHT while Space is held; letting go early cuts the rise.
const GRAVITY = 18, CUT = 3.5; // m/s², and how much harder it pulls once Space is let go on the way up
export const JUMP_HEIGHT = 0.6;
const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT) + GRAVITY / 120; // the half step the fixed steps lose
const MAX_FALL = 20;
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
  camera: FollowCamera;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  /** Where the feet are after the last step, and the horizontal velocity, m/s. */
  feet: Vector3;
  velocity: Vector3;
  facing: number;
  afloat: boolean;
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
  /** A part that uses the context key for lasting actions (gnaw, build); see Actor. */
  actor: Actor | undefined;
  /** Gives the carried stick away (into the dam) without putting it down: no longer carried, its body stays
   *  disabled and its mesh in the hand, for the taker to move. */
  handOver(): Stick | undefined;
  /** What a press of the context key would do right now, in words for the screen; undefined: nothing. */
  offer(): Offer | undefined;
}

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
  const { physics } = stage, sticks = options.sticks ?? [];
  const body = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(options.spawn.x, options.spawn.y + HEIGHT / 2 + OFFSET, options.spawn.z));
  const collider = physics.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS), body);
  const controller = physics.createCharacterController(OFFSET);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.setMaxSlopeClimbAngle(SLOPE);
  controller.setMinSlopeSlideAngle(SLOPE);
  // Rapier's own autostep never took a step with this capsule (measured); stepUp() below does it instead.
  controller.enableSnapToGround(0.2);
  controller.setApplyImpulsesToDynamicBodies(true);
  controller.setCharacterMass(12);

  const stickBodies = new Set(sticks.map((s) => s.body));
  let carried: { stick: Stick; parent: TransformNode["parent"] } | undefined, target: Stick | undefined;
  const notCarried = (c: RAPIER.Collider) => !carried || c.parent() !== carried.stick.body;
  const camera = followCamera(stage, (c) => c !== collider && !stickBodies.has(c.parent()!));
  const keys = keyboard(), input = newInput(), jump = newJump(), act = newAction(), motion: SwimMotion = newMotion(), steering = newSteering(), slap = newSlap(), dive = newDive();

  const node = new TransformNode("player", stage.scene);
  const feet = options.spawn.clone(), before = feet.clone(), velocity = new Vector3();
  let lift = 0; // m the picture still lags behind the last steps up
  let facing = 0, facingBefore = 0, speed = 0, vy = 0, grounded = false, afloat = false, actHeld = false, slapHeld = false, under = false;
  let actor: Actor | undefined, aim: number | undefined; // aim: where a lasting action turns the beaver
  const desired = new Vector3(), forward = new Vector3();

  // The live level: the pond rises with the dam (src/world/water.ts); options.waterLevel alone where there is no pond.
  const waterLevel = () => options.waterLevel === undefined ? undefined : waterOf(stage.scene)?.level ?? options.waterLevel;

  const inReach = () => {
    if (!options.hand) return undefined;
    const front = new Vector3(Math.sin(facing) * REACH, 0.1, Math.cos(facing) * REACH).add(feet);
    let best: Stick | undefined, bestDistance = REACH_RADIUS;
    for (const stick of sticks) {
      const at = stick.body.translation(), d = Math.hypot(at.x - front.x, (at.y - front.y) * 0.5, at.z - front.z);
      if (d < bestDistance && stick !== carried?.stick) { best = stick; bestDistance = d; }
    }
    return best;
  };

  const down = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const steep = () => {
    down.origin = { x: feet.x, y: feet.y + 0.3, z: feet.z };
    const hit = physics.castRayAndGetNormal(down, 0.5, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, collider, undefined, notCarried);
    return !!hit && hit.normal.y < Math.cos(SLOPE);
  };

  // Steps up onto a ledge up to STEP_UP high when walking is blocked: a ray just past the capsule's front finds the
  // ledge (walkable, not too high), then shape casts check for room above and STEP_WIDTH of room on top.
  // Returns how far to lift, or 0.
  const shape = collider.shape, still = { x: 0, y: 0, z: 0, w: 1 }, up = { x: 0, y: 1, z: 0 };
  const probe = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const stepUp = (dx: number, dz: number) => {
    const length = Math.hypot(dx, dz), from = collider.translation(), flags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    if (length < 1e-6) return 0;
    const ahead = { x: dx / length, y: 0, z: dz / length }, top = STEP_UP + 0.01;
    probe.origin = { x: feet.x + ahead.x * (RADIUS + 0.03), y: feet.y + top, z: feet.z + ahead.z * (RADIUS + 0.03) };
    const ledge = physics.castRayAndGetNormal(probe, top, true, flags, undefined, collider, undefined, notCarried);
    if (!ledge || ledge.normal.y < Math.cos(SLOPE)) return 0;
    const height = top - ledge.timeOfImpact + 0.01;
    if (height <= OFFSET + 0.01 || height > STEP_UP + 0.01) return 0;
    const cast = (at: RAPIER.Vector, way: RAPIER.Vector, distance: number) =>
      physics.castShape(at, still, way, shape, 0, distance, false, flags, undefined, collider, undefined, notCarried);
    if (cast(from, up, height)) return 0;
    return cast({ x: from.x, y: from.y + height, z: from.z }, ahead, STEP_WIDTH) ? 0 : height;
  };

  const grab = (stick: Stick) => {
    stick.body.setEnabled(false); // out of the simulation and out of every query
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
    const box = stick.body.collider(0)?.shape, flags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const roomFor = (yaw: number) => {
      const turn = Quaternion.RotationAxis(Vector3.Up(), yaw);
      if (!box) return { turn, room: DROP_AHEAD };
      const hit = physics.castShape(from, turn, ahead, box, 0, DROP_AHEAD, false, flags, undefined, collider, stick.body);
      return { turn, room: hit ? Math.max(0, hit.time_of_impact - 0.02) : DROP_AHEAD };
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
    stick.body.setTranslation(at, true);
    stick.body.setRotation(turn, true);
    stick.body.setEnabled(true);
    stick.body.setLinvel({ x: velocity.x, y: vy, z: velocity.z }, true);
    stick.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    stage.bind(stick.mesh, stick.body);
  };

  const step = (dt: number) => {
    before.copyFrom(feet);
    facingBefore = facing;
    keys.read(input);
    // Under water: no tail slap (it is the alarm on the surface); pickup and drop work, and the actor offers only what
    // can be done there (build/index.ts: wedging a stick into the food cache, no gnawing).
    stepSlap(slap, dt, !!input.slap && !slapHeld, (grounded || afloat) && act.action === "none" && !under);
    slapHeld = !!input.slap;
    const pressed = input.act && !actHeld && slap.progress === 0; // E waits while the tail is up
    actHeld = input.act;

    // The carry sequence.
    if (act.action === "none" && pressed && !act.carrying) target = grounded || afloat ? inReach() : undefined;
    // A lasting action of another part (gnaw, build) when there is nothing to pick up; it comes before a drop.
    const offer = act.action === "none" && pressed && !target && (grounded || afloat) ? actor?.begin(act.carrying) : undefined;
    if (offer) { act.action = offer.action; act.progress = 0; aim = offer.face; }
    else if (act.action === "gnaw" || act.action === "build") {
      const progress = actor?.step(dt, input.act);
      if (progress === undefined) { act.action = "none"; act.progress = 0; aim = undefined; } else act.progress = progress;
    }
    const event = stepAction(act, dt, pressed && !offer && (grounded || afloat), !!target);
    if (event === "grab") {
      if (target && target.body.isEnabled()) grab(target); else act.carrying = false;
      target = undefined;
    } else if (event === "release") release();
    const busy = act.action !== "none";

    // Where it wants to go, relative to the camera; it turns there and walks along its facing.
    forward.set(-Math.sin(camera.yaw), 0, -Math.cos(camera.yaw)); // camera to look point, on the ground
    desired.set(forward.x * input.move.y - forward.z * input.move.x, 0, forward.z * input.move.y + forward.x * input.move.x);
    const moving = desired.lengthSquared() > 0.01, wants = !busy && moving;
    // On land the dive key sits and Y crawls, while held (sitting the beaver does not move: moving gets it up).
    const { low, slow } = stepLow(!!input.dive, !!input.crawl, { grounded, afloat, moving, acting: busy, jumping: vy > 0 });
    const top = afloat ? SWIM_SPEED : slow ? CRAWL_SPEED : WALK_SPEED + (RUN_SPEED - WALK_SPEED) * Math.max(0, Math.min(1, input.run));
    const [accel, brake] = afloat ? [SWIM_ACCEL, SWIM_ACCEL] : !grounded ? [AIR_ACCEL, AIR_ACCEL] : [ACCEL, BRAKE];
    steering.facing = facing; steering.speed = speed;
    steer(steering, wants ? Math.atan2(desired.x, desired.z) : busy ? aim : undefined, wants ? desired.length() : 0, top, accel, brake, dt);
    facing = steering.facing; speed = steering.speed;
    if (low === "sit") speed = 0; // sitting, it does not slide on: it stops where it sat down

    // Up and down: jump, gravity, or floating at the surface.
    const level = waterLevel();
    const depth = level === undefined ? -Infinity : level - feet.y;
    if (!afloat && depth > FLOAT_DEPTH) { afloat = true; vy = Math.max(vy, -DIVE_SPEED); } // the water stops a fall: off the basin's drop-off it would sink a metre
    else if (afloat && grounded && depth < FLOAT_DEPTH - 0.02) afloat = false;
    if (jumpStarts(jump, dt, grounded, input.jump, !afloat && !busy && slap.progress === 0)) { vy = JUMP_SPEED; grounded = false; }
    const diving = stepDive(dive, dt, !!input.dive && act.action !== "gnaw" && (act.action !== "build" || under) && slap.progress === 0, afloat, under);
    if (afloat) {
      // m/s: diving, down (or up with Space) but never up out of it; else up towards floating depth, calmly from deep
      const goal = diving ? Math.min(input.jump ? DIVE_SPEED : -DIVE_SPEED, (depth - DIVE_TOP) * 4) : Math.min(RISE, (depth - HOLD_DEPTH) * 4);
      vy += (goal - vy) * Math.min(1, 5 * dt);
    } else {
      // On walkable ground snap-to-ground keeps it down; pressing into the floor would make the controller stall.
      // On ground steeper than it can climb gravity stays on, and the controller lets it slide.
      if (grounded && vy <= 0 && !steep()) vy = 0;
      else vy = Math.max(-MAX_FALL, vy - GRAVITY * (vy > 0 && !input.jump ? CUT : 1) * dt);
    }

    // Move the capsule through the world.
    if (afloat || vy > 0) controller.disableSnapToGround(); else controller.enableSnapToGround(0.2);
    const wish = { x: Math.sin(facing) * speed * dt, y: vy * dt, z: Math.cos(facing) * speed * dt };
    controller.computeColliderMovement(collider, wish, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, notCarried);
    const moved = controller.computedMovement();
    // Diving down onto the sloping bed, the controller slides the push down along it: no further sideways than wished,
    // or it would glide down to the deepest point by itself.
    const side = Math.hypot(moved.x, moved.z), wished = Math.hypot(wish.x, wish.z);
    if (diving && side > wished) { moved.x *= wished / side; moved.z *= wished / side; }
    // The round bottom of the capsule slides up the edge of a step too high to take, a little each step: such a
    // creep (steeper than SLOPE, smaller than an autostep) counts as a wall.
    if (grounded && wish.y <= 0 && moved.y > 0 && moved.y < 0.05 && moved.y > Math.tan(SLOPE) * Math.hypot(moved.x, moved.z)) moved.x = moved.y = moved.z = 0;
    // Blocked while walking on the ground: maybe a step to go up.
    let stepped = 0;
    if (grounded && wish.y <= 0 && Math.hypot(moved.x, moved.z) < 0.5 * Math.hypot(wish.x, wish.z)) {
      const height = stepUp(wish.x, wish.z);
      if (height > 0) { moved.x = wish.x; moved.y = height; moved.z = wish.z; lift -= height; before.y += height; stepped = height; }
    }
    const at = body.translation();
    body.setNextKinematicTranslation({ x: at.x + moved.x, y: at.y + moved.y, z: at.z + moved.z });
    feet.set(at.x + moved.x, at.y + moved.y - HEIGHT / 2 - OFFSET, at.z + moved.z);
    grounded = controller.computedGrounded();
    if (vy > 0 && moved.y < wish.y * 0.5) vy = 0; // bumped the head
    velocity.set(moved.x / dt, 0, moved.z / dt);

    under = level !== undefined && level - feet.y > HEAD_UNDER;

    trackMotion(motion, dt, {
      moved: Math.hypot(moved.x, moved.z), vertical: (moved.y - stepped) / dt, // a step up is not a leap
      turning: (facing - facingBefore) / dt, grounded, afloat, act, slap: slap.progress, diving, low,
    });
  };

  const show = new Vector3();
  const update = (dt: number, alpha: number) => {
    Vector3.LerpToRef(before, feet, alpha, node.position);
    lift *= Math.exp(-LIFT_EASE * dt); // a step up shows as a quick rise, not a jump of the whole body
    node.position.y += lift;
    node.rotation.set(0, facingBefore + Math.atan2(Math.sin(facing - facingBefore), Math.cos(facing - facingBefore)) * alpha, 0);
    camera.update(dt, show.copyFrom(node.position), { velocity, facing, afloat, busy: act.action === "gnaw" || act.action === "build", level: waterLevel(), diving: dive.diving });
    if (carried && options.hand) holdInHand(carried.stick.mesh, options.hand, node);
  };

  return {
    node, motion, step, update, keys, camera, collider, controller, feet, velocity,
    get facing() { return facing; },
    get afloat() { return afloat; },
    get diving() { return dive.diving; },
    get breath() { return dive.breath / BREATH; },
    get waterLevel() { return waterLevel(); },
    get carrying() { return carried?.stick; },
    drop() { if (carried) { release(); act.carrying = false; } },
    get actor() { return actor; },
    set actor(value) { actor = value; },
    offer() {
      if (act.action !== "none" || !(grounded || afloat)) return undefined; // busy, or in the air: E does nothing
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
      const at = { x, y: y + HEIGHT / 2 + OFFSET, z }, flags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
      const ground = (c: RAPIER.Collider) => c.shapeType() === RAPIER.ShapeType.HeightField || c.shapeType() === RAPIER.ShapeType.TriMesh;
      if (physics.intersectionWithShape(at, still, shape, flags, undefined, collider, undefined, ground)) {
        const hit = physics.castShape({ x, y: at.y + 1, z }, still, { x: 0, y: -1, z: 0 }, shape, 0, 1, true, flags, undefined, collider, undefined, ground);
        at.y += 1 - (hit?.time_of_impact ?? 1);
      }
      body.setTranslation(at, true);
      body.setNextKinematicTranslation(at);
      feet.set(x, at.y - HEIGHT / 2 - OFFSET, z); before.copyFrom(feet);
      facing = facingBefore = turnTo;
      speed = vy = lift = steering.spin = 0;
    },
  };
}
