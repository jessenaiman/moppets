import { canonicalCastId } from "../choir/castManifest.ts";
import type { Piece, StageBlockingCue, StageMoveTarget } from "../choir/music.ts";

export interface BlockingPose {
  /** Horizontal stage shift normalized to stage width (-0.42..+0.42). */
  dxNorm: number;
  /** Vertical hop/jump normalized to actor height (0..0.48). */
  hopNorm: number;
  /** Depth offset (-0.15 downstage .. +0.25 upstage). */
  depthOffset: number;
  /** Direction facing (-1 = facing left, +1 = facing right). */
  facing: number;
  /** Horizontal squash/stretch factor. */
  squashX: number;
  /** Vertical squash/stretch factor. */
  stretchY: number;
  /** Body lean in degrees (+ leans right). */
  leanDeg: number;
  /** Normalized walk stride cycle (radians) while relocating. */
  walkPhase: number;
  isWalking: boolean;
  isJumping: boolean;
  isDancing: boolean;
  isCelebrating: boolean;
  /** Preferred directional/action clip for atlas or rig performers when available. */
  preferredClip: "walk-left" | "walk-right" | "jump" | "react" | null;
}

const DEFAULT_MOVE_X: Record<StageMoveTarget, number> = {
  "wide-left": -0.34,
  left: -0.22,
  center: 0,
  right: 0.22,
  "wide-right": 0.34,
  forward: 0,
  back: 0,
};

