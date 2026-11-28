/**
 * Pure formation geometry, pose-to-pose riser groove, autopilot interpolation,
 * and CHIMERA vocal articulator mapping for `LiveStage3D`.
 */
import type { CinemaShotPreset, Piece } from "../choir/music.ts";
import type { Pose } from "../choir/pose.ts";
import type { VocalArticSample } from "../choir/vocalTiming.ts";
import type { MoppetVoice } from "../choir/voices.ts";
import type { StageAutopilotFrame, StagePropState } from "./stageAutopilot.ts";
import type { StageWorldId } from "./stageWorlds.ts";
import type { CameraMode } from "./studioWorlds3D.ts";

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp(t, 0, 1);

export const easeOutCubic = (t: number): number => {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
};

export const easeOutBack = (t: number): number => {
  const u = clamp(t, 0, 1) - 1;
  const s = 1.45;
  return 1 + (s + 1) * u * u * u + s * u * u;
};

export function interpolateAutopilotFrame(
  autopilot: readonly StageAutopilotFrame[],
  timeSec: number,
): StageAutopilotFrame | undefined {
  if (autopilot.length === 0) return undefined;
  const maxIdx = autopilot.length - 1;
  const f = clamp(timeSec * 30, 0, maxIdx);
  const i0 = Math.floor(f);
  const i1 = Math.min(maxIdx, Math.ceil(f));
  const a = autopilot[i0];
  if (i0 === i1) return a;
  const b = autopilot[i1];
  const t = f - i0;
  const snap = t >= 0.5 ? b : a;

  const props: StagePropState[] = a.props.map((pa, idx) => {
    const pb = b.props[idx];
    if (!pb || pb.id !== pa.id) return pa;
    return {
      ...pa,
      x: lerp(pa.x, pb.x, t),
      y: lerp(pa.y, pb.y, t),
      z: lerp(pa.z, pb.z, t),
      rotZ: lerp(pa.rotZ, pb.rotZ, t),
      rotY: lerp(pa.rotY, pb.rotY, t),
      compression: lerp(pa.compression, pb.compression, t),
      energy: lerp(pa.energy, pb.energy, t),
    };
  });

  return {
    frame: snap.frame,
    timeSec: lerp(a.timeSec, b.timeSec, t),
    beat: lerp(a.beat, b.beat, t),
    actor: {
      ...snap.actor,
      x: lerp(a.actor.x, b.actor.x, t),
      y: lerp(a.actor.y, b.actor.y, t),
      z: lerp(a.actor.z, b.actor.z, t),
      leanRad: lerp(a.actor.leanRad, b.actor.leanRad, t),
      squashX: lerp(a.actor.squashX, b.actor.squashX, t),
      stretchY: lerp(a.actor.stretchY, b.actor.stretchY, t),
      gazeX: lerp(a.actor.gazeX, b.actor.gazeX, t),
      gazeY: lerp(a.actor.gazeY, b.actor.gazeY, t),
      walkDistance: lerp(a.actor.walkDistance, b.actor.walkDistance, t),
    },
    props,
  };
}

export interface DownstageCastEntry {
  readonly voice: MoppetVoice;
  readonly idx: number;
}

/**
 * Resolve downstage cast preserving `piece.stage` order (excluding `"band"`) first,
 * then appending any singing track in `piece.tracks` not already listed.
 */
export function resolveDownstageCastEntries(
  piece: Piece,
  voices: readonly MoppetVoice[],
): DownstageCastEntry[] {
  const voiceById = new Map<string, DownstageCastEntry>();
  voices.forEach((voice, idx) => {
    voiceById.set(voice.id, { voice, idx });
  });

  const seen = new Set<string>();
  const out: DownstageCastEntry[] = [];
  const pushId = (id: string) => {
    if (!id || id === "band" || seen.has(id)) return;
    const entry = voiceById.get(id);
    if (!entry) return;
    seen.add(id);
    out.push(entry);
  };

  for (const stageId of piece.stage ?? []) {
    pushId(stageId);
  }
  const hasAnyEvents = piece.tracks.some((t) => t.events.length > 0);
  for (const track of piece.tracks) {
    if (!hasAnyEvents || track.events.length > 0) {
      pushId(track.id);
    }
  }
  if (out.length === 0 && voices[0]) {
    out.push({ voice: voices[0], idx: 0 });
  }
  return out;
}

