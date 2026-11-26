// Havok's WebAssembly as a file of the bundle (Bun's file loader): its address. A .js file, typed by
// havok-wasm.d.ts beside it: TypeScript 7 resolves a .wasm import itself and finds no types for it.
export { default } from "@babylonjs/havok/lib/esm/HavokPhysics.wasm" with { type: "file" };
