/**
 * Procedural secondary pose drivers for GLB performers (Tabby paw-clap / ear perk / tail wave
 * and 2-beat arm/wing clap presets for Clank, Watt, Chip, Thrum, and Zap).
 */
import * as THREE from "three";
import { clamp, clamp01, type PerformerUpdateInput } from "./actorShared.ts";

export type Quat4 = readonly [number, number, number, number];

export interface TwoBeatClapSpec {
  readonly upperHitQ: Quat4;
  readonly upperOpenQ: Quat4;
  readonly foreHitQ: Quat4;
  readonly foreOpenQ: Quat4;
  readonly asymRight?: {
    readonly upperHitQ: Quat4;
    readonly upperOpenQ: Quat4;
    readonly foreHitQ: Quat4;
    readonly foreOpenQ: Quat4;
    readonly shoulderHitL?: Quat4;
    readonly shoulderOpenL?: Quat4;
    readonly shoulderHitR?: Quat4;
    readonly shoulderOpenR?: Quat4;
  };
}

export const CLANK_CLAP_SPEC: TwoBeatClapSpec = {
  upperHitQ: [-0.2972, 0.2409, -0.5068, 0.7726],
  upperOpenQ: [-0.4208, 0.188, -0.2738, 0.8442],
  foreHitQ: [0.0073, -0.0068, -0.6816, 0.7317],
  foreOpenQ: [0, 0, -0.2231, 0.9748],
};

export const WATT_CLAP_SPEC: TwoBeatClapSpec = {
  upperHitQ: [0.1584, -0.11, -0.2705, 0.9432],
  upperOpenQ: [-0.2762, -0.3777, -0.1984, 0.8612],
  foreHitQ: [0.0061, 0.0002, 0.0137, 0.9999],
  foreOpenQ: [0.0029, 0.0004, 0.0051, 1],
  asymRight: {
    upperHitQ: [-0.1416, -0.4397, 0.484, 0.7432],
    upperOpenQ: [-0.0104, -0.4069, 0.2352, 0.8826],
    foreHitQ: [0.0059, 0.0063, 0.0036, 1],
    foreOpenQ: [0.0438, 0.0022, 0.0218, 0.9988],
    shoulderHitL: [-0.2534, -0.6601, -0.6601, 0.2534],
    shoulderOpenL: [-0.4056, -0.5792, -0.5792, 0.4056],
    shoulderHitR: [-0.4305, 0.561, 0.561, 0.4305],
    shoulderOpenR: [-0.4777, 0.5213, 0.5213, 0.4777],
  },
};

export const CHIP_CLAP_SPEC: TwoBeatClapSpec = {
  upperHitQ: [-0.0805, -0.0334, -0.3812, 0.9204],
  upperOpenQ: [-0.2071, -0.0181, -0.0853, 0.9744],
  foreHitQ: [0, 0, -0.2588, 0.9659],
  foreOpenQ: [0, 0, -0.0698, 0.9976],
  asymRight: {
    upperHitQ: [-0.0805, 0.0334, 0.3812, 0.9204],
    upperOpenQ: [-0.2071, 0.0181, 0.0853, 0.9744],
    foreHitQ: [0, 0, 0.2588, 0.9659],
    foreOpenQ: [0, 0, 0.0698, 0.9976],
    shoulderHitL: [-0.2706, -0.6533, -0.6533, 0.2706],
    shoulderOpenL: [-0.4156, -0.5721, -0.5721, 0.4156],
    shoulderHitR: [-0.2706, 0.6533, 0.6533, 0.2706],
    shoulderOpenR: [-0.4156, 0.5721, 0.5721, 0.4156],
  },
};

