// The map on screen, drawn by three.js in the stage's HUD scene (stage.hud): the painted map (map.ts) as a texture on
// a disc, its light rim, a soft shadow under it, the focus ring while its button has keyboard focus, and on the large
// map only an N at the top edge.
//
//   const display = createMapDisplay(stage);
//   display.show(button.getBoundingClientRect(), { large, focused, opacity }, (canvas, size) => map.draw(canvas, view, size));
//   display.hide();                    photo mode, start screen: nothing drawn
//
// Where and how big it is comes from the map's <button> in #beaver-hud, which stays as its invisible counterpart: CSS
// places, sizes and animates it, it takes clicks and taps, keyboard focus and the screen reader's attention.
// In the scene: the group "map", in it "map-disc" (the map; its scale is the painted diameter) and "map-north".
import * as THREE from "three";
import type { Stage } from "../../engine.ts";

const RIM = 2, RIM_COLOR = 0xffffff, RIM_OPACITY = 0.5; // CSS px: the button's border
const SHADOW = { y: 4, blur: 18, opacity: 0.35 };          // as box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35)
const FOCUS = { gap: 2, width: 2, color: 0xf1c470 };       // as the HUD's :focus-visible outline
const NORTH = { gap: 6, size: 14, color: "#f3efe6" };      // the N: px below the rim, font size, colour
const SEGMENTS = 96;

export function createMapDisplay({ renderer, hud }: Stage) {
  const flat = (options: THREE.MeshBasicMaterialParameters) =>
    new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false, ...options });
  const group = new THREE.Group();
  group.name = "map";
  group.visible = false;
  hud.scene.add(group);

  // The shadow: a disc that fades out over `blur` around the map's edge, measured in CSS px in the shader.
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { radius: { value: 1 }, blur: { value: SHADOW.blur }, opacity: { value: SHADOW.opacity } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float radius, blur, opacity; varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0 * (radius + blur);
        gl_FragColor = vec4(0.0, 0.0, 0.0, opacity * (1.0 - smoothstep(radius - blur * 0.5, radius + blur, d)));
      }`,
  }));
  const canvas = document.createElement("canvas");
  let texture = new THREE.CanvasTexture(canvas);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.5, SEGMENTS), flat({ map: texture }));
  disc.name = "map-disc";
  const rim = new THREE.Mesh(new THREE.BufferGeometry(), flat({ color: RIM_COLOR, opacity: RIM_OPACITY }));
  const focus = new THREE.Mesh(new THREE.BufferGeometry(), flat({ color: FOCUS.color }));

  // The N, painted once, with the shadow the text had: 0 1px 2px and 0 0 4px.
  const dpr = Math.min(2, devicePixelRatio), pad = 6, box = NORTH.size + 2 * pad;
  const letter = document.createElement("canvas");
  letter.width = letter.height = Math.ceil(box * dpr);
  const g = letter.getContext("2d")!;
  g.scale(dpr, dpr);
  g.font = `600 ${NORTH.size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = NORTH.color;
  for (const [y, blur, alpha] of [[1, 2, 0.9], [0, 4, 0.6]] as const) {
    Object.assign(g, { shadowOffsetY: y, shadowBlur: blur * dpr, shadowColor: `rgba(0, 0, 0, ${alpha})` });
    g.fillText("N", box / 2, box / 2 + 1);
  }
  const north = new THREE.Mesh(new THREE.PlaneGeometry(box, box), flat({ map: srgb(new THREE.CanvasTexture(letter)) }));
  north.name = "map-north";

  const parts = [shadow, disc, rim, focus, north];
  parts.forEach((part, i) => { part.renderOrder = i; part.frustumCulled = false; group.add(part); });
  const opacities = new Map(parts.map((p) => [p.material, (p.material as THREE.Material).opacity]));
  let shownSize = 0, shownOpacity = 1;

  function srgb(t: THREE.CanvasTexture) {
    t.colorSpace = THREE.SRGBColorSpace; // the canvas is in sRGB
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    return t;
  }
  srgb(texture);
  const ring = (inner: number, outer: number) => new THREE.RingGeometry(inner, outer, SEGMENTS);

  return {
    group, disc, north,
    /** Puts the map where `box` (CSS px, from getBoundingClientRect) is and paints it anew; paint fills the canvas
     *  for `size` CSS px across. */
    show(box: DOMRect, { large, focused, opacity }: { large: boolean; focused: boolean; opacity: number },
      paint: (canvas: HTMLCanvasElement, size: number) => void) {
      const on = renderer.domElement.getBoundingClientRect(), size = box.width, inner = size - 2 * RIM;
      group.visible = inner > 0 && opacity > 0;
      if (!group.visible) return;
      group.position.set(box.left - on.left + size / 2, -(box.top - on.top + box.height / 2), 0);
      if (size !== shownSize) {
        shownSize = size;
        rim.geometry.dispose();
        rim.geometry = ring(inner / 2, size / 2);
        focus.geometry.dispose();
        focus.geometry = ring(size / 2 + FOCUS.gap, size / 2 + FOCUS.gap + FOCUS.width);
        disc.scale.setScalar(inner);
        shadow.scale.setScalar(size + 2 * SHADOW.blur);
        (shadow.material as THREE.ShaderMaterial).uniforms.radius!.value = size / 2;
      }
      shadow.position.y = -SHADOW.y;
      focus.visible = focused;
      north.visible = large;
      north.position.y = inner / 2 - NORTH.gap - NORTH.size / 2;
      if (opacity !== shownOpacity) {
        shownOpacity = opacity;
        for (const [material, base] of opacities) {
          if (material instanceof THREE.ShaderMaterial) material.uniforms.opacity!.value = SHADOW.opacity * opacity;
          else (material as THREE.Material).opacity = base * opacity;
        }
      }
      const width = canvas.width;
      paint(canvas, inner);
      if (canvas.width !== width) { // a texture keeps the size it was first sent to the GPU with
        texture.dispose();
        texture = srgb(new THREE.CanvasTexture(canvas));
        (disc.material as THREE.MeshBasicMaterial).map = texture;
      } else texture.needsUpdate = true;
    },
    hide() { group.visible = false; },
  };
}
