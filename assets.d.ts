// Bun's bundler turns these imports into the file's address.
declare module "*.glb" { const url: string; export default url; }
declare module "*.png" { const url: string; export default url; }
declare module "*.jpg" { const url: string; export default url; }
declare module "*.wasm" { const url: string; export default url; }
