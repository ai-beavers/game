// Around the daylight from src/light.ts: haze that thickens with distance and meets the sky at the horizon, and a
// few soft clouds far away (flat cards with a texture drawn in code, always facing the middle).
//
//   addAir(stage)
//   airOf(scene)      the haze (scene.fog) and the cloud cards, for the sky feature to tint by hour and weather
import * as THREE from "three";
import type { Stage } from "../engine.ts";
import { seeded } from "./noise.ts";

/** The sky's colour just above the horizon, seen through the renderer's tone mapping: the haze ends in it. */
export const HAZE = 0xb4c7d6;

function cloudTexture(seed: number) {
  const w = 512, h = 256, canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext("2d")!, random = seeded(seed);
  for (let i = 0; i < 70; i++) { // many soft puffs, flatter at the bottom
    const x = w * (0.15 + random() * 0.7), y = h * (0.35 + random() * 0.35) - Math.sin((x / w) * Math.PI) * h * 0.15;
    const r = h * (0.08 + random() * 0.16) * Math.sin((x / w) * Math.PI);
    const puff = g.createRadialGradient(x, y, 0, x, y, r);
    const shade = 235 + random() * 20 - (y / h) * 30;
    puff.addColorStop(0, `rgba(${shade},${shade},${shade + 5},0.35)`);
    puff.addColorStop(1, `rgba(${shade},${shade},${shade + 5},0)`);
    g.fillStyle = puff;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function addAir({ scene }: Stage) {
  scene.fog = new THREE.FogExp2(HAZE, 0.011);
  const random = seeded(9), textures = [1, 2, 3].map(cloudTexture), clouds: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  for (let i = 0; i < 9; i++) {
    const material = new THREE.MeshBasicMaterial({ map: textures[i % 3], transparent: true, depthWrite: false, fog: false, opacity: 0.85 });
    const card = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), material);
    const a = (i / 9) * Math.PI * 2 + random() * 0.5, d = 300 + random() * 60;
    card.position.set(Math.cos(a) * d, 55 + random() * 70, Math.sin(a) * d);
    card.scale.setScalar(140 + random() * 120);
    card.lookAt(0, card.position.y * 0.7, 0);
    card.renderOrder = -1;
    card.name = "cloud";
    scene.add(card);
    clouds.push(card);
  }
  const air = { fog: scene.fog, clouds };
  scene.userData.air = air;
  return air;
}

export const airOf = (scene: THREE.Scene) => scene.userData.air as ReturnType<typeof addAir> | undefined;