export interface RiserGrooveSample {
  readonly hopY: number;
  readonly squashX: number;
  readonly stretchY: number;
  readonly leanRad: number;
  readonly rotY: number;
  readonly level: number;
}

/**
 * Disney pose-to-pose musical groove on beats 1 & 3 (or dotted-quarter pulses in 6/8):
 * anticipation -> beat snap -> moving hold -> settle (zero robotic sine wobble).
 */
export function evaluateRiserBandGroove(
  beat: number,
  index: number,
  meter: string | undefined,
  active: boolean,
): RiserGrooveSample {
  if (!active) {
    return { hopY: 0, squashX: 1, stretchY: 1, leanRad: 0, rotY: 0, level: 0 };
  }
  const pulseBeats = meter?.startsWith("6/") ? 1.5 : 2;
  const shifted = Math.max(0, beat + index * 0.04);
  const cycle = ((shifted % pulseBeats) + pulseBeats) % pulseBeats;
  const u = cycle / pulseBeats;
  const swaySign = Math.floor(shifted / pulseBeats) % 2 === 0 ? 1 : -1;

  let env = 0;
  let strongBeat = false;
  if (u < 0.14) {
    env = -0.26 * easeOutCubic(u / 0.14);
  } else if (u < 0.34) {
    env = -0.26 + 1.26 * easeOutBack((u - 0.14) / 0.2);
    strongBeat = true;
  } else if (u < 0.76) {
    env = 0.94 + 0.06 * (1 - (u - 0.34) / 0.42);
    strongBeat = u < 0.62;
  } else {
    env = 0.94 * (1 - easeOutCubic((u - 0.76) / 0.24));
  }

  const lift = Math.max(0, env);
  const crouch = Math.max(0, -env);
  return {
    hopY: lift * 0.032,
    squashX: 1 + crouch * 0.055 - lift * 0.025,
    stretchY: 1 - crouch * 0.05 + lift * 0.035,
    leanRad: swaySign * env * 0.048,
    rotY: swaySign * env * 0.065,
    level: strongBeat ? 0.35 : 0.12,
  };
}

export function poseToVocalArtic(p: Pose | undefined): VocalArticSample | undefined {
  if (!p) return undefined;
  return {
    open: p.singing ? p.open : 0,
    jaw: p.singing ? p.jaw : 0,
    round: p.singing ? p.round : 0,
    lipWidth: p.singing ? p.lipWidth : 0.5,
    labiodental: p.singing ? p.labiodental : 0,
    mouthPressure: p.singing ? p.mouthPressure : 0,
    f0: p.f0,
    voicing: p.voicing,
  };
}

