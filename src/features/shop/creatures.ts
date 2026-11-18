// Who is in the Shop: the Shopkeeper behind the counter, and creatures of the forest at the café's tables, typing on
// laptops whose screens scroll with code.
//
//   const keeper = await shopkeeper(stage, parent, z);   keeper.update(dt) once a picture, while someone is near
//   const crowd = workers(stage, parent);                crowd.update(dt) once a picture, while someone is near
//
// The Shopkeeper is a real beaver (loadBeaver) in a lighter coat with an apron and a bow, standing still with only
// her breath and small idle moves (the animator, standing). She is no Animal: nothing makes her flee or wander. The
// workers are small shapes of simple meshes (a beaver, a fox, a squirrel), one draw call each and two paws that type.
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { createAnimator } from "../../anim/index.ts";
import { loadBeaver } from "../../beaver/index.ts";
import type { Stage } from "../../engine.ts";
import { newMotion } from "../../player/state.ts";
import { TABLES } from "./building.ts";

const paint = (mesh: Mesh, c: Color3) => {
  const n = mesh.getTotalVertices(), colours = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) colours.set([c.r, c.g, c.b, 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colours);
  return mesh;
};

export async function shopkeeper(stage: Stage, parent: TransformNode, z: number) {
  const { scene } = stage, beaver = await loadBeaver(scene);
  beaver.root.parent = parent;
  beaver.root.position.set(0, 0, z);
  beaver.coat = [0.36, 0.15, 0.065]; // a lighter, redder brown than any player's
  beaver.hat = false;
  beaver.look = { shirt: [1, 0.72, 0.8], hat: [0, 0, 0] }; // a rose shirt under the apron
  const chest = beaver.chest, head = beaver.root.getDescendants(false, (n) => n.name === "head")[0] as TransformNode | undefined;
  const cloth = new StandardMaterial("shopkeeper-apron", scene);
  cloth.diffuseColor = Color3.White();
  cloth.specularColor.setAll(0.03);
  // The apron: a bib on the chest and a skirt down to the knees, white with a red trim, tied round the waist.
  const bib = paint(MeshBuilder.CreateBox("bib", { width: 0.2, height: 0.16, depth: 0.015 }, scene), new Color3(0.95, 0.93, 0.88));
  bib.position.set(0, 0.0, 0.16);
  const skirt = paint(MeshBuilder.CreateCylinder("skirt", { height: 0.26, diameterTop: 0.34, diameterBottom: 0.44, tessellation: 16, arc: 0.5, enclose: false }, scene), new Color3(0.95, 0.93, 0.88));
  skirt.rotation.y = -Math.PI / 2; // the half towards the front
  skirt.position.set(0, -0.2, 0.03);
  const trim = paint(MeshBuilder.CreateTorus("tie", { diameter: 0.36, thickness: 0.02, tessellation: 20 }, scene), new Color3(0.8, 0.15, 0.2));
  trim.position.set(0, -0.08, 0.02);
  const apron = Mesh.MergeMeshes([bib, skirt, trim], true)!;
  apron.name = "shopkeeper-apron";
  apron.material = cloth;
  apron.parent = chest;
  apron.isPickable = false;
  if (head) {
    const bowMat = new StandardMaterial("shopkeeper-bow", scene);
    bowMat.diffuseColor = new Color3(0.9, 0.2, 0.45);
    const loops = [-1, 1].map((side) => {
      const loop = MeshBuilder.CreateCylinder("bow", { height: 0.07, diameterTop: 0.0, diameterBottom: 0.06, tessellation: 8 }, scene);
      loop.rotation.z = side * Math.PI / 2;
      loop.position.x = side * 0.035;
      return loop;
    });
    const bow = Mesh.MergeMeshes([...loops, MeshBuilder.CreateSphere("knot", { diameter: 0.03, segments: 4 }, scene)], true)!;
    bow.name = "shopkeeper-bow";
    bow.material = bowMat;
    bow.parent = head;
    bow.position.set(0.05, 0.17, 0.02);
    bow.rotation.z = -0.3;
    bow.isPickable = false;
  }
  const animator = createAnimator(), motion = { ...newMotion(), grounded: true };
  return {
    beaver,
    update(dt: number) {
      motion.time += dt;
      beaver.pose(animator.pose(motion, dt));
      beaver.update(dt);
    },
  };
}

