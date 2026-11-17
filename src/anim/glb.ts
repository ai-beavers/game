// Reads a .glb file into its JSON and its accessors, without three.js: used by rest-gen.ts (to write rest.ts) and
// by the tests (to compare the ported pose functions with the clips baked into assets/beaver.glb).
//
//   const glb = parseGlb(bytes);  glb.json.nodes …;  glb.read(accessorIndex) → number[][] (one array per element)

export interface Glb { json: any; read(accessor: number): number[][] }

const SIZES: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function parseGlb(bytes: Uint8Array): Glb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a glb");
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const binStart = 20 + jsonLength + 8, bin = new DataView(bytes.buffer, bytes.byteOffset + binStart);
  return {
    json,
    read(index) {
      const accessor = json.accessors[index], bufferView = json.bufferViews[accessor.bufferView];
      if (accessor.componentType !== 5126) throw new Error("only float accessors");
      const size = SIZES[accessor.type]!, stride = bufferView.byteStride ?? size * 4;
      const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      return Array.from({ length: accessor.count }, (_, i) =>
        Array.from({ length: size }, (_, k) => bin.getFloat32(start + i * stride + k * 4, true)));
    },
  };
}
