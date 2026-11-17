// Stand-in models for every PropName, made in code: used when the real props (src/props, from Blender) are not
// given. They follow the same rules as Props in contracts.ts: each template stands on y = 0 around its origin,
// y up, in metres; sticks and logs lie along their z. Shared materials, vertex colours, no textures to load.
//
//   const props = standInProps();   props.tree[0].clone() …
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { Props } from "../contracts.ts";
import { fbm, noise, seeded } from "./noise.ts";

type Paint = (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void;

/** Smooth, indexed, with position, normal and color only, so pieces merge. */
function prep(geometry: THREE.BufferGeometry) {
  for (const name of Object.keys(geometry.attributes)) if (name !== "position") geometry.deleteAttribute(name);
  const merged = mergeVertices(geometry);
  merged.computeVertexNormals();
  return merged;
}

/** Moves every vertex along its normal by `push(p)` and paints it. */
function shape(geometry: THREE.BufferGeometry, push: (p: THREE.Vector3, n: THREE.Vector3) => void, paint: Paint) {
  const pos = geometry.attributes.position as THREE.BufferAttribute, nor = geometry.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3), p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nor, i);
    push(p, n);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nor, i);
    paint(p, n, c);
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

const hex = (h: number) => new THREE.Color(h);
const BARK = hex(0x6e5a44), BARK_DARK = hex(0x3a2e22), WOOD = hex(0xb08a5a), RING = hex(0x8a6a42);

const barkPaint = (seed: number): Paint => (p, n, c) => {
  const grooves = noise(Math.atan2(n.x, n.z) * 4 + seed, p.y * 0.8) * 0.5 + noise(Math.atan2(n.x, n.z) * 9, p.y * 6 + seed) * 0.5;
  c.copy(BARK).lerp(BARK_DARK, Math.max(0, grooves) * 0.9 + 0.1);
};

/** A trunk, tapered and a little crooked, standing on y = 0. */
function trunk(height: number, bottom: number, top: number, seed: number) {
  const g = prep(new THREE.CylinderGeometry(top, bottom, height, 10, Math.ceil(height * 3), false).translate(0, height / 2, 0));
  return shape(g, (p, n) => {
    const t = p.y / height;
    p.x += noise(p.y * 0.5, seed) * 0.25 * t; p.z += noise(seed, p.y * 0.5) * 0.25 * t;
    const flare = Math.max(0, 1 - p.y / 0.5) ** 2 * bottom * 0.6; // roots spread at the foot
    p.addScaledVector(new THREE.Vector3(n.x, 0, n.z), flare * (0.6 + 0.4 * noise(Math.atan2(n.x, n.z) * 3, seed)));
  }, barkPaint(seed));
}

/** A lumpy ball of leaves. */
function clump(radius: number, at: THREE.Vector3, seed: number, base: THREE.Color, detail = 2) {
  const g = prep(new THREE.IcosahedronGeometry(radius, detail));
  const dark = base.clone().multiplyScalar(0.45), light = base.clone().lerp(hex(0xb8c060), 0.3);
  return shape(g, (p) => {
    const k = p.clone().normalize();
    p.multiplyScalar(1 + fbm(k.x * 2.2 + seed, k.z * 2.2 + k.y * 1.7, 3) * 0.55);
    p.y *= 0.8;
    p.add(at);
  }, (p, n, c) => {
    c.copy(base).lerp(dark, Math.max(0, -n.y) * 0.8 + Math.max(0, at.y - p.y) / radius * 0.25);
    c.lerp(light, Math.max(0, n.y) * 0.35 * (0.6 + noise(p.x * 3, p.z * 3) * 0.4));
  });
}

function broadleaf(seed: number, height: number) {
  const random = seeded(seed), leaves: THREE.BufferGeometry[] = [];
  const green = hex([0x3f5f22, 0x4a6a26, 0x36561f][seed % 3]!);
  const crown = height * 0.68;
  for (let i = 0; i < 6; i++) {
    const a = random() * Math.PI * 2, r = i === 0 ? 0 : 0.7 + random() * 0.9;
    const at = new THREE.Vector3(Math.cos(a) * r, crown + (random() - 0.3) * 1.3 + (i === 0 ? 0.6 : 0), Math.sin(a) * r);
    leaves.push(clump(1.0 + random() * 0.6, at, seed * 10 + i, green.clone().offsetHSL((random() - 0.5) * 0.03, 0, (random() - 0.5) * 0.05)));
  }
  return { wood: trunk(crown + 0.6, 0.24 + height * 0.01, 0.1, seed), leaves: mergeGeometries(leaves)! };
}