export function resolveDownstageFormationSlot(
  i: number,
  total: number,
  riserCount: number,
): { readonly baseX: number; readonly baseZ: number; readonly onRiser: boolean } {
  if (total <= 1) {
    return { baseX: 0, baseZ: 0.25, onRiser: false };
  }
  if (total === 2) {
    return { baseX: i === 0 ? -1.35 : 1.35, baseZ: i === 0 ? 0.34 : 0.24, onRiser: false };
  }
  if (total === 3) {
    const slots = [
      { baseX: 0, baseZ: 0.48, onRiser: false },
      { baseX: -1.9, baseZ: 0.1, onRiser: false },
      { baseX: 1.9, baseZ: 0.1, onRiser: false },
    ];
    return slots[i] ?? { baseX: 0, baseZ: 0.1, onRiser: false };
  }
  if (total === 4) {
    const slots =
      riserCount >= 4
        ? [
            { baseX: -0.55, baseZ: 0.64, onRiser: false },
            { baseX: 1.65, baseZ: 0.16, onRiser: false },
            { baseX: 0.55, baseZ: 0.54, onRiser: false },
            { baseX: -1.65, baseZ: 0.16, onRiser: false },
          ]
        : [
            { baseX: -0.66, baseZ: 0.64, onRiser: false },
            { baseX: 2.0, baseZ: 0.16, onRiser: false },
            { baseX: 0.66, baseZ: 0.54, onRiser: false },
            { baseX: -2.0, baseZ: 0.16, onRiser: false },
          ];
    return slots[i] ?? { baseX: 0, baseZ: 0.2, onRiser: false };
  }
  if (total === 5) {
    const backOnRiser = riserCount === 0;
    const backZ = backOnRiser ? -1.24 : -0.35;
    const slots = [
      { baseX: 0, baseZ: 0.76, onRiser: false },
      { baseX: -1.72, baseZ: 0.68, onRiser: false },
      { baseX: 1.72, baseZ: 0.68, onRiser: false },
      { baseX: -0.88, baseZ: backZ, onRiser: backOnRiser },
      { baseX: 0.88, baseZ: backZ, onRiser: backOnRiser },
    ];
    return slots[i] ?? { baseX: 0, baseZ: backZ, onRiser: backOnRiser };
  }
  if (total === 6) {
    const backOnRiser = riserCount === 0;
    const backZ = backOnRiser ? -1.24 : -0.35;
    const slots = [
      { baseX: 0, baseZ: 0.78, onRiser: false },
      { baseX: 1.72, baseZ: 0.7, onRiser: false },
      { baseX: -1.72, baseZ: 0.7, onRiser: false },
      { baseX: -0.88, baseZ: backZ, onRiser: backOnRiser },
      { baseX: 0.88, baseZ: backZ, onRiser: backOnRiser },
      { baseX: -2.55, baseZ: backZ, onRiser: backOnRiser },
    ];
    return slots[i] ?? { baseX: 0, baseZ: backZ, onRiser: backOnRiser };
  }

  const frontCount = Math.ceil(total / 2);
  const backCount = total - frontCount;
  const frontStep = frontCount > 1 ? Math.min(1.6, 6.4 / (frontCount - 1)) : 0;
  const frontSpan = frontStep * (frontCount - 1);
  if (i < frontCount) {
    return {
      baseX: frontCount === 1 ? 0 : -frontSpan * 0.5 + i * frontStep,
      baseZ: 0.78,
      onRiser: false,
    };
  }
  const bi = i - frontCount;
  const backSpan = Math.min(5.6, Math.max(1, backCount - 1) * frontStep + frontStep * 0.5);
  const backOnRiser = riserCount === 0;
  return {
    baseX: backCount === 1 ? 0.85 : -backSpan * 0.5 + (bi / Math.max(1, backCount - 1)) * backSpan,
    baseZ: backOnRiser ? -1.24 : -0.35,
    onRiser: backOnRiser,
  };
}

export function resolveRiserBandX(ri: number, riserCount: number, downstageTotal: number): number {
  if (riserCount <= 1) return downstageTotal === 1 || downstageTotal === 3 || downstageTotal >= 5 ? 0.92 : 0;
  if (riserCount === 2) return ri === 0 ? -1.28 : 1.28;
  if (riserCount === 3) {
    return downstageTotal % 2 === 1 ? ([-2.45, -0.92, 0.92][ri] ?? 0) : ([-2.15, 0, 2.15][ri] ?? 0);
  }
  if (riserCount === 4) {
    if (downstageTotal >= 4) return [-2.95, -1.1, 0.05, 2.95][ri] ?? 0;
    if (downstageTotal === 2) return [-2.65, -0.72, 0.72, 2.65][ri] ?? 0;
    return [-2.75, -0.95, 0.95, 2.75][ri] ?? 0;
  }
  const riserSpan = Math.min(5.8, (riserCount - 1) * 1.42);
  return -riserSpan * 0.5 + (ri / (riserCount - 1)) * riserSpan;
}

export function defaultWorldForSong(songId: string): StageWorldId | null {
  if (songId === "cardboard-horse") return "caravan";
  if (songId === "bible-folio") return "storybook";
  return null;
}

export function resolveEffectiveCameraMode(
  cameraMode: CameraMode,
  variableStageEnabled: boolean,
  sceneCameraPreset?: CinemaShotPreset,
): CameraMode {
  if (cameraMode !== "authored") return cameraMode;
  if (!variableStageEnabled || !sceneCameraPreset) return "authored";
  if (sceneCameraPreset === "closeup" || sceneCameraPreset === "reaction") return "closeup";
  if (sceneCameraPreset === "low-angle") return "low-angle";
  if (sceneCameraPreset === "wide") return "wide";
  return "authored";
}
