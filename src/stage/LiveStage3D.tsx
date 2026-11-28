/**
 * Live Three.js 2.5D / 3D Stage (`MoppetPanel` / `LiveConsole` / `ScreeningRoom`):
 *  - Persistent native `THREE.WebGLRenderer` with `RoomEnvironment` PMREM PBR IBL, `PCFSoftShadowMap`,
 *    and `ACESFilmicToneMapping` (zero React-Three-Fiber reconciliation overhead, never remounts on playback).
 *  - Real 3D Studio 404 Broadcast Soundstage (bare scuffed floor, beveled wooden riser, real 3D
 *    `studio404-broadcast-mic.glb`, pleated 3D crimson curtains, live CRT equipment racks, overhead steel
 *    truss & barn-door Fresnel lamps — ZERO flat JPEG backdrop!) + Cosmic Observatory + Toybox Playroom.
 *  - Unified 3-Tier Performer Engine: 10 rigged `.glb` 3D Moppets + 6 articulated 2.5D multiplane rigs +
 *    world-lit 2.5D depth cutouts with AniCraft 4x2 visemes & CHIMERA `Expression` springs.
 *  - Interactive drag-to-orbit & wheel-zoom camera (double-click resets to Cinema Director auto-camera).
 *  - Registers WebGL `<canvas>` into `stageCanvasRegistry.current` (`preserveDrawingBuffer: true`) for
 *    1-click `StageClip` `MediaRecorder` MP4/WebM export.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Expression } from "@chimera/ui/render/expression.ts";
import { useAudio } from "../audio/audio.ts";
import { canonicalCastId, getCastCharacter } from "../choir/castManifest.ts";
import type { Actor } from "../choir/choreo.ts";
import { pose as sampleEnsemblePose, useEnsemble } from "../choir/ensemble.ts";
import type { Piece } from "../choir/music.ts";
import {
  performerAtlasUrls,
  resolvePerformerCel,
  resolvePerformerIdentity,
} from "../choir/performer.ts";
import type { Pose } from "../choir/pose.ts";
import {
  resolveActiveDirectedTake,
  resolveMultiplaneGagActive,
  resolveRiserCastIds,
} from "../choir/songCasting.ts";
import {
  getActiveBusGag,
  getActiveBusGesture,
  getActiveBusTake,
  useStageActionBus,
} from "../choir/stageActionBus.ts";
import { beatSeconds, LEAD_IN, pieceSeconds } from "../choir/timeline.ts";
import { buildVideoProject, type VideoBubbleClip } from "../choir/videoProject.ts";
import type { VocalArticSample } from "../choir/vocalTiming.ts";
import type { MoppetVoice } from "../choir/voices.ts";
import {
  StageActorsManager,
  preloadMoppetGlb,
  type PerformerUpdateInput,
  type RigPreference,
} from "./actors3D.ts";
import { CaravanSetpiece3D } from "./caravanSetpiece3D.ts";
import {
  evaluatePlannedCamera,
  planCompleteSongCamera,
  type CompleteSongCameraPlan,
} from "./cinemaDirector.ts";
import { stageCanvasRegistry } from "./recordClip.ts";
import { SceneCaptions, type SceneLine } from "./SceneCaptions.tsx";
import {
  simulateStageAutopilot,
  type StageAutopilotFrame,
  type StagePropState,
} from "./stageAutopilot.ts";
import { evaluateActorBlocking } from "./stageBlocking.ts";
import { loadStageTexture } from "./stageTextures.ts";
import { isStageWorldId, STAGE_WORLD_LIST, type StageWorldId } from "./stageWorlds.ts";
import {
  defaultMoodForSection,
  resolveActiveSceneForPiece,
  STAGE_LIGHTING_MOODS,
  useStageDirector,
  type StageLightingMood,
} from "./stageDirectorStore.ts";
import {
  STUDIO_RISER_TALL_TOP_Y,
  STUDIO_RISER_TOP_Y,
  StudioWorldRig,
  type CameraMode,
  type OrbitOffset,
} from "./studioWorlds3D.ts";
import {
  getSurfaceSampleAt,
  PLAYROOM_RISER_TOP_Y,
  resolveStageCollisions,
  resolveStudioMicPosition,
  type StageSurfaceContext,
} from "./stageSurface.ts";
import {
  naturalBlinkAmountAt,
  resolveTabbyFacialState,
  type TabbyFacialState,
} from "./visemeMapper.ts";

export interface LiveStage3DProps {
  readonly piece: Piece;
  readonly voices: readonly MoppetVoice[];
  readonly studio404: boolean;
  readonly beat: number;
  readonly timeSec: number;
  readonly performing: boolean;
  readonly actors?: readonly Actor[];
  readonly poses?: readonly Pose[];
  readonly cameraFollow: boolean;
  /** Optional canonical lesson/song ID for matching per-scene Variable Stage Storyboard cues. */
  readonly songId?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1);
const easeOutCubic = (t: number) => {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
};
const easeOutBack = (t: number) => {
  const u = clamp(t, 0, 1) - 1;
  const s = 1.45;
  return 1 + (s + 1) * u * u * u + s * u * u;
};

function interpolateAutopilotFrame(
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

interface CaptionViewState {
  readonly lines: SceneLine[];
  readonly timeSec: number;
}

const EMPTY_CAPTION_STATE: CaptionViewState = { lines: [], timeSec: 0 };

function activeWordIndexForBubble(b: VideoBubbleClip, timeSec: number): number {
  const words = b.words;
  if (!words || words.length === 0) return -1;
  for (let i = 0; i < words.length; i++) {
    if (timeSec >= words[i].startSec && timeSec < words[i].endSec) return i;
  }
  return -1;
}

function activePhraseStartForBubble(b: VideoBubbleClip, timeSec: number): number {
  const words = b.words;
  if (!words || words.length === 0) return 0;
  let start = 0;
  let length = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const next = words[i + 1];
    length += word.text.length + 1;
    if (!next || length + next.text.length > 46 || (length >= 22 && /[,;:.!?]$/.test(word.text))) {
      if (!next || timeSec < next.startSec) return start;
      start = i + 1;
      length = 0;
    }
  }
  return start;
}

interface DownstageCastEntry {
  readonly voice: MoppetVoice;
  readonly idx: number;
}

/**
 * Resolve downstage cast preserving `piece.stage` order (excluding `"band"`) first,
 * then appending any singing track in `piece.tracks` not already listed.
 */