function conifer(seed: number, height: number) {
  const random = seeded(seed), needles: THREE.BufferGeometry[] = [], green = hex(0x2c4a26);
  for (let i = 0; i < 6; i++) {
    const t = i / 6, r = (1 - t) * 1.6 + 0.25, h = 1.2 * (1 - t * 0.4);
    const cone = prep(new THREE.ConeGeometry(r, h, 11, 3).translate(0, 1.4 + t * (height - 2), 0));
    needles.push(shape(cone, (p) => {
      const k = p.clone().setY(0);
      p.addScaledVector(k, noise(Math.atan2(p.z, p.x) * 3 + i * 5, p.y + seed) * 0.18);
      p.y += noise(Math.atan2(p.z, p.x) * 5, i + seed) * 0.15;
    }, (p, n, c) => {
      c.copy(green).multiplyScalar(0.55 + Math.max(0, n.y) * 0.45 + random() * 0.1);
    }));
  }
  return { wood: trunk(height * 0.85, 0.22, 0.06, seed), leaves: mergeGeometries(needles)! };
}

function rockGeometry(seed: number, size: number, flat: number) {
  const g = prep(new THREE.IcosahedronGeometry(size, 3)), grey = hex(0x75716a), dark = hex(0x4f4c45), moss = hex(0x4f6326);
  return shape(g, (p) => {
    const k = p.clone().normalize();
    p.multiplyScalar(1 + fbm(k.x * 1.8 + seed, k.z * 1.8 + k.y * 2.1, 4) * 0.5);
    p.y = p.y * flat + size * flat * 0.55; // sunk a little into the ground
  }, (p, n, c) => {
    c.copy(grey).lerp(dark, Math.max(0, 0.5 + noise(p.x * 4 + seed, p.z * 4 + p.y * 4) * 0.5) * 0.6);
    c.lerp(moss, Math.max(0, n.y - 0.55) * 1.6 * Math.max(0, noise(p.x * 2, p.z * 2 + seed)));
  });
}

function woodPiece(length: number, radius: number, seed: number, cutEnds: boolean, pale = 0) {
  const g = prep(new THREE.CylinderGeometry(radius * 0.9, radius, length, 8, Math.max(2, Math.ceil(length * 2))));
  shape(g, (p) => { p.x += noise(p.y * 1.3, seed) * radius * 0.5; }, (p, n, c) => {
    if (cutEnds && Math.abs(n.y) > 0.8) c.copy(WOOD).lerp(RING, (Math.hypot(p.x, p.z) / radius * 6) % 1);
    else { barkPaint(seed)(p, n, c); c.lerp(WOOD, pale * (0.6 + 0.4 * noise(p.y * 20, seed))); }
  });
  return g.rotateX(Math.PI / 2).translate(0, radius, 0); // lies along z, on y = 0
}

function stumpGeometry(seed: number, radius: number, height: number) {
  const g = prep(new THREE.CylinderGeometry(radius, radius * 1.15, height, 12, 2).translate(0, height / 2, 0));
  return shape(g, (p, n) => {
    if (p.y > height * 0.9) p.y += noise(p.x * 6, p.z * 6 + seed) * 0.05; // a ragged cut
    p.addScaledVector(new THREE.Vector3(n.x, 0, n.z), Math.max(0, 1 - p.y / 0.2) * 0.08);
  }, (p, n, c) => {
    if (n.y > 0.7) c.copy(WOOD).lerp(RING, (Math.hypot(p.x, p.z) / radius * 7) % 1 * 0.8);
    else barkPaint(seed)(p, n, c);
  });
}

