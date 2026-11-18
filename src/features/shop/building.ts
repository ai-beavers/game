// The Shop as a building: a small round hut on dry ground, a disco from outside (a mirror ball on the roof, a ring of
// coloured bulbs, beams of coloured light turning from dusk to dawn, the sign HOUSE OF AI on a post in front) and a
// café inside (a wooden floor, a counter, small tables, warm hanging lamps).
//
//   const shop = buildShop(stage, world, SHOP);   shop.root (local +z: out of the doorway) · shop.local(feet) · shop.inside(feet)
//   shop.update(dt, dark, inside)                 once a picture: the lights by the sky's dark (0 … 1); inside: the
//                                                 roof and upper walls hidden, so the camera behind the beaver sees it
//
// No Babylon light is added (every light costs every material a slot): what glows is emissive, and the beams are
// see-through cones that add their colour. The walls' colliders reach only to the beaver's shoulders (WALL_SOLID), so
// the camera's cast passes over them from inside and the picture keeps the beaver, while the beaver cannot get over.
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { World } from "../../contracts.ts";
import { RAPIER, type Stage } from "../../engine.ts";

export const RADIUS = 2.7; // m, inside of the wall
const WALL = 2.1, THICK = 0.14, LOW = 0.95; // m: wall height, thickness, the lower part always shown
const WALL_SOLID = 0.95; // m the walls' colliders reach up: over the beaver's reach, under the camera's look
const SEGMENTS = 24, DOOR = 1; // wall pieces round the hut, and how many are left out on each side of the doorway's middle
const ROOF = 1.15; // m from the wall's top to the roof's tip
/** Where the counter stands (local z of its front) and how far from its front the beaver may talk to the Shopkeeper. */
export const COUNTER = { z: -1.2, depth: 0.5, width: 2.4, height: 0.45 };
export const KEEPER_Z = -1.95;
/** The tables of the café, local x, z; a creature sits at each on the side given (radians, local). */
export const TABLES = [{ x: -1.55, z: 0.05, seat: -Math.PI / 2 }, { x: 1.55, z: 0.05, seat: Math.PI / 2 }, { x: 1.25, z: 1.45, seat: Math.PI * 0.75 }];
const TILT = 0.75; // rad the beams point down from level
const BEAM_COLOURS = [new Color3(1, 0.15, 0.55), new Color3(0.2, 0.45, 1), new Color3(0.2, 1, 0.45), new Color3(1, 0.8, 0.15)];

const paint = (mesh: Mesh, c: Color3) => {
  const n = mesh.getTotalVertices(), colours = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) colours.set([c.r, c.g, c.b, 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colours);
  return mesh;
};
const matte = (scene: Scene, name: string, emissive?: Color3) => {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.White(); // times the vertex colours
  m.specularColor.setAll(0.05);
  if (emissive) m.emissiveColor = emissive;
  return m;
};
/** One mesh from many parts, each in its own colour: one draw call. */
const merge = (name: string, parts: Mesh[], material: StandardMaterial, parent: TransformNode) => {
  const mesh = Mesh.MergeMeshes(parts, true)!;
  mesh.name = name;
  mesh.material = material;
  mesh.parent = parent;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  return mesh;
};

/** The sign's board: HOUSE OF AI in large letters, drawn on a texture as real text. */
function signTexture(scene: Scene) {
  const texture = new DynamicTexture("shop-sign", { width: 1024, height: 384 }, scene, true);
  const g = texture.getContext() as CanvasRenderingContext2D;
  g.translate(1024, 0); g.scale(-1, 1); // a plane turned to face out, in this right-handed scene, shows it mirrored
  g.fillStyle = "#2a1238"; g.fillRect(0, 0, 1024, 384);
  g.strokeStyle = "#f7ca77"; g.lineWidth = 18; g.strokeRect(20, 20, 984, 344);
  g.fillStyle = "#ffe4a8"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = '900 150px "Arial Black", "Helvetica Neue", Arial, sans-serif';
  g.shadowColor = "#ff4fb4"; g.shadowBlur = 24;
  g.fillText("HOUSE", 512, 120);
  g.fillText("OF AI", 512, 270);
  texture.update(true);
  return texture;
}

