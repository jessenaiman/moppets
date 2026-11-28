/**
 * Synchronized Studio 404 Illustrated Songbook & Storyboard View (`S-57`, `D-143`, `D-144`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Camera,
  ExternalLink,
  Layers,
  MapPin,
  Music,
  Pause,
  Play,
  Printer,
  Square,
  Wrench,
} from "lucide-react";
import { useAudio } from "../audio/audio.ts";
import { Choreographer } from "../choir/choreo.ts";
import { play, pose as samplePose, seek, stop, useEnsemble } from "../choir/ensemble.ts";
import type { CinemaShotPreset, Piece } from "../choir/music.ts";
import type { Pose } from "../choir/pose.ts";
import { beatSeconds, LEAD_IN } from "../choir/timeline.ts";
import { useMoppet, type Lesson } from "../choir/store.ts";
import { CAST } from "../choir/voices.ts";
import {
  compileIllustratedSongbook,
  listSongbookCatalog,
  type SongbookSceneSpec,
} from "../choir/songbookStoryboard.ts";
import { LiveStage3D } from "../stage/LiveStage3D.tsx";
import {
  defaultMoodForSection,
  useStageDirector,
  type StageLightingMood,
} from "../stage/stageDirectorStore.ts";
import type { StageWorldId } from "../stage/stageWorlds.ts";
import { StaticLeadSheet } from "./songbook/StaticLeadSheet.tsx";
import {
  captureStageSnapshot,
  CopyPromptButton,
  fmtTime,
  sanitizeDisplayPath,
  SceneCard,
  SceneVariableStageControls,
  StoryboardImg,
} from "./songbook/StoryboardSceneCard.tsx";

export function SongbookPanel({
  lessonId,
  piece,
  onSeekStageSec,
}: {
  lessonId: string;
  piece: Piece;
  onSeekStageSec: (stageSec: number) => void;
}) {
  const spec = useMemo(() => compileIllustratedSongbook(lessonId), [lessonId, piece.title, piece.beats]);
  const captures = useStageDirector((s) => s.captures);

  return (
    <div className="songbook-reader min-h-0 h-full overflow-y-auto bg-[#f7f2e8] text-[#1c1410] [scrollbar-width:thin]">
      <div className="flex flex-col gap-3 p-3 pb-6">
        <div className="rounded-xl border border-[#d5c6af] bg-[#faf7f1] p-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5">
                <BookOpen className="size-3.5 text-[#8c6438]" />
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#7a6148]">
                  {spec.isPilot ? `Pilot ${spec.pilotArchetype} Storyboard` : "Songbook + Storyboard"}
                </span>
              </div>
              <h3 className="m-0 font-serif text-base font-bold text-[#1c1410]">{spec.title}</h3>
            </div>
            <a
              data-sb-tone="dark"
              href={spec.songbookUrl}
              className="inline-flex items-center gap-1 rounded-lg bg-[#1c1410] px-2.5 py-1 text-[11px] font-semibold text-[#faf7f1] hover:bg-[#33241c]"
            >
              Full Reader
              <ExternalLink className="size-3" />
            </a>
          </div>
          <p className="m-0 text-xs text-[#544232]">{spec.about}</p>
          <div className="flex flex-wrap gap-1 font-mono text-[10px]">
            <span className="rounded bg-[#efe6d6] px-1.5 py-0.5 text-[#493728]">{spec.keyLabel}</span>
            <span className="rounded bg-[#efe6d6] px-1.5 py-0.5 text-[#493728]">{spec.bpm} BPM</span>
            <span className="rounded bg-[#efe6d6] px-1.5 py-0.5 text-[#493728]">{spec.meterLabel}</span>
            <span className="rounded bg-[#efe6d6] px-1.5 py-0.5 text-[#493728]">{fmtTime(spec.durationSec)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              data-sb-tone="light"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 rounded border border-[#8c6438] bg-[#fffaf0] px-2 py-1 text-[11px] font-semibold text-[#613f1a] hover:bg-[#f2e6d0] cursor-pointer"
            >
              <Printer className="size-3" />
              Print / Save PDF
            </button>
            {spec.designcraftPath && (
              <CopyPromptButton text={sanitizeDisplayPath(spec.designcraftPath)} label="Copy .designcraft" />
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[#d5c6af] bg-[#faf7f1] p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#6e5641]">
              Connected Bibles ({spec.castRefs.length} Cast + Set)
            </span>
            <CopyPromptButton text={spec.masterLookPrompt} label="Copy Look Prompt" />
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {spec.castRefs.map((c) => (
              <div key={c.castId} className="flex items-center gap-2 rounded-lg border border-[#dfd2be] bg-white p-1.5">
                <StoryboardImg
                  src={c.bibleHeroUrl}
                  alt={c.displayName}
                  fallbackText={c.displayName.slice(0, 2).toUpperCase()}
                  className="size-10 shrink-0 rounded bg-[#18110d] object-contain p-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#1c1410]">
                    <span>{c.displayName}</span>
                    <span className="font-mono text-[10px] font-normal text-[#6f5a46]">{c.heightDu} DU</span>
                  </div>
                  <p className="m-0 truncate text-[10px] text-[#5e4b3a]">{c.usageInPiece}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {spec.scenes.map((sc) => {
          const cap = captures[`${spec.id}:${sc.index}`];
          const strip = cap?.frames.some(Boolean) ? cap.frames : sc.stripFrameUrls;
          return (
            <div key={sc.code} className="rounded-xl border border-[#d5c6af] bg-[#faf7f1] p-2.5 flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-[#1c1410] px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                    {sc.code}
                  </span>
                  <span className="font-serif text-sm font-bold">{sc.title}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-sb-tone="light"
                    onClick={() => {
                      const director = useStageDirector.getState();
                      const existing = director.overrides[`${spec.id}:${sc.index}`];
                      const targetWorld: StageWorldId = existing?.worldId ?? useAudio.getState().world;
                      const targetMood: StageLightingMood =
                        existing?.mood && existing.mood !== "auto"
                          ? existing.mood
                          : defaultMoodForSection(sc.title, spec.castRefs.length);
                      const targetCam: CinemaShotPreset = existing?.cameraPreset ?? sc.cameraPreset;
                      useAudio.getState().setWorld(targetWorld);
                      director.setVariableStageEnabled(true);
                      director.setSceneOverride(spec.id, sc.index, {
                        worldId: targetWorld,
                        mood: targetMood,
                        cameraPreset: targetCam,
                      });
                      director.setPreviewSceneKey(`${spec.id}:${sc.index}`);
                      onSeekStageSec(Math.max(0, sc.startSec - LEAD_IN));
                      window.setTimeout(() => {
                        const snap = captureStageSnapshot();
                        if (snap) {
                          useStageDirector.getState().setSceneCapture(spec.id, sc.index, {
                            heroUrl: snap,
                            frames: [snap, snap, snap, snap],
                            capturedAtMs: Date.now(),
                          });
                        }
                      }, 220);
                    }}
                    className="rounded border border-[#8c6438] bg-[#fffaf0] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#5a3d20] hover:bg-[#f2e5cf] cursor-pointer"
                  >
                    Snap 3D
                  </button>
                  <button
                    type="button"
                    data-sb-tone="teal"
                    onClick={() => {
                      const director = useStageDirector.getState();
                      director.setVariableStageEnabled(true);
                      director.setPreviewSceneKey(`${spec.id}:${sc.index}`);
                      onSeekStageSec(Math.max(0, sc.startSec - LEAD_IN));
                    }}
                    className="rounded bg-[#203832] px-2 py-0.5 font-mono text-[10px] font-semibold text-white hover:bg-[#2c4f46] cursor-pointer"
                  >
                    Seek {fmtTime(sc.startSec)}
                  </button>
                </div>
              </div>
              <SceneVariableStageControls
                songId={spec.id}
                sceneIndex={sc.index}
                compact
                onChanged={() => onSeekStageSec(Math.max(0, sc.startSec - LEAD_IN))}
              />
              {strip && (
                <div className="grid grid-cols-4 gap-1">
                  {strip.map((u, idx) =>
                    u ? (
                      <button
                        key={`${sc.code}-${idx}`}
                        type="button"
                        onClick={() => onSeekStageSec(Math.max(0, sc.stripTimestampsSec[idx]! - LEAD_IN))}
                        className="overflow-hidden rounded border border-[#ccbda6] cursor-pointer"
                      >
                        <StoryboardImg
                          src={u}
                          alt={`${sc.code} f${idx + 1}`}
                          fallbackText={`F${idx + 1}`}
                          className="aspect-video w-full object-cover"
                        />
                      </button>
                    ) : null,
                  )}
                </div>
              )}
              <div className="rounded border border-[#e3d7c4] bg-white p-2 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase text-[#8c432b]">Image Prompt</span>
                  <CopyPromptButton text={sc.imagePrompt} />
                </div>
                <p className="m-0 text-[11px] leading-snug text-[#2d2119]">{sc.imagePrompt}</p>
              </div>
              <div className="rounded border border-[#e3d7c4] bg-white p-2 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase text-[#097364]">I2V Motion Prompt</span>
                  <CopyPromptButton text={sc.motionPrompt} />
                </div>
                <p className="m-0 text-[11px] leading-snug text-[#2d2119]">{sc.motionPrompt}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SongbookPage({ id }: { id: string }) {
  const catalog = useMemo(() => listSongbookCatalog(), []);
  const pilots = useMemo(() => catalog.filter((c) => c.isPilot), [catalog]);
  const [selectedId, setSelectedId] = useState(id || "found");
  const spec = useMemo(() => compileIllustratedSongbook(selectedId), [selectedId]);
  const [scoreViewMode, setScoreViewMode] = useState<"live-svg" | "captured">("live-svg");
  const [stageDockOpen, setStageDockOpen] = useState(true);
  const [previewSec, setPreviewSec] = useState(0);
  const [snappingScene, setSnappingScene] = useState<number | null>(null);

  const status = useEnsemble((s) => s.status);
  const ensTime = useEnsemble((s) => s.time);
  const startAudio = useAudio((s) => s.start);
  const setSceneCapture = useStageDirector((s) => s.setSceneCapture);
  const choreoRef = useRef<Choreographer | null>(null);

  const isPlaying = status === "playing" || status === "buffering";
  const activeTimeSec = isPlaying || status === "paused" ? ensTime : previewSec;
  const activeBeat = Math.max(0, (activeTimeSec - LEAD_IN) / beatSeconds(spec.piece));

  const livePoses = useMemo<Pose[] | undefined>(() => {
    if (!isPlaying && status !== "paused") return undefined;
    return CAST.map((v) => samplePose(v.id));
  }, [isPlaying, status, activeTimeSec]);

  useEffect(() => {
    choreoRef.current = new Choreographer(CAST.map((v) => v.id));
    useMoppet.getState().setLesson(spec.id as Lesson);
  }, [spec.id]);

  useEffect(() => {
    stop();
    setSelectedId(id || "found");
    setScoreViewMode("live-svg");
    setPreviewSec(0);
    return () => {
      stop();
    };
  }, [id]);

  const navigateSongbook = (nextId: string) => {
    stop();
    setSelectedId(nextId);
    setPreviewSec(0);
    const url = new URL(window.location.href);
    url.searchParams.set("songbook", nextId);
    window.history.replaceState(window.history.state, "", url);
  };

  const togglePlay = () => {
    if (isPlaying) {
      stop();
      return;
    }
    useMoppet.getState().setLesson(spec.id as Lesson);
    void play(startAudio, previewSec > 0.1 ? previewSec : 0);
  };

  const handleSeekStageSec = (stageSec: number) => {
    const absSec = LEAD_IN + Math.max(0, stageSec);
    setPreviewSec(absSec);
    setStageDockOpen(true);
    seek(absSec);
  };

  const snapScene = async (scene: SongbookSceneSpec) => {
    setStageDockOpen(true);
    setSnappingScene(scene.index);
    const director = useStageDirector.getState();
    const existing = director.overrides[`${spec.id}:${scene.index}`];
    const targetWorld: StageWorldId = existing?.worldId ?? useAudio.getState().world;
    const targetMood: StageLightingMood =
      existing?.mood && existing.mood !== "auto"
        ? existing.mood
        : defaultMoodForSection(scene.title, spec.castRefs.length);
    const targetCam: CinemaShotPreset = existing?.cameraPreset ?? scene.cameraPreset;
    useAudio.getState().setWorld(targetWorld);
    director.setVariableStageEnabled(true);
    director.setSceneOverride(spec.id, scene.index, {
      worldId: targetWorld,
      mood: targetMood,
      cameraPreset: targetCam,
    });
    director.setPreviewSceneKey(`${spec.id}:${scene.index}`);
    const waitFrames = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(resolve, 110))),
      );
    const frames: (string | null)[] = [];
    for (const ts of scene.stripTimestampsSec) {
      setPreviewSec(ts);
      seek(ts);
      await waitFrames();
      frames.push(captureStageSnapshot());
    }
    const hero = frames[1] ?? frames[0] ?? null;
    if (hero || frames.some(Boolean)) {
      setSceneCapture(spec.id, scene.index, {
        heroUrl: hero ?? undefined,
        frames,
        capturedAtMs: Date.now(),
      });
    }
    setSnappingScene(null);
  };

  const snapAllScenes = async () => {
    for (const sc of spec.scenes) {
      await snapScene(sc);
    }
  };

  return (
    <main className="songbook-reader min-h-screen bg-[#ece2d0] text-[#1c1410] pb-16 print:bg-white print:pb-0">
      <header className="sticky top-0 z-20 border-b border-[#ccbda6] bg-[#faf7f1]/95 backdrop-blur-sm print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#1c1410] px-2.5 py-1 font-serif text-sm font-bold text-[#faf7f1]">
              <BookOpen className="size-4 text-[#e3bd7f]" />
              Studio 404 Live Storyboard
            </span>
            <select
              aria-label="Choose song or skit"
              value={spec.id}
              onChange={(e) => navigateSongbook(e.target.value)}
              className="rounded-lg border border-[#c3b197] bg-white px-2.5 py-1 text-xs font-semibold text-[#1c1410]"
            >
              <optgroup label="3-Archetype Pilots (DesignCraft + 35mm Strips)">
                {pilots.map((p) => (
                  <option key={p.id} value={p.id}>
                    ★ [{p.pilotArchetype}] {p.title} ({p.bpm} BPM)
                  </option>
                ))}
              </optgroup>
              <optgroup label="All Studio 404 Pieces">
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · {c.kind} · {c.bpm} BPM
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-sb-tone={stageDockOpen ? "teal" : "light"}
              onClick={() => setStageDockOpen((v) => !v)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                stageDockOpen
                  ? "border-[#203832] bg-[#203832] text-[#faf7f1]"
                  : "border-[#cbb99f] bg-white text-[#4f3b2a]"
              }`}
            >
              {stageDockOpen ? "Hide Live 3D Stage" : "Show Live 3D Stage"}
            </button>
            {pilots.map((p) => (
              <button
                key={p.id}
                type="button"
                data-sb-tone={spec.id === p.id ? "dark" : "light"}
                onClick={() => navigateSongbook(p.id)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                  spec.id === p.id
                    ? "border-[#1c1410] bg-[#1c1410] text-[#faf7f1]"
                    : "border-[#cbb99f] bg-white text-[#4f3b2a] hover:border-[#8c6438]"
                }`}
              >
                ★ {p.pilotArchetype}: {p.title.split(" · ")[0]}
              </button>
            ))}
            <a data-sb-tone="teal" href={spec.watchUrl} className="rounded-lg border border-[#203832] bg-[#203832] px-3 py-1 text-xs font-semibold text-white hover:bg-[#2c4f46]">
              Watch Film
            </a>
            <a href={spec.rehearseUrl} className="rounded-lg border border-[#8c6438] bg-[#fffaf0] px-3 py-1 text-xs font-semibold text-[#5a3d20] hover:bg-[#f2e5cf]">
              Live Console
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-6 sm:px-6">
        {stageDockOpen && (
          <section className="rounded-2xl border border-[#3a2a20] bg-[#120b0d] text-[#f6ead7] shadow-xl overflow-hidden print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#1a1114] px-4 py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-500 cursor-pointer"
                >
                  {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5 fill-current" />}
                  {isPlaying ? "Pause CHIMERA" : "Play Live 3D"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stop();
                    setPreviewSec(0);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10 cursor-pointer"
                >
                  <Square className="size-3" />
                  Stop
                </button>
                <span className="font-mono text-xs text-amber-200">
                  {fmtTime(activeTimeSec)} / {fmtTime(spec.durationSec)} · Beat {activeBeat.toFixed(1)}
                </span>
              </div>
              <button
                type="button"
                disabled={snappingScene !== null}
                onClick={() => void snapAllScenes()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-500/25 disabled:opacity-50 cursor-pointer"
              >
                <Camera className="size-3.5" />
                {snappingScene !== null ? `Snapping S${snappingScene}…` : "Snap All 3D Strips"}
              </button>
            </div>
            <div className="aspect-video max-h-[440px] w-full">
              <LiveStage3D
                piece={spec.piece}
                voices={CAST}
                studio404={true}
                beat={activeBeat}
                timeSec={activeTimeSec}
                performing={isPlaying}
                poses={livePoses}
                cameraFollow={true}
                songId={spec.id}
              />
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-[#ccbda6] bg-[#faf7f1] shadow-md overflow-hidden">
          <div className="border-b border-[#dfd2be] bg-gradient-to-r from-[#241812] via-[#342219] to-[#241812] px-6 py-4 text-[#faf7f1]">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="m-0 font-mono text-[11px] uppercase tracking-widest text-[#e3bd7f]">
                  {spec.isPilot
                    ? `S-57 Pilot Storyboard · ${spec.pilotArchetype} Archetype`
                    : `Studio 404 Catalog · ${spec.kind.toUpperCase()}`}
                </p>
                <h1 className="m-0 font-serif text-3xl font-bold tracking-tight text-white">{spec.title}</h1>
                <p className="mt-1 mb-0 max-w-3xl text-sm text-[#e7dac6]">{spec.about}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                <span className="rounded-lg border border-[#74573e] bg-[#160f0b] px-2.5 py-1">{spec.keyLabel}</span>
                <span className="rounded-lg border border-[#74573e] bg-[#160f0b] px-2.5 py-1">{spec.bpm} BPM</span>
                <span className="rounded-lg border border-[#74573e] bg-[#160f0b] px-2.5 py-1">{spec.meterLabel}</span>
                <span className="rounded-lg border border-[#74573e] bg-[#160f0b] px-2.5 py-1">{fmtTime(spec.durationSec)}</span>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#e3bd7f] bg-[#8f3122] px-3 py-1 font-sans text-xs font-bold text-white hover:brightness-110 cursor-pointer print:hidden"
                >
                  <Printer className="size-3.5" />
                  Print / Save PDF
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-[#d7c8b2] bg-white p-3.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#8c432b]">
                    Master Style, Stage &amp; Continuity Prompt
                  </span>
                  <CopyPromptButton text={spec.masterLookPrompt} label="Copy Master Prompt" />
                </div>
                <p className="m-0 text-xs leading-relaxed text-[#2d2119]">{spec.masterLookPrompt}</p>
                <div className="mt-2.5 flex flex-col gap-0.5 border-t border-[#efe5d6] pt-2 font-mono text-[10px] text-[#6d5946] break-all">
                  <div>Lead Sheet: {sanitizeDisplayPath(spec.songFilePath)}</div>
                  {spec.designcraftPath && <div>DesignCraft: {sanitizeDisplayPath(spec.designcraftPath)}</div>}
                  <div>Connected Book: {sanitizeDisplayPath(spec.dcbookPath)}</div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <h2 className="m-0 flex items-center gap-1.5 font-serif text-base font-bold text-[#1c1410]">
                  <Layers className="size-4 text-[#097364]" />
                  Connected Character Master Bibles ({spec.castRefs.length})
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {spec.castRefs.map((c) => (
                    <div key={c.castId} className="flex items-start gap-2.5 rounded-xl border border-[#d7c8b2] bg-white p-2.5 shadow-2xs">
                      <StoryboardImg
                        src={c.bibleHeroUrl}
                        alt={c.displayName}
                        fallbackText={c.displayName.slice(0, 2).toUpperCase()}
                        className="size-16 shrink-0 rounded-lg border border-[#e5d9c6] bg-[#1a120e] object-contain p-1"
                      />
                      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-serif text-sm font-bold text-[#1c1410]">{c.displayName}</span>
                          <span className="rounded bg-[#f0e7d8] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#5b4735]">
                            {c.heightDu} DU · {c.renderMode}
                          </span>
                        </div>
                        <p className="m-0 text-[11px] leading-snug text-[#4e3c2d]">{c.usageInPiece}</p>
                        <p className="m-0 truncate font-mono text-[9px] text-[#7a6450]" title={sanitizeDisplayPath(c.bibleDocPath)}>
                          {sanitizeDisplayPath(c.bibleDocPath)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="rounded-xl border border-[#d7c8b2] bg-white p-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#6e5641]">
                    <MapPin className="size-3.5 text-[#9a442b]" />
                    Location Bible Plate
                  </div>
                  <StoryboardImg
                    src={spec.locationRef.plateUrl}
                    alt={spec.locationRef.label}
                    fallbackText={spec.locationRef.setId}
                    className="aspect-video w-full rounded-lg border border-[#e3d7c4] object-cover"
                  />
                  <div className="text-xs font-bold text-[#1c1410]">{spec.locationRef.label}</div>
                  <div className="truncate font-mono text-[9px] text-[#7a6450]" title={sanitizeDisplayPath(spec.locationRef.setAssetPath)}>
                    {sanitizeDisplayPath(spec.locationRef.setAssetPath)}
                  </div>
                </div>

                <div className="rounded-xl border border-[#d7c8b2] bg-white p-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#6e5641]">
                    <Wrench className="size-3.5 text-[#097364]" />
                    Hero Props &amp; Stage Gear
                  </div>
                  <ul className="m-0 list-none flex flex-col gap-1.5 p-0">
                    {spec.propRefs.map((p) => (
                      <li key={p.anchorTag} className="rounded border border-[#ede4d4] bg-[#faf7f1] p-1.5">
                        <div className="flex items-center justify-between gap-1 text-[11px] font-bold text-[#1c1410]">
                          <span>{p.name}</span>
                          <span className="font-mono text-[9px] text-[#097364]">{p.anchorTag}</span>
                        </div>
                        <p className="m-0 text-[10px] text-[#5e4b3a]">{p.description}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="m-0 flex items-center gap-1.5 font-serif text-base font-bold text-[#1c1410]">
                  <Music className="size-4 text-[#9a442b]" />
                  Musical Lead Sheet &amp; Score
                </h2>
                {spec.leadSheetPublicUrl && (
                  <div className="flex rounded-lg border border-[#ccbda6] bg-white p-0.5 text-[11px] font-semibold">
                    <button
                      type="button"
                      data-sb-tone={scoreViewMode === "live-svg" ? "dark" : "light"}
                      onClick={() => setScoreViewMode("live-svg")}
                      className={`rounded px-2 py-0.5 cursor-pointer ${
                        scoreViewMode === "live-svg" ? "bg-[#1c1410] text-white" : "text-[#5b4735]"
                      }`}
                    >
                      Live Engraved SVG
                    </button>
                    <button
                      type="button"
                      data-sb-tone={scoreViewMode === "captured" ? "dark" : "light"}
                      onClick={() => setScoreViewMode("captured")}
                      className={`rounded px-2 py-0.5 cursor-pointer ${
                        scoreViewMode === "captured" ? "bg-[#1c1410] text-white" : "text-[#5b4735]"
                      }`}
                    >
                      Print Score Plate
                    </button>
                  </div>
                )}
              </div>

              {scoreViewMode === "captured" && spec.leadSheetPublicUrl ? (
                <div className="overflow-hidden rounded-xl border border-[#d4c4ae] bg-white p-2">
                  <StoryboardImg
                    src={spec.leadSheetPublicUrl}
                    alt={`${spec.title} VexFlow lead sheet`}
                    fallbackText="Score"
                    className="w-full rounded object-contain"
                  />
                </div>
              ) : (
                <StaticLeadSheet piece={spec.piece} />
              )}

              <div className="rounded-xl border border-[#d7c8b2] bg-white p-3.5">
                <h3 className="m-0 mb-2 text-xs font-bold uppercase tracking-wider text-[#6e5641]">
                  Scene Flow Roadmap ({spec.scenes.length} Spreads)
                </h3>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {spec.scenes.map((sc) => (
                    <a
                      key={sc.code}
                      href={`#scene-${sc.index}`}
                      className="flex items-center justify-between rounded-lg border border-[#e7dac6] bg-[#faf7f1] px-2.5 py-1.5 text-xs hover:border-[#8c6438]"
                    >
                      <span className="truncate font-semibold text-[#1c1410]">
                        <span className="font-mono text-[#8c432b]">{sc.code}</span> · {sc.title}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-[#6d5946]">{sc.barsLabel}</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-5">
          {spec.scenes.map((scene) => (
            <div key={scene.code} id={`scene-${scene.index}`}>
              <SceneCard
                spec={spec}
                scene={scene}
                onSeekStageSec={handleSeekStageSec}
                onSnapScene={(sc) => void snapScene(sc)}
                snapping={snappingScene === scene.index}
              />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
