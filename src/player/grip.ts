import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";

const grip = Quaternion.RotationYawPitchRoll(Math.PI / 2, -0.35, 0);
const offset = new Vector3(0, 0, 0.12);

export function holdInHand(mesh: TransformNode, hand: TransformNode, player: TransformNode) {
  const handMatrix = hand.computeWorldMatrix(true);
  const rotation = Quaternion.FromEulerVector(player.rotation).multiply(grip);
  const position = handMatrix.getTranslation().subtract(offset.applyRotationQuaternion(rotation));
  const local = Matrix.Compose(Vector3.One(), rotation, position).multiply(Matrix.Invert(handMatrix));
  mesh.rotationQuaternion ??= Quaternion.Identity();
  local.decompose(mesh.scaling, mesh.rotationQuaternion, mesh.position);
}

// In the first-person view the paw is below the picture, so the carried stick is shown where the eyes see it: low in
// front of them and across the view, a little to the side of the right paw, turning with the look's yaw only (looking
// up puts it out of the picture, looking down at the feet shows it whole). Only the mesh moves; a carried stick has
// no body in the simulation.
const VIEW_AHEAD = 0.55, VIEW_DOWN = 0.3, VIEW_SIDE = -0.1; // m from the eyes: ahead, down, to the right (+)
const viewGrip = Quaternion.RotationYawPitchRoll(Math.PI / 2, 0, -0.2);

/** Holds `mesh` (parented to `hand`) low in front of eyes at `eye`, looking the way `heading` (radians, as facing). */
export function holdInView(mesh: TransformNode, hand: TransformNode, eye: Vector3, heading: number) {
  const handMatrix = hand.computeWorldMatrix(true);
  const sin = Math.sin(heading), cos = Math.cos(heading);
  const position = new Vector3(eye.x + sin * VIEW_AHEAD + cos * VIEW_SIDE, eye.y - VIEW_DOWN, eye.z + cos * VIEW_AHEAD - sin * VIEW_SIDE);
  const rotation = Quaternion.RotationYawPitchRoll(heading, 0, 0).multiply(viewGrip);
  const local = Matrix.Compose(Vector3.One(), rotation, position).multiply(Matrix.Invert(handMatrix));
  mesh.rotationQuaternion ??= Quaternion.Identity();
  local.decompose(mesh.scaling, mesh.rotationQuaternion, mesh.position);
}
