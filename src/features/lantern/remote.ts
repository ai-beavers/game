// The lantern in other players' beavers' left paws (src/features/net/remote.ts): the same look as the player's own
// (look.ts), hanging the same way, while the shared day is dark. It glows with the dark unless that beaver's Motion
// says its player switched it off (a flash). No PointLight and no glow in the self-lit shaders: a small glowing mesh
// each, so sixteen beavers at night cost little. No reach into the backpack: it comes and goes with the dark, and
// is hidden while that beaver is under water.
//
//   const lanterns = remoteLanterns(game);       once, for all remotes
//   const lantern = lanterns.carry(beaver);       per remote beaver, once it is loaded
//   lantern.update(motion, feet);                 each picture, after the beaver is posed
//   lantern.dispose();
import type { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { Beaver, Motion } from "../../contracts.ts";
import type { Game } from "../../game.ts";
import { GLOW, glowOf, hanger, lanternMaterials, makeLantern, WARM } from "./look.ts";
import { wantsOut } from "./stow.ts";

/** m of water above the feet from which a swimming beaver is under: deeper than afloat (0.45), as deep as a dive. */
const UNDER = 0.55;

export function remoteLanterns(game: Game) {
  const { scene } = game.stage;
  // Two glasses for all: lit (glowing with the dark) and switched off. Each lantern takes one of them.
  const materials = lanternMaterials(scene, "remote-lantern"), lit = materials.glass;
  const dark = new StandardMaterial("remote-lantern-dark", scene);
  dark.diffuseColor.copyFrom(lit.diffuseColor);
  dark.specularColor.copyFrom(lit.specularColor);
  return {
    carry(beaver: Beaver) {
      const glass = makeLantern(scene, "remote-lantern", { glass: lit, frame: materials.frame }), hang = hanger(glass, beaver);
      glass.setEnabled(false);
      let out = false;
      return {
        update(motion: Motion, feet: Vector3) {
          const night = game.sky?.dark ?? 0, water = game.world.waterLevel;
          out = wantsOut(out, night);
          const under = motion.swimming > 0.5 && water - feet.y > UNDER, shown = out && !under;
          glass.setEnabled(shown);
          if (!shown) return;
          hang();
          lit.emissiveColor.copyFrom(WARM).scaleInPlace(GLOW * glowOf(night)); // the same for all: cheap to repeat
          glass.material = motion.lanternOff ? dark : lit;
        },
        dispose() { glass.dispose(false, false); },
      };
    },
  };
}
export type RemoteLanterns = ReturnType<typeof remoteLanterns>;
