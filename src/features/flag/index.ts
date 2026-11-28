// The Flag (a viewer's wish): a cloth with the AI beavers logo on a wooden pole on the bank beside the building site,
// waving in the sky's wind. With empty paws by the pole, E offers "Set the Flag alight": the fire catches at the
// cloth's bottom edge and climbs it in BURN_SECONDS, the cloth blackening and burning away to a ragged edge, flames and
// smoke rising from it (src/features/fx) and a warm light flickering on the ground and the pole. A charred rag stays
// on the pole until the next dawn raises a fresh Flag. The fire never leaves the cloth: nothing else reads it.
//
//   import { create as flag } from "./features/flag/index.ts";     after canoe in FEATURES (it shares the Use key)
//
// The Flag is the player's own (docs/adr/0003): never sent, never saved, whole after a reload. Events flagLit and
// flagBurnt. state.ts holds its life as plain numbers.
//
// Debug, for bun shot --eval (window.flag): flag.state · flag.burnt (0 … 1) · flag.pole (where it stands) ·
// flag.at() (stands by the pole facing it, empty-pawed).
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { PointLight } from "@babylonjs/core/Lights/pointLight.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import logoPng from "../../../assets/logo.png" with { type: "file" };
import { SHIRT_CREAM } from "../../contracts.ts";
import { cylinder } from "../../physics.ts";
import type { CreateFeature } from "../../game.ts";
import type { Actor, Offer } from "../../player/index.ts";
import { material } from "../../world/models.ts";
import { fxOf, WIND } from "../fx/index.ts";
import { dawnCame, POLE, raised, stepFlag, type Flag } from "./state.ts";

/** The cloth, m: along the wind, top to bottom, and where its top edge hangs on the pole. */
const CLOTH = { width: 1.2, height: 0.75, top: 2.05 };
/** m from the pole within which the feet can light it. */
const NEAR = 1.1;
/** How much of the cloth's height stays on the pole as a charred rag. */
const REMNANT = 0.16;
const NX = 16, NY = 10; // the cloth's grid: quads along and down
const WARM = new Color3(1, 0.55, 0.2);
const LIT: Offer = { action: "use", text: "Set the Flag alight" };

