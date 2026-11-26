import { expect, test } from "bun:test";
import { oneEach } from "./webgpu.ts";

test("every uniform, varying and attribute gets a line of its own", () => {
  const lines = (code: string) => oneEach(code).split("\n").map((line) => line.trim()).filter(Boolean);
  expect(lines("uniform float a, b; varying vec3 furRest, furNormal; attribute vec4 furMask; attribute float furLayer;"))
    .toEqual(["uniform float a;", "uniform float b;", "varying vec3 furRest;", "varying vec3 furNormal;", "attribute vec4 furMask;", "attribute float furLayer;"]);
  expect(lines("uniform highp vec4 tint[2], glow;")).toEqual(["uniform highp vec4 tint[2];", "uniform highp vec4 glow;"]);
  // Blocks, functions and code are left alone.
  const kept = "layout(std140) uniform Material { vec4 a; };\nvoid main() { float a, b; gl_FragColor = vec4(a, b, 0., 1.); }";
  expect(oneEach(kept)).toBe(kept);
});
