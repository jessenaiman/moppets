import { measures } from "../choir/meter.ts";
import { NewRehearsal } from "./NewRehearsal";
import { CastReferences } from "./CastReferences";
import VideoStudio from "./VideoStudio";
import {PortableStage} from "./PortableStage";
import {buildVideoProject} from "../choir/videoProject";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useAudio } from "../audio/audio.ts";
import { Screen } from "@chimera/ui/components/Screen.tsx";
import { currentFile, lessonFile, useMoppet, type Lesson } from "../choir/store.ts";
import { checkSung, holdAt, holdFix, lineStarts, splitFix, splitNote, unholdAt } from "../choir/songCheck.ts";
import type { Line, Section, Sung } from "../choir/songbook.ts";
import { sheetWords, type SongFile } from "../choir/songFile.ts";
import { g2p } from "../audio/g2p.ts";
import { cancel, scopeOf, useTelemetry, ensembleDebug, exportWav, loadPiece, play, pose, seek, stop, useEnsemble } from "../choir/ensemble.ts";
import { GROOVES, MODES, PALETTES, PROGRESSIONS } from "../choir/theory.ts";
import { KEYS, noteName, ROUND_LYRICS, type KeyName, type Piece, type ScaleMode, type ScoreEvent, type Track } from "../choir/music.ts";
import { midiBytes } from "../choir/midi.ts";
import { beatSeconds, LEAD_IN, pieceSeconds, sungSyllables } from "../choir/plan.ts";
import { CAST, CHORUS, type MoppetVoice } from "../choir/voices.ts";
import { makeIntroduction } from "../choir/music.ts";
import { Choreographer, featuredAt, sceneFeatured, type Actor } from "../choir/choreo.ts";
import { SKITS } from "../choir/skits.ts";
import { shownWords } from "../choir/captions.ts";
import { stageTalkAt } from "../choir/bubbles.ts";
import { effectOf, PropFx, updateProp } from "./props.tsx";
import { STUDIO_404_CAST, studio404Name } from "../choir/studio404.ts";
import { LaunchkeyConnect, LaunchkeyMap } from "./launchkey-map.tsx";
import { bandEnabled, bandFor } from "../choir/band.ts";
import { livePose, liveMidiPitch, liveNoteOff, liveNoteOn, auditionNote, MOUTH, moveMouth, PAD_VOWELS, padVowel, useLive, type LiveMode } from "../choir/live.ts";
import type { Pose } from "../choir/pose.ts";
import { ShotcraftStage, type LiveMidiSpeech } from "../stage/ShotcraftStage.tsx";
import { RehearsalStaffPanel, VexStaffLine, type StaffNoteItem } from "./StaffEditor.tsx";
import { SONGBOOK } from "../choir/songbook.ts";
import { lockVoiceControls, resetSelectedVocal, applyControl, ccFor, CONTROLS, handleControl, touchControl, useController, type ControlGroup, type ControlKey } from "../choir/controller.ts";
import { midiSupported } from "./midi.ts";
import { instrumentPart, partKey } from "../choir/pluginScore.ts";
import { EnsemblePuppet } from "./EnsemblePuppet.tsx";
import { manifestForCharacter } from "../choir/clipTimeline.ts";
import { SoloPuppet } from "./SoloPuppet.tsx";
import "./moppet.css";

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function download(blob: Blob, name: string): void {
  const u = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

/** The score moment now sounding, in beats. */
const beatNow = (p: Piece, seconds: number) => Math.max(0, (seconds - LEAD_IN) / beatSeconds(p));

function PlayLabel({ piece }: { piece: Piece }) {
  const status = useEnsemble((s) => s.status);
  if (status === "playing" || status === "buffering") return <>Ⅱ&nbsp; Pause</>;
  if (status === "paused") return <>▶&nbsp; Continue</>;
  if (status === "preparing" || status === "rendering") return <>Rendering…</>;
  const again = status === "ended" ? "↻ " : "▶ ";
  const name = piece.kind === "intro" ? "Meet the whole choir" : piece.kind === "round" ? "Play the jam round" : piece.kind === "solo" ? `Sing ${piece.tracks[0].id}'s introduction` : piece.kind === "motesong" || piece.kind === "skit" ? `Play “${piece.title}”` : "Play the new invention";
  return <>{again}&nbsp;{name}</>;
}

/** The words a Moppet is singing at `beat`, and how far through them it is (0..1). */
function lineAt(piece: Piece, id: string, beat: number): { text: string; at: number } | null {
  const t = piece.tracks.find((x) => x.id === id);
  const words = t?.phrases ?? t?.lines;
  const e = t?.events.find((x) => beat >= x.beat && beat < x.beat + x.beats && x.line !== undefined);
  if (!t || !words || !e) return null;
  const same = t.events.filter((x) => x.line === e.line && Math.abs(x.beat - e.beat) < 32);
  const start = Math.min(...same.map((x) => x.beat)), end = Math.max(...same.map((x) => x.beat + x.beats));
  return { text: shownWords(words[e.line!]), at: Math.min(1, (beat - start + 0.5) / Math.max(0.5, end - start)) };
}

/** A music note floating up from a singer (vector shape only, never text). */
interface Note {
  x: number;
  y: number;
  age: number;
  life: number;
  seed: number;
  color: string;
  double: boolean;
}

function fitCanvas(c: HTMLCanvasElement, W: number, H: number): CanvasRenderingContext2D | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(W * dpr), h = Math.round(H * dpr);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const g = c.getContext("2d");
  g?.setTransform(dpr, 0, 0, dpr, 0, 0);
  g?.clearRect(0, 0, W, H);
  return g;
}

function drawNote(g: CanvasRenderingContext2D, x: number, y: number, double: boolean) {
  const head = (hx: number, hy: number) => {
    g.beginPath();
    g.ellipse(hx, hy, 4.2, 3.1, -0.4, 0, Math.PI * 2);
    g.fill();
    g.fillRect(hx + 3, hy - 14, 1.6, 14);
  };
  head(x, y);
  if (double) {
    head(x + 10, y - 3);
    g.fillRect(x + 3, y - 15, 11.6, 3);
  } else {
    g.beginPath();
    g.moveTo(x + 4.6, y - 14);
    g.quadraticCurveTo(x + 12, y - 9, x + 9, y - 3);
    g.quadraticCurveTo(x + 10, y - 9, x + 4.6, y - 10);
    g.fill();
  }
}

