/**
 * Live Three.js 2.5D / 3D Stage (`MoppetPanel` / `LiveConsole` / `ScreeningRoom`):
 *  - Persistent native `THREE.WebGLRenderer` with `RoomEnvironment` PMREM PBR IBL, `PCFSoftShadowMap`,
 *    and `ACESFilmicToneMapping` (zero React-Three-Fiber reconciliation overhead, never remounts on playback).
 *  - Pure 16:9 unobstructed cinema viewport wired to `useStageView` (`./stageViewStore.ts`) and bottom-chin
 *    `StageCaptionsOverlay`.
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
import { simulateStageAutopilot } from "./stageAutopilot.ts";
import { evaluateActorBlocking } from "./stageBlocking.ts";
import {
  activePhraseStartForBubble,
  activeWordIndexForBubble,
  EMPTY_CAPTION_STATE,
  StageCaptionsOverlay,
  type CaptionViewState,
  type StageSubtitleLine,
} from "./StageCaptionsOverlay.tsx";
import {
  defaultMoodForSection,
  resolveActiveSceneForPiece,
  useStageDirector,
  type StageLightingMood,
} from "./stageDirectorStore.ts";
import {
  clamp,
  defaultWorldForSong,
  evaluateRiserBandGroove,
  interpolateAutopilotFrame,
  poseToVocalArtic,
  resolveDownstageCastEntries,
  resolveDownstageFormationSlot,
  resolveEffectiveCameraMode,
  resolveRiserBandX,
} from "./stageGrooveAndFormation.ts";
import {
  getSurfaceSampleAt,
  PLAYROOM_RISER_TOP_Y,
  resolveStageCollisions,
  resolveStudioMicPosition,
  type StageSurfaceContext,
} from "./stageSurface.ts";
import { loadStageTexture } from "./stageTextures.ts";
import { useStageView } from "./stageViewStore.ts";
import { isStageWorldId, type StageWorldId } from "./stageWorlds.ts";
import {
  STUDIO_RISER_TALL_TOP_Y,
  STUDIO_RISER_TOP_Y,
  StudioWorldRig,
  type CameraMode,
  type OrbitOffset,
} from "./studioWorlds3D.ts";
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
  variableStageEnabled: boolean;
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
  const cameraMode = useStageView((s) => s.cameraMode);
  const rigPreference = useStageView((s) => s.rigPreference);
  const variableStageEnabled = useStageView((s) => s.variableStageEnabled);
  const resetOrbitTick = useStageView((s) => s.resetOrbitTick);

  const resolvedSongId = useMemo(
    () =>
      songId ||
      piece.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    [songId, piece.title],
  );

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
  const orbitRef = useRef<OrbitOffset>({ azimuth: 0, polar: 0, zoom: 1 });
  const dragRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const expressionsRef = useRef<Map<string, Expression>>(new Map());

  useEffect(() => {
    if (resetOrbitTick > 0) {
      orbitRef.current = { azimuth: 0, polar: 0, zoom: 1 };
    }
  }, [resetOrbitTick]);

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
    variableStageEnabled,
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
    variableStageEnabled,
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
    };
    const onDblClick = () => {
      orbitRef.current = { azimuth: 0, polar: 0, zoom: 1 };
    };

    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("pointercancel", onPointerUp);
    dom.addEventListener("wheel", onWheel, { passive: false });
    dom.addEventListener("dblclick", onDblClick);

    let raf = 0;
    let lastNow = performance.now();
    let lastSceneWorldOv: StageWorldId | null = null;
    let lastPieceRef: Piece | null = null;
    let lastScoreTimeSec = -1;
    let lastValidEnsTimeSec = 0;
    let lastCaptionSig = "";
    let lastCaptionBubbles: readonly VideoBubbleClip[] | null = null;

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

      const castEntries = resolveDownstageCastEntries(s.piece, s.voices);
      const total = castEntries.length;
      const downstageIdents = castEntries.map(({ voice }) =>
        resolvePerformerIdentity(voice, s.studio404, s.piece.title),
      );
      const downstageArtKeys = downstageIdents.map((id) => id.artKey);
      const riserIds = resolveRiserCastIds(s.piece, downstageArtKeys, s.studio404);
      const riserCount = riserIds.length;

      const director = useStageDirector.getState();
      const activeScene = resolveActiveSceneForPiece(s.piece, scoreBeat);
      const slugKey = s.piece.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const sceneOv =
        director.overrides[`${s.songId}:${activeScene.sceneIndex}`] ??
        director.overrides[`${slugKey}:${activeScene.sceneIndex}`];
      const varStageOn = s.variableStageEnabled;
      const sceneWorldOv = varStageOn ? sceneOv?.worldId ?? null : null;
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
            : varStageOn && autoSongWorld
              ? autoSongWorld
              : s.worldId;
      const effectiveMood: Exclude<StageLightingMood, "auto"> = varStageOn
        ? sceneOv?.mood && sceneOv.mood !== "auto"
          ? sceneOv.mood
          : defaultMoodForSection(activeScene.sectionName, total)
        : "warm-spotlight";
      const overrideCam = resolveEffectiveCameraMode(s.cameraMode, varStageOn, sceneOv?.cameraPreset);

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
      const riserSpan = riserXs.length > 1 ? Math.max(...riserXs) - Math.min(...riserXs) : 0;
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
        if (level > maxEnergy) maxEnergy = level;

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
            : total === 1 || total <= 3
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

        let expr = expressionsRef.current.get(voice.id);
        if (!expr) {
          expr = new Expression();
          expressionsRef.current.set(voice.id, expr);
        }
        expr.update(null, dt);
        const rotY = expr.tilt * 0.45;
        leanRad += expr.tilt * 0.25;

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

        const baseHeight = total === 1 ? 2.15 : total <= 3 ? 1.95 : 1.72;
        const scaleFactor = manifest?.scaleFactor ?? 1;
        const worldHeight = baseHeight * clamp(scaleFactor, 0.65, 1.85);

        let tabbyFacial: TabbyFacialState | undefined;
        if (ident.artKey === "tabby") {
          const baseFacial = resolveTabbyFacialState(animTimeSec, voice.id, s.project.bubbles, undefined, singing);
          if (artic && singing) {
            const blink = naturalBlinkAmountAt(animTimeSec, true);
            const brow = artic.f0 > 60 ? clamp(Math.log2(artic.f0 / 260) * 0.7, -0.5, 0.9) : 0;
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
          const worldHeight = 1.65 * clamp(scaleFactor, 0.65, 1.65);
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
      const leftmostActorX = performerInputs.reduce((lo, p) => Math.min(lo, p.x), 0);

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

      actorsMgr.syncAll(performerInputs);

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
          setCaptionState(EMPTY_CAPTION_STATE);
        }
      } else {
        const sig = activeBubbles
          .map(
            (b) =>
              `${b.id}:${activeWordIndexForBubble(b, scoreTimeSec)}:${activePhraseStartForBubble(b, scoreTimeSec)}`,
          )
          .join("|");
        if (sig !== lastCaptionSig || s.project.bubbles !== lastCaptionBubbles) {
          lastCaptionSig = sig;
          lastCaptionBubbles = s.project.bubbles;
          const nextLines: StageSubtitleLine[] = activeBubbles.map((b) => ({
            key: b.id,
            speaker: b.speaker,
            speakerColors: b.speakerColors,
            text: b.text,
            accent: b.color,
            start: b.startSec,
            end: b.startSec + Math.max(0.8, b.durationSec),
            words: (b.words ?? []).map((w) => ({ text: w.text, start: w.startSec, end: w.endSec })),
          }));
          setCaptionState({ lines: nextLines, timeSec: scoreTimeSec });
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
      {captionState.lines.length > 0 && (
        <StageCaptionsOverlay lines={captionState.lines} time={captionState.timeSec} />
      )}
    </div>
  );
};