export const THRUM_CLAP_SPEC: TwoBeatClapSpec = {
  upperHitQ: [0.1591, -0.1283, -0.6003, 0.7732],
  upperOpenQ: [0.0848, -0.1039, -0.4105, 0.902],
  foreHitQ: [0.1059, -0.2759, -0.3425, 0.8918],
  foreOpenQ: [0.0359, -0.1754, -0.1971, 0.9639],
  asymRight: {
    upperHitQ: [0.1591, 0.1283, 0.6003, 0.7732],
    upperOpenQ: [0.0848, 0.1039, 0.4105, 0.902],
    foreHitQ: [0.1059, 0.2759, 0.3425, 0.8918],
    foreOpenQ: [0.0359, 0.1754, 0.1971, 0.9639],
    shoulderHitL: [-0.4338, -0.5584, -0.5584, 0.4338],
    shoulderOpenL: [-0.4611, -0.5361, -0.5361, 0.4611],
    shoulderHitR: [-0.4338, 0.5584, 0.5584, 0.4338],
    shoulderOpenR: [-0.4611, 0.5361, 0.5361, 0.4611],
  },
};

export const ZAP_CLAP_SPEC: TwoBeatClapSpec = {
  upperHitQ: [0.1133, 0.2286, -0.1928, 0.9475],
  upperOpenQ: [0.1995, 0.1919, -0.1995, 0.94],
  foreHitQ: [0.1384, 0.209, -0.053, 0.9666],
  foreOpenQ: [0.1624, 0.2059, -0.0776, 0.9619],
  asymRight: {
    upperHitQ: [-0.0081, 0.058, 0.3746, 0.9253],
    upperOpenQ: [-0.0091, 0.0114, 0.3498, 0.9367],
    foreHitQ: [0.0519, 0.0293, 0.1039, 0.9928],
    foreOpenQ: [-0.0223, 0.0297, 0.1881, 0.9815],
    shoulderHitL: [-0.1237, -0.5722, -0.6791, 0.4429],
    shoulderOpenL: [-0.3259, -0.4305, -0.6933, 0.4773],
    shoulderHitR: [-0.0318, 0.782, 0.5341, 0.3196],
    shoulderOpenR: [-0.2802, 0.7608, 0.5086, 0.2898],
  },
};

export interface GlbSecondaryPoseBones {
  readonly shoulderL: THREE.Object3D | null;
  readonly shoulderR: THREE.Object3D | null;
  readonly upperArmL: THREE.Object3D | null;
  readonly upperArmR: THREE.Object3D | null;
  readonly forearmL: THREE.Object3D | null;
  readonly forearmR: THREE.Object3D | null;
  readonly handL: THREE.Object3D | null;
  readonly handR: THREE.Object3D | null;
  readonly earL: THREE.Object3D | null;
  readonly earR: THREE.Object3D | null;
  readonly tail1: THREE.Object3D | null;
  readonly tail2: THREE.Object3D | null;
  readonly tail3: THREE.Object3D | null;
}

export class GlbSecondaryPoseState {
  clapWeight = 0;
  earPerk = 0;
  tailActiveWeight = 0;
  lastPostSec = -1;
  private readonly tmpEuler = new THREE.Euler(0, 0, 0, "ZYX");
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpTargetQuat = new THREE.Quaternion();

  private stepDt(timeSec: number): number {
    const dt =
      this.lastPostSec >= 0 && timeSec >= this.lastPostSec
        ? clamp(timeSec - this.lastPostSec, 0, 0.05)
        : 0.016;
    this.lastPostSec = timeSec;
    return dt;
  }