function detSpawnHash(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

interface LiveStageFrame {
  beat: number;
  timeSec: number;
  performing: boolean;
  dancing: boolean;
  still: boolean;
  actors: Actor[];
  poses: Pose[];
  bandParts: ReturnType<typeof bandFor>;
  liveMidiSpeech: LiveMidiSpeech | null;
}

function Stage({ cameraFollow }: { cameraFollow: boolean }) {
  const voices = useMoppet((s) => s.voices);
  const selected = useMoppet((s) => s.selected);
  const select = useMoppet((s) => s.select);
  const piece = useMoppet((s) => s.piece);
  const status = useEnsemble((s) => s.status);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const poke = useRef<{ index: number; at: number } | null>(null);
  const [stageLabel, setStageLabel] = useState("READY WHEN YOU ARE");

  const [frameState, setFrameState] = useState<LiveStageFrame>(() => ({
    beat: 0,
    timeSec: 0,
    performing: false,
    dancing: false,
    still: false,
    actors: [],
    poses: [],
    bandParts: [],
    liveMidiSpeech: null,
  }));

  useEffect(() => {
    let raf = 0;
    let lastStage = "";
    let lastT = performance.now() / 1000;
    let choreo: Choreographer | null = null;
    let bandCache: { piece: Piece | null; on: boolean; parts: ReturnType<typeof bandFor> } = { piece: null, on: false, parts: [] };
    let noteTick = 0;
    const notes: Note[] = [];
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (now: number, dt: number) => {
      const m = useMoppet.getState();
      const e = useEnsemble.getState();
      const lv = useLive.getState();
      const active: string[] = [];
      const songTime = e.time;
      const dancing = e.status === "playing" || e.status === "buffering";
      const performing = dancing || e.status === "paused";
      const beat = performing ? beatNow(m.piece, songTime) : now * 1.1;
      const poses = m.voices.map((v) => pose(v.id));
      const lp = !performing ? livePose() : null;
      if (lp) poses[m.selected] = lp;

      const ids = m.voices.map((v) => v.id);
      if (!choreo || choreo.actors.length !== ids.length) choreo = new Choreographer(ids);
      const featured = !performing ? ids.map(() => false) : m.piece.scenes ? sceneFeatured(m.piece.scenes, ids, beat) : featuredAt(m.piece.tracks, ids, beat);
      const talk = stageTalkAt(m.piece, ids, beat, performing);
      const actors = choreo.step({ playing: performing, beat, now, featured, singing: poses.map((p) => p.singing), poke: poke.current, still, talk }, dt);

      const showBand = m.piece.stage ? m.piece.stage.includes("band") : (m.piece.kind !== "skit" && m.piece.chords.length > 0);
      if (showBand) {
        const on = bandEnabled();
        if (bandCache.piece !== m.piece || bandCache.on !== on) bandCache = { piece: m.piece, on, parts: bandFor(m.piece) };
      } else if (bandCache.parts.length) {
        bandCache = { piece: m.piece, on: false, parts: [] };
      }

      const selVoice = m.voices[m.selected];
      let liveMidiSpeech: LiveMidiSpeech | null = null;
      if (!performing && selVoice && (lp?.singing || (lv.mode !== "off" && lv.last && lp && lp.level > 0.04))) {
        const rawLast = lv.last.trim();
        const quoted = /^"([^"]+)"(?:\s*·\s*(.+))?$/.exec(rawLast);
        const text = quoted ? quoted[1] : (rawLast || (lv.words.length ? lv.words.slice(0, 6).join(" ") : "♪"));
        const noteSuffix = quoted?.[2] ? ` · ${quoted[2]}` : "";
        liveMidiSpeech = {
          voiceId: selVoice.id,
          midi: liveMidiPitch(),
          text,
          roleLabel: `${lv.mode === "words" ? "LIVE WORDS" : lv.mode === "puppet" ? "PUPPETEER" : "LIVE VOICE"}${noteSuffix}`,
          level: lp?.level ?? 0.65,
        };
      }

      const stage = stageRef.current;
      const W = stage?.clientWidth ?? 0;
      const H = stage?.clientHeight ?? 0;

      m.voices.forEach((v, i) => {
        const el = refs.current[i];
        const p = poses[i];
        const a = actors[i];
        if (p?.singing) active.push(m.studio404 ? studio404Name(v.id, v.name) : v.name);
        if (!el || !a || !p) return;
        const walkFrame = Math.floor(now * 7 + i * 3) % 8;
        const cel = dancing ? Math.floor(beat * 2) % 8 : a.walking ? walkFrame : 7;
        updateProp(
          el.querySelector<HTMLElement>(".prop"),
          v.id,
          cel,
          p,
          dt,
          effectOf(v.id) === "typewriter" ? lineAt(m.piece, v.id, beat) : null,
          effectOf(v.id) === "scope" && p.singing ? scopeOf(v.id) : null,
        );
      });

      // Vector rising eighth-notes on front canvas (no canvas text ever drawn)
      if (frontRef.current && W > 2 && H > 2) {
        const f = fitCanvas(frontRef.current, W, H);
        if (f) {
          const stepDt = Math.min(dt, 0.05);
          if (!still && m.piece.kind !== "skit") {
            const soloStage = (m.piece.stage?.length ?? 0) === 1;
            m.voices.forEach((v, i) => {
              if (m.piece.stage && !m.piece.stage.includes(v.id)) return;
              const p = poses[i];
              const a = actors[i];
              if (!p?.singing || !a) return;
              noteTick += 1;
              if (detSpawnHash(noteTick + now * 13) > stepDt * (1.1 + 4.2 * p.level)) return;
              const ax = soloStage ? 0.5 : m.studio404 ? 0.075 + Math.max(0, Math.min(1, (a.x - 0.09) / 0.82)) * 0.645 : a.x;
              const color = m.studio404 ? (STUDIO_404_CAST[v.id]?.color ?? v.color) : v.color;
              notes.push({
                x: ax * W + (detSpawnHash(noteTick + 5) - 0.5) * W * 0.04,
                y: H * (0.58 - a.depth * 0.05),
                age: 0,
                life: 1.5 + detSpawnHash(noteTick + 11) * 0.7,
                seed: detSpawnHash(noteTick + 19) * 6 + i,
                color,
                double: detSpawnHash(noteTick + 29) < 0.35,
              });
            });
          }
          for (let i = notes.length - 1; i >= 0; i--) {
            const n = notes[i];
            n.age += stepDt;
            n.y -= stepDt * 44;
            if (n.age > n.life || n.y < 20) notes.splice(i, 1);
          }
          for (const n of notes) {
            const t = n.age / n.life;
            f.globalAlpha = Math.min(1, n.age * 5) * (1 - t * t);
            f.fillStyle = n.color;
            drawNote(f, n.x + Math.sin(n.age * 3 + n.seed) * 8, n.y, n.double);
          }
          f.globalAlpha = 1;
        }
      }

      setFrameState({
        beat,
        timeSec: now,
        performing,
        dancing,
        still,
        actors: actors.map((a) => ({ ...a })),
        poses: poses.map((p) => ({ ...p })),
        bandParts: bandCache.parts,
        liveMidiSpeech,
      });

      const running = e.status === "playing" || e.status === "buffering";
      if (running) {
        const names = active.length >= 6 ? "ALL TOGETHER" : active.length > 1 ? `${active.length} VOICES IN HARMONY` : active[0] ? `${active[0].toUpperCase()} IS SINGING` : "A LITTLE BREATH";
        if (names !== lastStage) {
          lastStage = names;
          setStageLabel(names);
        }
      } else if (lastStage) {
        lastStage = "";
        setStageLabel("READY WHEN YOU ARE");
      }
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now() / 1000;
      const dt = now - lastT;
      lastT = now;
      draw(now, dt);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const [failedClips, setFailedClips] = useState<ReadonlySet<string>>(new Set());
  const studio404 = useMoppet((s) => s.studio404);
  const lesson = useMoppet(s=>s.lesson);
  return (
    <div className="moppet-stage-wrap" aria-label={status === "playing" ? stageLabel : "Stage"}>
      <div className={`stage${studio404 ? " studio404" : ""}`} ref={stageRef}>
        <ShotcraftStage
          piece={piece}
          voices={voices}
          studio404={studio404}
          beat={frameState.beat}
          timeSec={frameState.timeSec}
          performing={frameState.performing}
          dancing={frameState.dancing}
          still={frameState.still}
          selectedIndex={selected}
          cameraFollow={cameraFollow}
          actors={frameState.actors.length === voices.length ? frameState.actors : undefined}
          poses={frameState.poses.length === voices.length ? frameState.poses : undefined}
          bandParts={frameState.bandParts}
          liveMidiSpeech={frameState.liveMidiSpeech}
          onSelectActor={(i) => {
            select(i);
            poke.current = { index: i, at: performance.now() / 1000 };
          }}
          padGesture={useController.getState().gesture}
          puppetRef={(i, el) => {
            refs.current[i] = el;
          }}
          renderCharacterOverride={(id, art, style) => {
            if (!studio404 || frameState.still || failedClips.has(art)) return null;
            if (piece.stage && !piece.stage.includes(id)) return null;
            if (art !== "tabby" && !(art === "gruff" && lesson === "close-up")) {
              const manifest = manifestForCharacter(id,studio404);
              if (!manifest || frameState.liveMidiSpeech?.voiceId === id) return null;
              return <EnsemblePuppet piece={piece} voice={id} manifest={manifest}
                onError={()=>setFailedClips(previous=>new Set(previous).add(art))}/>;
            }
            return (
              <SoloPuppet art={art} solo={lesson === "tabby-solo" || lesson === "close-up"} bpm={piece.bpm} style={style}
                onError={() => setFailedClips(previous => new Set(previous).add(art))} />
            );
          }}
          renderPropFx={(id) => <PropFx id={id} />}
        />
        <canvas ref={frontRef} className="stage-fx front" data-layout="overlay" aria-hidden="true" />
      </div>

    </div>
  );
}

function Transport() {
  const piece = useMoppet((s) => s.piece);
  const status = useEnsemble((s) => s.status);
  const duration = useEnsemble((s) => s.duration);
  const time = useEnsemble((s) => s.time);
  const howPlaying = useEnsemble((s) => s.howPlaying);
  const start = useAudio((s) => s.start);
  const volume = useAudio((s) => s.volume);
  const setVolume = useAudio((s) => s.setVolume);
  const message = useEnsemble(s=>s.message);
  const shown = duration || pieceSeconds(piece);
  const busy = status === "preparing" || status === "rendering";
  return (
    <div className="transport">
      <button className="primary moppet-play" onClick={() => void play(start)} disabled={busy} data-kind={piece.kind}>
        <PlayLabel piece={piece} />
      </button>
      <button className="square" aria-label="Stop playback" onClick={stop} disabled={status === "idle"}>■</button>
      {busy && <button onClick={cancel}>Cancel</button>}
      <div className="timeline">
        <input aria-label="Song position" type="range" min={0} max={shown} step={0.05} value={Math.min(time, shown)} onChange={(e) => seek(Number(e.target.value))} />
        <div><span>{fmt(time)}</span><span>{fmt(shown)}</span></div>
      </div>
      <label className="volume">VOL <input aria-label="Playback volume" type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} /></label>
      {status==="idle" && message.includes("plug-in") && <small role="status">{message}</small>}
      <span className="how">{howPlaying === "live" ? "Live" : ""}</span>
    </div>
  );
}

/** Every performance in one menu, grouped: the lessons, the songs, the skits. */
const soloSongs = SONGBOOK.filter((e) => e.song.stage?.length === 1 && e.song.stage[0] === e.song.lead);

function SoloLibrary({onPick}: {onPick: () => void}) {
  const lesson = useMoppet((s) => s.lesson),
    setLesson = useMoppet((s) => s.setLesson);
  return (
    <nav className="cast-library" aria-label="Solo library">
      <strong>Solo library</strong>
      {soloSongs.map(({ id, song }) => {
        const cast = STUDIO_404_CAST[song.lead];
        return (
          <button
            key={id}
            type="button"
            aria-pressed={lesson === id}
            onClick={() => {setLesson(id);onPick()}}
            style={{ "--cast-accent": cast.color } as React.CSSProperties}
          >
            <img src={`/rehearsal/img/${cast.artKey}-rest.webp`} alt="" />
            <span>
              <b>{cast.name}</b>
              <small>{song.title}</small>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
function PerformanceMenu({
  cameraFollow,
  toggleCamera,
  onOpenVideo,
}: {
  cameraFollow: boolean;
  toggleCamera: () => void;
  onOpenVideo?: () => void;
}) {
  const piece = useMoppet((s) => s.piece),
    lesson = useMoppet((s) => s.lesson),
    setLesson = useMoppet((s) => s.setLesson);
  const studio = useMoppet((s) => s.studio404),
    setStudio = useMoppet((s) => s.setStudio404),
    fresh = useMoppet((s) => s.freshSkit);
  const start = useAudio((s) => s.start);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const midiName =
    piece.kind === "round"
      ? `${piece.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}.mid`
      : piece.kind === "intro"
        ? "studio-404-introduction.mid"
        : piece.kind === "solo"
          ? `${piece.tracks[0].id}-introduction.mid`
          : piece.kind === "motesong" || piece.kind === "skit"
            ? `${piece.title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")}.mid`
            : `moppet-invention-${piece.seed}.mid`;
  const midi = () => download(new Blob([midiBytes(piece) as BlobPart], { type: "audio/midi" }), midiName);
  const [wavBusy, setWavBusy] = useState(false);
  const wav = async () => {
    setWavBusy(true);
    try {
      const out = await exportWav(start);
      download(
        new Blob([out.bytes], { type: "audio/wav" }),
        piece.kind === "round"
          ? `${piece.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")}.wav`
          : piece.kind === "intro"
            ? "studio-404-introduction.wav"
            : piece.kind === "solo"
              ? `${piece.tracks[0].id}-introduction.wav`
              : piece.kind === "motesong" || piece.kind === "skit"
                ? `${piece.title.toLowerCase().replace(/\s+/g, "-")}.wav`
                : `moppet-invention-${piece.seed}.wav`,
      );
    } catch (e) {
      useEnsemble.setState({ message: `WAV export: ${e instanceof Error ? e.message : String(e)}` });
    }
    setWavBusy(false);
  };
  return (
    <nav className="performance-menu" aria-label="Performance menu">
      <button type="button" aria-expanded={libraryOpen} aria-controls="repertoire" onClick={() => setLibraryOpen(!libraryOpen)}>
        Repertoire
      </button>
      <details className="stage-tools"><summary>Stage tools</summary><div>
      <SoundCraftButtons name={midiName} />
      <button onClick={midi}>Export MIDI</button>
      <button onClick={() => void wav()} disabled={wavBusy}>
        {wavBusy ? "Rendering WAV…" : "Export WAV"}
      </button>
      {onOpenVideo && <button onClick={onOpenVideo}>Video studio</button>}
      <button onClick={toggleCamera} aria-pressed={cameraFollow}>
        {cameraFollow ? "Follow camera" : "Wide camera"}
      </button>
      <button onClick={() => setStudio(!studio)}>{studio ? "Studio 404 cast" : "Workshop cast"}</button>
      </div></details>
      <LaunchkeyConnect />
      {libraryOpen && (
        <div id="repertoire" className="repertoire-grid" aria-label="Performance library">
          <SoloLibrary onPick={()=>setLibraryOpen(false)} />
          {[
            {
              label: "Lessons",
              items: [
                ["intro", "The first hello"],
                ["school", "Music school"],
                ["round", "The jam round"],
              ],
            },
            {
              label: "Songs with the choir",
              items: [
                ["chip", "Chip’s song"],
                ["tabby", "Tabby’s song"],
                ["gruff", "Gruff’s shanty"],
                ...SONGBOOK.filter((s) => !soloSongs.includes(s) && s.id !== "right-on-cue").map((s) => [s.id, s.song.title]),
              ],
            },
            { label: "Duets", items: SONGBOOK.filter(s => s.id === "right-on-cue").map(s => [s.id, s.tab]) },
            { label: "Skits", items: [...SKITS.map((s) => [s.id, s.title]), ...(fresh ? [["newskit", fresh.title]] : [])] },
          ].map((group) => (
            <section key={group.label}>
              <h3>{group.label}</h3>
              {group.items.map(([id, title]) => (
                <button
                  type="button"
                  key={id}
                  aria-pressed={lesson === id}
                  onClick={() => {
                    setLesson(id as Lesson);
                    setLibraryOpen(false);
                  }}
                >
                  {title}
                </button>
              ))}
            </section>
          ))}
        </div>
      )}
    </nav>
  );
}

function MusicSettings() {
  const lesson = useMoppet((s) => s.lesson);
  const key = useMoppet((s) => s.key);
  const mode = useMoppet((s) => s.mode);
  const bpm = useMoppet((s) => s.bpm);
  const repeats = useMoppet((s) => s.repeats);
  const seed = useMoppet((s) => s.seed);
  const progression = useMoppet((s) => s.progression);
  const groove = useMoppet((s) => s.groove);
  const palette = useMoppet((s) => s.palette);
  const soul = useMoppet((s) => s.soul);
  const setSettings = useMoppet((s) => s.setSettings);
  const invent = useMoppet((s) => s.invent);
  const rehearse = useMoppet((s) => s.rehearse);
  const busy = useEnsemble((s) => s.status === "preparing" || s.status === "rendering");
  if (lesson !== "school" && lesson !== "round") return null;
  return (
    <div className="music-settings">
      <label>Key<select value={key} disabled={busy} onChange={(e) => setSettings({ key: e.target.value as KeyName })}>{Object.keys(KEYS).map((k) => <option key={k}>{k}</option>)}</select></label>
      <label>Scale<select value={mode} disabled={busy || lesson === "round"} onChange={(e) => setSettings({ mode: e.target.value as ScaleMode })}>{MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      {lesson === "round" ? <label>Tempo<select value={bpm} disabled={busy} onChange={(e) => setSettings({ bpm: Number(e.target.value) })}>{[84, 96, 108, 112, 120, 132].map((t) => <option key={t} value={t}>{t} BPM</option>)}</select></label> : <>
        <label>Progression<select value={progression} disabled={busy} onChange={(e) => setSettings({ progression: e.target.value })}>{PROGRESSIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label>Groove<select value={groove} disabled={busy} onChange={(e) => setSettings({ groove: e.target.value })}>{GROOVES.map((g) => <option key={g.id} value={g.id}>{g.label} · {g.bpm}</option>)}</select></label>
        <label>Sounds<select value={palette} disabled={busy} onChange={(e) => setSettings({ palette: e.target.value })}>{PALETTES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label className="soul-toggle"><input type="checkbox" checked={soul} disabled={busy} onChange={(e) => setSettings({ soul: e.target.checked })} /> Moppet soul</label>
      </>}
      {lesson === "round" && <RoundLyricsPicker busy={busy} />}
      {lesson === "round" ? <label>Cycles<select value={repeats} disabled={busy} onChange={(e) => setSettings({ repeats: Number(e.target.value) })}><option value={1}>Once through</option><option value={2}>Twice through</option><option value={3}>Three times</option></select></label> : <label>Seed<input type="number" value={seed} disabled={busy} onChange={(e) => setSettings({ seed: Number(e.target.value) >>> 0 })} /></label>}
      <button className="invent" disabled={busy} onClick={lesson === "round" ? rehearse : invent}>{lesson === "round" ? "↻ Rehearse this round" : "✦ Invent another melody"}</button>
    </div>
  );
}

/**
 * Edit the words of the open song or skit, line by line. Each sung line shows how the dictionary
 * splits it and whether that fits its notes; the score follows once every line fits. Edits stay in
 * this browser until saved into songs/ (dev server) or downloaded, or reverted.
 */
/**
 * A line's notes under its words: each block as long as its note and as high as its pitch, with the
 * syllable it sings ("–": a hold). A note with no syllable is dashed: click it to hold the syllable
 * before it there. Click a hold to let go of it. Syllables with no note show in red after the
 * line: click a note to split it in two for one of them.
 */
function NoteStrip({ s, syllables, diff, onHold, onUnhold, onSplit }: { s: Sung; syllables: string[]; diff: number; onHold: (k: number) => void; onUnhold: (k: number) => void; onSplit: (i: number) => void }) {
  const total = s.rhythm.reduce((a, b) => a + b, 0);
  const lo = Math.min(...s.degrees), hi = Math.max(...s.degrees), span = Math.max(1, hi - lo);
  let at = 0;
  return (
    <div className="note-strip" aria-label="The line's notes and the syllable each sings">
      {/* every beat gets room for a syllable (a half-beat note still shows its "please"); a long line scrolls in its strip */}
      <div className="note-scroll">
      <div className="note-row" style={{ minWidth: `${total * 64}px` }}>
        {s.degrees.map((d, i) => {
          const left = (at / total) * 100, width = (s.rhythm[i] / total) * 100;
          at += s.rhythm[i];
          const syl = syllables[i];
          const empty = syl === undefined, hold = syl === "~";
          const act = empty && i > 0 ? () => onHold(i - 1) : hold ? () => onUnhold(i) : diff > 0 && s.rhythm[i] >= 0.5 ? () => onSplit(i) : undefined;
          const title = empty ? (i > 0 ? `No syllable: click to hold "${syllables[i - 1] ?? ""}" over this note` : "No syllable") : hold ? "Held from the syllable before: click to let go" : act ? "Click to split this note in two (for a syllable with no note)" : `${syl}, ${s.rhythm[i]} beat${s.rhythm[i] === 1 ? "" : "s"}`;
          return (
            <button key={i} type="button" className={`note${empty ? " empty" : ""}${hold ? " hold" : ""}${act ? " act" : ""}`} style={{ left: `${left}%`, width: `${width}%`, bottom: `${((d - lo) / span) * 60}%` }} onClick={act} disabled={!act} title={title}>
              {empty ? "" : hold ? "–" : syl}
            </button>
          );
        })}
      </div>
      </div>
      {diff > 0 && <span className="extra" title="Syllables with no note: shorten the words, or click a note to split it">+ {syllables.slice(s.degrees.length).join(" ")}</span>}
    </div>
  );
}

function WordsEditor() {
  const lesson = useMoppet((s) => s.lesson);
  const piece = useMoppet((s) => s.piece);
  const shiftTrackNote = useMoppet((s) => s.shiftTrackNote);
  const edits = useMoppet((s) => s.songEdits);
  const editSongFile = useMoppet((s) => s.editSongFile);
  const revert = useMoppet((s) => s.revertSongFile);
  const save = useMoppet((s) => s.saveSongFile);
  const voices = useMoppet((s) => s.voices);
  const [open, setOpen] = useState(false);
  const [dictionary, setDictionary] = useState(g2p.loaded);
  const [selNote, setSelNote] = useState<{ key: string; idx: number } | null>(null);
  useEffect(() => {
    if (open && !dictionary) void g2p.load().then(() => setDictionary(true), () => setDictionary(true));
  }, [open, dictionary]);
  const cur = currentFile(lesson);
  if (!cur) return null;
  const name = (id: string | undefined, fallback: string) => voices.find((v) => v.id === (id ?? fallback))?.name ?? id ?? fallback;
  const head = (
    <div className="words-bar">
      <button className={open ? "on" : ""} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Done editing" : "✎ Edit words"}</button>
      {cur.edited && <span className="words-edited">Edited, not saved</span>}
      {cur.edited && <button onClick={() => void save()}>{import.meta.env.DEV ? `Save to songs/${cur.file}` : `Download ${cur.file}`}</button>}
      {cur.edited && <button className="link" onClick={revert}>Revert</button>}
    </div>
  );
  if (!open) return head;
  const f = cur.parsed;
  if (f.kind === "skit") {
    return (
      <div className="words-editor">
        {head}
        {f.skit.scenes.map((scene, si) => (
          <section key={si}>
            <h3>Scene {si + 1}</h3>
            {scene.map((l, li) => (
              <label key={li} className="words-line">
                <b>{name(l.who, l.who)}</b>
                <input value={l.say} onChange={(e) => editSongFile((x) => void (x.kind === "skit" && (x.skit.scenes[si][li].say = sheetWords(e.target.value))))} />
              </label>
            ))}
          </section>
        ))}
      </div>
    );
  }
  if (f.kind !== "song") return head;
  const song = f.song;
  const starts = lineStarts(song);
  const sections = [...new Set(song.sections)];
  const repeats = (sec: Section) => song.sections.filter((x) => x === sec).length;
  // a phrase of the song, found again in the edited copy (a repeated section is one object)
  const at = (x: SongFile, si: number, li: number, ai: number | null): Sung => {
    const l = [...new Set((x as Extract<SongFile, { kind: "song" }>).song.sections)][si].lines[li] as Line;
    return ai === null ? l : l.with![ai];
  };
  const change = (si: number, li: number, ai: number | null, apply: (s: Sung) => void) => editSongFile((x) => void (x.kind === "song" && apply(at(x, si, li, ai))));
  const line = (s: Sung, start: number | undefined, si: number, li: number, ai: number | null) => {
    const check = dictionary ? checkSung(s, start) : null;
    const diff = check ? check.syllables.length - check.notes : 0;
    const split = check && check.syllables.length && diff > 0 ? splitFix(s, diff) : null;
    const whoId = s.who ?? song.lead;
    const lineVoice = voices.find((v) => v.id === whoId) ?? voices[0];
    const lineTrack = piece.tracks.find((t) => t.id === whoId);
    const targetAi = ai ?? -1;
    const seenNi = new Set<number>();
    const staffItems: StaffNoteItem[] = [];
    if (lineTrack) {
      lineTrack.events.forEach((ev, evIdx) => {
        if (!ev.src || ev.src[0] !== si || ev.src[1] !== li || ev.src[2] !== targetAi) return;
        const ni = ev.src[3];
        if (seenNi.has(ni)) return;
        seenNi.add(ni);
        const syl = check?.syllables[ni];
        staffItems.push({
          beat: ev.beat,
          beats: ev.beats,
          midi: ev.midi,
          syllable: syl === "~" ? "–" : (syl ?? ""),
          index: evIdx,
          canEdit: true,
        });
      });
    }
    const lineKey = `${si}-${li}-${targetAi}`;
    return (
      <div key={`${li}-${ai}`} className={`words-line${ai !== null ? " answer" : ""}`}>
        <b>{ai !== null ? "+ " : ""}{name(s.who, song.lead)}</b>
        <input value={s.words} aria-invalid={check ? !check.ok : undefined} onChange={(e) => change(si, li, ai, (x) => void (x.words = sheetWords(e.target.value)))} />
        {staffItems.length > 0 && (
          <div className="words-staff">
            <VexStaffLine
              compact
              events={staffItems}
              piece={piece}
              voice={lineVoice}
              selectedIndex={selNote?.key === lineKey ? selNote.idx : null}
              onSelect={(idx) => {
                setSelNote({ key: lineKey, idx });
                const item = staffItems.find((n) => n.index === idx);
                if (item) void auditionNote(lineVoice, item.midi, item.syllable, item.beats * beatSeconds(piece) * 1000);
              }}
              onShift={(idx, steps) => {
                setSelNote({ key: lineKey, idx });
                const item = staffItems.find((n) => n.index === idx);
                const nextMidi = shiftTrackNote(whoId, idx, steps);
                if (item && nextMidi !== null) void auditionNote(lineVoice, nextMidi, item.syllable, item.beats * beatSeconds(piece) * 1000);
              }}
            />
          </div>
        )}
        {check && <NoteStrip s={s} syllables={check.syllables} diff={diff} onHold={(k) => change(si, li, ai, (x) => void (x.words = holdAt(x.words, k) ?? x.words))} onUnhold={(k) => change(si, li, ai, (x) => void (x.words = unholdAt(x.words, k) ?? x.words))} onSplit={(i) => change(si, li, ai, (x) => void Object.assign(x, splitNote(x, i) ?? {}))} />}
        {check && <small className={check.ok ? (check.hint ? "hint" : "ok") : "bad"} title={check.hint || check.problem}>{check.ok ? `${check.notes} notes ✓` : check.problem}{check.ok && check.hint ? ` · ${check.hint}` : ""}</small>}
        {check && check.syllables.length > 0 && diff < 0 && (
          <span className="words-fix">
            <button title="Hold the last syllable over the spare notes (the _ marks); move the marks to hold another syllable" onClick={() => change(si, li, ai, (x) => void (x.words = holdFix(x.words, -diff)))}>Hold the last word over {-diff + 1} notes</button>
          </span>
        )}
        {split && (
          <span className="words-fix">
            <button title="Split the longest notes in two, same pitch: the tune changes, the chords still fit" onClick={() => change(si, li, ai, (x) => void Object.assign(x, splitFix(x, diff)))}>Split {diff > 1 ? `${diff} notes` : "a note"} in two</button>
          </span>
        )}
      </div>
    );
  };
  return (
    <div className="words-editor">
      {head}
      {!dictionary && <p className="words-note">Loading the pronouncing dictionary…</p>}
      <p className="words-note">Under each line, its notes and the syllable each one sings. A dashed note has no syllable: click it to hold the syllable before it there (that writes <code>_</code>, as in <code>ma_ny</code>). Red syllables have no note: shorten the words, or click a note to split it. A repeated section is edited once.</p>
      {sections.map((sec, si) => (
        <section key={si}>
          <h3>Section {si + 1}{sec.choir ? " · choir" : ""}{repeats(sec) > 1 ? ` · sung ${repeats(sec)} times` : ""}</h3>
          {sec.lines.map((l, li) =>
            "rest" in l ? (
              <p key={li} className="words-rest">rest {l.rest} beats</p>
            ) : (
              <Fragment key={li}>
                {line(l, starts.get(l), si, li, null)}
                {(l.with ?? []).map((a, ai) => line(a, undefined, si, li, ai))}
              </Fragment>
            ),
          )}
        </section>
      ))}
    </div>
  );
}

/** A skit's script, scene by scene, each line in its speaker's colour. */
function Script({ piece }: { piece: Piece }) {
  const voices = useMoppet((s) => s.voices);
  const lines = piece.tracks.flatMap((t) => t.events.map((e) => ({ who: voices.find((v) => v.id === t.id), beat: e.beat, text: e.text }))).sort((a, b) => a.beat - b.beat);
  return (
    <div className="skit-script" aria-label="The script">
      {(piece.scenes ?? []).map((sc, i) => (
        <section key={i}>
          <h3>Scene {i + 1}</h3>
          {lines.filter((l) => l.beat >= sc.beat && l.beat < sc.beat + sc.beats).map((l, k) => (
            <p key={k}><b style={{ color: l.who?.color }}>{l.who?.name.toUpperCase()}</b>{l.text}</p>
          ))}
        </section>
      ))}
    </div>
  );
}

/** The round's words: one set, or each set with the Moppets singing it. */
function RoundWords({ piece }: { piece: Piece }) {
  const voices = useMoppet((s) => s.voices);
  const sets = new Map<string, string[]>();
  for (const t of piece.tracks) if (t.lines) sets.set(t.lines.join("|"), [...(sets.get(t.lines.join("|")) ?? []), voices.find((v) => v.id === t.id)?.name ?? t.id]);
  return (
    <div className="round-words">
      {[...sets].map(([key, who]) => (
        <Fragment key={key}>
          {sets.size > 1 && <h3>{who.join(", ")}</h3>}
          {key.split("|").slice(0, 4).map((l, i) => <p key={i}><b>{String(i + 1).padStart(2, "0")}</b>{l}</p>)}
        </Fragment>
      ))}
    </div>
  );
}

/** Pick the round's words, or have Claude write new ones (dev server only). */
function RoundLyricsPicker({ busy }: { busy: boolean }) {
  const roundLyrics = useMoppet((s) => s.roundLyrics);
  const fresh = useMoppet((s) => s.freshRound);
  const writing = useMoppet((s) => s.writing);
  const setSettings = useMoppet((s) => s.setSettings);
  const writeRound = useMoppet((s) => s.writeRound);
  const [writer, setWriter] = useState(false);
  useEffect(() => void hasWriter().then(setWriter), []);
  return (
    <>
      <label>Words<select value={roundLyrics} disabled={busy || writing} onChange={(e) => setSettings({ roundLyrics: e.target.value as typeof roundLyrics })}>
        {ROUND_LYRICS.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
        <option value="mixed">All three at once</option>
        {fresh && <option value="fresh">New: {fresh.title}</option>}
      </select></label>
      {writer && <button className="invent" disabled={busy || writing} onClick={() => void writeRound()}>{writing ? "Claude is writing…" : "✎ Write a new round"}</button>}
    </>
  );
}

/** Have Claude write a new skit for the cast (dev server only). */
function SkitTools() {
  const writing = useMoppet((s) => s.writing);
  const writeSkit = useMoppet((s) => s.writeSkit);
  const busy = useEnsemble((s) => s.status === "preparing" || s.status === "rendering");
  const [writer, setWriter] = useState(false);
  useEffect(() => void hasWriter().then(setWriter), []);
  if (!writer) return null;
  return (
    <div className="music-settings">
      <button className="invent" disabled={busy || writing} onClick={() => void writeSkit()}>{writing ? "Claude is writing…" : "✎ Write a new skit"}</button>
    </div>
  );
}

let writerProbe: Promise<boolean> | null = null;
const hasWriter = () => (writerProbe ??= import.meta.env.DEV ? fetch("/__claude/ping").then((r) => r.status === 204, () => false) : Promise.resolve(false));

/** Editing one Moppet's notes on the score (a lead-sheet song): what the drags change. */
interface NoteEdit {
  id: string;
  /** move a note this many scale steps */
  pitch: (src: NonNullable<ScoreEvent["src"]>, steps: number) => void;
  /** lengthen a note by `beats` (negative: shorten), taken from the next note of its phrase */
  length: (src: NonNullable<ScoreEvent["src"]>, beats: number) => void;
}
/** A scale step is about 12/7 semitones on the score. */
const STEP = 12 / 7;
const SNAP = 0.25;

/** Each sung note's syllable, for a track with lyric lines (holds show as "–"). */
function syllablesOf(t: Track): (string | null)[] {
  const byLine = new Map<number, string[]>();
  const seen = new Map<number, number>();
  return t.events.map((e) => {
    if (e.line === undefined || !t.phrases) return null;
    if (!byLine.has(e.line)) {
      try {
        byLine.set(e.line, sungSyllables(t.phrases[e.line]).map((x) => (x.melisma ? "–" : x.text)));
      } catch {
        byLine.set(e.line, []);
      }
    }
    const k = seen.get(e.line) ?? 0;
    seen.set(e.line, k + 1);
    return byLine.get(e.line)![k] ?? null;
  });
}

function ScoreSvg({ piece, edit }: { piece: Piece; edit?: NoteEdit | null }) {
  const voices = useMoppet((s) => s.voices);
  const studio404 = useMoppet((s) => s.studio404);
  const cursor = useRef<SVGPathElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  /** the note being dragged: its event, how, and how far so far (in score units) */
  const [drag, setDrag] = useState<{ track: string; i: number; how: "pitch" | "length"; x0: number; y0: number; dx: number; dy: number } | null>(null);
  const bandOn = useMoppet(s=>s.band);
  const accompaniment = bandOn ? bandFor(piece) : [];
  const w = 1100, h = edit ? 200 : 76, left = 38, top = 8;
  const midis = piece.tracks.flatMap((t) => t.events.map((e) => e.midi));
  for (const part of accompaniment) for (const note of part.notes) midis.push(note.midi);
  const range = midis.length ? [Math.min(...midis)-2, Math.max(...midis)+2] : [48,72];
  const sx = (w - left - 15) / piece.beats, sy = (h - top - 25) / (range[1] - range[0]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const e = useEnsemble.getState();
      const b = Math.min(piece.beats, beatNow(piece, e.time));
      cursor.current?.setAttribute("d", `M${left + b * sx} 12V${h - 18}`);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [piece, sx, h]);
  // a drag in viewBox units, whatever size the score is drawn at
  const scale = () => w / (svg.current?.getBoundingClientRect().width || w);
  const start = (ev: React.PointerEvent, track: string, i: number, how: "pitch" | "length") => {
    ev.stopPropagation();
    try {
      (ev.target as Element).setPointerCapture(ev.pointerId); // keeps the drag when the pointer leaves the note
    } catch {
      // no live pointer to capture (a synthetic event): the score still follows it
    }
    setDrag({ track, i, how, x0: ev.clientX, y0: ev.clientY, dx: 0, dy: 0 });
  };
  const move = (ev: React.PointerEvent) => drag && setDrag({ ...drag, dx: (ev.clientX - drag.x0) * scale(), dy: (ev.clientY - drag.y0) * h / (svg.current?.getBoundingClientRect().height || h) });
  const end = () => {
    if (!drag || !edit) return setDrag(null);
    const e = piece.tracks.find((t) => t.id === drag.track)?.events[drag.i];
    setDrag(null);
    if (!e?.src) return;
    if (drag.how === "pitch") {
      const steps = Math.round(-drag.dy / (STEP * sy));
      if (steps) edit.pitch(e.src, steps);
    } else {
      const beats = Math.round(drag.dx / sx / SNAP) * SNAP;
      if (beats) edit.length(e.src, beats);
    }
  };
  const octaves: number[] = [];
  const octaveStep = 12 * Math.max(1, Math.ceil(15 / (12 * sy)));
  for (let n = Math.ceil(range[0] / 12) * 12; n <= range[1]; n += octaveStep) octaves.push(n);
  const bars: number[] = [];
  for (const measure of measures(piece)) bars.push(measure.start);
  return (
    <svg ref={svg} className={edit ? "editing" : undefined} preserveAspectRatio="none" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${piece.title}, ${piece.tracks.length} voice parts across ${piece.beats} beats`} onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)}>
      <rect width={w} height={h} fill="#1b1612" />
      {octaves.map((n) => <g key={n}><path d={`M${left} ${top + (range[1] - n) * sy}H${w}`} stroke="#ffffff14" /><text x={5} y={top + (range[1] - n) * sy + 3} fill="#9c8e7b" fontSize={9}>{noteName(n)}</text></g>)}
      {bars.map((b,i) => <g key={b}><path d={`M${left + b * sx} ${top}V${h - 18}`} stroke="#ffffff12" /><text x={left + b * sx + 3} y={h - 4} fill="#9c8e7b" fontSize={8}>{i + 1}</text></g>)}
      {accompaniment.map(part=><path key={part.id} data-band={part.id} stroke="#9aaea0" strokeWidth={1.7} opacity={.6}
        d={part.notes.map(n=>`M${left+n.beat*sx} ${top+(range[1]-n.midi)*sy}h${Math.max(1,n.beats*sx-1)}`).join(" ")}>
        <title>{part.id}</title>
      </path>)}
      {piece.tracks.map((t) => {
        const baseColor = voices.find((v) => v.id === t.id)?.color ?? "#fff";
        const color = studio404 ? (STUDIO_404_CAST[t.id]?.color ?? baseColor) : baseColor;
        const mine = edit?.id === t.id;
        const words = mine ? syllablesOf(t) : null;
        // a syllable is labelled only where it doesn't run into the one before (about 5 units a letter)
        let free = -Infinity;
        return t.events.map((e, i) => {
          const editable = mine && !!e.src;
          const d = drag && drag.track === t.id && drag.i === i ? drag : null;
          const steps = d?.how === "pitch" ? Math.round(-d.dy / (STEP * sy)) : 0;
          const grow = d?.how === "length" ? Math.round(d.dx / sx / SNAP) * SNAP : 0;
          const x = left + e.beat * sx, y = top + (range[1] - e.midi - steps * STEP) * sy;
          const width = Math.max(1.5, (e.beats + grow) * sx - 1.5);
          return (
            <g key={`${t.id}${i}`} className={editable ? "note-edit" : undefined} opacity={edit && !mine ? 0.25 : 1}>
              <rect x={x} y={y - (editable ? 4 : 2.5)} width={width} height={editable ? 8 : 5} rx={1.5} fill={color} opacity={0.85} onPointerDown={editable ? (ev) => start(ev, t.id, i, "pitch") : undefined}>
                <title>{`${t.id}: ${noteName(e.midi, piece.key, piece.mode)}, beat ${e.beat + 1}${e.text ? `, ${e.text}` : ""}`}</title>
              </rect>
              {editable && <rect className="note-end" x={x + width - 4} y={y - 6} width={6} height={12} fill="transparent" onPointerDown={(ev) => start(ev, t.id, i, "length")} />}
              {words?.[i] && x >= free && (free = x + words[i]!.length * 5 + 3) && <text x={x + 1} y={y - 7} fill="#fff4d6" fontSize={9} pointerEvents="none">{words[i]}</text>}
            </g>
          );
        });
      })}
      <path ref={cursor} d={`M${left} 12V${h - 18}`} stroke="#fff2c4" strokeWidth={1.5} />
    </svg>
  );
}

function PianoRoll() {
  const piece = useMoppet((s) => s.piece),
    lesson = useMoppet((s) => s.lesson);
  const selected = useMoppet((s) => s.voices[s.selected]);
  const studio404 = useMoppet((s) => s.studio404);
  const selectedName = studio404 ? studio404Name(selected.id, selected.name) : selected.name;
  const editSongFile = useMoppet((s) => s.editSongFile);
  const [editing, setEditing] = useState(false);
  // notes can be edited where a lead sheet wrote them: the songbook songs
  const editable = piece.kind === "motesong" && !!lessonFile(lesson);
  const sung = (x: SongFile, [si, li, ai]: number[]): Sung | null => {
    if (x.kind !== "song") return null;
    const l = [...new Set(x.song.sections)][si]?.lines[li];
    return !l || "rest" in l ? null : ai < 0 ? l : (l.with?.[ai] ?? null);
  };
  const noteEdit: NoteEdit | null =
    editing && editable
      ? {
          id: selected.id,
          pitch: (src, steps) =>
            editSongFile((x) => {
              const s = sung(x, src);
              if (s) s.degrees[src[3]] += steps;
            }),
          length: (src, beats) =>
            editSongFile((x) => {
              const s = sung(x, src),
                n = src[3];
              // the line keeps its length: the next note gives (or takes) the beats
              if (!s || n + 1 >= s.rhythm.length) return;
              const a = s.rhythm[n] + beats,
                b = s.rhythm[n + 1] - beats;
              if (a < SNAP || b < SNAP) return;
              s.rhythm[n] = a;
              s.rhythm[n + 1] = b;
            }),
        }
      : null;
  return (
    <section className="desk-roll" aria-label="Full MIDI score">
      <header>
        <h2>Full MIDI score</h2>
        <small>
          {measures(piece).length} bars · {piece.bpm} BPM
        </small>
        <Transport />
        <BandToggle />
        {editable && (
          <button onClick={() => setEditing(!editing)} aria-pressed={editing}>
            {editing ? "Finish note edits" : `Edit ${selectedName}’s notes`}
          </button>
        )}
      </header>
      <ScoreSvg piece={piece} edit={noteEdit} />
      {noteEdit && <small>Drag a note to change its pitch or drag its right edge to change its length.</small>}
    </section>
  );
}

function ScorePanel() {
  const piece = useMoppet((s) => s.piece);
  const voices = useMoppet((s) => s.voices);
  const status = useMoppet((s) => s.status);
  const lesson = useMoppet((s) => s.lesson);
  const eStatus = useEnsemble((s) => s.status);
  const message = useEnsemble((s) => s.message);
  const progress = useEnsemble((s) => s.progress);
  return (
    <div className="moppet-score">
      <div className="lesson-header">
        <div>
          <p className="eyebrow">{piece.kind === "round" ? (piece.title.includes("Jam") ? "SAME TUNE. ONE VERY STICKY HAT." : "SAME TUNE. NEW WORDS.") : piece.kind === "intro" ? "SIX VERSES, ONE CHORUS" : piece.kind === "solo" ? "ONE MOPPET, ALONE" : piece.kind === "motesong" ? "A MOPPET ORIGINAL" : piece.kind === "skit" ? "A MOPPET SKIT" : "AN INVENTION, NOT A REPEAT"}</p>
          <h2>{piece.title}</h2>
          <p>{piece.description}</p>
        </div>
        <span className="seed-label">{piece.kind === "skit" ? `${piece.tracks.reduce((n, t) => n + t.events.length, 0)} LINES · ${piece.beats} S` : piece.kind === "round" ? `3 PARTS · ${piece.tracks.length} VOICES` : piece.kind === "school" ? `SEED ${piece.seed}` : `${piece.key} ${piece.mode === "major" ? "MAJOR" : piece.mode.toUpperCase()} · ${piece.bpm} BPM`}</span>
      </div>
      <MusicSettings />
      {piece.kind === "skit" && <SkitTools />}
      <p className="moppet-status" role="status">{message || status || (eStatus === "idle" ? "Ready. Press play." : "")}{eStatus === "rendering" ? ` (${Math.round(progress * 100)} %)` : ""}</p>
      {lessonFile(lesson) && <WordsEditor key={lesson} />}
      {piece.kind === "round" && <RoundWords piece={piece} />}
      {lesson === "intro" && <details className="lyrics-sheet"><summary>The words we found</summary><div>{voices.map((v) => <div key={v.id}><h3>{v.name} · {v.role}</h3><p>{v.lyrics.join(" / ")}</p></div>)}<div><h3>All together</h3><p>{CHORUS.join(" / ")}</p></div></div></details>}
      {piece.kind === "skit" && <Script piece={piece} />}
    </div>
  );
}


/** The backing band (bass, electric piano, and drums unless the beatbox plays): background music, in the MIDI too. */
function BandToggle() {
  const band = useMoppet((s) => s.band);
  const setBand = useMoppet((s) => s.setBand);
  const busy = useEnsemble((s) => s.status === "preparing" || s.status === "rendering");
  return <button className={band ? "on" : ""} aria-pressed={band} disabled={busy} onClick={() => setBand(!band)} title="Bass, electric piano and drums under the voices">{band ? "Band on" : "Band off"}</button>;
}

/** Does the dev server have the SoundCraft bridge (tools/soundcraft-bridge.ts)? */
let bridge: Promise<boolean> | null = null;
const hasBridge = () => (bridge ??= import.meta.env.DEV ? fetch("/__soundcraft/ping").then((r) => r.status === 204, () => false) : Promise.resolve(false));

/**
 * Edit the notes in SoundCraft: open the score there (one track per Moppet), move notes, then sing
 * SoundCraft's notes back with the same words. Without the dev bridge, load an exported .mid file.
 */
function SoundCraftButtons({ name }: { name: string }) {
  const piece = useMoppet((s) => s.piece);
  const singMidi = useMoppet((s) => s.singMidi);
  const [linked, setLinked] = useState(false);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => void hasBridge().then(setLinked), []);
  const say = (message: string) => useEnsemble.setState({ message });
  const call = async (path: string, body?: BlobPart) => {
    setBusy(true);
    try {
      const r = await fetch(path, { method: "POST", body });
      if (!r.ok) throw new Error(await r.text());
      return r;
    } catch (e) {
      say(`SoundCraft: ${e instanceof Error ? e.message : e}`);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const open = async () => {
    say("Opening SoundCraft…");
    if (await call(`/__soundcraft/open?name=${encodeURIComponent(name)}`, midiBytes(piece) as BlobPart)) {
      setOpened(true);
      say("In SoundCraft: move, stretch or transpose notes (keep one note per syllable), then press “Sing SoundCraft’s notes”.");
    }
  };
  const openInstrument = async () => {
    const state=useMoppet.getState();
    const voice=state.voices[state.selected],track=piece.tracks.find(t=>t.id===voice.id);
    if(!track)return say("Select a singer with a part in this score.");
    const key=await partKey(instrumentPart(piece,track,voice));
    if(await call(`/__soundcraft/instrument?part=${key}`))say("CHIMERA vocal instrument opened in SoundCraft.");
  };
  const pull = async () => {
    const r = await call("/__soundcraft/pull");
    if (r) singMidi(new Uint8Array(await r.arrayBuffer()));
  };
  const load = async (f: File | undefined) => {
    if (!f) return;
    try {
      singMidi(new Uint8Array(await f.arrayBuffer()));
    } catch (e) {
      say(`${f.name}: ${e instanceof Error ? e.message : e}`);
    }
  };
  return (
    <>
      <button onClick={() => void open()} disabled={!linked || busy} title={linked ? "Open the current score" : "Available with the local SoundCraft bridge"}>Open in SoundCraft</button>
      {linked && <button onClick={()=>void openInstrument()} disabled={busy}>Open vocal instrument</button>}
      {linked && opened && <button onClick={() => void pull()} disabled={busy}>Sing SoundCraft’s notes</button>}
      <button onClick={() => file.current?.click()} title="Sing the score on an edited .mid file's notes">Load MIDI…</button>
      <input ref={file} type="file" accept=".mid,.midi,audio/midi" hidden onChange={(e) => (void load(e.target.files?.[0]), (e.target.value = ""))} />
    </>
  );
}

/** Connect a MIDI controller to the workbench; shows what it did last. */
function MidiStrip() {
  const midi = useController((s) => s.midi);
  const setMidi = useController((s) => s.setMidi);
  const last = useController((s) => s.last);
  const learning = useController((s) => s.learning);
  const resetMap = useController((s) => s.resetMap);
  if (!midiSupported()) return null;
  const on = midi.status === "on";
  const status = midi.status === "connecting" ? "Connecting…" : midi.status === "denied" ? "Blocked by the browser" : on ? (midi.inputs.length ? midi.inputs.join(", ") : "Plug one in") : "Off";
  return (
    <div className="midi-strip">
      <button type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => setMidi(!on)}>{on ? "MIDI on" : "Connect MIDI controller"}</button>
      <span className="midi-what">{learning ? "Turn the knob to use" : last || status}</span>
      <button type="button" className="link" onClick={resetMap} title="Restore default Launchkey Mini CC 21–28 knob assignments">Reset CC map</button>
    </div>
  );
}

/** Live Organ manual inspector: Puppeteer mouth drawbars, Sing-the-words prompter, and Melody step-editor chips (the layered 25-key manual sits right above in LaunchkeyMap). */
function LivePanel({ name }: { name: string }) {
  const mode = useLive((s) => s.mode);
  const last = useLive((s) => s.last);
  const mouth = useLive((s) => s.mouth);
  const words = useLive((s) => s.words);
  const next = useLive((s) => s.next);
  const editIndex = useLive((s) => s.editIndex);
  const setEditIndex = useLive((s) => s.setEditIndex);
  const piece = useMoppet((s) => s.piece);
  const voice = useMoppet((s) => s.voices[s.selected]);
  const track = piece.tracks.find((t) => t.id === voice?.id) ?? piece.tracks[0];
  const events = track?.events ?? [];
  const curIdx = events.length ? Math.min(editIndex, events.length - 1) : 0;
  const hearCurrent = () => {
    const ev = events[curIdx];
    if (!ev || !voice) return;
    void auditionNote(voice, ev.midi, words[curIdx], (ev.beats * 60000) / Math.max(40, piece.bpm));
    setEditIndex(curIdx);
  };
  if (mode === "off") return null;
  return (
    <div className="live-panel organ-expression-tray">
      <div className="live-head">
        <h3>
          {mode === "puppet"
            ? `${name} · Mouth Drawbars`
            : mode === "words"
              ? `${name} · Word Teleprompter`
              : `${name} · Melody Step Editor`}
        </h3>
      </div>
      {mode === "puppet" && (
        <>
          <div className="live-pads">{PAD_VOWELS.map(([, label], i) => <button key={label} onClick={() => padVowel(i)}>{label}</button>)}</div>
          <div className="knobs live-knobs">
            {MOUTH.map(([k, lo, hi, label]) => (
              <div className="knob" key={k}>
                <div className="knob-head"><label htmlFor={`mouth-${k}`}>{label}</label><output>{(mouth[k] ?? 0).toFixed(2)}</output></div>
                <input id={`mouth-${k}`} type="range" min={0} max={1} step={0.01} value={((mouth[k] ?? lo) - lo) / (hi - lo)} onChange={(e) => moveMouth(k, Number(e.target.value))} />
              </div>
            ))}
          </div>
        </>
      )}
      {mode === "words" && (
        <p className="live-words" aria-label="The words the keys sing">
          {words.length ? words.map((w, i) => <span key={i} className={i === next ? "next" : i < next ? "sung" : ""}>{w}</span>) : `${name} has no words in this piece.`}
        </p>
      )}
      {mode === "edit" && (
        <div className="melody-edit">
          <div className="melody-edit-bar">
            <button onClick={() => setEditIndex(Math.max(0, curIdx - 1))} disabled={curIdx <= 0}>← Prev</button>
            <button onClick={hearCurrent} disabled={!events.length}>Hear note {curIdx + 1}/{events.length}</button>
            <button onClick={() => setEditIndex(Math.min(events.length - 1, curIdx + 1))} disabled={curIdx >= events.length - 1}>Next →</button>
          </div>
          <p className="live-words" aria-label="Melody notes to edit">
            {events.length
              ? events.map((ev, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`melody-chip${i === curIdx ? " next" : i < curIdx ? " sung" : ""}`}
                    onClick={() => setEditIndex(i)}
                  >
                    {words[i] ?? ev.text ?? `#${i + 1}`} <em>{noteName(ev.midi, piece.key, piece.mode)}</em>
                  </button>
                ))
              : `${name} has no melody notes in this piece.`}
          </p>
        </div>
      )}
      <p className="status" role="status">{last}</p>
    </div>
  );
}

function Workbench() {
  const voices = useMoppet((s) => s.voices);
  const selected = useMoppet((s) => s.selected);
  const studio404 = useMoppet((s) => s.studio404);
  const select = useMoppet((s) => s.select);
  const reset = resetSelectedVocal;
  const unlocked = useController(s => s.voiceEditing);
  useEffect(() => lockVoiceControls, [selected]);
  const savePreset = useMoppet((s) => s.savePreset);
  const loadPreset = useMoppet((s) => s.loadPreset);
  const singSolo = useMoppet((s) => s.singSolo);
  const start = useAudio((s) => s.start);
  const ccMap = useController((s) => s.map);
  const learning = useController((s) => s.learning);
  const learn = useController((s) => s.learn);
  const v = voices[selected];
  const s404V = studio404 ? STUDIO_404_CAST[v.id] : undefined;
  const vName = s404V?.name ?? v.name;
  const vRole = s404V?.role ?? v.role;
  const [note, setNote] = useState("Controls act on this Moppet's own engine.");
  const file = useRef<HTMLInputElement>(null);
  const change = (key: ControlKey, group: ControlGroup, n: number) => {
    applyControl(key, n);
    const playing = useEnsemble.getState().status === "playing";
    // a body is built when the singer's engine is, so it waits for the next performance
    setNote(playing && group !== "body" && group !== "size" ? "Heard about 0.3 s later on this singer's engine." : "Saved to this Moppet. Applied on its next performance.");
  };
  const solo = () => {
    singSolo();
    void play(start);
  };
  const wav = async () => {
    setNote("Rendering this voice…");
    try {
      const m = useMoppet.getState();
      const index = m.piece.kind === "solo" ? 0 : selected;
      const out = await exportWav(start, index);
      download(new Blob([out.bytes], { type: "audio/wav" }), `${v.id}${m.piece.kind === "solo" ? "-introduction" : "-part"}.wav`);
      setNote(`${v.name}'s voice is ready.`);
    } catch (e) {
      setNote(`WAV: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <div className="moppet-workbench">
      <div className="cards">
        {voices.map((c, i) => {
          const s404C = studio404 ? STUDIO_404_CAST[c.id] : undefined;
          return (
            <button key={c.id} className={`card${i === selected ? " selected" : ""}`} onClick={() => select(i)} aria-pressed={i === selected}>
              <span className="card-top"><span className="swatch" style={{ background: s404C?.color ?? c.color }} /><span className="card-num">0{i + 1}</span></span>
              <strong>{s404C?.name ?? c.name}</strong>
              <small>{s404C?.role ?? c.role}</small>
            </button>
          );
        })}
      </div>
      <div className="voice-panel">
        <div className="voice-panel-head">
          <div className="panel-title"><h2>{vName}</h2><span>{vRole}</span></div>
          <div className="panel-actions">
            <button type="button" onClick={solo}>▶ Sing my introduction</button>
            <button type="button" className="download" onClick={() => void wav()}>↓ WAV</button>
          </div>
        </div>
        <MidiStrip />

        <LivePanel name={vName} />
        <button type="button" aria-pressed={unlocked} onClick={() => unlocked ? lockVoiceControls() : useController.setState({voiceEditing:true})}>
          {unlocked ? "Lock vocal controls" : "Unlock vocal editing"}
        </button>
        {unlocked && <div className="knobs">
          {CONTROLS.map(([key, label, min, max, step, unit, group]) => {
            const value = group === "size" ? (v.size ?? 1) : group === "artic" ? v.artic[key as keyof MoppetVoice["artic"]] : group === "body" ? v.body[key as keyof MoppetVoice["body"]] : (v.source[key as keyof MoppetVoice["source"]] ?? 0);
            const cc = ccFor(ccMap, key);
            return <div className="knob" key={key}>
              <div className="knob-head">
                <label htmlFor={`knob-${key}`}>{label}</label>
                <output>{Number(value).toFixed(2)} {unit}</output>
                {midiSupported() && <button className={`cc${learning === key ? " learning" : ""}`} onClick={() => learn(key)} aria-pressed={learning === key} title={learning === key ? "Turn a knob on your controller (click again to cancel)" : `Assign a controller knob to ${label}`}>{learning === key ? "turn a knob" : cc !== undefined ? `CC ${cc}` : "learn"}</button>}
              </div>
              <input id={`knob-${key}`} type="range" min={min} max={max} step={step} value={value} onChange={(e) => change(key, group, Number(e.target.value))} />
            </div>;
          })}
        </div>
        }
        <p className="status" role="status">{note}</p>
        <p className="status">{import.meta.env.DEV ? "Vocal edits use the local CHIMERA plug-in host." : "Published songs use recorded CHIMERA plug-in presets. Open the local stage to render a custom voice."}</p>
        <div className="panel-footer">
          <button onClick={reset}>Reset voice</button>
          <button onClick={savePreset}>↓ Save preset</button>
          <button onClick={() => file.current?.click()}>↑ Load preset</button>
          <input ref={file} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadPreset(f).catch((err) => setNote(err.message)); e.target.value = ""; }} />
        </div>
      </div>
    </div>
  );
}

export function MoppetRight() {
  const [cameraFollow,setCameraFollow]=useState(true);
  const [desk, setDesk] = useState(false);
  const [liveDesk,setLiveDesk]=useState(false);
  const showLive = liveDesk;
  const [writing,setWriting]=useState(false);
  const [references,setReferences]=useState(false);
  const [editor, setEditor] = useState(false);
  const lesson = useMoppet(s=>s.lesson);
  const setLesson = useMoppet(s=>s.setLesson);
  const selected = useMoppet((s) => s.selected);
  const voices = useMoppet((s) => s.voices);
  const studio404 = useMoppet((s) => s.studio404);
  const v = voices[selected];
  const name = studio404 ? studio404Name(v.id, v.name) : v.name;
  const piece = useMoppet((s) => s.piece);
  const guestPreview = useMemo(()=>{
    if(!showLive || piece.title!=="Borrowed Light") return null;
    const project=buildVideoProject(piece,voices,studio404);
    return {...project,fps:24,intro:{...project.intro,enabled:false},outro:{...project.outro,enabled:false}};
  },[showLive,piece,voices,studio404]);
  useEffect(() => {
    // load the score on first arrival
    if (useMoppet.getState().piece === piece) {
      loadPiece(piece);
      useMoppet.getState().select(useMoppet.getState().selected);
    }
    (window as unknown as { __choir: unknown }).__choir = { seek, play: () => play(useAudio.getState().start), stop, debug: ensembleDebug, ensemble: useEnsemble, moppet: useMoppet, audio: useAudio, telemetry: useTelemetry, live: useLive, controller: useController, midi: handleControl, makeIntroduction, bench: () => import("../choir/bench.ts").then((m) => m.benchChoir()) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="right right-moppet right-stage">
      <VideoStudio liveEditing={desk || liveDesk || editor || writing} controller={<div className="instrument-bay">
        <aside className="bay-controls" aria-label="Stage controls">
          <button aria-pressed={references} onClick={()=>setReferences(!references)}>Cast bibles</button>
          <button aria-pressed={writing} onClick={()=>setWriting(!writing)}>Write &amp; rehearse</button>
          <button aria-pressed={liveDesk} onClick={()=>{stop();setLiveDesk(!liveDesk)}}>Live puppets</button>
        </aside>
        <LaunchkeyMap/>
        <aside className="bay-controls" aria-label="Music controls">
          <button aria-pressed={desk} onClick={()=>setDesk(!desk)}>♫ Music desk</button>
          <button aria-pressed={editor} onClick={()=>{lockVoiceControls();setEditor(!editor)}}>Voice workshop</button>
          <button onClick={resetSelectedVocal} title="Restore this singer’s factory vocal settings">↺ Reset {name} vocals</button>
          <small>{!import.meta.env.DEV ? "CHIMERA plug-in voice" : JSON.stringify(v) === JSON.stringify(CAST[selected]) ? "CHIMERA · factory voice" : "CHIMERA · custom voice"}</small>
        </aside>
      </div>} livePreview={guestPreview ? <PortableStage project={guestPreview}/> : showLive ? <Stage cameraFollow={cameraFollow}/> : undefined}/>
      {(desk || liveDesk) && <Screen className="s-stage warm" label="Rehearsal tools">
        {(desk || liveDesk) && <PerformanceMenu cameraFollow={cameraFollow} toggleCamera={()=>setCameraFollow(!cameraFollow)}/>}
        {desk && piece.kind!=="skit" ? <PianoRoll/> : liveDesk || desk ? <Transport/> : null}
      </Screen>}
      {references && <CastReferences/>}
      {writing && <NewRehearsal/>}
      {(desk || writing) && <Screen className="s-score warm" title="Music Desk" sub="Score & Stops">
        <ScorePanel />
        {piece.kind !== "skit" && <RehearsalStaffPanel />}
      </Screen>}
      {editor && <Screen className="s-cast warm" title={`Organ Console · ${name}`} sub="Voice & Manuals">
        <Workbench />
      </Screen>}
      {desk && <details className="layout-studies"><summary>Earlier desk layouts</summary><div>{["Center music rack","Side desk","Pinned rehearsal console"].map((name,i)=><figure key={name}><a href={`/layouts/layout-${String.fromCharCode(97+i)}.webp`}><img loading="lazy" src={`/layouts/layout-${String.fromCharCode(97+i)}.webp`} alt={name}/></a><figcaption>{name}</figcaption></figure>)}</div></details>}
      <p className="moppet-credit">Experimental character voices · Studio 404. Physical voice synthesis by <a href="https://github.com/jamesondh/chimera-vocal-synth" target="_blank" rel="noreferrer">CHIMERA</a>, MIT licensed.</p>
    </div>
  );
}
