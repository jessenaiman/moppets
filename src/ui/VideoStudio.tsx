import {CastExposure,exposureCatalog} from '../rehearsal/CastExposure';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import {beatSeconds, LEAD_IN} from "../choir/timeline";
import {MusicRack} from "./MusicRack";
import { Screen } from "@chimera/ui/components/Screen.tsx";
import { useAudio } from "../audio/audio.ts";
import { exportWav, pause, stop, useEnsemble } from "../choir/ensemble.ts";
import { useRehearsalTransport } from "./useRehearsalTransport.ts";
import { MoppetComposition } from "../remotion/MoppetComposition";
import { SongNavigator } from "./SongNavigator.tsx";
import { WORLD_LENSES, type WorldLens } from "../stage/worlds.ts";
const loadActionStrip = () => import("../rehearsal/NeonActions").then(m => ({default: m.ActionStrip}));
import { BenchPack, cycleLength } from "../rehearsal/BenchPack";
import { RemotionDock, type StudioComposition } from "./RemotionDock";
import { useMoppet } from "../choir/store.ts";
import { useController } from "../choir/controller.ts";
import { midiBytes } from "../choir/midi.ts";
import { midiSupported } from "./midi.ts";
import { STUDIO_404_CAST } from "../choir/studio404.ts";
import {
  buildVideoProject,
  compositionDimensions,
  lessonSlug,
  videoFrameLayout,
  type AspectMode,
  type MoppetVideoProps,
  type VideoBubbleClip,
} from "../choir/videoProject.ts";

type Selection =
  | { kind: "stage" }
  | { kind: "intro" }
  | { kind: "outro" }
  | { kind: "bubble"; id: string };

interface BridgeAssets {
  slug: string;
  exports: { file: string; url: string }[];
}

interface BridgeJob {
  id: number;
  kind: "render" | null;
  status: "idle" | "running" | "done" | "error";
  progress: number;
  message: string;
  outputUrl: string | null;
  error: string | null;
}

const BUBBLE_PRESETS: { label: string; bg: string; fg: string; color: string }[] = [
  { label: "Velvet Glass", bg: "rgba(20, 12, 15, 0.88)", fg: "#f8efe2", color: "#57d3e8" },
  { label: "Neon Cyan", bg: "rgba(14, 22, 28, 0.88)", fg: "#f4fbff", color: "#57d3e8" },
  { label: "Stage Gold", bg: "rgba(24, 18, 12, 0.88)", fg: "#fff8ec", color: "#e3bd7f" },
  { label: "Studio Teal", bg: "rgba(12, 24, 21, 0.88)", fg: "#f2fff9", color: "#3fbfa0" },
  { label: "Tally Ember", bg: "rgba(28, 13, 12, 0.90)", fg: "#fff5f2", color: "#e06a4f" },
];