/** The mirror ball's skin: grey tiles, a few of them catching the light, moved on as it turns. */
function ballTexture(scene: Scene) {
  const texture = new DynamicTexture("shop-mirror-ball", { width: 128, height: 64 }, scene, false);
  const g = texture.getContext() as CanvasRenderingContext2D;
  const draw = (seed: number) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
      const r = Math.sin((x * 12.9898 + y * 78.233 + seed) * 43758.5453) % 1;
      const v = Math.abs(r) > 0.85 ? 255 : 90 + Math.round(Math.abs(r) * 80);
      g.fillStyle = `rgb(${v},${v},${Math.min(255, v + 15)})`;
      g.fillRect(x * 8, y * 8, 7, 7);
    }
    texture.update(false);
  };
  draw(0);
  return { texture, draw };
}

export function buildShop(stage: Stage, world: World, spot: { x: number; z: number; facing: number }) {
  const { scene, physics } = stage;
  // The floor stands level at the highest ground under the hut; its edge slopes down into the grass like a ramp.
  let top = -Infinity, low = Infinity;
  for (let a = 0; a < 24; a++) for (const r of [0, 1, 2, RADIUS + THICK, RADIUS + 0.7]) {
    const h = world.heightAt(spot.x + Math.sin(a / 24 * Math.PI * 2) * r, spot.z + Math.cos(a / 24 * Math.PI * 2) * r);
    top = Math.max(top, h); low = Math.min(low, h);
  }
  const floorY = top + 0.03;
  const root = new TransformNode("shop", scene);
  root.position.set(spot.x, floorY, spot.z);
  root.rotation.y = spot.facing;
  root.computeWorldMatrix(true);
  const turn = Quaternion.RotationAxis(Vector3.Up(), spot.facing);
  const toWorld = (x: number, y: number, z: number) => Vector3.TransformCoordinates(new Vector3(x, y, z), root.getWorldMatrix());
  const solid = (desc: RAPIER.ColliderDesc, x: number, y: number, z: number, yaw = 0) => {
    const at = toWorld(x, y, z), q = Quaternion.RotationAxis(Vector3.Up(), spot.facing + yaw);
    physics.createCollider(desc.setTranslation(at.x, at.y, at.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.9));
  };

  const wood = new Color3(0.42, 0.26, 0.14), plum = new Color3(0.36, 0.13, 0.46), cream = new Color3(0.86, 0.74, 0.56);
  const solidMat = matte(scene, "shop-wood");
  // ---- the floor: a low disc whose edge runs down into the grass ----
  const rise = floorY - low + 0.05;
  const floor = MeshBuilder.CreateCylinder("shop-floor", { height: rise, diameterTop: 2 * (RADIUS + THICK + 0.05), diameterBottom: 2 * (RADIUS + THICK + 0.05) + 1.4, tessellation: 32 }, scene);
  floor.position.y = -rise / 2;
  paint(floor, new Color3(0.5, 0.33, 0.19));
  const floorMesh = merge("shop-floor", [floor], solidMat, root);
  const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(floorMesh.getVerticesData(VertexBuffer.PositionKind)!));
  if (hull) solid(hull, 0, 0, 0);

  // ---- the walls: pieces round a circle, the doorway left open; outside plum, inside warm cream ----
  const lower: Mesh[] = [], upper: Mesh[] = [], step = Math.PI * 2 / SEGMENTS;
  const piece = (a: number, r: number, thick: number, y0: number, y1: number, c: Color3) => {
    const b = MeshBuilder.CreateBox("wall", { width: 2 * (r + thick) * Math.tan(step / 2) + 0.02, height: y1 - y0, depth: thick }, scene);
    b.position.set(Math.sin(a) * (r + thick / 2), (y0 + y1) / 2, Math.cos(a) * (r + thick / 2));
    b.rotation.y = a;
    return paint(b, c);
  };
  for (let k = 0; k < SEGMENTS; k++) {
    const a = (k + 0.5) * step, door = k < DOOR || k >= SEGMENTS - DOOR;
    if (!door) {
      lower.push(piece(a, RADIUS, THICK / 2, 0, LOW, cream), piece(a, RADIUS + THICK / 2, THICK / 2, 0, LOW, plum));
      solid(RAPIER.ColliderDesc.cuboid((RADIUS + THICK) * Math.tan(step / 2), (WALL_SOLID + 0.3) / 2, THICK / 2), Math.sin(a) * (RADIUS + THICK / 2), (WALL_SOLID - 0.3) / 2, Math.cos(a) * (RADIUS + THICK / 2), a);
    }
    // Over the doorway the wall goes on from its lintel up.
    upper.push(piece(a, RADIUS, THICK / 2, door ? 1.55 : LOW, WALL, cream), piece(a, RADIUS + THICK / 2, THICK / 2, door ? 1.55 : LOW, WALL, plum));
  }
  // The door frame: two posts and a lintel in wood.
  const half = (RADIUS + THICK) * Math.sin(DOOR * step) ;
  for (const side of [-1, 1]) {
    const post = MeshBuilder.CreateBox("post", { width: 0.12, height: 1.55, depth: THICK + 0.06 }, scene);
    post.position.set(side * (half - 0.02), 0.775, Math.cos(DOOR * step) * (RADIUS + THICK / 2));
    lower.push(paint(post, wood));
  }
  merge("shop-walls", lower, solidMat, root);
  // The roof: a cone of dark felt shingles over the walls, gold at the eaves.
  const roof = MeshBuilder.CreateCylinder("roof", { height: ROOF, diameterTop: 0.25, diameterBottom: 2 * (RADIUS + THICK + 0.35), tessellation: SEGMENTS }, scene);
  roof.position.y = WALL + ROOF / 2;
  const eave = MeshBuilder.CreateTorus("eave", { diameter: 2 * (RADIUS + THICK + 0.3), thickness: 0.08, tessellation: SEGMENTS * 2 }, scene);
  eave.position.y = WALL + 0.03;
  const pole = MeshBuilder.CreateCylinder("pole", { height: 0.45, diameter: 0.05 }, scene);
  pole.position.y = WALL + ROOF + 0.15;
  const upperMesh = merge("shop-roof", [...upper, paint(roof, new Color3(0.12, 0.06, 0.16)), paint(eave, new Color3(0.8, 0.6, 0.25)), paint(pole, new Color3(0.5, 0.5, 0.55))], solidMat, root);

  // ---- the mirror ball, turning on its pole at the roof's tip ----
  const ball = MeshBuilder.CreateSphere("shop-mirror-ball", { diameter: 0.55, segments: 8 }, scene);
  ball.convertToFlatShadedMesh();
  const tiles = ballTexture(scene), ballMat = new StandardMaterial("shop-mirror-ball", scene);
  ballMat.diffuseTexture = tiles.texture;
  ballMat.emissiveTexture = tiles.texture;
  ballMat.specularColor.setAll(0.9);
  ballMat.specularPower = 64;
  ball.material = ballMat;
  ball.parent = root;
  ball.position.y = WALL + ROOF + 0.55;
  ball.isPickable = false;

  // ---- a ring of bulbs under the eaves, in four colours that chase each other at night ----
  const bulbs = BEAM_COLOURS.map((colour, c) => {
    const parts: Mesh[] = [];
    for (let k = c; k < SEGMENTS * 2; k += BEAM_COLOURS.length) {
      const a = (k + 0.5) * step / 2, bulb = MeshBuilder.CreateSphere("bulb", { diameter: 0.09, segments: 4 }, scene);
      bulb.position.set(Math.sin(a) * (RADIUS + THICK + 0.05), WALL - 0.1, Math.cos(a) * (RADIUS + THICK + 0.05));
      parts.push(paint(bulb, Color3.White()));
    }
    const mat = matte(scene, `shop-bulbs-${c}`);
    mat.diffuseColor = colour.scale(0.6);
    return { mesh: merge(`shop-bulbs-${c}`, parts, mat, root), mat, colour };
  });

  // ---- beams of coloured light from the ball: see-through cones, turning, from dusk to dawn ----
  const beamRoot = new TransformNode("shop-beams", scene);
  beamRoot.parent = root;
  beamRoot.position.y = ball.position.y;
  const beams = BEAM_COLOURS.map((colour, c) => {
    const cone = MeshBuilder.CreateCylinder("beam", { height: 5, diameterTop: 0.03, diameterBottom: 0.7, tessellation: 12, cap: Mesh.NO_CAP }, scene);
    const holder = new TransformNode("beam-holder", scene);
    holder.parent = beamRoot;
    holder.rotation.y = c * Math.PI / 2;
    cone.parent = holder;
    cone.rotation.x = Math.PI / 2 + TILT; // out and down from the ball, onto the meadow
    cone.position.set(0, -Math.sin(TILT) * 2.5, Math.cos(TILT) * 2.5);
    const mat = new StandardMaterial(`shop-beam-${c}`, scene);
    mat.disableLighting = true;
    mat.emissiveColor = colour;
    mat.alpha = 0;
    mat.backFaceCulling = false;
    mat.alphaMode = 1; // ALPHA_ADD: light adds its colour
    cone.material = mat;
    cone.isPickable = false;
    return mat;
  });

  // ---- the sign on a post in front, beside the path to the doorway, facing out ----
  const sign = new TransformNode("shop-sign", scene);
  sign.parent = root;
  sign.position.set(1.6, 0, RADIUS + 1.6);
  sign.rotation.y = -0.35; // turned a little towards the path
  const signPost = MeshBuilder.CreateCylinder("sign-post", { height: 1.9, diameter: 0.1 }, scene);
  signPost.position.y = 0.95 - 0.1;
  const frame = MeshBuilder.CreateBox("sign-frame", { width: 1.5, height: 0.6, depth: 0.08 }, scene);
  frame.position.y = 1.55;
  merge("shop-sign-post", [paint(signPost, wood), paint(frame, new Color3(0.8, 0.6, 0.25))], solidMat, sign);
  const board = MeshBuilder.CreatePlane("shop-sign-board", { width: 1.4, height: 0.52 }, scene);
  const boardMat = new StandardMaterial("shop-sign-board", scene);
  const text = signTexture(scene);
  boardMat.diffuseTexture = text;
  boardMat.emissiveTexture = text;
  boardMat.emissiveColor = new Color3(0.35, 0.35, 0.35);
  boardMat.specularColor.setAll(0.05);
  board.material = boardMat;
  board.parent = sign;
  board.position.set(0, 1.55, 0.045);
  board.rotation.y = Math.PI; // its face to local +z, out of the shop (the texture is drawn mirrored for this)
  board.isPickable = false;
  const back = board.clone("shop-sign-back"); // the same words on the side towards the shop
  back.position.z = -0.045;
  back.rotation.y = 0;
  solid(RAPIER.ColliderDesc.cylinder(0.6, 0.08), sign.position.x, 0.5, sign.position.z);

  // ---- the café inside: the counter, a shelf of folded shirts behind it, small tables and stools, warm lamps ----
  const inside: Mesh[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: Color3, yaw = 0) => {
    const b = MeshBuilder.CreateBox("part", { width: w, height: h, depth: d }, scene);
    b.position.set(x, y, z); b.rotation.y = yaw;
    inside.push(paint(b, c));
    return b;
  };
  const cz = COUNTER.z - COUNTER.depth / 2;
  box(COUNTER.width, COUNTER.height, COUNTER.depth, 0, COUNTER.height / 2, cz, wood);
  box(COUNTER.width + 0.1, 0.05, COUNTER.depth + 0.1, 0, COUNTER.height + 0.025, cz, new Color3(0.85, 0.8, 0.7));
  solid(RAPIER.ColliderDesc.cuboid(COUNTER.width / 2, (WALL_SOLID + 0.3) / 2, COUNTER.depth / 2), 0, (WALL_SOLID - 0.3) / 2, cz);
  // Low rails from the counter's ends to the wall: behind it is the Shopkeeper's place.
  for (const side of [-1, 1]) {
    const from = COUNTER.width / 2, to = Math.sqrt(RADIUS ** 2 - cz ** 2), w = to - from + 0.1;
    box(w, 0.6, 0.08, side * (from + w / 2), 0.3, cz, wood);
    solid(RAPIER.ColliderDesc.cuboid(w / 2, (WALL_SOLID + 0.3) / 2, 0.05), side * (from + w / 2), (WALL_SOLID - 0.3) / 2, cz);
  }
  // The shelf on the back wall, with folded shirts in the Outfits' colours.
  box(1.6, 0.05, 0.3, 0, 1.0, -RADIUS + 0.35, wood);
  box(1.6, 0.05, 0.3, 0, 0.65, -RADIUS + 0.35, wood);
  [[0.3, 0.55, 0.26], [1, 0.42, 0.12], [0.85, 0.2, 0.75], [0.94, 0.9, 0.82]].forEach((c, i) => {
    box(0.26, 0.08, 0.2, -0.6 + i * 0.4, 1.065, -RADIUS + 0.35, new Color3(c[0], c[1], c[2]).scale(0.9));
    box(0.26, 0.08, 0.2, -0.6 + ((i + 2) % 4) * 0.4, 0.715, -RADIUS + 0.35, new Color3(c[0], c[1], c[2]).scale(0.9));
  });
  for (const t of TABLES) {
    const top = MeshBuilder.CreateCylinder("table", { height: 0.04, diameter: 0.62, tessellation: 16 }, scene);
    top.position.set(t.x, 0.48, t.z); inside.push(paint(top, new Color3(0.55, 0.36, 0.2)));
    const leg = MeshBuilder.CreateCylinder("leg", { height: 0.48, diameter: 0.06 }, scene);
    leg.position.set(t.x, 0.24, t.z); inside.push(paint(leg, new Color3(0.15, 0.12, 0.1)));
    const sx = t.x + Math.sin(t.seat) * 0.5, sz = t.z + Math.cos(t.seat) * 0.5;
    const stool = MeshBuilder.CreateCylinder("stool", { height: 0.3, diameter: 0.3, tessellation: 12 }, scene);
    stool.position.set(sx, 0.15, sz); inside.push(paint(stool, new Color3(0.6, 0.18, 0.2)));
    solid(RAPIER.ColliderDesc.cylinder((WALL_SOLID + 0.3) / 2, 0.36), t.x, (WALL_SOLID - 0.3) / 2, t.z);
    solid(RAPIER.ColliderDesc.cylinder((WALL_SOLID + 0.3) / 2, 0.28), sx, (WALL_SOLID - 0.3) / 2, sz);
  }
  merge("shop-cafe", inside, solidMat, root);
  // Lamps over the tables and the counter, warm, hanging from the roof: glowing a little by day, more at night.
  const lampMat = matte(scene, "shop-lamps");
  lampMat.diffuseColor = new Color3(1, 0.85, 0.6);
  const lamps: Mesh[] = [], cords: Mesh[] = [];
  for (const [x, z] of [...TABLES.map((t) => [t.x, t.z] as const), [0, COUNTER.z - 0.3] as const]) {
    const shade = MeshBuilder.CreateCylinder("lamp", { height: 0.16, diameterTop: 0.08, diameterBottom: 0.3, tessellation: 12 }, scene);
    shade.position.set(x, 1.55, z);
    // The cord up to the roof goes with the roof when it is hidden; a short piece stays on the shade.
    const stub = MeshBuilder.CreateCylinder("cord", { height: 0.2, diameter: 0.015 }, scene);
    stub.position.set(x, 1.73, z);
    const cord = MeshBuilder.CreateCylinder("cord", { height: WALL + 0.3 - 1.83, diameter: 0.015 }, scene);
    cord.position.set(x, (1.83 + WALL + 0.3) / 2, z);
    lamps.push(paint(shade, Color3.White()), paint(stub, new Color3(0.1, 0.1, 0.1)));
    cords.push(paint(cord, new Color3(0.1, 0.1, 0.1)));
  }
  merge("shop-lamps", lamps, lampMat, root);
  const cordMesh = merge("shop-cords", cords, solidMat, root);

  const roofParts = [upperMesh, cordMesh, ball, beamRoot, ...bulbs.map((b) => b.mesh)];
  let time = 0, spin = 0, shown = true;
  const local = (p: { x: number; z: number }) => {
    const dx = p.x - spot.x, dz = p.z - spot.z, c = Math.cos(spot.facing), s = Math.sin(spot.facing);
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  };
  return {
    root, turn, floorY, toWorld,
    /** A world point in the shop's own frame: z out of the doorway, x to its left as one walks out. */
    local,
    /** Inside the walls. */
    inside: (p: { x: number; z: number }) => Math.hypot(p.x - spot.x, p.z - spot.z) < RADIUS + 0.1,
    update(dt: number, dark: number, isInside: boolean) {
      time += dt;
      if (shown === isInside) { shown = !isInside; for (const n of roofParts) n.setEnabled(shown); }
      const night = Math.min(1, Math.max(0, (dark - 0.08) / 0.4));
      // The bulbs chase round, brighter at night; by day they show their colour softly.
      bulbs.forEach((b, c) => {
        const on = 0.5 + 0.5 * Math.sin(time * 4 - c * Math.PI / 2);
        b.mat.emissiveColor.copyFrom(b.colour).scaleInPlace(0.12 + night * (0.25 + 0.6 * on));
      });
      boardMat.emissiveColor.setAll(0.35 + 0.45 * night);
      lampMat.emissiveColor.set(0.35 + 0.45 * night, 0.25 + 0.3 * night, 0.1 + 0.15 * night);
      ballMat.emissiveColor.setAll(0.15 + 0.5 * night);
      if (shown) {
        ball.rotation.y = time * 0.6;
        beamRoot.rotation.y = spin += dt * (0.4 + 0.5 * night);
        beams.forEach((m, c) => { m.alpha = night * (0.07 + 0.03 * Math.sin(time * 2 + c)); });
        if (night > 0 && Math.floor(time * 3) !== Math.floor((time - dt) * 3)) tiles.draw(Math.floor(time * 3));
      }
    },
  };
}
