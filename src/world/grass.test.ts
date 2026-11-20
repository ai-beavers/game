// The meadow's tiles: each draws its own blades. Run: bun test src/world/grass.test.ts
import { expect, test } from "bun:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import type { Stage } from "../engine.ts";
import { daylight } from "../light.ts";
import { buildGrass } from "./grass.ts";

test("every grass tile draws with its own instance buffers, not the weeds' (the GL refused those draws)", () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.metadata = {};
  const stage = { engine, scene, camera: new FreeCamera("follow", new Vector3(0, 2, 0), scene) } as unknown as Stage;
  daylight(stage);
  buildGrass(stage, () => false, new StandardMaterial("soil", scene));
  const tiles = scene.meshes.filter((mesh) => mesh.name === "grass tile") as Mesh[];
  expect(tiles.length).toBeGreaterThan(1);
  const floats = (tile: Mesh, kind: string) => (tile.getVertexBuffer(kind)!.getData() as Float32Array).length;
  for (const tile of tiles) {
    // What the draw binds (the geometry's buffers) must hold as many instances as the draw asks for.
    expect(floats(tile, "ground") / 4).toBe(tile.thinInstanceCount);
    expect(floats(tile, "world0") / 16).toBe(tile.thinInstanceCount);
  }
});
