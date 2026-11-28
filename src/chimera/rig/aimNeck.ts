import * as THREE from "three";
import { RANGE, type Pose } from "./pose.ts";
import { neckTurns, type Rig } from "./rig.ts";

const { clamp, radToDeg } = THREE.MathUtils;
const azimuth = (v: THREE.Vector3) => radToDeg(Math.atan2(v.z, v.x));
const elevation = (v: THREE.Vector3) => radToDeg(Math.atan2(v.y, Math.hypot(v.x, v.z)));

/** Neck angles relative to the posed trunk, aimed at a world-space target. */
export function aimNeck(rig: Rig, parentMatrixWorld: THREE.Matrix4, target: THREE.Vector3): Pose["neck"] {
  const neck = rig.bone("neck"), head = rig.bone("head");
  const fromTrunk = rig.W[rig.bones[neck].parent].clone().invert();
  const to = target.clone().applyMatrix4(parentMatrixWorld.clone().invert())
    .sub(rig.P[neck]).applyQuaternion(fromTrunk);
  const headOffset = rig.H[head].clone().sub(rig.H[neck]).applyQuaternion(rig.N[neck]);
  // +X is forward. +Y twist turns toward -Z, and flexion rotates about -Z.
  const yaw = azimuth(to);
  const aim = { flex: clamp(-elevation(to), ...RANGE.neck.flex), bend: 0, twist: clamp(-yaw, ...RANGE.neck.twist) };
  // The joints split twist and flexion, and bending moves the head pivot. Correct for both
  // in the trunk frame using the same local turns as Rig.pose.
  for (let i = 0; i < 5; i++) {
    const [lower, upper] = neckTurns(aim);
    const ray = to.clone().sub(headOffset.clone().applyQuaternion(lower));
    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(rig.N[head]).applyQuaternion(upper).applyQuaternion(lower);
    aim.flex = clamp(aim.flex + elevation(forward) - elevation(ray), ...RANGE.neck.flex);
    // Keep the same side of the ±180° seam when the target is behind the figure.
    const rayYaw = yaw + THREE.MathUtils.euclideanModulo(azimuth(ray) - yaw + 180, 360) - 180;
    aim.twist = clamp(aim.twist + azimuth(forward) - rayYaw, ...RANGE.neck.twist);
  }
  return aim;
}
