// Proves the port: every ported pose function gives, at every frame, what the clip in assets/beaver.glb holds
// for every bone (rotation up to sign, translation, scale). Frames: Blender keyed frame f + 1 for t = f / frames,
// exported at 30 per second, so a key at time s is frame k = s * 30 - 1 and t = k / frames.
import { expect, test } from "bun:test";
import { BONES } from "../contracts.ts";
import { Body } from "./body.ts";
import { CLIPS } from "./clips.ts";
import { parseGlb } from "./glb.ts";
import { inv, mul, type Quat } from "./quat.ts";

const glb = parseGlb(new Uint8Array(await Bun.file(new URL("../../assets/beaver.glb", import.meta.url)).arrayBuffer()));
const nodes: any[] = glb.json.nodes;

for (const [name, frames, clip] of CLIPS) {
  test(`${name} matches the glb`, () => {
    const animation = glb.json.animations.find((a: any) => a.name === name);
    expect(animation).toBeDefined();
    const body = new Body();
    let worst = 0;
    for (const channel of animation.channels) {
      const bone = nodes[channel.target.node].name, path = channel.target.path;
      expect(BONES as readonly string[]).toContain(bone);
      const sampler = animation.samplers[channel.sampler], times = glb.read(sampler.input), values = glb.read(sampler.output);
      times.forEach(([time], key) => {
        const k = Math.round(time! * 30) - 1; // constant channels keep only their first and last key
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThanOrEqual(frames);
        body.reset();
        clip(body, k / frames);
        const mine = body.pose()[bone as keyof ReturnType<Body["pose"]>]!, theirs = values[key]!;
        let error: number;
        if (path === "rotation") {
          const [x, y, z, w] = mul(inv(mine.rotation), theirs as Quat); // the turn between the two, either sign
          error = 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w)); // radians
        } else if (path === "translation") error = Math.max(...mine.translation!.map((x, i) => Math.abs(x - theirs[i]!)));
        else error = Math.max(...theirs.map((x) => Math.abs(x - mine.scale!)));
        worst = Math.max(worst, error);
        if (error > 1e-3) throw new Error(`${name} ${bone} ${path} key ${k}: mine ${JSON.stringify(mine)} glb ${theirs}`);
      });
    }
    expect(worst).toBeLessThan(1e-3); // 0.06° or 1 mm
    console.log(name, "worst", worst.toExponential(1));
  });
}
