/**
 * CHIMERA Moppets Studio — Mop #1 (Tabby) workspace wrapping Three.js stage, CHIMERA MIDI-only
 * singing, live playable keys, vocal tract inspector, and 1280x720 MP4/WebM export.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import "./studio.css";
import { engine } from "../audio/AudioEngine.ts";
import { useStore } from "../ui/store.ts";
import { AnatomyView } from "../ui/components/AnatomyView.tsx";
import { TABBY_VOICE } from "./tabby.ts";
import { fetchTabbySong, type CameraPreset, type MopAction, type ParsedMopSong } from "./midiSong.ts";
import {
  getFrameState,
  getLastSongSec,
  isPlayingSong,
  playLiveNoteOff,
  playLiveNoteOn,
  playSong,
  resetTabbyVoice,
  setCurrentSong,
  stopLiveKeys,
  stopSong,
  subscribePlayer,
} from "./player.ts";
import { MoppetStage3D, type StageDebugInfo } from "./MoppetStage3D.tsx";
import { canExportVideo, getMasterRecordStream, StageVideoExporter } from "./exportVideo.ts";

const ACTIONS: { id: MopAction; label: string }[] = [
  { id: "idle", label: "Idle" },
  { id: "sing", label: "Sing" },
  { id: "belt", label: "Belt" },
  { id: "chuckle", label: "Chuckle" },
  { id: "walk", label: "Walk" },
  { id: "toast", label: "Toast" },
  { id: "bow", label: "Bow" },
];

const CAMERAS: { id: CameraPreset | "auto"; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "wide", label: "Wide" },
  { id: "closeup", label: "Close-Up" },
  { id: "low-angle", label: "Low Angle" },
];

const KEYBOARD_NOTES: { midi: number; label: string; keyHint: string; sharp?: boolean }[] = [
  { midi: 60, label: "C4", keyHint: "Z" },
  { midi: 61, label: "C#4", keyHint: "S", sharp: true },
  { midi: 62, label: "D4", keyHint: "X" },
  { midi: 63, label: "D#4", keyHint: "D", sharp: true },
  { midi: 64, label: "E4", keyHint: "C" },
  { midi: 65, label: "F4", keyHint: "V" },
  { midi: 66, label: "F#4", keyHint: "G", sharp: true },
  { midi: 67, label: "G4", keyHint: "B" },
  { midi: 68, label: "G#4", keyHint: "H", sharp: true },
  { midi: 69, label: "A4", keyHint: "N" },
  { midi: 70, label: "A#4", keyHint: "J", sharp: true },
  { midi: 71, label: "B4", keyHint: "M" },
  { midi: 72, label: "C5", keyHint: "Q" },
  { midi: 74, label: "D5", keyHint: "W" },
  { midi: 76, label: "E5", keyHint: "E" },
];

const KEY_TO_MIDI = new Map(KEYBOARD_NOTES.map((k) => [k.keyHint.toLowerCase(), k.midi]));

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function MoppetStudioApp() {
  const [song, setSong] = useState<ParsedMopSong | null>(null);
  const [playing, setPlaying] = useState(false);
  const [songSec, setSongSec] = useState(0);
  const [activePhrase, setActivePhrase] = useState(-1);
  const [caption, setCaption] = useState("");
  const [rms, setRms] = useState(0);
  const [f0, setF0] = useState(0);
  const [cameraOverride, setCameraOverride] = useState<CameraPreset | "auto">("auto");
  const [actionOverride, setActionOverride] = useState<MopAction | null>(null);
  const [pressedMidi, setPressedMidi] = useState<number[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportElapsed, setExportElapsed] = useState(0);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const volume = useStore((s) => s.volume);
  const setVolume = useStore((s) => s.setVolume);
  const source = useStore((s) => s.source);
  const setSource = useStore((s) => s.setSource);

  const stageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captionRef = useRef("");
  const exporterRef = useRef<StageVideoExporter | null>(null);
  const exportStartedAtRef = useRef(0);
  const songRef = useRef<ParsedMopSong | null>(null);
  const stageDebugRef = useRef<StageDebugInfo | null>(null);
  const [fmvBadge, setFmvBadge] = useState("FMV loading…");
  songRef.current = song;

  useEffect(() => {
    void fetchTabbySong()
      .then((loaded) => {
        setSong(loaded);
        setCurrentSong(loaded);
      })
      .catch((e) => setErrorMsg(e instanceof Error ? e.message : String(e)));
    return () => {
      stopSong();
      stopLiveKeys();
    };
  }, []);

  useEffect(() => {
    return subscribePlayer(() => setPlaying(isPlayingSong()));
  }, []);

  // Expose live inspection state for headless browser verification
  useEffect(() => {
    (window as unknown as { __moppetStudio?: unknown }).__moppetStudio = {
      getFrame: () => getFrameState(songRef.current),
      isPlaying: () => isPlayingSong(),
      getStageDebug: () => stageDebugRef.current,
    };
  }, []);

  // Poll lightweight UI readouts at ~12 Hz (never throttling the 60 fps Three.js stage)
  useEffect(() => {
    const id = setInterval(() => {
      const f = getFrameState(songRef.current);
      setPlaying(f.playing);
      setSongSec(f.songSec);
      setActivePhrase(f.phraseIndex);
      setRms(f.rms);
      setF0(f.f0);
      const dbg = stageDebugRef.current;
      if (dbg) {
        setFmvBadge(
          dbg.usingVideoTexture
            ? `FMV ${dbg.activeAction} ${dbg.frameIndex}/${dbg.totalFrames}f`
            : `Canon ${dbg.activeAction}`,
        );
      }
      if (exporterRef.current) {
        setExportElapsed((performance.now() - exportStartedAtRef.current) / 1000);
      }
    }, 85);
    return () => clearInterval(id);
  }, []);

  const finishExport = useCallback(async () => {
    const rec = exporterRef.current;
    if (!rec) return;
    exporterRef.current = null;
    try {
      const out = await rec.stopAndDownload("tabby-studio404");
      setExportNote(`Saved ${out.filename} (${Math.round(out.sizeBytes / 1024)} KB)`);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
      setExportElapsed(0);
    }
  }, []);

  const handlePlayToggle = async () => {
    setErrorMsg(null);
    if (!song) return;
    if (isPlayingSong()) {
      stopSong();
      setPlaying(false);
      return;
    }
    const resumeAt = getLastSongSec() >= song.durationSec - 1 ? 0 : getLastSongSec();
    const ok = await playSong(song, {
      startSec: resumeAt,
      onEnd: () => {
        setPlaying(false);
        if (exporterRef.current) void finishExport();
      },
    });
    setPlaying(ok);
  };

  const handleSeek = async (sec: number) => {
    if (!song) return;
    setSongSec(sec);
    if (isPlayingSong()) {
      await playSong(song, { startSec: sec });
    } else {
      await playSong(song, { startSec: sec });
    }
  };

  const handleExportToggle = async () => {
    setErrorMsg(null);
    setExportNote(null);
    if (!song) return;
    if (exporterRef.current) {
      stopSong();
      await finishExport();
      return;
    }
    try {
      if (!canExportVideo()) throw new Error("MediaRecorder video export is unavailable in this browser");
      await playSong(song, {
        startSec: 0,
        onEnd: () => {
          setPlaying(false);
          void finishExport();
        },
      });
      const stream = getMasterRecordStream();
      exporterRef.current = new StageVideoExporter(
        () => stageCanvasRef.current,
        () => captionRef.current,
        stream,
      );
      exportStartedAtRef.current = performance.now();
      setExporting(true);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setExporting(false);
    }
  };

  // Computer keyboard live singing (Z-M, Q-E)
  useEffect(() => {
    const down = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      const midi = KEY_TO_MIDI.get(k);
      if (midi === undefined || down.has(k)) return;
      down.add(k);
      setPressedMidi((prev) => (prev.includes(midi) ? prev : [...prev, midi]));
      void playLiveNoteOn(midi, 96);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const midi = KEY_TO_MIDI.get(k);
      if (midi === undefined || !down.has(k)) return;
      down.delete(k);
      setPressedMidi((prev) => prev.filter((m) => m !== midi));
      playLiveNoteOff(midi);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const getFrame = useCallback(() => getFrameState(songRef.current), []);
  const handleCanvasReady = useCallback((c: HTMLCanvasElement | null) => {
    stageCanvasRef.current = c;
  }, []);
  const handleStageDebug = useCallback((dbg: StageDebugInfo) => {
    stageDebugRef.current = dbg;
  }, []);
  const onCaptionFrame = useCallback((text: string) => {
    if (text !== captionRef.current) {
      captionRef.current = text;
      setCaption(text);
    }
  }, []);

  const duration = song?.durationSec ?? 34;

  return (
    <div className="mop-shell">
      {/* Top Transport Bar */}
      <header className="mop-topbar" data-stitch-id="studio-topbar">
        <div className="mop-brand">
          <img className="mop-brand-mark" src="/moppets/tabby/portrait.webp" alt="Tabby" />
          <h1 className="mop-brand-title">CHIMERA Moppets Studio</h1>
          <span className="mop-song-pill mop-num">
            {song ? `${song.title} · ${Math.round(song.bpm)} BPM · ${song.key}` : "Loading score…"}
          </span>
        </div>

        <div className="mop-transport">
          <button
            type="button"
            className="mop-btn primary"
            data-testid="play-btn"
            disabled={!song}
            onClick={() => void handlePlayToggle()}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              {playing ? (
                <path fill="currentColor" d="M3 2h3.5v12H3V2zm6.5 0H13v12H9.5V2z" />
              ) : (
                <path fill="currentColor" d="M3.5 2.2v11.6L13.5 8 3.5 2.2z" />
              )}
            </svg>
            {playing ? "Pause" : "Play"}
          </button>

          <input
            type="range"
            aria-label="Song timeline"
            className="mop-range mop-scrubber"
            min={0}
            max={duration}
            step={0.1}
            value={Math.min(duration, songSec)}
            onChange={(e) => void handleSeek(Number(e.target.value))}
          />

          <span className="mop-num" style={{ fontSize: 12, color: "var(--m-muted)", minWidth: 82, textAlign: "right" }}>
            {fmtClock(songSec)} / {fmtClock(duration)}
          </span>
        </div>

        <div className="mop-top-actions">
          <label className="mop-vol-wrap">
            <span>Vol</span>
            <input
              type="range"
              aria-label="Master Volume"
              className="mop-range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </label>

          <button
            type="button"
            className={`mop-btn ${exporting ? "export-active" : ""}`}
            data-testid="export-btn"
            disabled={!song}
            onClick={() => void handleExportToggle()}
          >
            {exporting ? `Save Now (${exportElapsed.toFixed(1)}s)` : "Export Video"}
          </button>

          <a className="mop-btn" href="/?view=chimera">
            Airway Lab
          </a>
          <a className="mop-btn" href="/rig.html">
            3D Rig
          </a>
        </div>
      </header>

      {/* Center 16:9 Three.js Stage */}
      <section className="mop-stage-card" data-stitch-id="stage-viewport" aria-label="Studio 404 Three.js Stage">
        <MoppetStage3D
          getFrame={getFrame}
          cameraOverride={cameraOverride}
          actionOverride={actionOverride}
          onCanvasReady={handleCanvasReady}
          onCaptionFrame={onCaptionFrame}
          onStageDebug={handleStageDebug}
        />

        <div className="mop-stage-overlay-top">
          <div className="mop-action-group" role="group" aria-label="Stage actions">
            {ACTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`mop-pill-btn ${actionOverride === a.id ? "active" : ""}`}
                data-action={a.id}
                onClick={() => setActionOverride((prev) => (prev === a.id ? null : a.id))}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div className="mop-cam-group" role="group" aria-label="Camera angles">
            {CAMERAS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`mop-pill-btn ${cameraOverride === c.id ? "active" : ""}`}
                data-cam={c.id}
                onClick={() => setCameraOverride(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mop-stage-overlay-bottom">
          <span className="mop-num" style={{ fontSize: 12, color: "var(--m-muted)", background: "rgba(17,16,20,0.78)", padding: "5px 10px", borderRadius: 8, border: "1px solid var(--m-border)" }}>
            {f0 > 40 ? `${Math.round(f0)} Hz` : "Ready"} · RMS {rms.toFixed(3)} · {fmvBadge}
          </span>
          {caption && <div className="mop-caption-box">{caption}</div>}
        </div>
      </section>

      {/* Bottom 3-Zone Studio Console */}
      <section className="mop-console" data-stitch-id="studio-console">
        {/* Left: Cast Roster */}
        <div className="mop-panel">
          <div className="mop-panel-head">
            <h2 className="mop-panel-title">Cast Roster</h2>
            <span className="mop-num" style={{ fontSize: 11, color: "var(--m-teal)" }}>1 / 21</span>
          </div>

          <div className="mop-cast-active">
            <img className="mop-cast-avatar" src="/moppets/tabby/portrait.webp" alt="Tabby portrait" />
            <div className="mop-cast-meta">
              <div className="mop-cast-name">{TABBY_VOICE.name}</div>
              <div className="mop-cast-role">{TABBY_VOICE.role}</div>
              <div className="mop-meter-track">
                <div className="mop-meter-fill" style={{ width: `${Math.min(100, rms * 450)}%` }} />
              </div>
            </div>
          </div>

          <div className="mop-cast-next">
            <strong>Mop #1 Canon v2:</strong> Female 90 · Child 10%, lit 24 fps <code>#00FF00</code> FMV <code>VideoTexture</code> streams atop Studio 404 trunk riser. Next migration slot: <strong>Neon</strong>.
          </div>

          {(errorMsg || exportNote) && (
            <div className={`mop-status-line ${errorMsg ? "mop-status-err" : ""}`}>
              <span>{errorMsg ?? exportNote}</span>
            </div>
          )}
        </div>

        {/* Center: Lead Sheet & Playable Keys */}
        <div className="mop-panel">
          <div className="mop-panel-head">
            <h2 className="mop-panel-title">Lead Sheet &amp; Live Keys</h2>
            <span className="mop-num" style={{ fontSize: 11, color: "var(--m-muted)" }}>
              Click phrase to seek · Z–M / Q–E to sing
            </span>
          </div>

          <div className="mop-phrases">
            {song?.phrases.map((p) => (
              <button
                key={p.index}
                type="button"
                className={`mop-phrase-row ${activePhrase === p.index ? "active" : ""}`}
                onClick={() => void handleSeek((p.startBeat * 60) / song.bpm)}
              >
                <span>{p.words.replace(/_/g, "")}</span>
                <span className="mop-phrase-cue">
                  {[p.doGesture, p.take, p.moveTarget, p.cam].filter(Boolean).join(" · ") || p.section}
                </span>
              </button>
            ))}
          </div>

          <div className="mop-piano" role="group" aria-label="Playable vocal keyboard">
            {KEYBOARD_NOTES.map((k) => {
              const down = pressedMidi.includes(k.midi);
              return (
                <button
                  key={k.midi}
                  type="button"
                  className={`mop-key ${k.sharp ? "sharp" : ""} ${down ? "pressed" : ""}`}
                  onPointerDown={() => {
                    setPressedMidi((prev) => (prev.includes(k.midi) ? prev : [...prev, k.midi]));
                    void playLiveNoteOn(k.midi, 96);
                  }}
                  onPointerUp={() => {
                    setPressedMidi((prev) => prev.filter((m) => m !== k.midi));
                    playLiveNoteOff(k.midi);
                  }}
                  onPointerLeave={() => {
                    if (down) {
                      setPressedMidi((prev) => prev.filter((m) => m !== k.midi));
                      playLiveNoteOff(k.midi);
                    }
                  }}
                >
                  <span>{k.keyHint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: CHIMERA Voice & Live Airway */}
        <div className="mop-panel">
          <div className="mop-panel-head">
            <h2 className="mop-panel-title">CHIMERA Voice &amp; Airway</h2>
            <button type="button" className="mop-btn" style={{ height: 26, padding: "0 9px", fontSize: 11 }} onClick={resetTabbyVoice}>
              Reset Canon
            </button>
          </div>

          <div className="mop-sliders">
            <label className="mop-slider-field">
              <div className="mop-slider-top">
                <span>Pressure</span>
                <span className="mop-num">{source.pressure.toFixed(1)}</span>
              </div>
              <input
                type="range"
                className="mop-range"
                min={6.4}
                max={8.6}
                step={0.1}
                value={source.pressure}
                onChange={(e) => setSource({ pressure: Number(e.target.value) })}
              />
            </label>

            <label className="mop-slider-field">
              <div className="mop-slider-top">
                <span>Tension</span>
                <span className="mop-num">{source.tension.toFixed(2)}</span>
              </div>
              <input
                type="range"
                className="mop-range"
                min={0.35}
                max={0.72}
                step={0.01}
                value={source.tension}
                onChange={(e) => setSource({ tension: Number(e.target.value) })}
              />
            </label>

            <label className="mop-slider-field">
              <div className="mop-slider-top">
                <span>Brightness</span>
                <span className="mop-num">{source.brightness.toFixed(2)}</span>
              </div>
              <input
                type="range"
                className="mop-range"
                min={0.12}
                max={0.55}
                step={0.01}
                value={source.brightness}
                onChange={(e) => setSource({ brightness: Number(e.target.value) })}
              />
            </label>

            <label className="mop-slider-field">
              <div className="mop-slider-top">
                <span>Breathiness</span>
                <span className="mop-num">{source.breathiness.toFixed(2)}</span>
              </div>
              <input
                type="range"
                className="mop-range"
                min={0.04}
                max={0.24}
                step={0.01}
                value={source.breathiness}
                onChange={(e) => setSource({ breathiness: Number(e.target.value) })}
              />
            </label>
          </div>

          <div className="mop-tract-box" aria-label="Live CHIMERA sagittal vocal tract">
            <AnatomyView showFormants={false} />
          </div>
        </div>
      </section>
    </div>
  );
}