function resolveDownstageCastEntries(
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

interface RiserGrooveSample {
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
function evaluateRiserBandGroove(
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

function poseToVocalArtic(p: Pose | undefined): VocalArticSample | undefined {
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

function resolveDownstageFormationSlot(
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
    // 4 strictly distinct X columns (tightened slightly when backing band >= 4 on riser so outer wings + inter-performer gaps shine)
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
    // Lead dead-center front (0), wings ±1.72, back pair centered cleanly in the ±0.88 inter-performer gaps
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
    // Lead dead-center front (0), flanks ±1.72, back trio staggered in exact gaps (-0.88, +0.88, -2.55) on riser/row 2
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

  // Fallback for 7+ downstage cast: front row centered lead + staggered half-step offset back row
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

function resolveRiserBandX(ri: number, riserCount: number, downstageTotal: number): number {
  if (riserCount <= 1) return downstageTotal === 1 || downstageTotal === 3 || downstageTotal >= 5 ? 0.92 : 0;
  if (riserCount === 2) return ri === 0 ? -1.28 : 1.28;
  if (riserCount === 3) {
    return downstageTotal % 2 === 1 ? [-2.45, -0.92, 0.92][ri] ?? 0 : [-2.15, 0, 2.15][ri] ?? 0;
  }
  if (riserCount === 4) {
    if (downstageTotal >= 4) return [-2.95, -1.1, 0.05, 2.95][ri] ?? 0;
    if (downstageTotal === 2) return [-2.65, -0.72, 0.72, 2.65][ri] ?? 0;
    return [-2.75, -0.95, 0.95, 2.75][ri] ?? 0;
  }
  const riserSpan = Math.min(5.8, (riserCount - 1) * 1.42);
  return -riserSpan * 0.5 + (ri / (riserCount - 1)) * riserSpan;
}

function defaultWorldForSong(songId: string): StageWorldId | null {
  if (songId === "cardboard-horse") return "caravan";
  if (songId === "bible-folio") return "storybook";
  return null;
}

interface StageLiveState {
  piece: Piece;
  voices: readonly MoppetVoice[];
  studio404: boolean;
  beat: number;
  timeSec: number;
  performing: boolean;
  actors?: readonly Actor[];
  poses?: readonly Pose[];
  cameraFollow: boolean;
  worldId: StageWorldId;
  cameraMode: CameraMode;
  rigPreference: RigPreference;
  songId: string;
  project: ReturnType<typeof buildVideoProject>;
  autopilot: ReturnType<typeof simulateStageAutopilot>;
  cameraPlan: CompleteSongCameraPlan;
}

export const LiveStage3D: React.FC<LiveStage3DProps> = ({
  piece,
  voices,
  studio404,
  beat,
  timeSec,
  performing,
  actors,
  poses,
  cameraFollow,
  songId,
}) => {
  const worldId = useAudio((s) => s.world);
  const setWorld = useAudio((s) => s.setWorld);
  const variableStageEnabled = useStageDirector((s) => s.variableStageEnabled);
  const setVariableStageEnabled = useStageDirector((s) => s.setVariableStageEnabled);

  const resolvedSongId = useMemo(
    () =>
      songId ||
      piece.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    [songId, piece.title],
  );

  const [cameraMode, setCameraMode] = useState<CameraMode>("authored");
  const [rigPreference, setRigPreference] = useState<RigPreference>("auto-3d");
  const [isOrbited, setIsOrbited] = useState(false);
  const [tierBadge, setTierBadge] = useState<string>("3D Stage");
  const [tierDisabledReason, setTierDisabledReason] = useState<string | null>(null);
  const [sceneBadge, setSceneBadge] = useState<string>("");
  const [manualWorldSong, setManualWorldSong] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const qWorld = new URLSearchParams(window.location.search).get("world");
    return isStageWorldId(qWorld) ? resolvedSongId : null;
  });
  const [sceneWorldOverride, setSceneWorldOverride] = useState<StageWorldId | null>(null);

  const autoSongWorld = defaultWorldForSong(resolvedSongId);
  const effectiveReactWorldId: StageWorldId =
    manualWorldSong === resolvedSongId
      ? worldId
      : variableStageEnabled && sceneWorldOverride
        ? sceneWorldOverride
        : variableStageEnabled && autoSongWorld
          ? autoSongWorld
          : worldId;

  const [activeWorldId, setActiveWorldId] = useState<StageWorldId>(effectiveReactWorldId);
  const [captionState, setCaptionState] = useState<CaptionViewState>(EMPTY_CAPTION_STATE);

  const manualWorldSongRef = useRef<string | null>(manualWorldSong);
  const prevSongIdRef = useRef<string>(resolvedSongId);
  const prevAudioWorldRef = useRef<StageWorldId>(worldId);

  if (prevSongIdRef.current !== resolvedSongId) {
    prevSongIdRef.current = resolvedSongId;
    manualWorldSongRef.current = null;
    prevAudioWorldRef.current = worldId;
  } else if (prevAudioWorldRef.current !== worldId) {
    prevAudioWorldRef.current = worldId;
    manualWorldSongRef.current = resolvedSongId;
  }

  useEffect(() => {
    setManualWorldSong(manualWorldSongRef.current);
    setSceneWorldOverride(null);
  }, [resolvedSongId, worldId]);

  const containerRef = useRef<HTMLDivElement>(null);
  const captionsContainerRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<OrbitOffset>({ azimuth: 0, polar: 0, zoom: 1 });
  const dragRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const expressionsRef = useRef<Map<string, Expression>>(new Map());
  const bubbleMotionRef = useRef<
    Map<string, { leftPct: number; topPct: number; tailPct: number; tail2Pct: number }>
  >(new Map());

  const project = useMemo(
    () => buildVideoProject(piece, voices, studio404),
    [piece, voices, studio404],
  );

  const downstagePlanIds = useMemo(() => {
    const entries = resolveDownstageCastEntries(piece, voices);
    const stageIds = entries.map(
      ({ voice }) => resolvePerformerIdentity(voice, studio404, piece.title).artKey,
    );
    const voiceIds = entries.map(({ voice }) => voice.id);
    return {
      stageIds,
      voiceIds,
      stageIdsKey: stageIds.join("|"),
      voiceIdsKey: voiceIds.join("|"),
    };
  }, [piece, voices, studio404]);

  const cameraPlan = useMemo(
    () =>
      planCompleteSongCamera(
        piece,
        downstagePlanIds.stageIds,
        downstagePlanIds.voiceIds,
      ),
    [piece, downstagePlanIds.stageIdsKey, downstagePlanIds.voiceIdsKey],
  );

  const totalFrames = useMemo(
    () => Math.max(90, Math.round(pieceSeconds(piece) * 30)),
    [piece],
  );

  const autopilot = useMemo(
    () => simulateStageAutopilot(piece, effectiveReactWorldId, totalFrames, 30),
    [piece, effectiveReactWorldId, totalFrames],
  );

  // Preload active downstage + riser band performers' primary idle/rig assets first, then background clips
  useEffect(() => {
    let cancelled = false;
    const downstageEntries = resolveDownstageCastEntries(piece, voices);
    const downstageArtKeys = downstageEntries.map(
      ({ voice }) => resolvePerformerIdentity(voice, studio404, piece.title).artKey,
    );
    const riserIds = resolveRiserCastIds(piece, downstageArtKeys, studio404);
    const activeIds = new Set<string>([...downstageArtKeys, ...riserIds]);
    const secondaryUrls: string[] = [];

    for (const castId of activeIds) {
      const m = getCastCharacter(castId);
      if (m?.model3d?.url) preloadMoppetGlb(m.model3d.url);
      if (m?.model3d?.faceSheet?.url) loadStageTexture(m.model3d.faceSheet.url);
      if (m?.anicraftFaceOverlay?.url) loadStageTexture(m.anicraftFaceOverlay.url);
      if (m?.multiplane) {
        for (const n of m.multiplane.nodes) {
          if (n.publicSrc) loadStageTexture(n.publicSrc);
        }
        for (const extra of Object.values(m.multiplane.extraParts)) {
          loadStageTexture(extra.url);
        }
      }
      const primaryUrl = m?.clips?.idle?.url;
      if (primaryUrl) loadStageTexture(primaryUrl);
      if (m?.portraitUrl) loadStageTexture(m.portraitUrl);
      for (const u of performerAtlasUrls(castId)) {
        if (u !== primaryUrl && u !== m?.portraitUrl && u !== m?.anicraftFaceOverlay?.url) {
          secondaryUrls.push(u);
        }
      }
    }

    const warmSecondary = () => {
      if (cancelled) return;
      for (const u of secondaryUrls) loadStageTexture(u);
    };
    const idleTimer = window.setTimeout(warmSecondary, 40);
    return () => {
      cancelled = true;
      window.clearTimeout(idleTimer);
    };
  }, [piece, voices, studio404]);

  const liveRef = useRef<StageLiveState>({
    piece,
    voices,
    studio404,
    beat,
    timeSec,
    performing,
    actors,
    poses,
    cameraFollow,
    worldId,
    cameraMode,
    rigPreference,
    songId: resolvedSongId,
    project,
    autopilot,
    cameraPlan,
  });
  liveRef.current = {
    piece,
    voices,
    studio404,
    beat,
    timeSec,
    performing,
    actors,
    poses,
    cameraFollow,
    worldId,
    cameraMode,
    rigPreference,
    songId: resolvedSongId,
    project,
    autopilot,
    cameraPlan,
  };

  // Mount ONE persistent Three.js WebGLRenderer + RoomEnvironment IBL + StudioWorldRig + StageActorsManager
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.cursor = "grab";
    container.appendChild(renderer.domElement);

    // Bind live WebGL canvas for 1-click StageClip MediaRecorder export
    stageCanvasRegistry.current = renderer.domElement;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.72;

    const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 120);
    camera.position.set(0, 1.65, 9.2);

    const worldRig = new StudioWorldRig(scene);
    const actorsMgr = new StageActorsManager(scene);

    let width = Math.max(320, container.clientWidth || 1280);
    let height = Math.max(180, container.clientHeight || 720);
    renderer.setSize(width, height, false);

    const ro = new ResizeObserver(() => {
      width = Math.max(320, container.clientWidth || 1280);
      height = Math.max(180, container.clientHeight || 720);
      renderer.setSize(width, height, false);
    });
    ro.observe(container);

    // Interactive orbit / wheel zoom controls
    const dom = renderer.domElement;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragRef.current = { active: true, x: e.clientX, y: e.clientY };
      dom.style.cursor = "grabbing";
      dom.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      dragRef.current.x = e.clientX;
      dragRef.current.y = e.clientY;
      orbitRef.current.azimuth = clamp(orbitRef.current.azimuth - dx * 0.0055, -1.15, 1.15);
      orbitRef.current.polar = clamp(orbitRef.current.polar + dy * 0.004, -0.22, 0.58);
      setIsOrbited(true);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      dom.style.cursor = "grab";
      try {
        dom.releasePointerCapture(e.pointerId);
      } catch {
        // ignore if already released
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      orbitRef.current.zoom = clamp(orbitRef.current.zoom * (1 + Math.sign(e.deltaY) * 0.07), 0.58, 1.55);
      setIsOrbited(true);
    };
    const onDblClick = () => {
      orbitRef.current = { azimuth: 0, polar: 0, zoom: 1 };
      setIsOrbited(false);
    };

    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("pointercancel", onPointerUp);
    dom.addEventListener("wheel", onWheel, { passive: false });
    dom.addEventListener("dblclick", onDblClick);

    let raf = 0;
    let lastNow = performance.now();
    let lastBadge = "";
    let lastDisabledReason: string | null = null;
    let lastSceneBadge = "";
    let lastWorldId: StageWorldId | "" = "";
    let lastSceneWorldOv: StageWorldId | null = null;
    let lastPieceRef: Piece | null = null;
    let lastScoreTimeSec = -1;
    let lastValidEnsTimeSec = 0;
    let lastCaptionSig = "";
    let lastCaptionBubbles: readonly VideoBubbleClip[] | null = null;
    const tmpHeadVec = new THREE.Vector3();

    const renderLoop = (now: number) => {
      raf = requestAnimationFrame(renderLoop);
      const busNow = typeof performance !== "undefined" ? performance.now() : now;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;

      const s = liveRef.current;
      const pieceChanged = s.piece !== lastPieceRef;
      if (pieceChanged) {
        lastPieceRef = s.piece;
        lastScoreTimeSec = -1;
        lastValidEnsTimeSec = 0;
        bubbleMotionRef.current.clear();
      }

      const wallSec = now / 1000;
      const ens = useEnsemble.getState();
      const ensActive =
        ens.status === "playing" || ens.status === "buffering" || ens.status === "paused";

      let liveTimeSec: number;
      let livePerforming: boolean;
      if (ensActive) {
        if (ens.time > 0.005) {
          lastValidEnsTimeSec = ens.time;
          liveTimeSec = ens.time;
        } else if (ens.status === "buffering" && lastValidEnsTimeSec > 0.005) {
          liveTimeSec = lastValidEnsTimeSec;
        } else {
          liveTimeSec = s.timeSec;
        }
        livePerforming = liveTimeSec > 0.005 || s.performing;
      } else {
        liveTimeSec = s.timeSec;
        livePerforming = s.performing;
      }

      const scoreTimeSec = Math.max(0, liveTimeSec);
      const scoreBeat =
        livePerforming && scoreTimeSec > 0.005
          ? Math.max(0, (scoreTimeSec - LEAD_IN) / beatSeconds(s.piece))
          : ensActive
            ? 0
            : Math.max(0, s.beat);
      const animTimeSec = livePerforming ? scoreTimeSec : wallSec;
      const animBeat = livePerforming ? scoreBeat : wallSec * ((s.piece.bpm || 108) / 60);
      const snapCamera =
        pieceChanged ||
        (lastScoreTimeSec >= 0 && Math.abs(scoreTimeSec - lastScoreTimeSec) > 1.2);
      lastScoreTimeSec = scoreTimeSec;

      const apFrame = interpolateAutopilotFrame(s.autopilot, scoreTimeSec);
      const bus = useStageActionBus.getState();

      // Determine visible downstage cast & upstage oak-riser band lineup
      const castEntries = resolveDownstageCastEntries(s.piece, s.voices);
      const total = castEntries.length;
      const downstageIdents = castEntries.map(({ voice }) =>
        resolvePerformerIdentity(voice, s.studio404, s.piece.title),
      );
      const downstageArtKeys = downstageIdents.map((id) => id.artKey);
      const riserIds = resolveRiserCastIds(s.piece, downstageArtKeys, s.studio404);
      const riserCount = riserIds.length;

      // Resolve per-scene Variable Stage override up-front from the actual score beat (not wall clock!)
      const director = useStageDirector.getState();
      const activeScene = resolveActiveSceneForPiece(s.piece, scoreBeat);
      const slugKey = s.piece.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const sceneOv =
        director.overrides[`${s.songId}:${activeScene.sceneIndex}`] ??
        director.overrides[`${slugKey}:${activeScene.sceneIndex}`];
      const sceneWorldOv = director.variableStageEnabled ? sceneOv?.worldId ?? null : null;
      if (sceneWorldOv !== lastSceneWorldOv) {
        lastSceneWorldOv = sceneWorldOv;
        setSceneWorldOverride(sceneWorldOv);
      }
      const autoSongWorld = defaultWorldForSong(s.songId);
      const effectiveWorldId: StageWorldId =
        manualWorldSongRef.current === s.songId
          ? s.worldId
          : sceneWorldOv
            ? sceneWorldOv
            : director.variableStageEnabled && autoSongWorld
              ? autoSongWorld
              : s.worldId;
      const effectiveMood: Exclude<StageLightingMood, "auto"> =
        director.variableStageEnabled
          ? sceneOv?.mood && sceneOv.mood !== "auto"
            ? sceneOv.mood
            : defaultMoodForSection(activeScene.sectionName, total)
          : "warm-spotlight";
      const overrideCam: CameraMode =
        s.cameraMode !== "authored"
          ? s.cameraMode
          : director.variableStageEnabled && sceneOv?.cameraPreset
            ? sceneOv.cameraPreset === "closeup" || sceneOv.cameraPreset === "reaction"
              ? "closeup"
              : sceneOv.cameraPreset === "low-angle"
                ? "low-angle"
                : sceneOv.cameraPreset === "wide"
                  ? "wide"
                  : "authored"
            : "authored";

      const stageIds: string[] = [];
      const voiceIds: string[] = [];
      const actorXNorms: number[] = [];
      const actorWorldXs: number[] = [];
      const actorWorldYs: number[] = [];
      const actorWorldZs: number[] = [];
      const actorHopYs: number[] = [];
      const actorOnRiser: boolean[] = [];
      let maxEnergy = 0;

      const riserXs =
        riserCount > 0
          ? Array.from({ length: riserCount }, (_, ri) => resolveRiserBandX(ri, riserCount, total))
          : [];
      const riserSpan =
        riserXs.length > 1 ? Math.max(...riserXs) - Math.min(...riserXs) : 0;
      const activeRiserTopY =
        effectiveWorldId === "playroom"
          ? PLAYROOM_RISER_TOP_Y
          : riserCount >= 4 && total >= 4
            ? STUDIO_RISER_TALL_TOP_Y
            : STUDIO_RISER_TOP_Y;
      const showRiser = total > 3 || riserCount > 0;
      const computedRiserWidth =
        riserCount > 0
          ? clamp(
              riserCount >= 4 && total >= 4 ? Math.max(7.0, riserSpan + 1.55) : Math.max(3.2, riserSpan + 1.55),
              3.2,
              7.6,
            )
          : clamp(2.8 + total * 0.72, 3.4, 6.8);

      const caravanSlots =
        effectiveWorldId === "caravan"
          ? CaravanSetpiece3D.getRiderSlots(total, riserCount)
          : null;

      const performerInputs: PerformerUpdateInput[] = [];

      for (let i = 0; i < total; i++) {
        const { voice, idx } = castEntries[i];
        const ident = downstageIdents[i];
        const manifest = getCastCharacter(ident.artKey);
        const pose = ensActive ? sampleEnsemblePose(voice.id) : s.poses?.[idx];
        const artic = poseToVocalArtic(pose);

        const singing = Boolean(pose?.singing);
        const level = pose ? clamp(pose.level, 0, 1) : 0;
        const mouthOpen = Boolean(pose && pose.singing && pose.open > 0.08);

        if (level > maxEnergy) {
          maxEnergy = level;
        }

        // Clean, uncrowded non-occluding formation (Caravan riders sit right on carriage deck)
        const slot =
          caravanSlots?.downstage[i] ??
          (effectiveWorldId === "storybook" && total === 1
            ? { baseX: -0.55, baseZ: 0.48, onRiser: false }
            : resolveDownstageFormationSlot(i, total, riserCount));
        const { baseX, baseZ, onRiser } = slot;

        const blocking = evaluateActorBlocking(
          s.piece,
          ident.artKey,
          scoreBeat,
          scoreTimeSec,
          i,
          total,
          singing,
          voice.id,
        );

        const moveGain =
          effectiveWorldId === "caravan"
            ? total === 1
              ? 0.48
              : total <= 3
                ? 0.34
                : 0.16
            : total === 1
              ? 1.15
              : total <= 3
                ? 1.15
                : 0.36;
        let wx =
          effectiveWorldId === "caravan"
            ? clamp(baseX + blocking.dxNorm * moveGain, -2.55, 1.32)
            : total === 1
              ? clamp(baseX + blocking.dxNorm * moveGain, -1.15, 1.35)
              : clamp(baseX + blocking.dxNorm * moveGain, -3.5, 3.5);
        let localHopY = blocking.hopNorm * 1.4;
        let wz = baseZ - blocking.depthOffset * (total === 1 ? 1.1 : 0.45);
        let facing = blocking.facing;
        let squashX = blocking.squashX;
        let stretchY = blocking.stretchY;
        let leanRad = -(blocking.leanDeg * Math.PI) / 180;

        // For solo performances in motion, blend deterministic stage autopilot coordinates cleanly inside active world
        if (total === 1 && livePerforming && apFrame) {
          wx =
            effectiveWorldId === "caravan"
              ? clamp(-0.65 + apFrame.actor.x * 0.45, -2.35, 1.15)
              : clamp(apFrame.actor.x, -1.15, 1.35);
          localHopY = Math.max(localHopY, apFrame.actor.y);
          wz =
            effectiveWorldId === "caravan"
              ? clamp(-0.08 + (apFrame.actor.z - 0.22) * 0.45, -0.68, 0.42)
              : effectiveWorldId === "storybook"
                ? clamp(apFrame.actor.z + 0.18, -0.65, 1.45)
                : apFrame.actor.z;
          facing = apFrame.actor.facing;
          squashX *= apFrame.actor.squashX;
          stretchY *= apFrame.actor.stretchY;
          leanRad += apFrame.actor.leanRad;
        }

        // CHIMERA damped-spring Expression nod/tilt/breath
        let expr = expressionsRef.current.get(voice.id);
        if (!expr) {
          expr = new Expression();
          expressionsRef.current.set(voice.id, expr);
        }
        expr.update(null, dt);
        const rotY = expr.tilt * 0.45;
        leanRad += expr.tilt * 0.25;

        // Directed takes, Launchkey pad overrides, and score cues
        const bs = beatSeconds(s.piece);
        const busTake = getActiveBusTake(ident.artKey, busNow, bus.takes);
        const scoreTake = resolveActiveDirectedTake(s.piece, voice.id, ident.artKey, scoreBeat, scoreTimeSec, bs, LEAD_IN);
        const activeTake = busTake ?? scoreTake ?? undefined;
        const busGag = getActiveBusGag(ident.artKey, busNow, bus.gags);
        const gagActive =
          busGag || resolveMultiplaneGagActive(s.piece, voice.id, ident.artKey, scoreBeat, scoreTimeSec, bs, LEAD_IN);
        const busGesture = getActiveBusGesture(ident.artKey, busNow, bus.gestures);
        const activeCue = (s.piece.cues ?? []).find(
          (c) => (c.who === voice.id || c.who === ident.artKey) && scoreBeat >= c.beat && scoreBeat < c.beat + 3,
        );
        const activeActionClip =
          activeTake?.clipKey ??
          busGesture?.gesture ??
          activeCue?.gesture ??
          blocking.preferredClip ??
          (total === 1 && livePerforming && apFrame && apFrame.actor.mode !== "rigged" ? apFrame.actor.mode : null);
        const activeElapsedSec = activeTake?.elapsedSec ?? busGesture?.elapsedSec;

        // When Walk/Step is fired interactively via Console/Gestures, stride smoothly out & back so the walk clip travels cleanly
        if (busTake?.clipKey === "walk" && !blocking.isWalking) {
          const wu = clamp(busTake.elapsedSec / Math.max(0.4, busTake.durationSec), 0, 1);
          const strideArc = Math.sin(wu * Math.PI);
          const stepSpan = total === 1 ? 0.68 : 0.42;
          const dir = baseX > 0.25 ? -1 : 1;
          wx = clamp(wx + dir * stepSpan * strideArc, -3.5, 3.5);
          facing = wu < 0.5 ? dir : -dir;
          localHopY += Math.abs(Math.sin(busTake.elapsedSec * 7.8)) * 0.055 * strideArc;
        }

        const cel = resolvePerformerCel(
          ident.artKey,
          { singing, level, open: pose?.open ?? 0, viseme: pose?.viseme ?? 0 },
          animBeat,
          animTimeSec,
          i,
          mouthOpen,
          null,
          false,
          activeTake,
        );

        const baseHeight = total === 1 ? 2.48 : total <= 3 ? 2.24 : 1.98;
        const scaleFactor = manifest?.scaleFactor ?? 1;
        const worldHeight = baseHeight * clamp(scaleFactor, 0.78, 1.24);

        let tabbyFacial: TabbyFacialState | undefined;
        if (ident.artKey === "tabby") {
          const baseFacial = resolveTabbyFacialState(animTimeSec, voice.id, s.project.bubbles, undefined, singing);
          if (artic && singing) {
            const blink = naturalBlinkAmountAt(animTimeSec, true);
            const brow = artic.f0 > 60 ? clamp((Math.log2(artic.f0 / 260)) * 0.7, -0.5, 0.9) : 0;
            tabbyFacial = {
              ...baseFacial,
              speaking: true,
              mouthOpen: clamp(artic.open, 0, 1),
              mouthJaw: clamp(artic.jaw, 0, 1),
              mouthRound: clamp(artic.round, 0, 1),
              mouthWidth: clamp(artic.lipWidth, 0, 1),
              labiodental: clamp(artic.labiodental, 0, 1),
              mouthPressure: clamp(artic.mouthPressure, 0, 1),
              f0: artic.f0,
              voicing: artic.voicing,
              blinkAmount: blink,
              browLift: brow,
            };
          } else {
            tabbyFacial = baseFacial;
          }
        }

        stageIds.push(ident.artKey);
        voiceIds.push(voice.id);
        actorXNorms.push(clamp(wx / 6.4 + 0.5, 0.1, 0.9));
        actorWorldXs.push(wx);
        actorWorldYs.push(localHopY);
        actorWorldZs.push(wz);
        actorHopYs.push(localHopY);
        actorOnRiser.push(onRiser);

        performerInputs.push({
          key: `${voice.id}:${ident.artKey}`,
          castId: ident.artKey,
          manifest,
          cel,
          accentColor: ident.color,
          worldId: effectiveWorldId,
          x: wx,
          y: localHopY,
          z: wz,
          floorY: 0,
          worldHeight,
          facing,
          rotY,
          squashX,
          stretchY,
          leanRad,
          timeSec: animTimeSec,
          beat: animBeat,
          performing: livePerforming,
          singing,
          level,
          mouthOpen,
          gagActive,
          phaseIndex: i,
          actionClip: activeActionClip,
          actionElapsedSec: activeElapsedSec,
          artic,
          tabbyFacial,
          rigPreference: s.rigPreference,
        });
      }

      // Upstage Riser Band (`resolveRiserCastIds`) staggered cleanly in the sightline gaps behind downstage singers
      if (riserCount > 0) {
        const inScoreWindow =
          s.performing && (s.timeSec >= LEAD_IN || scoreBeat > 0.001) && scoreBeat < s.piece.beats;
        const hasMusicNow =
          s.piece.chords.length > 0
            ? s.piece.chords.some((c) => scoreBeat >= c.beat - 1e-6 && scoreBeat < c.beat + c.beats - 1e-6)
            : s.piece.tracks.some((t) =>
                t.events.some((e) => scoreBeat >= e.beat - 0.1 && scoreBeat < e.beat + e.beats + 0.1),
              );
        const bandPlayingNow = inScoreWindow && hasMusicNow;

        const riserZ =
          effectiveWorldId === "caravan"
            ? -0.74
            : effectiveWorldId === "storybook"
              ? -0.72
              : total >= 4
                ? -1.38
                : -1.32;

        for (let ri = 0; ri < riserCount; ri++) {
          const castId = riserIds[ri];
          const manifest = getCastCharacter(castId);
          const cSlot = caravanSlots?.riser[ri];
          const rx = cSlot ? cSlot.baseX : (riserXs[ri] ?? 0);
          const rz = cSlot ? cSlot.baseZ : riserZ;
          const scaleFactor = manifest?.scaleFactor ?? 1;
          const worldHeight = 1.92 * clamp(scaleFactor, 0.78, 1.18);
          const groove = evaluateRiserBandGroove(animBeat, ri, s.piece.meter, bandPlayingNow);

          const perfClip = manifest?.clips?.performance;
          const riserTake =
            bandPlayingNow && perfClip
              ? {
                  clipKey: "performance",
                  elapsedSec: animTimeSec + ri * 0.25,
                  durationSec: perfClip.frames / Math.max(1, perfClip.fps),
                }
              : null;
          const riserCel = resolvePerformerCel(
            castId,
            { singing: false, level: groove.level, open: 0, viseme: 0 },
            animBeat,
            animTimeSec,
            ri,
            false,
            null,
            !bandPlayingNow,
            riserTake,
          );

          actorHopYs.push(groove.hopY);
          actorOnRiser.push(true);
          performerInputs.push({
            key: `riser:${castId}`,
            castId,
            manifest,
            cel: riserCel,
            accentColor: manifest?.color ?? "#e3bd7f",
            worldId: effectiveWorldId,
            x: rx,
            y: groove.hopY,
            z: rz,
            floorY: 0,
            worldHeight,
            facing: 1,
            rotY: groove.rotY,
            squashX: groove.squashX,
            stretchY: groove.stretchY,
            leanRad: groove.leanRad,
            timeSec: animTimeSec,
            beat: animBeat,
            performing: bandPlayingNow,
            singing: false,
            level: groove.level,
            mouthOpen: false,
            gagActive: false,
            phaseIndex: total + ri,
            actionClip: bandPlayingNow && perfClip ? "performance" : null,
            poseDrivenGroove: true,
            rigPreference: s.rigPreference,
          });
        }
      }

      // Sync Caravan / Storybook setpiece kinematics BEFORE sampling surface heightfield
      worldRig.syncSetpieces({
        worldId: effectiveWorldId,
        timeSec: animTimeSec,
        dt,
        beat: animBeat,
        voiceEnergy: maxEnergy,
        songTitle: s.piece.title,
        sceneIndex: activeScene.sceneIndex,
        sectionName: activeScene.sectionName,
        lightingEnabled: true,
        lightingMood: effectiveMood,
      });

      // Unified XZ Collision & Heightfield Grounding (`S-53`)
      const tentativeLeftmostX = performerInputs.reduce((lo, p) => Math.min(lo, p.x), 0);
      const micPos =
        effectiveWorldId === "theater"
          ? resolveStudioMicPosition({
              showRiser,
              riserWidth: computedRiserWidth,
              downstageCount: total,
              leftmostActorX: tentativeLeftmostX,
            })
          : null;
      const resolvedXZ = resolveStageCollisions(
        performerInputs.map((p, idx) => ({ x: p.x, z: p.z, onRiser: actorOnRiser[idx] })),
        {
          worldId: effectiveWorldId,
          showRiser,
          riserWidth: computedRiserWidth,
          micPos,
          totalCount: total + riserCount,
        },
      );
      const surfaceCtx: StageSurfaceContext = {
        worldId: effectiveWorldId,
        showRiser,
        riserWidth: computedRiserWidth,
        riserTopY: activeRiserTopY,
        props: apFrame?.props ?? [],
        customSurface: worldRig.getCustomSurfaceSampler(effectiveWorldId),
      };
      for (let idx = 0; idx < performerInputs.length; idx++) {
        const rx = resolvedXZ[idx].x;
        const rz = resolvedXZ[idx].z;
        const surf = getSurfaceSampleAt(rx, rz, surfaceCtx);
        const floorY = surf.y;
        const wy = floorY + actorHopYs[idx];
        performerInputs[idx] = { ...performerInputs[idx], x: rx, y: wy, z: rz, floorY };
        if (idx < total) {
          actorXNorms[idx] = clamp(rx / 6.4 + 0.5, 0.1, 0.9);
          actorWorldXs[idx] = rx;
          actorWorldYs[idx] = wy;
          actorWorldZs[idx] = rz;
        }
      }

      const cinema = evaluatePlannedCamera(
        s.cameraPlan,
        actorXNorms,
        scoreBeat,
        s.cameraFollow,
        false,
      );

      let focusMinX = Infinity;
      let focusMaxX = -Infinity;
      let focusSumX = 0;
      let focusSumY = 0;
      let focusSumZ = 0;
      let focusCount = 0;
      for (const focusId of cinema.focusActorIds) {
        const canonFocus = canonicalCastId(focusId);
        let matchedIdx = stageIds.indexOf(focusId);
        if (matchedIdx < 0) matchedIdx = voiceIds.indexOf(focusId);
        if (matchedIdx < 0) matchedIdx = stageIds.indexOf(canonFocus);
        if (matchedIdx < 0) {
          matchedIdx = voiceIds.findIndex((vid) => canonicalCastId(vid) === canonFocus);
        }
        if (matchedIdx >= 0 && actorWorldXs[matchedIdx] !== undefined) {
          const fx = actorWorldXs[matchedIdx];
          focusMinX = Math.min(focusMinX, fx);
          focusMaxX = Math.max(focusMaxX, fx);
          focusSumX += fx;
          focusSumY += actorWorldYs[matchedIdx] ?? 0;
          focusSumZ += actorWorldZs[matchedIdx] ?? 0.2;
          focusCount++;
        }
      }

      const targetX =
        cinema.shotType === "wide" || focusCount === 0
          ? 0
          : focusCount >= 2
            ? (focusMinX + focusMaxX) * 0.5
            : focusSumX;
      const targetSpanX = focusCount >= 2 ? Math.max(0, focusMaxX - focusMinX) : 0;
      const spotX = focusCount > 0 ? focusSumX / focusCount : 0;
      const spotY = focusCount > 0 ? focusSumY / focusCount : 0;
      const spotZ = focusCount > 0 ? focusSumZ / focusCount : 0.2;

      const leftmostActorX = performerInputs.reduce(
        (lo, p) => Math.min(lo, p.x),
        0,
      );

      worldRig.update(camera, {
        worldId: effectiveWorldId,
        lightingMood: effectiveMood,
        timeSec: animTimeSec,
        beat: animBeat,
        dt,
        actorX: spotX,
        actorY: spotY,
        actorZ: spotZ,
        targetX,
        targetSpanX,
        snapCamera,
        voiceEnergy: maxEnergy,
        cinema,
        cameraMode: overrideCam,
        lightingEnabled: true,
        showRiser,
        riserWidth: computedRiserWidth,
        riserTopY: activeRiserTopY,
        downstageCount: total,
        leftmostActorX,
        aspectRatio: width / Math.max(1, height),
        props: apFrame?.props ?? [],
        orbit: orbitRef.current,
        songTitle: s.piece.title,
        sceneIndex: activeScene.sceneIndex,
        sectionName: activeScene.sectionName,
        setpiecesPreSynced: true,
      });

      const moodShort = STAGE_LIGHTING_MOODS.find((m) => m.id === effectiveMood)?.shortLabel ?? effectiveMood;
      const nextSceneBadge = director.variableStageEnabled
        ? `S${activeScene.sceneIndex} · ${moodShort}`
        : "Stage Lock";
      if (nextSceneBadge !== lastSceneBadge) {
        lastSceneBadge = nextSceneBadge;
        setSceneBadge(nextSceneBadge);
      }
      if (effectiveWorldId !== lastWorldId) {
        lastWorldId = effectiveWorldId;
        setActiveWorldId(effectiveWorldId);
      }

      const counts = actorsMgr.syncAll(performerInputs);
      const hasAnyRig = counts.glbCount > 0 || counts.multiplaneCount > 0;
      const hasDualRig = performerInputs.some((p) => Boolean(p.manifest?.model3d && p.manifest?.multiplane));
      const nextDisabledReason = !hasAnyRig
        ? "No 3D/Multiplane rigs in this cast"
        : !hasDualRig
          ? "No dual GLB/Multiplane rigs to toggle in this cast"
          : null;
      if (nextDisabledReason !== lastDisabledReason) {
        lastDisabledReason = nextDisabledReason;
        setTierDisabledReason(nextDisabledReason);
      }
      const parts: string[] = [];
      if (counts.glbCount > 0) parts.push(`${counts.glbCount} 3D GLB`);
      if (counts.multiplaneCount > 0) parts.push(`${counts.multiplaneCount} 2.5D Rig`);
      if (counts.atlasCount > 0) parts.push(`${counts.atlasCount} World-Lit 2.5D`);
      if (riserCount > 0) parts.push("Band");
      const nextBadge = parts.join(" · ") || "3D Stage";
      if (nextBadge !== lastBadge) {
        lastBadge = nextBadge;
        setTierBadge(nextBadge);
      }

      // 3D-Projected Floating Speech Bubbles + Group Speech Bubbles (`S-51`)
      const activeBubbles: VideoBubbleClip[] = [];
      for (const b of s.project.bubbles) {
        const endSec = b.startSec + Math.max(0.8, b.durationSec);
        if (scoreTimeSec >= b.startSec - 0.08 && scoreTimeSec <= endSec + 0.12) {
          activeBubbles.push(b);
        }
      }

      if (activeBubbles.length === 0) {
        if (lastCaptionSig !== "" || lastCaptionBubbles !== s.project.bubbles) {
          lastCaptionSig = "";
          lastCaptionBubbles = s.project.bubbles;
          bubbleMotionRef.current.clear();
          setCaptionState(EMPTY_CAPTION_STATE);
        }
      } else {
        const capHost = captionsContainerRef.current;
        const stageW = Math.max(320, width);
        const stageH = Math.max(180, height);

        interface PlacedBubbleBox {
          bubble: VideoBubbleClip;
          el: HTMLElement | null;
          isGroup: boolean;
          anchorSx: number;
          minMemberSx: number;
          maxMemberSx: number;
          minSy: number;
          w: number;
          halfW: number;
          h: number;
          cx: number;
          topY: number;
          tailPct: number;
          tail2Pct: number;
          tail2Opacity: number;
        }

        // 1. Project every active speaker's 3D head crown + read DOM dimensions in one read batch
        const placed: PlacedBubbleBox[] = activeBubbles.map((b) => {
          const ids = b.speakerIds.length > 0 ? b.speakerIds : [b.speakerId];
          const memberSxs: number[] = [];
          const memberSys: number[] = [];
          for (const sid of ids) {
            if (actorsMgr.getHeadWorldPos(sid, tmpHeadVec)) {
              tmpHeadVec.project(camera);
              if (tmpHeadVec.z > -1 && tmpHeadVec.z < 1) {
                memberSxs.push(clamp(tmpHeadVec.x * 0.5 + 0.5, 0.06, 0.94));
                memberSys.push(clamp(0.5 - tmpHeadVec.y * 0.5, 0.05, 0.88));
              }
            }
          }
          if (memberSxs.length === 0) {
            memberSxs.push(clamp(b.x, 0.12, 0.88));
            memberSys.push(0.4);
          }

          let sumSx = 0;
          let minMemberSx = Infinity;
          let maxMemberSx = -Infinity;
          let minSy = Infinity;
          for (let i = 0; i < memberSxs.length; i++) {
            sumSx += memberSxs[i];
            if (memberSxs[i] < minMemberSx) minMemberSx = memberSxs[i];
            if (memberSxs[i] > maxMemberSx) maxMemberSx = memberSxs[i];
            if (memberSys[i] < minSy) minSy = memberSys[i];
          }
          const meanSx = sumSx / memberSxs.length;
          const isGroup = b.isGroup || ids.length >= 2;
          const el = capHost
            ? (capHost.querySelector(`[data-bubble-key="${CSS.escape(b.id)}"]`) as HTMLElement | null)
            : null;
          const w =
            el && el.offsetWidth > 0
              ? clamp(el.offsetWidth / stageW, 0.14, 0.58)
              : clamp(0.13 + b.text.length * 0.0082, 0.18, isGroup ? 0.54 : 0.44);
          const h =
            el && el.offsetHeight > 0
              ? clamp(el.offsetHeight / stageH, 0.06, 0.24)
              : 0.105;
          const halfW = w * 0.5;
          const minCx = Math.max(0.14, halfW + 0.02);
          const maxCx = Math.min(0.86, 1 - halfW - 0.02);
          const cx = minCx <= maxCx ? clamp(meanSx, minCx, maxCx) : 0.5;
          const tailGap = 0.032;
          const maxTop = Math.min(0.58, 0.80 - h);
          const topY = clamp(minSy - tailGap - h, 0.04, Math.max(0.04, maxTop));

          return {
            bubble: b,
            el,
            isGroup,
            anchorSx: meanSx,
            minMemberSx,
            maxMemberSx,
            minSy,
            w,
            halfW,
            h,
            cx,
            topY,
            tailPct: 50,
            tail2Pct: 62,
            tail2Opacity: 0,
          };
        });

        // 2. Lightweight 2D non-overlap vertical & horizontal relaxation for simultaneous call-and-response bubbles
        if (placed.length >= 2) {
          placed.sort((a, b) => a.anchorSx - b.anchorSx || a.bubble.startSec - b.bubble.startSec);
          const padX = 0.015;
          const padY = 0.018;
          for (let iter = 0; iter < 4; iter++) {
            for (let i = 0; i < placed.length; i++) {
              for (let j = i + 1; j < placed.length; j++) {
                const a = placed[i];
                const b = placed[j];
                const reqX = a.halfW + b.halfW + padX;
                const ovX = reqX - Math.abs(b.cx - a.cx);
                const cyA = a.topY + a.h * 0.5;
                const cyB = b.topY + b.h * 0.5;
                const reqY = (a.h + b.h) * 0.5 + padY;
                const ovY = reqY - Math.abs(cyB - cyA);
                if (ovX <= 0 || ovY <= 0) continue;

                // Try gentle horizontal separation first if speakers sit horizontally apart
                if (Math.abs(a.anchorSx - b.anchorSx) > 0.04) {
                  const dir = a.cx <= b.cx ? -1 : 1;
                  const nudge = ovX * 0.52;
                  a.cx = clamp(a.cx + dir * nudge, Math.max(0.14, a.halfW + 0.02), Math.min(0.86, 1 - a.halfW - 0.02));
                  b.cx = clamp(b.cx - dir * nudge, Math.max(0.14, b.halfW + 0.02), Math.min(0.86, 1 - b.halfW - 0.02));
                }

                const remOvX = reqX - Math.abs(b.cx - a.cx);
                const remOvY = reqY - Math.abs((b.topY + b.h * 0.5) - (a.topY + a.h * 0.5));
                if (remOvX > 0 && remOvY > 0) {
                  // Lift the secondary / higher-head bubble upward into upper headroom
                  const liftTarget = a.minSy < b.minSy ? a : b;
                  const stayTarget = liftTarget === a ? b : a;
                  const liftedTop = liftTarget.topY - remOvY - 0.004;
                  if (liftedTop >= 0.035) {
                    liftTarget.topY = liftedTop;
                  } else {
                    liftTarget.topY = 0.035;
                    const maxStayTop = Math.min(0.58, 0.80 - stayTarget.h);
                    stayTarget.topY = clamp(liftTarget.topY + liftTarget.h + padY, 0.035, Math.max(0.035, maxStayTop));
                  }
                }
              }
            }
          }
        }

        // 3. Compute SVG downward pointer tail offsets aimed directly at speaker(s)
        for (const p of placed) {
          if (!p.isGroup) {
            p.tailPct = clamp(50 + ((p.anchorSx - p.cx) / Math.max(0.08, p.w)) * 100, 14, 86);
            p.tail2Opacity = 0;
          } else {
            const leftTail = clamp(50 + ((p.minMemberSx - p.cx) / Math.max(0.08, p.w)) * 100, 16, 46);
            const rightTail = clamp(50 + ((p.maxMemberSx - p.cx) / Math.max(0.08, p.w)) * 100, 54, 84);
            if (p.maxMemberSx - p.minMemberSx < 0.06 || rightTail - leftTail < 12) {
              p.tailPct = clamp(50 + ((p.anchorSx - p.cx) / Math.max(0.08, p.w)) * 100, 14, 86);
              p.tail2Pct = p.tailPct;
              p.tail2Opacity = 0;
            } else {
              p.tailPct = leftTail;
              p.tail2Pct = rightTail;
              p.tail2Opacity = 1;
            }
          }
        }

        // 4. Only trigger React state update when active bubble IDs or highlighted word/phrase changes (ZERO per-frame churn!)
        const sig = activeBubbles
          .map((b) => `${b.id}:${activeWordIndexForBubble(b, scoreTimeSec)}:${activePhraseStartForBubble(b, scoreTimeSec)}`)
          .join("|");
        if (sig !== lastCaptionSig || s.project.bubbles !== lastCaptionBubbles) {
          lastCaptionSig = sig;
          lastCaptionBubbles = s.project.bubbles;
          const byId = new Map(placed.map((p) => [p.bubble.id, p]));
          const nextLines: SceneLine[] = activeBubbles.map((b) => {
            const p = byId.get(b.id)!;
            const endSec = b.startSec + Math.max(0.8, b.durationSec);
            return {
              key: b.id,
              speaker: b.speaker,
              speakerIds: b.speakerIds,
              speakerNames: b.speakerNames,
              speakerColors: b.speakerColors,
              isGroup: b.isGroup,
              text: b.text,
              accent: b.color,
              start: b.startSec,
              end: endSec,
              words: (b.words ?? []).map((w) => ({ text: w.text, start: w.startSec, end: w.endSec })),
              x: p.cx,
              y: p.topY,
              tailXPct: p.tailPct,
              tail2XPct: p.tail2Pct,
              tail2Opacity: p.tail2Opacity,
              bg: b.bg,
              fg: b.fg,
              tail: b.tail !== "none",
            };
          });
          setCaptionState({ lines: nextLines, timeSec: scoreTimeSec });
        }

        // 5. Smoothly damp (leftPct, topPct, tailPct, tail2Pct) at 60fps directly onto DOM refs
        const activeIdsSet = new Set<string>();
        const dampAlpha = 1 - Math.exp(-16 * dt);
        for (const p of placed) {
          activeIdsSet.add(p.bubble.id);
          const tgtLeft = p.cx * 100;
          const tgtTop = p.topY * 100;
          let m = bubbleMotionRef.current.get(p.bubble.id);
          if (!m || snapCamera) {
            m = { leftPct: tgtLeft, topPct: tgtTop, tailPct: p.tailPct, tail2Pct: p.tail2Pct };
            bubbleMotionRef.current.set(p.bubble.id, m);
          } else {
            m.leftPct += (tgtLeft - m.leftPct) * dampAlpha;
            m.topPct += (tgtTop - m.topPct) * dampAlpha;
            m.tailPct += (p.tailPct - m.tailPct) * dampAlpha;
            m.tail2Pct += (p.tail2Pct - m.tail2Pct) * dampAlpha;
          }
          if (p.el) {
            p.el.style.setProperty("--bubble-left", `${m.leftPct.toFixed(2)}%`);
            p.el.style.setProperty("--bubble-top", `${m.topPct.toFixed(2)}%`);
            p.el.style.setProperty("--tail-x", `${m.tailPct.toFixed(2)}%`);
            p.el.style.setProperty("--tail2-x", `${m.tail2Pct.toFixed(2)}%`);
            p.el.style.setProperty("--tail2-opacity", String(p.tail2Opacity));
          }
        }
        for (const key of bubbleMotionRef.current.keys()) {
          if (!activeIdsSet.has(key)) bubbleMotionRef.current.delete(key);
        }
      }

      renderer.render(scene, camera);
    };

    raf = requestAnimationFrame(renderLoop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointercancel", onPointerUp);
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("dblclick", onDblClick);
      if (stageCanvasRegistry.current === renderer.domElement) {
        stageCanvasRegistry.current = null;
      }
      actorsMgr.dispose();
      worldRig.dispose();
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#120a0d",
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Unified Bottom Stage Control Row (wraps cleanly at narrow widths; zero left/right collision!) */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 8,
          right: 8,
          zIndex: 12,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 5,
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              flexWrap: "nowrap",
              whiteSpace: "nowrap",
              gap: 2,
              padding: 2,
              borderRadius: 999,
              background: "rgba(12, 10, 14, 0.8)",
              border: "1px solid rgba(255, 224, 178, 0.2)",
              backdropFilter: "blur(8px)",
            }}
          >
            {STAGE_WORLD_LIST.map((w) => {
              const active = w.id === activeWorldId;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => {
                    manualWorldSongRef.current = resolvedSongId;
                    setManualWorldSong(resolvedSongId);
                    setWorld(w.id);
                  }}
                  title={w.tagline}
                  style={{
                    border: "none",
                    borderRadius: 999,
                    padding: "3px 7px",
                    fontSize: 11,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                    background: active ? "rgba(227, 189, 127, 0.28)" : "transparent",
                    color: active ? "#ffe6ba" : "rgba(232, 225, 214, 0.76)",
                  }}
                >
                  {w.shortLabel}
                </button>
              );
            })}
          </div>

          {tierDisabledReason === null ? (
            <button
              type="button"
              onClick={() =>
                setRigPreference((r) => (r === "auto-3d" ? "multiplane-first" : "auto-3d"))
              }
              title="Toggle between rigged 3D GLB performers and articulated 2.5D Multiplane rigs"
              style={{
                border: "1px solid rgba(114, 245, 218, 0.3)",
                borderRadius: 999,
                padding: "3px 9px",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                background: "rgba(10, 20, 22, 0.8)",
                color: "#8ffae6",
                backdropFilter: "blur(8px)",
              }}
            >
              {tierBadge}
            </button>
          ) : (
            <span
              title={tierDisabledReason}
              style={{
                border: "1px solid rgba(255, 255, 255, 0.14)",
                borderRadius: 999,
                padding: "3px 9px",
                fontSize: 11,
                fontWeight: 600,
                background: "rgba(18, 16, 20, 0.72)",
                color: "rgba(232, 225, 214, 0.68)",
                backdropFilter: "blur(8px)",
              }}
            >
              {tierBadge}
            </span>
          )}

          {sceneBadge && (
            <button
              type="button"
              onClick={() => setVariableStageEnabled(!variableStageEnabled)}
              title="Variable Stage: auto-shifts lighting & worlds per Storyboard scene (click to toggle)"
              style={{
                border: variableStageEnabled
                  ? "1px solid rgba(251, 191, 36, 0.42)"
                  : "1px solid rgba(255, 255, 255, 0.16)",
                borderRadius: 999,
                padding: "3px 8px",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                background: variableStageEnabled ? "rgba(38, 26, 10, 0.82)" : "rgba(18, 16, 20, 0.78)",
                color: variableStageEnabled ? "#fde68a" : "rgba(220, 215, 205, 0.68)",
                backdropFilter: "blur(8px)",
              }}
            >
              ✦ {sceneBadge}
            </button>
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 5,
            pointerEvents: "auto",
          }}
        >
        <div
          style={{
            display: "inline-flex",
            gap: 2,
            padding: 3,
            borderRadius: 999,
            background: "rgba(12, 10, 14, 0.78)",
            border: "1px solid rgba(255, 255, 255, 0.14)",
            backdropFilter: "blur(8px)",
          }}
        >
          {(
            [
              ["authored", "Auto"],
              ["wide", "Wide"],
              ["closeup", "Close"],
              ["low-angle", "Low"],
            ] as const
          ).map(([mode, label]) => {
            const active = cameraMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setCameraMode(mode);
                  orbitRef.current = { azimuth: 0, polar: 0, zoom: 1 };
                  setIsOrbited(false);
                }}
                style={{
                  border: "none",
                  borderRadius: 999,
                  padding: "3px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  background: active ? "rgba(255, 255, 255, 0.18)" : "transparent",
                  color: active ? "#ffffff" : "rgba(232, 225, 214, 0.72)",
                }}
              >
                {label}
              </button>
            );
          })}
          {isOrbited && (
            <button
              type="button"
              onClick={() => {
                orbitRef.current = { azimuth: 0, polar: 0, zoom: 1 };
                setIsOrbited(false);
              }}
              style={{
                border: "none",
                borderRadius: 999,
                padding: "3px 8px",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                background: "rgba(245, 158, 11, 0.3)",
                color: "#fde68a",
              }}
            >
              Reset View
            </button>
          )}
        </div>

        <a
          href="/?chimera"
          title="Open full native CHIMERA vocal synthesizer (Play, Speak, Sing, Beatbox, Bestiary)"
          style={{
            textDecoration: "none",
            border: "1px solid rgba(130, 195, 255, 0.35)",
            borderRadius: 999,
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 600,
            background: "rgba(10, 18, 30, 0.8)",
            color: "#a8d8ff",
            backdropFilter: "blur(8px)",
          }}
        >
          CHIMERA Synth
        </a>

        <a
          href="/rig.html"
          title="Open CHIMERA 3D Acoustic Head & Body Rig playground"
          style={{
            textDecoration: "none",
            border: "1px solid rgba(130, 195, 255, 0.25)",
            borderRadius: 999,
            padding: "4px 9px",
            fontSize: 11,
            fontWeight: 600,
            background: "rgba(10, 18, 30, 0.8)",
            color: "#c8e4ff",
            backdropFilter: "blur(8px)",
          }}
        >
          3D Rig
        </a>
        </div>
      </div>

      {/* Live 3D-Projected Speech & Lyric Bubbles */}
      {captionState.lines.length > 0 && (
        <SceneCaptions
          lines={captionState.lines}
          time={captionState.timeSec}
          containerRef={captionsContainerRef}
        />
      )}
    </div>
  );
};