function reedGeometry(seed: number) {
  const random = seeded(seed), blades: THREE.BufferGeometry[] = [];
  const green = hex(0x5e7a30), brown = hex(0x5a3a22);
  for (let i = 0; i < 14; i++) {
    const h = 0.9 + random() * 0.8, a = random() * Math.PI * 2, r = random() * 0.25;
    const lean = new THREE.Vector3((random() - 0.5) * 0.4, 0, (random() - 0.5) * 0.4);
    const blade = new THREE.CylinderGeometry(0.004, 0.012, h, 3, 4).translate(0, h / 2, 0);
    blade.deleteAttribute("uv");
    const pos = blade.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v), t = y / h;
      pos.setXYZ(v, pos.getX(v) + Math.cos(a) * r + lean.x * t * t, y, pos.getZ(v) + Math.sin(a) * r + lean.z * t * t);
    }
    const parts = [blade];
    if (i % 4 === 0) { // a cattail head on some
      const head = new THREE.CylinderGeometry(0.018, 0.018, 0.16, 6).translate(Math.cos(a) * r + lean.x * 0.8, h * 0.85, Math.sin(a) * r + lean.z * 0.8);
      head.deleteAttribute("uv");
      parts.push(head);
    }
    for (const part of parts) {
      const colors = new Float32Array(part.attributes.position!.count * 3), c = new THREE.Color();
      for (let v = 0; v < part.attributes.position!.count; v++) {
        (part === blade ? c.copy(green).multiplyScalar(0.6 + 0.5 * part.attributes.position!.getY(v) / h) : c.copy(brown)).toArray(colors, v * 3);
      }
      part.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      blades.push(part.toNonIndexed());
    }
  }
  const merged = mergeGeometries(blades)!;
  merged.computeVertexNormals();
  return merged;
}

function crateTexture() {
  const size = 256, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!, random = seeded(5);
  g.fillStyle = "#a0763f"; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 4; i++) { // planks with grain
    const y = i * 64;
    g.fillStyle = `hsl(32, ${40 + random() * 10}%, ${36 + random() * 8}%)`; g.fillRect(0, y + 2, size, 60);
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(60,35,15,${0.1 + random() * 0.15})`; g.lineWidth = 1;
      const yy = y + 4 + random() * 56; g.beginPath(); g.moveTo(0, yy); g.bezierCurveTo(80, yy + random() * 4 - 2, 170, yy + random() * 4 - 2, size, yy); g.stroke();
    }
    g.fillStyle = "#3a2614"; g.fillRect(0, y, size, 3);
  }
  g.strokeStyle = "#6b4a24"; g.lineWidth = 22; g.strokeRect(11, 11, size - 22, size - 22); // the frame
  g.lineWidth = 16; g.beginPath(); g.moveTo(16, 16); g.lineTo(size - 16, size - 16); g.stroke(); // the brace
  g.fillStyle = "#2a2a28";
  for (const [x, y] of [[14, 14], [242, 14], [14, 242], [242, 242]]) { g.beginPath(); g.arc(x!, y!, 4, 0, 7); g.fill(); }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = m.receiveShadow = true;
  return m;
};
const group = (...children: THREE.Object3D[]) => new THREE.Group().add(...children);

/** Every PropName with a few variants, all made here. */
export function standInProps(): Props {
  const bark = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const leaf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const stone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const reed = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  const plank = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.85 });
  const trees = [broadleaf(1, 7), broadleaf(2, 8.5), broadleaf(3, 6), conifer(4, 9), conifer(5, 7)];
  return {
    tree: trees.map(({ wood, leaves }) => group(mesh(wood, bark), mesh(leaves, leaf))),
    stump: [stumpGeometry(1, 0.28, 0.4), stumpGeometry(2, 0.36, 0.28)].map((g) => group(mesh(g, bark))),
    log: [woodPiece(2.4, 0.2, 1, true), woodPiece(1.7, 0.16, 2, true)].map((g) => group(mesh(g, bark))),
    stick: [woodPiece(0.65, 0.02, 3, false, 0.55), woodPiece(0.65, 0.02, 4, false, 0.35)].map((g) => group(mesh(g, bark))),
    rock: [rockGeometry(1, 0.5, 0.65), rockGeometry(2, 0.7, 0.5), rockGeometry(3, 0.35, 0.8)].map((g) => group(mesh(g, stone))),
    crate: [group(mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5).translate(0, 0.25, 0), plank))],
    reed: [reedGeometry(1), reedGeometry(2)].map((g) => { const m = mesh(g, reed); m.castShadow = false; return group(m); }),
  };
}

/** Bushes for the thicket on the bank (not a PropName: the world's own), three variants of low leaf clumps. */
export function bushes() {
  const leaf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  return [1, 2, 3].map((seed) => {
    const random = seeded(seed + 40), lumps: THREE.BufferGeometry[] = [];
    const green = hex([0x3a5520, 0x46602a, 0x4f5a24][seed - 1]!);
    for (let i = 0; i < 4; i++) {
      const a = random() * Math.PI * 2, r = i ? 0.5 + random() * 0.5 : 0;
      lumps.push(clump(0.6 + random() * 0.4, new THREE.Vector3(Math.cos(a) * r, 0.55 + random() * 0.4, Math.sin(a) * r), seed * 7 + i, green, 2));
    }
    return group(mesh(mergeGeometries(lumps)!, leaf));
  });
}