  applyTabbySecondaryPose(bones: GlbSecondaryPoseBones, inp: PerformerUpdateInput, isTabbyClap: boolean): void {
    const dt = this.stepDt(inp.timeSec);

    const clapTarget = isTabbyClap ? 1 : 0;
    const clapRate = isTabbyClap ? 14 : 10;
    this.clapWeight += (clapTarget - this.clapWeight) * (1 - Math.exp(-dt * clapRate));
    if (this.clapWeight > 0.002) {
      const u = (((inp.beat % 2) + 2) % 2) / 2;
      let openAmt: number;
      if (u < 0.16) {
        const a = u / 0.16;
        openAmt = 0.36 + 0.64 * (1 - Math.pow(1 - a, 3));
      } else if (u < 0.28) {
        const snap = (u - 0.16) / 0.12;
        openAmt = 1 - snap * snap * snap;
      } else if (u < 0.56) {
        const hold = (u - 0.28) / 0.28;
        openAmt = 0.2 * Math.sin(hold * Math.PI * 0.65);
      } else if (u < 0.82) {
        const reb = (u - 0.56) / 0.26;
        openAmt = 0.18 + 0.3 * (1 - Math.pow(1 - reb, 2));
      } else {
        const set = (u - 0.82) / 0.18;
        openAmt = 0.48 - 0.12 * set;
      }

      const uaZ = -1.36 + openAmt * 0.48;
      const uaX = -0.34 + openAmt * 0.08;
      const uaY = 0.14;
      const faZ = -1.32 + openAmt * 0.58;
      const faX = 0.24 - openAmt * 0.08;
      const hdZ = -0.06 + openAmt * 0.14;

      const slerpBone = (bone: THREE.Object3D | null, ex: number, ey: number, ez: number) => {
        if (!bone) return;
        this.tmpEuler.set(ex, ey, ez, "ZYX");
        this.tmpQuat.setFromEuler(this.tmpEuler);
        bone.quaternion.slerp(this.tmpQuat, clamp01(this.clapWeight));
      };
      slerpBone(bones.upperArmL, uaX, uaY, uaZ);
      slerpBone(bones.forearmL, faX, 0, faZ);
      slerpBone(bones.handL, 0.06, 0.1, hdZ);
      slerpBone(bones.upperArmR, uaX, -uaY, -uaZ);
      slerpBone(bones.forearmR, faX, 0, -faZ);
      slerpBone(bones.handR, 0.06, -0.1, -hdZ);
    }

    const rawBrow = inp.tabbyFacial ? clamp(inp.tabbyFacial.browLift, -0.25, 1) : 0;
    const pitchPerk =
      inp.singing && inp.artic && inp.artic.f0 > 240
        ? clamp((inp.artic.f0 - 240) / 180, 0, 0.75)
        : 0;
    const clapPerk = isTabbyClap ? 0.45 : 0;
    const targetPerk = inp.singing
      ? clamp(Math.max(rawBrow, pitchPerk * 0.85, clapPerk), -0.15, 1)
      : clamp(Math.max(rawBrow * 0.35, clapPerk), -0.1, 0.65);
    const earRate = targetPerk > this.earPerk ? 12 : 5;
    this.earPerk += (targetPerk - this.earPerk) * (1 - Math.exp(-dt * earRate));
    if (Math.abs(this.earPerk) > 0.002) {
      if (bones.earL) {
        bones.earL.rotateZ(this.earPerk * 0.14);
        bones.earL.rotateX(this.earPerk * 0.09);
      }
      if (bones.earR) {
        bones.earR.rotateZ(-this.earPerk * 0.14);
        bones.earR.rotateX(this.earPerk * 0.09);
      }
    }

    const tailActiveTarget = inp.performing || inp.singing ? 1 : 0;
    const tailRate = tailActiveTarget > 0 ? 8 : 5;
    this.tailActiveWeight += (tailActiveTarget - this.tailActiveWeight) * (1 - Math.exp(-dt * tailRate));
    if (this.tailActiveWeight > 0.002) {
      const sampleTailPhrase = (beatVal: number): number => {
        const b = Math.max(0, beatVal);
        const dir = Math.floor(b / 2) % 2 === 0 ? 1 : -1;
        const u = (((b % 2) + 2) % 2) / 2;
        let env = 0;
        if (u < 0.14) {
          const a = u / 0.14;
          env = -0.22 * (1 - Math.pow(1 - a, 3));
        } else if (u < 0.36) {
          const s = (u - 0.14) / 0.22 - 1;
          env = -0.22 + 1.22 * (1 + 2.4 * s * s * s + 1.4 * s * s);
        } else if (u < 0.78) {
          env = 0.94 - 0.08 * ((u - 0.36) / 0.42);
        } else {
          const r = (u - 0.78) / 0.22;
          env = 0.86 * Math.pow(1 - r, 3);
        }
        return dir * env * this.tailActiveWeight;
      };
      const w1 = sampleTailPhrase(inp.beat);
      const w2 = sampleTailPhrase(inp.beat - 0.18);
      const w3 = sampleTailPhrase(inp.beat - 0.36);
      if (bones.tail1) {
        bones.tail1.rotateY(w1 * 0.14);
        bones.tail1.rotateX(Math.abs(w1) * 0.08);
      }
      if (bones.tail2) {
        bones.tail2.rotateZ(-w2 * 0.18);
        bones.tail2.rotateX(w2 * 0.08);
      }
      if (bones.tail3) {
        bones.tail3.rotateZ(-w3 * 0.24);
        bones.tail3.rotateX(w3 * 0.1);
      }
    }
  }