export const create: CreateFeature = (game) => {
  const { stage, world, player, events, settings } = game, { scene } = stage;
  const ground = world.heightAt(POLE.x, POLE.z), foot = new Vector3(POLE.x, ground, POLE.z);
  let flag: Flag = raised();

  // ---- the pole: a straight stick with a knob, solid --------------------------------------------------------------
  const wood = material(scene, "flag pole", 0x8a5a32);
  const pole = MeshBuilder.CreateCylinder("flag pole", { height: POLE.height, diameterTop: POLE.radius * 1.6, diameterBottom: POLE.radius * 2.4, tessellation: 10 }, scene);
  pole.position.set(POLE.x, ground + POLE.height / 2 - 0.05, POLE.z);
  const knob = MeshBuilder.CreateSphere("flag knob", { diameter: 0.08, segments: 6 }, scene);
  knob.position.set(POLE.x, ground + POLE.height - 0.03, POLE.z);
  for (const m of [pole, knob]) { m.material = wood; m.receiveShadows = true; m.isPickable = false; }
  stage.physics.fixed(cylinder(stage.scene, POLE.height / 2, POLE.radius + 0.03, { x: POLE.x, y: ground + POLE.height / 2, z: POLE.z }));

  // ---- the cloth: a grid moved by the wind, its picture redrawn while it burns ------------------------------------
  const art = drawCloth(scene);
  const cloth = new Mesh("flag cloth", scene);
  const positions = new Float32Array((NX + 1) * (NY + 1) * 3), normals = new Float32Array(positions.length), uvs: number[] = [], indices: number[] = [];
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    uvs.push(1 - i / NX, j / NY); // the picture reads from the south, the side the spawn and the site are on
    if (i < NX && j < NY) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; indices.push(a, c, b, b, c, d); }
  }
  const data = new VertexData();
  Object.assign(data, { positions, normals, uvs, indices });
  data.applyToMesh(cloth, true);
  cloth.position.set(POLE.x, ground + CLOTH.top, POLE.z);
  cloth.rotation.y = Math.atan2(WIND.z, WIND.x) * -1; // its +x along the wind
  cloth.setBoundingInfo(new BoundingInfo(new Vector3(-0.1, -CLOTH.height - CLOTH.width, -0.6), new Vector3(CLOTH.width + 0.1, 0.2, 0.6)));
  cloth.doNotSyncBoundingInfo = true;
  cloth.material = art.material;
  cloth.receiveShadows = true;
  cloth.isPickable = false;

  /** The cloth's shape this moment: (u along from the pole, v down from the top, both 0 … 1) → local x, y, z. */
  let time = 0, wind = 0.25;
  const shape = (u: number, v: number, out: Vector3) => {
    const droop = Math.max(0, 1 - wind / 0.3) * 1.15, flap = 0.035 + 0.13 * Math.min(1, wind);
    const along = u * CLOTH.width, speed = 2.5 + 6 * Math.min(1, wind);
    const wave = Math.sin(along * 5.2 - time * speed + v * 0.9) + 0.35 * Math.sin(along * 9.1 - time * speed * 1.7 + v * 2.3);
    const z = flap * Math.pow(u, 1.1) * wave;
    return out.set(along * Math.cos(droop) - Math.abs(z) * 0.25 + 0.03, -v * CLOTH.height - along * Math.sin(droop), z);
  };
  const p = new Vector3();
  const move = () => {
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
      shape(i / NX, j / NY, p);
      const k = (j * (NX + 1) + i) * 3;
      positions[k] = p.x; positions[k + 1] = p.y; positions[k + 2] = p.z;
    }
    VertexData.ComputeNormals(positions, indices, normals);
    cloth.updateVerticesData(VertexBuffer.PositionKind, positions);
    cloth.updateVerticesData(VertexBuffer.NormalKind, normals);
  };

  // ---- the burn front: ragged, climbing from the bottom edge --------------------------------------------------------
  let rag = ragged();
  /** v (down from the top) where the fire's edge is at u; below it the cloth is gone. */
  const front = (u: number) => {
    const b = flag.burnt, n = rag[Math.round(u * (rag.length - 1))]!;
    return Math.min(1.02, 1 - b * (1 - REMNANT) + (n - 0.5) * 0.14 * Math.min(1, b * 10));
  };
  const at = (u: number, v: number) => Vector3.TransformCoordinates(shape(u, v, new Vector3()), cloth.getWorldMatrix());

  // ---- light: one warm point light on the ground and the pole, dark until it burns ---------------------------------
  // Made once and always on at intensity 0 (src/features/lantern does the same): switching a light on recompiles the
  // materials that take it. It reaches only the ground and the pole (the cloth has its own glow).
  // shortcut: the grass, leaves and animals around the pole stay unlit by the fire (their shaders take no Babylon light),
  // upgrade to a term like LANTERN_GLSL in src/light.ts when a lasting fire (a campfire) comes.
  const light = new PointLight("flag-fire", foot.clone(), scene);
  light.diffuse.copyFrom(WARM);
  light.specular.copyFrom(WARM).scaleInPlace(0.2);
  light.range = 5;
  light.falloffType = PointLight.FALLOFF_STANDARD;
  light.intensity = 0;
  const groundMesh = scene.getMeshByName("ground");
  light.includedOnlyMeshes = [pole, knob, ...(groundMesh ? [groundMesh] : [])];
  scene.onDisposeObservable.add(settings.on(({ quality }) => light.setEnabled(quality !== "low")));

  // ---- E by the pole: light a whole Flag ------------------------------------------------------------------------------
  let wants = false;
  const canLight = (carrying: boolean) => flag.state === "whole" && !carrying && !player.diving && !player.riding && !player.afloat
    && Math.hypot(player.feet.x - POLE.x, player.feet.z - POLE.z) < NEAR;
  const before = player.actor;
  const actor: Actor = {
    begin(carrying) {
      if (canLight(carrying)) { wants = true; return undefined; }
      return before?.begin(carrying);
    },
    offer(carrying) { return canLight(carrying) ? LIT : before?.offer?.(carrying); },
    step(dt, held) { return before?.step(dt, held); },
  };
  player.actor = actor;

  Object.assign(window, {
    flag: {
      get state() { return flag.state; },
      get burnt() { return flag.burnt; },
      pole: { x: POLE.x, z: POLE.z },
      /** Stands by the pole, on its south side, facing it, with empty paws. */
      at() {
        player.drop();
        const x = POLE.x - 0.2, z = POLE.z - 0.75;
        player.teleport(x, world.heightAt(x, z), z, Math.atan2(POLE.x - x, POLE.z - z));
        player.camera.yaw = Math.atan2(POLE.x - x, POLE.z - z) + Math.PI;
        return { at: [x, z] };
      },
    },
  });

  let hour = game.sky?.hour ?? 12, drawn = -1;
  return {
    step(dt) {
      const now = game.sky?.hour ?? hour, was = flag.state;
      flag = stepFlag(flag, dt, wants, dawnCame(hour, now));
      hour = now;
      wants = false;
      if (was !== flag.state) {
        if (flag.state === "burning") events.emit("flagLit", { place: at(0.5, 1) });
        if (flag.state === "charred") events.emit("flagBurnt", { place: at(0.3, REMNANT) });
        if (flag.state === "whole") rag = ragged(); // a fresh Flag tears its own way
      }
    },
    update(dt) {
      if (!stage.paused) { time += dt; wind += ((game.sky?.wind ?? 0.25) - wind) * Math.min(1, dt * 0.5); }
      move();
      // The picture: redrawn while the fire climbs, once when it changes otherwise.
      const burning = flag.state === "burning";
      if (burning ? !stage.paused : drawn !== flag.burnt) { art.paint(flag.burnt, front, burning, time); drawn = flag.burnt; }
      if (!burning) { light.intensity = 0; return; }
      // Flames all along the front, strongest while it climbs through the middle; the light where they are.
      const b = flag.burnt, strength = 0.6 + Math.sin(Math.PI * Math.min(1, b * 1.3)) * 0.8;
      const middle = at(0.5, front(0.5));
      light.position.copyFrom(middle).addInPlaceFromFloats(0, 0.1, -0.6); // a little out from the cloth, so the pole is lit from the side, not burnt white
      if (stage.paused) return; // the light holds as it was, like the fire
      const flicker = 0.75 + 0.25 * Math.sin(time * 23) * Math.sin(time * 7.3 + 1) + 0.15 * Math.random();
      light.intensity = (1.2 + 0.3 * (game.sky?.dark ?? 0)) * strength * flicker;
      const fx = fxOf(scene);
      if (!fx) return;
      for (let i = 0; i < 10; i++) { // close enough that the tongues run together into one ragged band
        const u = (i + Math.random()) / 10;
        fx.fire(at(u, front(u) - 0.02), dt * 10 * strength);
      }
    },
  };
};

