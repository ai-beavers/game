// Checks assets/props.glb without a browser: reads the glb's JSON chunk, finds every <prop>_<n> node and counts the
// triangles under it, against the budget. Run: bun test src/props
import { expect, test } from "bun:test";

const FILE = new URL("../../assets/props.glb", import.meta.url);
const VARIANTS = { tree: 3, stump: 2, log: 2, stick: 3, rock: 3, crate: 1, reed: 2, bush: 3 };
const BUDGET: Partial<Record<keyof typeof VARIANTS, number>> = { tree: 15_000, rock: 1_500, stick: 300, bush: 1_000 };
const MAX_BYTES = 6 * 1024 * 1024;

interface Gltf {
  nodes: { name?: string; mesh?: number; children?: number[] }[];
  meshes: { primitives: { indices?: number; attributes: Record<string, number>; mode?: number }[] }[];
  accessors: { count: number }[];
}

const bytes = new Uint8Array(await Bun.file(FILE).arrayBuffer());
const view = new DataView(bytes.buffer);
const gltf: Gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));

function triangles(node: number): number {
  const { mesh, children = [] } = gltf.nodes[node]!;
  const own = mesh === undefined ? 0 : gltf.meshes[mesh]!.primitives.reduce((sum, p) => {
    expect(p.mode ?? 4).toBe(4); // plain triangle lists only
    return sum + gltf.accessors[p.indices ?? p.attributes.POSITION!]!.count / 3;
  }, 0);
  return own + children.reduce((sum, child) => sum + triangles(child), 0);
}

test("is a glb within the size budget", () => {
  expect(view.getUint32(0, true)).toBe(0x46546c67); // "glTF"
  expect(view.getUint32(16, true)).toBe(0x4e4f534a); // "JSON"
  expect(bytes.length).toBeLessThanOrEqual(MAX_BYTES);
});

for (const [prop, count] of Object.entries(VARIANTS) as [keyof typeof VARIANTS, number][]) {
  test(`${prop}: ${count} variants within budget`, () => {
    for (let n = 1; n <= count; n++) {
      const index = gltf.nodes.findIndex((node) => node.name === `${prop}_${n}`);
      expect(index, `${prop}_${n}`).toBeGreaterThanOrEqual(0);
      const tris = triangles(index);
      expect(tris).toBeGreaterThan(0);
      if (BUDGET[prop]) expect(tris, `${prop}_${n}: ${tris} triangles`).toBeLessThanOrEqual(BUDGET[prop]!);
    }
  });
}