  applyTwoBeatClapPose(
    bones: GlbSecondaryPoseBones,
    inp: PerformerUpdateInput,
    active: boolean,
    spec: TwoBeatClapSpec,
  ): void {
    const dt = this.stepDt(inp.timeSec);
    const clapTarget = active ? 1 : 0;
    const clapRate = active ? 30 : 10;
    this.clapWeight += (clapTarget - this.clapWeight) * (1 - Math.exp(-dt * clapRate));
    if (this.clapWeight <= 0.002) return;

    const u =
      inp.actionElapsedSec !== undefined && !inp.performing
        ? (((inp.actionElapsedSec * 1.65) % 1) + 1) % 1
        : (((inp.beat * 1.0 + inp.phaseIndex * 0.25) % 1) + 1) % 1;
    let openAmt: number;
    if (u < 0.08) {
      const a = u / 0.08;
      openAmt = 0.45 + 0.55 * (1 - Math.pow(1 - a, 3));
    } else if (u < 0.2) {
      const snap = (u - 0.08) / 0.12;
      openAmt = 1 - snap * snap * snap;
    } else if (u < 0.56) {
      const hold = (u - 0.2) / 0.36;
      openAmt = 0.06 * Math.sin(hold * Math.PI * 0.65);
    } else if (u < 0.84) {
      const reb = (u - 0.56) / 0.28;
      openAmt = 0.06 + 0.54 * (1 - Math.pow(1 - reb, 2));
    } else {
      const set = (u - 0.84) / 0.16;
      openAmt = 0.6 - 0.15 * set;
    }

    const slerpOne = (bone: THREE.Object3D | null, hitQ: Quat4, openQ: Quat4, mirrorR = false) => {
      if (!bone) return;
      this.tmpQuat.set(hitQ[0], hitQ[1], hitQ[2], hitQ[3]);
      this.tmpTargetQuat.set(openQ[0], openQ[1], openQ[2], openQ[3]);
      this.tmpQuat.slerp(this.tmpTargetQuat, openAmt);
      if (mirrorR) {
        this.tmpQuat.set(this.tmpQuat.x, -this.tmpQuat.y, -this.tmpQuat.z, this.tmpQuat.w);
      }
      bone.quaternion.slerp(this.tmpQuat, this.clapWeight);
    };

    const asym = spec.asymRight;
    if (asym?.shoulderHitL && asym.shoulderOpenL) {
      slerpOne(bones.shoulderL, asym.shoulderHitL, asym.shoulderOpenL);
    }
    if (asym?.shoulderHitR && asym.shoulderOpenR) {
      slerpOne(bones.shoulderR, asym.shoulderHitR, asym.shoulderOpenR);
    }
    slerpOne(bones.upperArmL, spec.upperHitQ, spec.upperOpenQ);
    slerpOne(bones.upperArmR, asym?.upperHitQ ?? spec.upperHitQ, asym?.upperOpenQ ?? spec.upperOpenQ, !asym);
    slerpOne(bones.forearmL, spec.foreHitQ, spec.foreOpenQ);
    slerpOne(bones.forearmR, asym?.foreHitQ ?? spec.foreHitQ, asym?.foreOpenQ ?? spec.foreOpenQ, !asym);
  }
}