// ---- the workers at the tables ----
type Kind = "beaver" | "fox" | "squirrel";
const FUR: Record<Kind, { coat: Color3; light: Color3; dark: Color3 }> = {
  beaver: { coat: new Color3(0.3, 0.16, 0.08), light: new Color3(0.5, 0.33, 0.2), dark: new Color3(0.12, 0.08, 0.06) },
  fox: { coat: new Color3(0.85, 0.36, 0.1), light: new Color3(0.96, 0.92, 0.85), dark: new Color3(0.12, 0.08, 0.06) },
  squirrel: { coat: new Color3(0.62, 0.3, 0.14), light: new Color3(0.92, 0.8, 0.62), dark: new Color3(0.12, 0.08, 0.06) },
};
const CODE = [
  "$ bun test", "  ✓ dam holds water", "  ✓ lodge stands", "  12 pass, 0 fail", "fn fell(tree) {", "  bites += 1;",
  "  if (bites > 9) fall();", "}", "> git commit -m \"dam\"", "const sticks = [];", "for (s of sticks) {", "  build(s);",
  "}", "// TODO: more sticks", "$ make lodge", "  compiling...", "  done in 1.2s", "let pond = rise();",
];

/** A laptop: base, and a lid whose screen shows a terminal scrolling with code. */
function laptop(scene: Scene, parent: TransformNode, seed: number) {
  const node = new TransformNode("laptop", scene);
  node.parent = parent;
  const metal = new StandardMaterial("laptop-case", scene);
  metal.diffuseColor = new Color3(0.55, 0.57, 0.6);
  metal.specularColor.setAll(0.3);
  const base = MeshBuilder.CreateBox("laptop-base", { width: 0.3, height: 0.015, depth: 0.2 }, scene);
  base.material = metal; base.parent = node; base.isPickable = false;
  const lid = new TransformNode("laptop-lid", scene);
  lid.parent = node;
  lid.position.set(0, 0.008, -0.1);
  lid.rotation.x = 0.3; // tipped back from upright
  const back = MeshBuilder.CreateBox("laptop-back", { width: 0.3, height: 0.2, depth: 0.01 }, scene);
  back.material = metal; back.parent = lid; back.position.set(0, 0.1, -0.006); back.isPickable = false;
  const texture = new DynamicTexture("laptop-screen", { width: 256, height: 160 }, scene, false);
  const screenMat = new StandardMaterial("laptop-screen", scene);
  screenMat.diffuseColor = Color3.Black();
  screenMat.emissiveTexture = texture;
  screenMat.specularColor.setAll(0.2);
  const screen = MeshBuilder.CreatePlane("laptop-screen", { width: 0.27, height: 0.17 }, scene);
  screen.material = screenMat; screen.parent = lid; screen.position.set(0, 0.1, 0.0); screen.isPickable = false;
  screen.rotation.y = Math.PI; // its face towards the one typing (the laptop's +z)
  const g = texture.getContext() as CanvasRenderingContext2D;
  let line = seed * 5;
  const draw = () => {
    g.fillStyle = "#0e1512"; g.fillRect(0, 0, 256, 160);
    g.font = "15px monospace";
    for (let r = 0; r < 9; r++) {
      const text = CODE[(line + r) % CODE.length]!;
      g.fillStyle = text.startsWith("$") || text.startsWith(">") ? "#f7ca77" : text.includes("✓") ? "#7be38a" : "#d6e2dc";
      g.fillText(text, 10, 20 + r * 17);
    }
    g.fillStyle = "#7be38a"; g.fillRect(10 + (line * 37 % 120), 20 + 8 * 17 - 12, 8, 14); // the cursor
    texture.update(false);
    line++;
  };
  draw();
  return { node, draw };
}

