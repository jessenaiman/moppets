/**
 * Moppets screens inside CHIMERA's settled Hershey vector-display UI (`docs/ui-redesign.md`).
 *
 * - `MoppetStageScreen`: the left focus screen hosting the 60 fps Studio 404 Three.js stage +
 *   camera & directed-take chips.
 * - `MoppetsRight`: the right instrument column (`ActionBar` with Spacebar Sing, `Band` stem chip,
 *   `Record video` 1280x720 MP4/WebM export; `Lead sheet` with live word editing & CMUdict syllable
 *   check per `docs/writing-songs.md`; 4-slot OP-1 `Voice` encoders; `<Screen watch>` live `Airway`;
 *   and CHIMERA's 25-key `<Keys />` + Web MIDI `<MidiButton />`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import "./studio.css";
import { useStore } from "../ui/store.ts";
import { AnatomyView } from "../ui/components/AnatomyView.tsx";
import { ActionBar, PrimaryButton } from "../ui/components/ActionBar.tsx";
import { EncoderPages } from "../ui/components/Encoder.tsx";
import { Keys, MidiButton } from "../ui/components/Keys.tsx";
import { Chip, Screen } from "../ui/components/Screen.tsx";
import { noteName } from "../ui/components/VoiceControls.tsx";
import { TABBY_VOICE } from "./tabby.ts";
import {
  checkPhraseWords,
  fetchTabbySong,
  holdFixWords,
  updateSongPhraseWords,
  type CameraPreset,
  type MopAction,
  type ParsedMopSong,
} from "./midiSong.ts";
import {
  getFrameState,
  getLastSongSec,
  isBandEnabled,
  isPlayingSong,
  playSong,
  resetTabbyVoice,
  setBandEnabled,
  setCurrentSong,
  stopLiveKeys,
  stopSong,
  subscribePlayer,
} from "./player.ts";
import { MoppetStage3D } from "./MoppetStage3D.tsx";
import { canExportVideo, getMasterRecordStream, StageVideoExporter } from "./exportVideo.ts";

const ACTIONS: { id: MopAction; label: string }[] = [
  { id: "idle", label: "Idle" },
  { id: "sing", label: "Sing" },
  { id: "belt", label: "Belt" },
  { id: "chuckle", label: "Laugh" },
  { id: "walk", label: "Walk" },
  { id: "toast", label: "Toast" },
  { id: "bow", label: "Bow" },
];

const CAMERAS: { id: CameraPreset | "auto"; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "wide", label: "Wide" },
  { id: "closeup", label: "Close" },
  { id: "low-angle", label: "Low" },
];

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Shared stage bridge between `MoppetStageScreen` (left column) and `MoppetsRight` (right column)
interface SharedStudioBridge {
  song: ParsedMopSong | null;
  originalSong: ParsedMopSong | null;
  stageCanvas: HTMLCanvasElement | null;
  caption: string;
  cameraOverride: CameraPreset | "auto";
  actionOverride: MopAction | null;
  listeners: Set<() => void>;
}

const bridge: SharedStudioBridge = {
  song: null,
  originalSong: null,
  stageCanvas: null,
  caption: "",
  cameraOverride: "auto",
  actionOverride: null,
  listeners: new Set(),
};

function notifyBridge(): void {
  for (const fn of bridge.listeners) fn();
}

function useBridgeState() {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    bridge.listeners.add(fn);
    return () => {
      bridge.listeners.delete(fn);
    };
  }, []);
  return bridge;
}

let songLoadStarted = false;

function ensureSongLoaded(onError: (msg: string) => void): void {
  if (bridge.song || songLoadStarted) return;
  songLoadStarted = true;
  void fetchTabbySong()
    .then((loaded) => {
      bridge.song = loaded;
      bridge.originalSong = loaded;
      setCurrentSong(loaded);
      notifyBridge();
    })
    .catch((e) => {
      songLoadStarted = false;
      onError(e instanceof Error ? e.message : String(e));
    });
}

export function MoppetStageScreen() {
  const b = useBridgeState();
  const [caption, setCaption] = useState("");

  useEffect(() => {
    ensureSongLoaded(() => {});
  }, []);

  const getFrame = useCallback(() => getFrameState(bridge.song), []);
  const handleCanvasReady = useCallback((c: HTMLCanvasElement | null) => {
    bridge.stageCanvas = c;
  }, []);
  const handleCaptionFrame = useCallback((text: string) => {
    if (text !== bridge.caption) {
      bridge.caption = text;
      setCaption(text);
    }
  }, []);

  return (
    <Screen
      className="left s-moppet-stage"
      focus
      label="Studio 404 stage"
      lead={
        <span className="moppet-stage-head-lead">
          <img className="moppet-avatar" src="/moppets/tabby/portrait.webp" alt="" />
          <span className="moppet-stage-title">{TABBY_VOICE.name} · Studio 404</span>
        </span>
      }
      tools={
        <div className="moppet-chip-row">
          {ACTIONS.map((a) => (
            <Chip
              key={a.id}
              on={b.actionOverride === a.id}
              onClick={() => {
                bridge.actionOverride = bridge.actionOverride === a.id ? null : a.id;
                notifyBridge();
              }}
            >
              {a.label}
            </Chip>
          ))}
          {CAMERAS.map((c) => (
            <Chip
              key={c.id}
              tone="amber"
              on={b.cameraOverride === c.id}
              onClick={() => {
                bridge.cameraOverride = c.id;
                notifyBridge();
              }}
            >
              {c.label}
            </Chip>
          ))}
        </div>
      }
    >
      <div className="moppet-stage-wrap">
        <MoppetStage3D
          getFrame={getFrame}
          cameraOverride={b.cameraOverride}
          actionOverride={b.actionOverride}
          onCanvasReady={handleCanvasReady}
          onCaptionFrame={handleCaptionFrame}
        />
        {caption && (
          <div className="moppet-caption-bar" data-layout="overlay">
            <div className="moppet-caption-text">{caption}</div>
          </div>
        )}
      </div>
    </Screen>
  );
}

export function MoppetsRight() {
  const b = useBridgeState();
  const song = b.song;

  const [playing, setPlaying] = useState(false);
  const [bandOn, setBandOnState] = useState(isBandEnabled());
  const [songSec, setSongSec] = useState(0);
  const [activePhrase, setActivePhrase] = useState(-1);
  const [f0, setF0] = useState(0);
  const [editingWords, setEditingWords] = useState(false);
  const [draftWords, setDraftWords] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportElapsed, setExportElapsed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const source = useStore((s) => s.source);
  const setSource = useStore((s) => s.setSource);
  const artic = useStore((s) => s.artic);
  const setArtic = useStore((s) => s.setArtic);

  const exporterRef = useRef<StageVideoExporter | null>(null);
  const exportStartedAtRef = useRef(0);

  useEffect(() => {
    ensureSongLoaded((msg) => setErrorMsg(msg));
    return () => {
      stopSong();
      stopLiveKeys();
    };
  }, []);

  useEffect(() => {
    if (song && !editingWords) {
      setDraftWords(song.phrases.map((p) => p.words));
    }
  }, [song, editingWords]);

  useEffect(() => {
    return subscribePlayer(() => {
      setPlaying(isPlayingSong());
      setBandOnState(isBandEnabled());
    });
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const f = getFrameState(bridge.song);
      setPlaying(f.playing);
      setSongSec(f.songSec);
      setActivePhrase(f.phraseIndex);
      setF0(f.f0);
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
      setNotice(`Saved ${out.filename} (${Math.round(out.sizeBytes / 1024)} KB)`);
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
      if (exporterRef.current) await finishExport();
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
    const ok = await playSong(song, { startSec: sec });
    setPlaying(ok);
  };

  const handleBandToggle = () => {
    const next = !bandOn;
    setBandOnState(next);
    setBandEnabled(next);
  };

  const handleExportToggle = async () => {
    setErrorMsg(null);
    setNotice(null);
    if (!song) return;
    if (exporterRef.current) {
      stopSong();
      await finishExport();
      return;
    }
    try {
      if (!canExportVideo()) throw new Error("MediaRecorder video export is unavailable in this browser");
      const ok = await playSong(song, {
        startSec: 0,
        onEnd: () => {
          setPlaying(false);
          void finishExport();
        },
      });
      setPlaying(ok);
      const stream = getMasterRecordStream();
      exporterRef.current = new StageVideoExporter(
        () => bridge.stageCanvas,
        () => bridge.caption,
        stream,
      );
      exportStartedAtRef.current = performance.now();
      setExporting(true);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setExporting(false);
    }
  };

  const handleWordEdit = (phraseIdx: number, nextWords: string) => {
    if (!song) return;
    const nextDrafts = draftWords.slice();
    nextDrafts[phraseIdx] = nextWords;
    setDraftWords(nextDrafts);

    const phrase = song.phrases[phraseIdx];
    if (!phrase) return;
    const check = checkPhraseWords(nextWords, phrase.rhythm.length);
    if (check.ok) {
      const updated = updateSongPhraseWords(song, phraseIdx, nextWords);
      bridge.song = updated;
      setCurrentSong(updated);
      notifyBridge();
    }
  };

  const handleRevertWords = () => {
    if (!bridge.originalSong) return;
    bridge.song = bridge.originalSong;
    setCurrentSong(bridge.originalSong);
    setDraftWords(bridge.originalSong.phrases.map((p) => p.words));
    notifyBridge();
    setNotice("Reverted lead sheet to bible-tabby.song");
  };

  const handleDownloadSong = () => {
    if (!song) return;
    const blob = new Blob([song.rawSongText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${song.id}.song`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const duration = song?.durationSec ?? 34;
  const pct = (v: number) => ({ value: String(Math.round(v * 100)), unit: "%" });

  return (
    <div className="right right-moppets">
      <ActionBar label="Moppets" onSpace={() => void handlePlayToggle()}>
        <PrimaryButton
          label="Sing"
          playing={playing}
          onClick={() => void handlePlayToggle()}
          title="Play Tabby's Studio 404 score through CHIMERA WASM + backing band (Space)"
        />
        <Chip on={bandOn} onClick={handleBandToggle} title="Toggle pure-JS bass, electric piano & beat accompaniment">
          Band
        </Chip>
        <Chip
          toggle={false}
          tone="amber"
          onClick={() => void handleExportToggle()}
          disabled={!song}
          title="Record 1280x720 stage video + CHIMERA master audio"
        >
          {exporting ? `Save clip (${exportElapsed.toFixed(1)}s)` : "Record video"}
        </Chip>
        <a className="chip" href="/rig.html" title="Open the 3D body rig playground">
          3D Rig
        </a>
      </ActionBar>

      <Screen
        className="s-moppet-sheet"
        title="Lead sheet"
        sub={song ? `${song.title} · ${Math.round(song.bpm)} BPM · ${song.key}` : "Loading…"}
        tools={
          <Chip on={editingWords} onClick={() => setEditingWords((v) => !v)}>
            Edit words
          </Chip>
        }
      >
        <div className="moppet-timeline-row">
          <input
            type="range"
            aria-label="Song timeline"
            min={0}
            max={duration}
            step={0.1}
            value={Math.min(duration, songSec)}
            onChange={(e) => void handleSeek(Number(e.target.value))}
            style={{ "--pos": `${Math.min(100, (songSec / Math.max(1, duration)) * 100)}%` } as React.CSSProperties}
          />
          <span className="moppet-clock">
            {fmtClock(songSec)} / {fmtClock(duration)}
          </span>
        </div>

        <div className="moppet-sheet-body">
          {!editingWords
            ? song?.phrases.map((p) => (
                <button
                  key={p.index}
                  type="button"
                  className={`moppet-phrase-btn${activePhrase === p.index ? " on" : ""}`}
                  onClick={() => void handleSeek((p.startBeat * 60) / song.bpm)}
                >
                  <span>{p.words.replace(/_/g, "")}</span>
                  <span className="moppet-phrase-tag">
                    {[p.take ?? p.doGesture, p.cam].filter(Boolean).join(" · ") || p.section}
                  </span>
                </button>
              ))
            : song?.phrases.map((p, idx) => {
                const text = draftWords[idx] ?? p.words;
                const check = checkPhraseWords(text, p.rhythm.length);
                const spare = p.rhythm.length - check.syllables.length;
                return (
                  <div key={p.index} className={`moppet-edit-row${check.ok ? "" : " bad"}`}>
                    <input
                      type="text"
                      className="moppet-edit-input"
                      aria-label={`Phrase ${idx + 1} lyrics`}
                      value={text}
                      onKeyDown={(e) => e.stopPropagation()}
                      onChange={(e) => handleWordEdit(idx, e.target.value)}
                    />
                    <div className={`moppet-edit-meta${check.ok ? "" : " bad"}`}>
                      <span>
                        {check.syllables.join("·") || "—"} ·{" "}
                        {check.ok ? `${check.noteCount} ✓` : check.problem}
                      </span>
                      {!check.ok && spare > 0 && (
                        <Chip
                          toggle={false}
                          onClick={() => handleWordEdit(idx, holdFixWords(text, spare))}
                        >
                          Hold (_)
                        </Chip>
                      )}
                    </div>
                  </div>
                );
              })}
        </div>

        {editingWords && (
          <div className="moppet-edit-toolbar">
            <Chip toggle={false} onClick={handleDownloadSong}>
              Save .song
            </Chip>
            <Chip toggle={false} onClick={handleRevertWords}>
              Revert
            </Chip>
          </div>
        )}

        {(errorMsg || notice) && (
          <p className={`moppet-notice${errorMsg ? " err" : ""}`} role="status">
            {errorMsg ?? notice}
          </p>
        )}
      </Screen>

      <Screen
        className="s-voice"
        title="Voice"
        sub="Tabby · Female 90 · Child 10%"
        tools={
          <Chip toggle={false} onClick={resetTabbyVoice} title="Restore calibrated Tabby soprano parameters">
            Tabby preset
          </Chip>
        }
      >
        <EncoderPages
          label="Tabby voice"
          pages={[
            {
              name: "Source",
              encoders: [
                {
                  label: "Breath",
                  value: source.pressure,
                  min: 6.4,
                  max: 8.6,
                  step: 0.1,
                  onChange: (v) => setSource({ pressure: v }),
                  format: (v) => ({ value: v.toFixed(1), unit: "cmH₂O" }),
                },
                {
                  label: "Pressed",
                  value: source.tension,
                  min: 0.36,
                  max: 0.68,
                  step: 0.01,
                  onChange: (v) => setSource({ tension: v }),
                  format: pct,
                },
                {
                  label: "Bright",
                  value: source.brightness,
                  min: 0.15,
                  max: 0.5,
                  step: 0.01,
                  onChange: (v) => setSource({ brightness: v }),
                  format: pct,
                },
                {
                  label: "Breathy",
                  value: source.breathiness,
                  min: 0.04,
                  max: 0.22,
                  step: 0.01,
                  onChange: (v) => setSource({ breathiness: v }),
                  format: pct,
                },
              ],
            },
            {
              name: "Tract",
              encoders: [
                {
                  label: "Rate",
                  value: source.vibratoRate,
                  min: 4.8,
                  max: 6.6,
                  step: 0.1,
                  onChange: (v) => setSource({ vibratoRate: v }),
                  format: (v) => ({ value: v.toFixed(1), unit: "Hz" }),
                },
                {
                  label: "Glide",
                  value: source.glide,
                  min: 0.06,
                  max: 0.14,
                  step: 0.005,
                  onChange: (v) => setSource({ glide: v }),
                  format: (v) => ({ value: String(Math.round(v * 1000)), unit: "ms" }),
                },
                {
                  label: "Larynx",
                  value: artic.larynx,
                  min: -0.6,
                  max: 0.8,
                  step: 0.02,
                  onChange: (v) => setArtic({ larynx: v }),
                  format: (v) => ({ value: `${v >= 0 ? "+" : ""}${v.toFixed(2)}`, unit: "cm" }),
                },
                {
                  label: "Twang",
                  value: artic.epilarynx,
                  min: 0,
                  max: 0.45,
                  step: 0.01,
                  onChange: (v) => setArtic({ epilarynx: v }),
                  format: pct,
                },
              ],
            },
          ]}
        />
      </Screen>

      <Screen
        className="s-keys"
        title="Keys"
        sub={f0 > 45 ? `${noteName(f0)} · ${Math.round(f0)} Hz` : "A–; keys · Z/X octave"}
        tools={<MidiButton />}
      >
        <Keys />
      </Screen>
    </div>
  );
}

export function MoppetAirwayScreen() {
  return (
    <Screen watch className="s-moppet-airway" title="Airway" sub="Live sagittal vocal tract">
      <AnatomyView showFormants={false} />
    </Screen>
  );
}