/** 1-D noise across the cloth: how far the fire's edge runs ahead or lags, 0 … 1, smooth with a few tears. */
function ragged() {
  const raw = Array.from({ length: 48 }, () => Math.random());
  return raw.map((_, i) => {
    let sum = 0, n = 0;
    for (let k = -2; k <= 2; k++) { const v = raw[i + k]; if (v !== undefined) { sum += v * (3 - Math.abs(k)); n += 3 - Math.abs(k); } }
    return sum / n;
  });
}

/** The cloth's picture: the logo printed dark on cream as on the beaver's shirt (src/beaver), and a glow for the fire.
 *  paint(burnt, front, glowing, time) blackens it towards the fire's edge, cuts it away below the edge (alpha test) and
 *  makes the edge glow. */
function drawCloth(scene: Scene) {
  const W = 512, H = 320, canvas = document.createElement("canvas"), glowCanvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  glowCanvas.width = 128; glowCanvas.height = 80;
  const paint = canvas.getContext("2d")!, glow = glowCanvas.getContext("2d")!;
  const logo = new Image();
  let ready: "image" | "text" | undefined;
  logo.src = logoPng;
  logo.decode().then(() => { ready = "image"; }, () => { ready = "text"; }).then(() => draw(0, () => 1, false, 0));
  const texture = new DynamicTexture("flag print", canvas, scene, true);
  texture.hasAlpha = true;
  const glowTexture = new DynamicTexture("flag glow", glowCanvas, scene, true);
  const mat = new StandardMaterial("flag cloth", scene);
  mat.diffuseTexture = texture;
  mat.emissiveTexture = glowTexture;
  mat.specularColor.set(0.04, 0.04, 0.04);
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;

  function draw(burnt: number, along: (u: number) => number, glowing: boolean, time: number) {
    const front = (x: number) => along(1 - x); // the picture's x runs from the free end to the pole
    // The cloth: cream with a weave and a darker hem at the pole.
    paint.globalCompositeOperation = "source-over";
    paint.filter = "none";
    paint.fillStyle = SHIRT_CREAM;
    paint.fillRect(0, 0, W, H);
    paint.fillStyle = "rgba(0, 0, 0, 0.035)";
    for (let y = 0; y < H; y += 4) paint.fillRect(0, y, W, 2);
    paint.fillStyle = "#7a5a3a";
    paint.fillRect(W - 22, 0, 22, H);
    // The logo, shrinking and curling up as the fire takes the cloth.
    const s = 1 - 0.45 * Math.min(1, burnt * 1.4), cx = W / 2 - 10, cy = H / 2 - burnt * H * 0.2;
    if (ready === "image") {
      const width = 400 * s, height = width * logo.height / logo.width;
      paint.filter = "invert(1)"; // the logo file is white
      paint.drawImage(logo, cx - width / 2, cy - height / 2, width, height);
      paint.filter = "none";
    } else if (ready === "text") {
      paint.fillStyle = "#101114";
      paint.font = `800 ${Math.round(64 * s)}px "Helvetica Neue", Arial, sans-serif`;
      paint.textAlign = "center";
      paint.textBaseline = "middle";
      paint.fillText("AI BEAVERS", cx, cy);
    }
    glow.globalCompositeOperation = "source-over";
    glow.fillStyle = "#000";
    glow.fillRect(0, 0, 128, 80);
    if (burnt > 0) {
      // Smoke-stained all over, black over the last of it; scorched in a band above the edge.
      paint.fillStyle = `rgba(22, 15, 10, ${0.06 + 0.9 * burnt ** 4})`;
      paint.fillRect(0, 0, W, H);
      const columns = 64, cw = W / columns;
      for (let c = 0; c < columns; c++) {
        const y = front((c + 0.5) / columns) * H, band = H * 0.2;
        const g = paint.createLinearGradient(0, y - band, 0, y);
        g.addColorStop(0, "rgba(30, 18, 8, 0)"); g.addColorStop(0.55, "rgba(40, 22, 8, 0.75)"); g.addColorStop(0.85, "rgba(10, 6, 4, 1)");
        paint.fillStyle = g;
        paint.fillRect(c * cw - 0.5, y - band, cw + 1, band + 2);
      }
      // Gone below the edge.
      paint.globalCompositeOperation = "destination-out";
      paint.beginPath();
      paint.moveTo(0, H + 2);
      for (let c = 0; c <= columns; c++) paint.lineTo(c * cw, front(c / columns) * H);
      paint.lineTo(W, H + 2);
      paint.closePath();
      paint.fillStyle = "#000";
      paint.fill();
      // The glowing edge, flickering, and embers in the scorch above it.
      if (glowing) {
        glow.lineWidth = 3.5;
        glow.lineJoin = "round";
        glow.strokeStyle = `rgb(255, ${Math.round(120 + 50 * Math.sin(time * 17))}, 30)`;
        glow.beginPath();
        for (let c = 0; c <= 32; c++) glow.lineTo(c * 4, front(c / 32) * 80 - 1.5);
        glow.stroke();
        for (let k = 0; k < 14; k++) {
          const u = Math.random(), y = front(u) * 80 - 2 - Math.random() * 8;
          glow.fillStyle = `rgba(255, ${Math.round(90 + Math.random() * 80)}, 20, ${0.5 + Math.random() * 0.5})`;
          glow.fillRect(u * 128, y, 2, 2);
        }
      }
    }
    texture.update(false);
    glowTexture.update(false);
  }
  return { material: mat, paint: draw };
}