/** A creature sitting on a stool: a body and head of simple shapes in one mesh, and two paws on the keys. */
function creature(scene: Scene, parent: TransformNode, kind: Kind) {
  const f = FUR[kind], node = new TransformNode(`worker-${kind}`, scene);
  node.parent = parent;
  const parts: Mesh[] = [];
  const add = (mesh: Mesh, c: Color3, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    mesh.position.set(x, y, z); mesh.scaling.set(sx, sy, sz);
    parts.push(paint(mesh, c));
    return mesh;
  };
  const sphere = (d: number) => MeshBuilder.CreateSphere("part", { diameter: d, segments: 8 }, scene);
  const cone = (h: number, d: number) => MeshBuilder.CreateCylinder("part", { height: h, diameterTop: 0, diameterBottom: d, tessellation: 8 }, scene);
  const body = kind === "beaver" ? 0.34 : 0.28, headD = kind === "beaver" ? 0.24 : 0.2;
  add(sphere(body), f.coat, 0, 0.3 + body * 0.55, 0, 1, 1.35, 0.95);
  add(sphere(body * 0.7), f.light, 0, 0.3 + body * 0.5, body * 0.22, 0.9, 1.2, 0.6); // belly
  const hy = 0.3 + body * 1.25 + headD * 0.35;
  add(sphere(headD), f.coat, 0, hy, 0.03);
  if (kind === "fox") {
    add(cone(0.16, 0.1), f.coat, 0, hy - 0.02, 0.15).rotation.x = Math.PI / 2; // the pointed snout
    add(sphere(0.035), f.dark, 0, hy - 0.02, 0.23);
    for (const s of [-1, 1]) add(cone(0.12, 0.08), f.coat, s * 0.06, hy + 0.12, 0).rotation.z = -s * 0.25;
    const tail = add(cone(0.42, 0.16), f.coat, 0, 0.42, -0.22); tail.rotation.x = -2.1;
    add(sphere(0.08), f.light, 0, 0.27, -0.38);
  } else if (kind === "squirrel") {
    add(sphere(0.1), f.light, 0, hy - 0.03, 0.09);
    add(sphere(0.03), f.dark, 0, hy - 0.01, 0.14);
    for (const s of [-1, 1]) add(cone(0.08, 0.05), f.coat, s * 0.06, hy + 0.1, 0).rotation.z = -s * 0.2;
    // The big bushy tail, curled up the back.
    for (let k = 0; k < 5; k++) add(sphere(0.17 - k * 0.012), f.coat, 0, 0.35 + k * 0.1, -0.2 - Math.sin(k * 0.7) * 0.08);
  } else {
    add(sphere(0.13), f.light, 0, hy - 0.04, 0.1, 1, 0.8, 1); // the muzzle
    add(MeshBuilder.CreateBox("teeth", { width: 0.04, height: 0.035, depth: 0.01 }, scene), new Color3(0.95, 0.85, 0.6), 0, hy - 0.09, 0.16);
    add(sphere(0.035), f.dark, 0, hy - 0.01, 0.17);
    for (const s of [-1, 1]) add(sphere(0.05), f.coat, s * 0.09, hy + 0.09, -0.01);
    add(MeshBuilder.CreateBox("tail", { width: 0.18, height: 0.035, depth: 0.32 }, scene), f.dark, 0, 0.32, -0.28).rotation.x = 0.15;
  }
  for (const s of [-1, 1]) add(sphere(0.03), f.dark, s * headD * 0.25, hy + headD * 0.12, headD * 0.42); // eyes
  for (const s of [-1, 1]) add(sphere(0.09), f.coat, s * 0.08, 0.32, 0.12, 1, 0.7, 1.6); // the legs on the stool
  const mat = new StandardMaterial(`worker-${kind}`, scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor.setAll(0.04);
  const mesh = Mesh.MergeMeshes(parts, true)!;
  mesh.name = `worker-${kind}`; mesh.material = mat; mesh.parent = node; mesh.isPickable = false;
  const paws = [-1, 1].map((s) => {
    const paw = MeshBuilder.CreateCapsule("paw", { radius: 0.03, height: 0.2 }, scene);
    paint(paw, f.coat); paw.material = mat; paw.parent = node; paw.isPickable = false;
    paw.rotation.x = 1.25; // reaching forward to the keys
    paw.position.set(s * 0.07, 0.3 + body * 0.75, body * 0.45);
    return paw;
  });
  return { node, paws, y: paws[0]!.position.y };
}

export function workers(stage: Stage, parent: TransformNode) {
  const { scene } = stage, kinds: Kind[] = ["beaver", "fox", "squirrel"];
  const crowd = TABLES.map((t, i) => {
    const c = creature(scene, parent, kinds[i % kinds.length]!);
    // On the stool beside the table, facing it.
    c.node.position.set(t.x + Math.sin(t.seat) * 0.5, 0, t.z + Math.cos(t.seat) * 0.5);
    c.node.rotation.y = t.seat + Math.PI;
    const l = laptop(scene, parent, i);
    l.node.position.set(t.x + Math.sin(t.seat) * 0.08, 0.5, t.z + Math.cos(t.seat) * 0.08);
    l.node.rotation.y = t.seat; // its keys towards the one sitting there
    return { ...c, screen: l, phase: i * 1.7, every: 0.35 + i * 0.12, wait: 0 };
  });
  let time = 0;
  return {
    update(dt: number) {
      time += dt;
      for (const c of crowd) {
        // Typing: the paws tap in turn, quick and small, with a pause now and then to think.
        const think = Math.sin(time * 0.5 + c.phase) > 0.75;
        c.paws.forEach((paw, s) => { paw.position.y = c.y + (think ? 0.02 : Math.max(0, Math.sin(time * 18 + c.phase + s * Math.PI)) * 0.025); });
        if ((c.wait -= dt) <= 0) { c.wait = c.every; if (!think) c.screen.draw(); }
      }
    },
  };
}