const fmtSec = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`;

export function VideoStudio({livePreview, controller}:{liveEditing?: boolean;livePreview?:React.ReactNode;controller:React.ReactNode}) {
  const [timelineOpen,setTimelineOpen] = useState(false);
  const [audioError,setAudioError] = useState("");
  const [advancedOpen,setAdvancedOpen]=useState(false);
  const [composition,setComposition]=useState<StudioComposition>("Rehearsal");
  const [worldLens, setWorldLens] = useState<WorldLens>("diorama");
  const lesson = useMoppet((s) => s.lesson);
  const piece = useMoppet((s) => s.piece);
  const voices = useMoppet((s) => s.voices);
  const studio404 = useMoppet((s) => s.studio404);
  const singMidi = useMoppet((s) => s.singMidi);
  const midi = useController((s) => s.midi);
  const setMidi = useController((s) => s.setMidi);
  const midiFileRef = useRef<HTMLInputElement | null>(null);
  const playerRef = useRef<PlayerRef>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [project, setProject] = useState<MoppetVideoProps>(() => buildVideoProject(piece, voices, studio404));
  const [selection, setSelection] = useState<Selection>({ kind: "stage" });
  const [zoom, setZoom] = useState<1 | 2>(1);
  const [bridgeOn, setBridgeOn] = useState(false);
  const [assets, setAssets] = useState<BridgeAssets | null>(null);
  const [job, setJob] = useState<BridgeJob | null>(null);

  const slug = useMemo(() => lessonSlug(piece.title), [piece.title]);

  const refreshAssets = useCallback(async (targetSlug: string) => {
    if (!import.meta.env.DEV) return null;
    try {
      const r = await fetch(`/__video/assets?slug=${encodeURIComponent(targetSlug)}`);
      if (!r.ok) return null;
      const data = (await r.json()) as BridgeAssets;
      setAssets(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fetch("/__video/ping").then((r) => setBridgeOn(r.status === 204), () => setBridgeOn(false));
  }, []);

  useEffect(() => {
    if (!bridgeOn || job?.status !== "running") return;
    const t = setInterval(() => {
      void fetch("/__video/job")
        .then((r) => (r.ok ? (r.json() as Promise<BridgeJob>) : null))
        .then((next) => {
          if (!next) return;
          setJob(next);
          if (next.status === "done") {
            void refreshAssets(slug);
          }
        });
    }, 650);
    return () => clearInterval(t);
  }, [bridgeOn, job?.status, refreshAssets, slug]);

  const dims = compositionDimensions(project.aspect);
  const study=exposureCatalog.find(item=>item.id===composition);
  const { fps, introFrames, stageFrames, outroFrames } = videoFrameLayout(project);
  const stageEnd = introFrames + stageFrames;
  const totalFrames = stageEnd + outroFrames;
  const totalSec = totalFrames / fps;
  const introSec = introFrames / fps;
  const outroSec = outroFrames / fps;
  const showingRehearsal = composition === "Rehearsal" && !livePreview;
  // Always play live CHIMERA audio directly so edits, voice sliders, and master volume apply immediately.
  const recorded = false;
  const transport = useRehearsalTransport(playerRef, showingRehearsal, fps, introFrames, stageEnd, totalFrames, recorded, lesson);
  const ensembleMessage = useEnsemble(s => s.message);
  const vocalTiming = useEnsemble(s => s.vocalTiming);
  const previewProject = useMemo(() => ({
    ...project,
    audioUrl: null,
    vocalTiming,
    worldLens,
  }), [project, vocalTiming, worldLens]);
  const curSec = transport.frame / fps;
  const curStageSec = Math.max(0, Math.min(project.stageDurationSec, curSec - introFrames / fps));
  const seekToSec = (sec: number) => transport.seekTo(Math.round(sec * fps));

  useEffect(() => {
    const next = buildVideoProject(piece, voices, studio404);
    next.intro.enabled = false;
    next.outro.enabled = false;
    setAudioError("");
    setProject(next);
    setComposition("Rehearsal");
    transport.reset();
    setSelection({ kind: "stage" });
    if (lesson === "cardboard-horse") setWorldLens("caravan");
    if (lesson === "right-on-cue") setWorldLens("archive");
    void refreshAssets(next.slug);
  }, [piece, voices, studio404, refreshAssets, lesson]);

  const selectComposition = (id: StudioComposition) => {
    if (showingRehearsal) {
      if (transport.busy) stop();
      else pause();
    }
    playerRef.current?.pause();
    setComposition(id);
  };

  const seekOnRuler = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    seekToSec(((event.clientX - box.left) / Math.max(1, box.width)) * totalSec);
  };

  const resetFromScore = () => {
    const next = buildVideoProject(piece, voices, studio404, {
      aspect: project.aspect,
      audioUrl: project.audioUrl,
    });
    setProject(next);
    setSelection({ kind: "stage" });
  };

  const updateBubble = (id: string, patch: Partial<VideoBubbleClip>) => {
    setProject((cur) => ({
      ...cur,
      bubbles: cur.bubbles.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  };

  const [synthBusy, setSynthBusy] = useState(false);
  const blobAudioRef = useRef<string | null>(null);
  const startAudio = useAudio((s) => s.start);

  useEffect(() => {
    return () => {
      if (blobAudioRef.current) URL.revokeObjectURL(blobAudioRef.current);
    };
  }, []);

  const preparing=useRef(false);
  const prepareMix = async () => {
    if(preparing.current)return null;
    preparing.current=true;
    const sameScore = () => useMoppet.getState().piece === piece && useMoppet.getState().voices === voices;
    setAudioError("");
    setSynthBusy(true);
    try {
      const out = await exportWav(startAudio);
      if (!sameScore()) return null;
      if (blobAudioRef.current) {
        URL.revokeObjectURL(blobAudioRef.current);
        blobAudioRef.current = null;
      }
      let nextAudioUrl: string;
      if (bridgeOn) {
        const resp = await fetch(`/__video/audio?slug=${encodeURIComponent(slug)}`, {
          method: "POST",
          headers: { "content-type": "audio/wav" },
          body: new Blob([out.bytes as BlobPart], { type: "audio/wav" }),
        });
        if (!resp.ok) throw new Error(await resp.text());
        const data = (await resp.json()) as { audioUrl: string };
        nextAudioUrl = data.audioUrl;
      } else {
        const url = URL.createObjectURL(new Blob([out.bytes as BlobPart], { type: "audio/wav" }));
        blobAudioRef.current = url;
        nextAudioUrl = url;
      }
      if (!sameScore()) return null;
      const mix = { audioUrl: nextAudioUrl, vocalTiming: out.vocalTiming, stageDurationSec: out.durationSec };
      setProject((cur) => ({ ...cur, ...mix }));
      return mix;
    } catch(error) {
      if (sameScore()) setAudioError(error instanceof Error ? error.message : "Could not prepare rehearsal audio.");
      return null;
    } finally {
      preparing.current=false;
      setSynthBusy(false);
    }
  };

  const midiOn = midi.status === "on";
  const downloadScoreMidi = () => {
    const url = URL.createObjectURL(new Blob([midiBytes(piece) as BlobPart], { type: "audio/midi" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.mid`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const handleMidiFile = async (file?: File | null) => {
    if (!file) return;
    singMidi(new Uint8Array(await file.arrayBuffer()));
  };

  const addBubbleAtPlayhead = () => {
    const id = `bubble-${Date.now().toString(36)}`;
    const clip: VideoBubbleClip = {
      id,
      speakerId: voices[0]?.id ?? "vee",
      speaker: studio404 ? (STUDIO_404_CAST[voices[0]?.id ?? "vee"]?.name ?? "Neon") : (voices[0]?.name ?? "Singer"),
      text: "New Studio 404 caption",
      startSec: Number(Math.min(Math.max(0, project.stageDurationSec - 1), curStageSec).toFixed(2)),
      durationSec: 2.2,
      x: 0.5,
      y: 0.1,
      bg: "rgba(20, 12, 15, 0.88)",
      fg: "#f8efe2",
      color: "#57d3e8",
      tail: "down",
    };
    setProject((cur) => ({ ...cur, bubbles: [...cur.bubbles, clip] }));
    setSelection({ kind: "bubble", id });
    seekToSec(introSec + clip.startSec + 0.1);
  };

  const duplicateBubble = (src: VideoBubbleClip) => {
    const id = `bubble-${Date.now().toString(36)}`;
    const clone: VideoBubbleClip = {
      ...src,
      id,
      startSec: Number(Math.min(project.stageDurationSec - 0.5, src.startSec + 0.5).toFixed(2)),
      y: Math.min(0.72, Number((src.y + 0.12).toFixed(2))),
    };
    setProject((cur) => ({ ...cur, bubbles: [...cur.bubbles, clone] }));
    setSelection({ kind: "bubble", id });
  };

  const deleteBubble = (id: string) => {
    setProject((cur) => ({ ...cur, bubbles: cur.bubbles.filter((b) => b.id !== id) }));
    setSelection({ kind: "stage" });
  };

  const triggerRender = async () => {
    const mix = await prepareMix();
    if (!mix || mix.audioUrl.startsWith("blob:")) return;
    try {
      const props = { ...project, ...mix, worldLens };
      const r = await fetch("/__video/render", { method: "POST", body: JSON.stringify({ slug, props }) });
      if (!r.ok) throw new Error(await r.text());
      setJob(await r.json() as BridgeJob);
    } catch (error) {
      setJob({ id: 0, kind: "render", status: "error", progress: 0, message: "Render failed to start.", outputUrl: null, error: String(error) });
    }
  };

  const cancelJob = async () => {
    const r = await fetch("/__video/cancel", { method: "POST" });
    if (r.ok) setJob((await r.json()) as BridgeJob);
  };

  const downloadPropsJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = `${project.slug}-remotion.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };

  const selectedBubble = selection.kind === "bubble" ? project.bubbles.find((b) => b.id === selection.id) ?? null : null;
  const activeSelKind: Selection["kind"] = selection.kind === "bubble" && !selectedBubble ? "stage" : selection.kind;
  const pct = (sec: number) => `${((sec / Math.max(0.1, totalSec)) * 100).toFixed(3)}%`;

  return (
    <Screen className="s-video warm" title="Video Studio" sub="Remotion Workbench">
      <div className="vs-wrap">
        {/* Interactive Vinyl Crates Coverflow + Expandable Poster Deck (replaces boring <select>) */}
        <SongNavigator />

        {/* Locked, Unified Tailwind Studio Stage Bar — zero layout shift across all 8 worlds & never burned into MP4 export */}
        <div
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#745438]/65 bg-[#1e150f]/95 px-3 py-2 shadow-md"
          data-stage-bar="locked"
        >
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Stage world switcher">
            {WORLD_LENSES.map((item) => {
              const active = worldLens === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={item.tagline}
                  onClick={() => setWorldLens(item.id)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-bold tracking-wide cursor-pointer ${
                    active
                      ? "border-[#50cfad] bg-[#50cfad] text-[#111917] shadow-sm"
                      : "border-[#745438]/65 bg-[#2a1d15] text-[#f3e6d3] hover:border-[#e3bd7f]"
                  }`}
                >
                  {item.shortLabel}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="vs-aspect" role="group" aria-label="Aspect ratio">
              {(["16:9", "9:16"] as AspectMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={project.aspect === mode ? "on" : ""}
                  aria-pressed={project.aspect === mode}
                  onClick={() => setProject((cur) => ({ ...cur, aspect: mode }))}
                >
                  {mode}
                </button>
              ))}
            </div>

            <button
              type="button"
              className={project.cameraAutoFollow ? "on" : ""}
              aria-pressed={project.cameraAutoFollow}
              onClick={() => setProject((cur) => ({ ...cur, cameraAutoFollow: !cur.cameraAutoFollow }))}
            >
              {project.cameraAutoFollow ? "Auto-follow" : "Wide"}
            </button>

            <button type="button" disabled={synthBusy || transport.busy || job?.status === "running"} onClick={() => void prepareMix()}>
              {synthBusy ? "Preparing WAV…" : project.audioUrl ? "Refresh WAV" : "Prepare WAV"}
            </button>

            <details className="vs-more">
              <summary>More ▾</summary>
              <div className="vs-more-menu">
                <button
                  type="button"
                  className={midiOn ? "on" : ""}
                  aria-pressed={midiOn}
                  disabled={!midiSupported()}
                  onClick={() => setMidi(!midiOn)}
                >
                  {!midiSupported()
                    ? "MIDI: Needs HTTPS"
                    : midi.status === "denied"
                      ? "MIDI: Blocked"
                      : midi.status === "connecting"
                        ? "MIDI: Connecting…"
                        : midiOn
                          ? midi.inputs[0]
                            ? `MIDI: ${midi.inputs[0]}`
                            : "MIDI: Ready"
                          : "Connect MIDI"}
                </button>

                <input
                  ref={midiFileRef}
                  type="file"
                  accept=".mid,.midi,audio/midi"
                  hidden
                  onChange={(e) => {
                    void handleMidiFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />

                <button type="button" onClick={() => midiFileRef.current?.click()}>
                  ↑ Import .mid
                </button>

                <button type="button" onClick={downloadScoreMidi}>
                  ↓ Export .mid
                </button>

                <button type="button" onClick={resetFromScore}>
                  Reset from Score
                </button>

                <button type="button" onClick={downloadPropsJson}>
                  ↓ Export JSON
                </button>
              </div>
            </details>

            {bridgeOn && composition === "Rehearsal" && (
              <button type="button" className="primary" disabled={job?.status === "running" || synthBusy || transport.busy} onClick={() => void triggerRender()}>
                Export MP4
              </button>
            )}
          </div>
        </div>

        {(job && job.status !== "idle") || assets?.exports.length ? (
          <div className="vs-jobbar" role="status">
            <span>
              {job && job.status !== "idle" ? job.message : "Ready for local Remotion MP4 export."}
              {job?.status === "error" && job.error ? ` (${job.error.slice(0, 120)})` : ""}
            </span>
            <span className="vs-job-links">
              {job?.status === "running" && <button type="button" onClick={() => void cancelJob()}>Cancel</button>}
              {job?.outputUrl && (
                <a className="vs-dl" href={job.outputUrl} download>
                  ↓ Download rendered MP4
                </a>
              )}
              {!job?.outputUrl &&
                assets?.exports.map((ex) => (
                  <a key={ex.file} className="vs-dl" href={ex.url} download={ex.file}>
                    ↓ {ex.file}
                  </a>
                ))}
            </span>
          </div>
        ) : null}

        <div className="vs-main vs-score-desk">
          <div className="vs-stage-col">
            <div className={`vs-player-frame${livePreview ? " live-preview" : ""}${project.aspect === "9:16" ? " portrait" : ""}`} data-layout="overlay" ref={stageRef}>
              {livePreview ?? (composition==="Rehearsal" ? <Player
                key={recorded ? `performance-${lesson}` : "rehearsal"} controls={recorded} ref={playerRef} component={MoppetComposition} inputProps={previewProject}
                durationInFrames={totalFrames} compositionWidth={dims.width} compositionHeight={dims.height}
                fps={fps} numberOfSharedAudioTags={recorded ? 1 : 0} moveToBeginningWhenEnded={false} style={{width:"100%",height:"100%"}}/>
                : composition==="Cue-Bench-Pack" ? <Player key="cue" ref={playerRef} component={BenchPack}
                  durationInFrames={cycleLength*2} compositionWidth={1280} compositionHeight={720} fps={24}
                  controls loop style={{width:"100%",height:"100%"}}/>
                : study ? <Player key={study.id} ref={playerRef} component={CastExposure} inputProps={{study}} durationInFrames={study.count*study.hold} compositionWidth={960} compositionHeight={720} fps={24} controls loop style={{width:"100%",height:"100%"}}/>
                : <Player key="neon" ref={playerRef} lazyComponent={loadActionStrip} inputProps={{review:true}}
                  durationInFrames={720} compositionWidth={820} compositionHeight={680} fps={24}
                  controls loop style={{width:"100%",height:"100%"}}/>)}
              {showingRehearsal && !recorded && <div className="vs-rehearsal-controls" data-layout="overlay" aria-label="Rehearsal transport">
                <button type="button" disabled={synthBusy && !transport.playing}
                  aria-label={transport.playing || transport.busy ? "Pause video" : "Play video"} onClick={transport.toggle}>
                  <span aria-hidden="true">{transport.playing || transport.busy ? "Ⅱ" : "▶"}</span>
                </button>
                <span>{fmtSec(curSec)} / {fmtSec(totalSec)}</span>
                <input type="range" min={0} max={totalFrames - 1} step={1} value={transport.frame}
                  aria-label="Seek rehearsal" aria-valuetext={fmtSec(curSec)}
                  onChange={e => transport.seekTo(Number(e.target.value))} />
                <button type="button" aria-label="Toggle fullscreen" onClick={() => {
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else void stageRef.current?.requestFullscreen();
                }}><span aria-hidden="true">⛶</span></button>
              </div>}
            </div>
            {showingRehearsal && piece.sections && piece.sections.length > 1 && (
              <nav aria-label="Rehearsal scenes" className="flex flex-wrap gap-1 py-2">
                {piece.sections.map((section, i, sections) => {
                  const start = LEAD_IN + section.beat * beatSeconds(piece);
                  const next = sections[i + 1];
                  const active = curStageSec >= start && (!next || curStageSec < LEAD_IN + next.beat * beatSeconds(piece));
                  return <button key={section.beat + "-" + i} type="button" aria-current={active ? "step" : undefined}
                    className="rounded px-2 py-1 text-xs capitalize aria-[current=step]:bg-teal-900"
                    onClick={() => transport.seekTo(introFrames + Math.ceil(start * fps))}>
                    {section.name}
                  </button>;
                })}
              </nav>
            )}
            {showingRehearsal && (transport.busy || ensembleMessage.startsWith("Could not") || ensembleMessage.startsWith("No sound"))
              && <p role="status" className="vs-meta">{ensembleMessage}</p>}
          </div>

          <MusicRack timeSec={showingRehearsal ? curStageSec : undefined} playing={showingRehearsal ? transport.playing : undefined}
            onSeek={showingRehearsal ? seconds => seekToSec(introFrames / fps + seconds) : undefined}/>
        </div>
        <section className="vs-midi s-stage" aria-label="MIDI controller">{controller}</section>
        {audioError && <p role="alert">Rehearsal audio: {audioError}</p>}
        {synthBusy && <p role="status">Preparing the score audio…</p>}
        <details className="vs-timeline-disclosure" onToggle={event=>{setTimelineOpen(event.currentTarget.open);if(!event.currentTarget.open)setAdvancedOpen(false)}}>
          <summary>Timeline</summary>
          {timelineOpen && <>



        {composition==="Rehearsal" && <div className="vs-timeline" aria-label="Cards, stage, dialogue and audio tracks">
          <div className="vs-tl-head">
            <span className="vs-time">{fmtSec(curSec)} / {fmtSec(totalSec)}</span>
            <div className="vs-tl-actions">
              <div className="vs-zoom" role="group" aria-label="Timeline zoom">
                {([1, 2] as const).map((z) => (
                  <button key={z} type="button" className={zoom === z ? "on" : ""} onClick={() => setZoom(z)}>{z}×</button>
                ))}
              </div>
              <button type="button" onClick={addBubbleAtPlayhead}>+ Add Bubble</button>
            </div>
          </div>

          <div className="vs-tracks-scroll">
            <div className="vs-tracks-canvas" style={{ minWidth: zoom === 2 ? "max(1440px, 100%)" : "max(800px, 100%)" }}>
              <div className="vs-track-row">
                <span className="vs-track-label">Time</span>
                <div
                  className="vs-track-lane vs-ruler"
                  role="slider"
                  aria-label="Seek timeline"
                  aria-valuemin={0}
                  aria-valuemax={Number(totalSec.toFixed(1))}
                  aria-valuenow={Number(curSec.toFixed(1))}
                  tabIndex={0}
                  style={{touchAction:"pan-y"}}
                  onPointerDown={event => {
                    if (!event.isPrimary || event.button !== 0) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    seekOnRuler(event);
                  }}
                  onPointerMove={event => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) seekOnRuler(event);
                  }}
                  onKeyDown={event => {
                    const step = event.shiftKey ? 1 : 1 / fps;
                    const positions: Record<string, number> = {
                      ArrowLeft: curSec - step, ArrowRight: curSec + step,
                      PageDown: curSec - 5, PageUp: curSec + 5, Home: 0, End: totalSec,
                    };
                    if (!(event.key in positions)) return;
                    event.preventDefault();
                    seekToSec(positions[event.key]);
                  }}
                >
                  {Array.from({ length: Math.min(30, Math.ceil(totalSec / 5) + 1) }, (_, idx) => {
                    const sec = idx * 5;
                    if (sec > 0 && totalSec - sec < 4) return null;
                    return (
                      <span key={sec} className="vs-tick" style={{ left: `min(${pct(sec)}, calc(100% - 4ch - 4px))` }}>
                        {Math.round(sec)}s
                      </span>
                    );
                  })}
                  <span className="vs-playhead" data-layout="overlay" style={{ left: pct(curSec) }} />
                </div>
              </div>

              <div className="vs-track-row">
                <span className="vs-track-label">Cards</span>
                <div className="vs-track-lane" data-layout="layered">
                  {project.intro.enabled && (
                    <button
                      type="button"
                      className={`vs-clip vs-clip-card${activeSelKind === "intro" ? " sel" : ""}`}
                      style={{ left: "0%", width: pct(introSec) }}
                      onClick={() => {
                        setSelection({ kind: "intro" });
                        seekToSec(0.3);
                      }}
                    >
                      <span>Intro: {project.intro.heading}</span>
                    </button>
                  )}
                  {project.outro.enabled && (
                    <button
                      type="button"
                      className={`vs-clip vs-clip-card${activeSelKind === "outro" ? " sel" : ""}`}
                      style={{ left: pct(introSec + project.stageDurationSec), width: pct(outroSec) }}
                      onClick={() => {
                        setSelection({ kind: "outro" });
                        seekToSec(introSec + project.stageDurationSec + 0.3);
                      }}
                    >
                      <span>Outro: {project.outro.heading}</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="vs-track-row">
                <span className="vs-track-label">Stage</span>
                <div className="vs-track-lane">
                  <button
                    type="button"
                    className={`vs-clip vs-clip-stage${activeSelKind === "stage" ? " sel" : ""}`}
                    style={{ left: pct(introSec), width: pct(project.stageDurationSec) }}
                    onClick={() => setSelection({ kind: "stage" })}
                  >
                    <span>
                      Live ShotcraftStage · {project.cameraAutoFollow ? "Auto-follow" : "Wide"}
                    </span>
                  </button>
                </div>
              </div>

              <div className="vs-track-row">
                <span className="vs-track-label">Dialogue</span>
                <div className="vs-track-lane vs-lane-bubbles" data-layout="layered" style={{ height: 60 }}>
                  {(() => {
                    const rowEnds = [-1, -1];
                    return project.bubbles.map((b) => {
                      const s0 = introSec + b.startSec;
                      const dur = Math.max(0.8, b.durationSec);
                      let row = rowEnds.findIndex((end) => s0 >= end + 0.05);
                      if (row < 0) row = rowEnds[0] <= rowEnds[1] ? 0 : 1;
                      rowEnds[row] = s0 + dur;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          className={`vs-clip vs-clip-bubble${selectedBubble?.id === b.id ? " sel" : ""}`}
                          style={{
                            left: pct(s0),
                            top: row === 0 ? 4 : 32,
                            width: pct(dur),
                            borderLeftColor: b.color,
                          }}
                          title={`${b.speaker}: ${b.text}`}
                          onClick={() => {
                            setSelection({ kind: "bubble", id: b.id });
                            seekToSec(introSec + b.startSec + Math.min(0.4, b.durationSec / 2));
                          }}
                        >
                          <span>{b.text}</span>
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>

              <div className="vs-track-row">
                <span className="vs-track-label">Audio</span>
                <div className="vs-track-lane">
                  <button
                    type="button"
                    className="vs-clip vs-clip-audio"
                    style={{ left: pct(introSec), width: pct(project.stageDurationSec) }}
                    onClick={() => setSelection({ kind: "stage" })}
                  >
                    <span>{project.audioUrl ? "48 kHz CHIMERA studio mix" : "CHIMERA rehearsal mix"}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>}
          {composition==="Rehearsal" && <details className="vs-advanced"><summary>Track inspector</summary><aside className="vs-inspector" aria-label="Track inspector">
            <div className="vs-ins-tabs" role="group" aria-label="Inspect layer">
              <button type="button" className={activeSelKind === "stage" ? "on" : ""} onClick={() => setSelection({ kind: "stage" })}>Stage & Audio</button>
              <button type="button" className={activeSelKind === "intro" ? "on" : ""} onClick={() => setSelection({ kind: "intro" })}>Intro</button>
              <button type="button" className={activeSelKind === "outro" ? "on" : ""} onClick={() => setSelection({ kind: "outro" })}>Outro</button>
              {selectedBubble && <button type="button" className="on" onClick={() => setSelection({ kind: "bubble", id: selectedBubble.id })}>Bubble</button>}
            </div>

            {selectedBubble ? (
              <div className="vs-ins-body">
                <label className="vs-field">
                  <span>Bubble text</span>
                  <input
                    aria-label="Bubble text"
                    value={selectedBubble.text}
                    onChange={(e) => updateBubble(selectedBubble.id, { text: e.target.value })}
                  />
                </label>
                <label className="vs-field">
                  <span>Speaker</span>
                  <input
                    aria-label="Bubble speaker"
                    value={selectedBubble.speaker}
                    onChange={(e) => updateBubble(selectedBubble.id, { speaker: e.target.value })}
                  />
                </label>
                <div className="vs-two">
                  <label className="vs-field">
                    <span>Start (s)</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      max={Math.max(0, project.stageDurationSec - 0.3)}
                      value={selectedBubble.startSec}
                      onChange={(e) => updateBubble(selectedBubble.id, { startSec: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </label>
                  <label className="vs-field">
                    <span>Length (s)</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0.3}
                      max={60}
                      value={selectedBubble.durationSec}
                      onChange={(e) => updateBubble(selectedBubble.id, { durationSec: Math.max(0.3, Number(e.target.value) || 0.3) })}
                    />
                  </label>
                </div>
                <div className="vs-two">
                  <label className="vs-field">
                    <span>X ({Math.round(selectedBubble.x * 100)}%)</span>
                    <input
                      type="range"
                      min={0.1}
                      max={0.9}
                      step={0.01}
                      value={selectedBubble.x}
                      onChange={(e) => updateBubble(selectedBubble.id, { x: Number(e.target.value) })}
                    />
                  </label>
                  <label className="vs-field">
                    <span>Y ({Math.round(selectedBubble.y * 100)}%)</span>
                    <input
                      type="range"
                      min={0.06}
                      max={0.78}
                      step={0.01}
                      value={selectedBubble.y}
                      onChange={(e) => updateBubble(selectedBubble.id, { y: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <div className="vs-two">
                  <label className="vs-field">
                    <span>Tail</span>
                    <select
                      value={selectedBubble.tail}
                      onChange={(e) => updateBubble(selectedBubble.id, { tail: e.target.value as VideoBubbleClip["tail"] })}
                    >
                      <option value="down">Down pointer</option>
                      <option value="none">Pill (no tail)</option>
                    </select>
                  </label>
                  <div className="vs-field">
                    <span>Bubble / Text colors</span>
                    <div className="vs-colors">
                      <input type="color" aria-label="Bubble accent color" value={selectedBubble.color} onChange={(e) => updateBubble(selectedBubble.id, { color: e.target.value })} />
                      <input type="color" aria-label="Bubble text color" value={selectedBubble.fg} onChange={(e) => updateBubble(selectedBubble.id, { fg: e.target.value })} />
                    </div>
                  </div>
                </div>
                <div className="vs-swatches">
                  {BUBBLE_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => updateBubble(selectedBubble.id, { bg: p.bg, fg: p.fg, color: p.color })}
                      style={{ background: p.bg, color: p.color, borderColor: `${p.color}66` }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="vs-ins-actions">
                  <button type="button" onClick={() => duplicateBubble(selectedBubble)}>Duplicate</button>
                  <button type="button" className="danger" onClick={() => deleteBubble(selectedBubble.id)}>Delete</button>
                </div>
              </div>
            ) : activeSelKind === "intro" || activeSelKind === "outro" ? (
              <div className="vs-ins-body">
                {(() => {
                  const key = activeSelKind;
                  const card = project[key];
                  const updateCard = (patch: Partial<typeof card>) =>
                    setProject((cur) => ({ ...cur, [key]: { ...cur[key], ...patch } }));
                  return (
                    <>
                      <label className="vs-check">
                        <input type="checkbox" checked={card.enabled} onChange={(e) => updateCard({ enabled: e.target.checked })} />
                        Show {key === "intro" ? "intro title card" : "outro card"}
                      </label>
                      <label className="vs-field">
                        <span>Duration (s)</span>
                        <input type="number" step={0.1} min={0.4} max={10} value={card.durationSec} onChange={(e) => updateCard({ durationSec: Math.max(0.4, Number(e.target.value) || 0.4) })} />
                      </label>
                      <label className="vs-field">
                        <span>Heading</span>
                        <input value={card.heading} onChange={(e) => updateCard({ heading: e.target.value })} />
                      </label>
                      <label className="vs-field">
                        <span>Subheading</span>
                        <input value={card.subheading} onChange={(e) => updateCard({ subheading: e.target.value })} />
                      </label>
                      <div className="vs-two">
                        <label className="vs-field">
                          <span>Accent</span>
                          <input type="color" value={card.accent} onChange={(e) => updateCard({ accent: e.target.value })} />
                        </label>
                        <label className="vs-field">
                          <span>Background</span>
                          <input type="color" value={card.bg} onChange={(e) => updateCard({ bg: e.target.value })} />
                        </label>
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="vs-ins-body">
                <p className="vs-meta">
                  Audio bed: <b>CHIMERA mixes the current score and singer levels on export.</b>
                </p>
                <label className="vs-field">
                  <span>Audio mix volume ({Math.round(project.audioVolume * 100)}%)</span>
                  <input type="range" min={0} max={1} step={0.05} value={project.audioVolume} onChange={(e) => setProject((cur) => ({ ...cur, audioVolume: Number(e.target.value) }))} />
                </label>
                <label className="vs-check">
                  <input type="checkbox" checked={project.cameraAutoFollow} onChange={(e) => setProject((cur) => ({ ...cur, cameraAutoFollow: e.target.checked }))} />
                  Auto-follow soloists (2.5D stage framing)
                </label>
              </div>
            )}
          </aside></details>}
        {!livePreview && <details className="vs-advanced" onToggle={e=>setAdvancedOpen(e.currentTarget.open)}>
          <summary>Remotion layers</summary>
          {advancedOpen&&<RemotionDock project={previewProject} playerRef={playerRef} composition={composition} setComposition={selectComposition}
            onSeek={showingRehearsal ? transport.seekTo : undefined} onToggle={showingRehearsal ? transport.toggle : undefined}/>}
        </details>}
          </>}
        </details>
      </div>
    </Screen>
  );
}

export default VideoStudio;