const DEFAULT_MOVE_DEPTH: Record<StageMoveTarget, number> = {
  "wide-left": 0.04,
  left: 0.02,
  center: 0,
  right: 0.02,
  "wide-right": 0.04,
  forward: -0.14,
  back: 0.18,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothstep = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

function resolveWhoMatch(cueWho: string, castId: string, voiceId?: string): boolean {
  if (cueWho === castId || (voiceId && cueWho === voiceId)) return true;
  if (canonicalCastId(cueWho) === canonicalCastId(castId)) return true;
  if (voiceId && canonicalCastId(cueWho) === canonicalCastId(voiceId)) return true;
  if (cueWho === "tracking" && castId === "tracker") return true;
  if (cueWho === "tracker" && castId === "tracking") return true;
  return false;
}

function collectBlockingForActor(piece: Piece, castId: string, voiceId?: string): StageBlockingCue[] {
  const explicit = (piece.blocking ?? []).filter((b) => resolveWhoMatch(b.who, castId, voiceId));
  const merged = [...explicit];

  // Auto-derive celebratory finale hop & entrance flair when a piece has no explicit cues near the finale
  const lastBeat = Math.max(4, piece.beats || 16);
  const hasLateCue = merged.some((b) => b.beat >= lastBeat - 6);
  if (!hasLateCue && piece.sections?.some((s) => /finale/i.test(s.name))) {
    merged.push({
      beat: Math.max(0, lastBeat - 4),
      beats: 4,
      who: castId,
      action: "celebrate",
    });
  }
  return merged.sort((a, b) => a.beat - b.beat);
}

/**
 * Pure deterministic stage locomotion solver (`S-56`):
 * Evaluates full-body stage travel (`move L/R/center/forward/back`), 3-phase cartoon `jump`
 * (anticipation -> parabola -> landing squash), beat-synced `dance`, and `celebrate` fireworks.
 * Works identically on both live interactive playback and headless Remotion renders.
 */
export function evaluateActorBlocking(
  piece: Piece,
  castId: string,
  beat: number,
  sec: number,
  actorIndex: number,
  totalActors: number,
  singingNow: boolean,
  voiceId?: string,
): BlockingPose {
  const cues = collectBlockingForActor(piece, castId, voiceId);
  const beatsPerSec = Math.max(0.5, (piece.bpm || 112) / 60);

  let dxNorm = 0;
  let depthOffset = 0;
  let facing = 1;
  let hopNorm = 0;
  let squashX = 1;
  let stretchY = 1;
  let leanDeg = 0;
  let walkPhase = 0;
  let isWalking = false;
  let isJumping = false;
  let isDancing = false;
  let isCelebrating = false;
  let preferredClip: BlockingPose["preferredClip"] = null;

  // 1. Resolve cumulative waypoint positions from `move` cues up to `beat`
  let curX = 0;
  let curDepth = 0;
  const moveCues = cues.filter((c) => c.action === "move" && c.target);
  for (const mc of moveCues) {
    const tgt = mc.target!;
    const destX = tgt === "forward" || tgt === "back" ? curX : DEFAULT_MOVE_X[tgt];
    const destD = DEFAULT_MOVE_DEPTH[tgt];
    const span = Math.max(1.5, mc.beats || 3);
    const t0 = mc.beat;
    const t1 = mc.beat + span;
    if (beat >= t1) {
      if (Math.abs(destX - curX) > 0.02) facing = destX > curX ? 1 : -1;
      curX = destX;
      curDepth = destD;
    } else if (beat >= t0) {
      const u = clamp((beat - t0) / span, 0, 1);
      // 14% anticipation crouch -> 72% smooth travel -> 14% settle cushion
      if (u < 0.14) {
        const a = u / 0.14;
        const dir = Math.sign(destX - curX) || facing;
        facing = dir;
        squashX = 1 + 0.08 * Math.sin(a * Math.PI);
        stretchY = 1 - 0.07 * Math.sin(a * Math.PI);
        leanDeg = -dir * 6 * Math.sin(a * Math.PI);
      } else {
        const moveU = smoothstep((u - 0.14) / 0.86);
        const prevX = curX;
        curX = prevX + (destX - prevX) * moveU;
        curDepth = curDepth + (destD - curDepth) * moveU;
        if (Math.abs(destX - prevX) > 0.02) facing = destX > prevX ? 1 : -1;
        isWalking = u < 0.94;
        if (isWalking) {
          walkPhase = (u * span * Math.PI * 2);
          hopNorm = Math.max(hopNorm, Math.abs(Math.sin(walkPhase)) * 0.055);
          leanDeg += facing * 5.5 * (1 - moveU * 0.4);
          preferredClip = facing < 0 ? "walk-left" : "walk-right";
        }
      }
      break;
    }
  }
  dxNorm = curX;
  depthOffset = curDepth;

  // 2. Evaluate active `jump`, `dance`, and `celebrate` overlay cues
  for (const cue of cues) {
    if (cue.action === "move") continue;
    const span = Math.max(1.2, cue.beats || (cue.action === "jump" ? 1.5 : 3.5));
    if (beat < cue.beat || beat > cue.beat + span) continue;
    const u = clamp((beat - cue.beat) / span, 0, 1);

    if (cue.action === "jump") {
      isJumping = true;
      preferredClip = "jump";
      if (u < 0.18) {
        // Anticipation squash
        const a = Math.sin((u / 0.18) * Math.PI);
        squashX *= 1 + 0.15 * a;
        stretchY *= 1 - 0.14 * a;
      } else if (u < 0.78) {
        // Airborne parabola
        const air = (u - 0.18) / 0.6;
        const arc = 4 * air * (1 - air);
        hopNorm = Math.max(hopNorm, arc * 0.36);
        squashX *= 1 - 0.11 * arc;
        stretchY *= 1 + 0.14 * arc;
        leanDeg += facing * (6 * Math.sin(air * Math.PI));
      } else {
        // Landing squash + quick spring recovery
        const land = (u - 0.78) / 0.22;
        const cushion = Math.sin(land * Math.PI);
        squashX *= 1 + 0.14 * cushion;
        stretchY *= 1 - 0.13 * cushion;
      }
    } else if (cue.action === "dance") {
      isDancing = true;
      const sway = Math.sin(beat * Math.PI);
      const bounce = Math.abs(Math.sin(beat * Math.PI * 2));
      dxNorm += sway * 0.045;
      hopNorm = Math.max(hopNorm, bounce * 0.09);
      leanDeg += sway * 8;
      squashX *= 1 + (1 - bounce) * 0.05;
      stretchY *= 1 + (bounce - 0.4) * 0.07;
      walkPhase = beat * Math.PI;
      if (!preferredClip) preferredClip = Math.abs(sway) > 0.35 ? (sway < 0 ? "walk-left" : "walk-right") : "react";
    } else if (cue.action === "celebrate") {
      isCelebrating = true;
      const bounce = Math.abs(Math.sin((beat - cue.beat) * Math.PI * 1.5));
      const wiggle = Math.sin((beat - cue.beat) * Math.PI * 3);
      hopNorm = Math.max(hopNorm, bounce * 0.22);
      leanDeg += wiggle * 7;
      squashX *= 1 - 0.06 * bounce + 0.04 * (1 - bounce);
      stretchY *= 1 + 0.09 * bounce - 0.04 * (1 - bounce);
      if (!preferredClip) preferredClip = bounce > 0.45 ? "jump" : "react";
    }
  }

  // 3. Respect explicit AniCraft `cheer`/`bow` gesture timing on stage
  for (const gc of piece.cues ?? []) {
    if (!resolveWhoMatch(gc.who, castId, voiceId)) continue;
    const dt = (beat - gc.beat) / beatsPerSec;
    if (dt < 0 || dt > 1.4) continue;
    if (gc.gesture === "cheer" && !isJumping) {
      isCelebrating = true;
      hopNorm = Math.max(hopNorm, Math.sin(Math.min(1, dt / 0.7) * Math.PI) * 0.14);
    } else if (gc.gesture === "bow") {
      const b = Math.sin(Math.min(1, dt / 1.2) * Math.PI);
      leanDeg += facing * 12 * b;
      stretchY *= 1 - 0.08 * b;
      squashX *= 1 + 0.06 * b;
    }
  }

  // S-3: body blocking stays 100% decoupled from vocal singing state (zero Math.sin(sec * 7.2) vocal body rock).
  void sec;
  void actorIndex;
  void totalActors;
  void singingNow;

  return {
    dxNorm: clamp(dxNorm, -0.4, 0.4),
    hopNorm: clamp(hopNorm, 0, 0.45),
    depthOffset: clamp(depthOffset, -0.18, 0.28),
    facing: facing < 0 ? -1 : 1,
    squashX: clamp(squashX, 0.82, 1.2),
    stretchY: clamp(stretchY, 0.82, 1.2),
    leanDeg: clamp(leanDeg, -18, 18),
    walkPhase,
    isWalking,
    isJumping,
    isDancing,
    isCelebrating,
    preferredClip,
  };
}
