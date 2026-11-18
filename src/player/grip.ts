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
