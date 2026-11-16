import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.ts";
import { engine } from "../../audio/AudioEngine.ts";
import { Screen } from "./Screen.tsx";
import { TubeView } from "./TubeView.tsx";
import { Stroboscope } from "./Stroboscope.tsx";
import { SpectrumView } from "./SpectrumView.tsx";
import { VoiceControls, VoiceToggles } from "./VoiceControls.tsx";
import { Keys } from "./Keys.tsx";
import { useMoppet, type Lesson } from "../../choir/store.ts";
import { cancel, ensembleDebug, exportWav, loadPiece, pause, play, pose, seek, setRenderMode, stop, useEnsemble, type RenderMode } from "../../choir/ensemble.ts";
import { GROOVES, MODES, PALETTES, PROGRESSIONS } from "../../choir/theory.ts";
import { KEYS, noteName, ROUND_LINES, type KeyName, type Piece, type ScaleMode } from "../../choir/music.ts";
import { midiBytes } from "../../choir/midi.ts";
import { beatSeconds, LEAD_IN, pieceSeconds } from "../../choir/plan.ts";
import { CHORUS, type MoppetVoice } from "../../choir/voices.ts";
import { makeIntroduction } from "../../choir/music.ts";
import { Choreographer, featuredAt } from "../../choir/choreo.ts";
import { applyControl, ccFor, CONTROLS, handleControl, useController, type ControlGroup, type ControlKey } from "../../choir/controller.ts";
import { midiSupported } from "../midi.ts";
import solo from "../../choir/vee-solo.json";
import "../moppet.css";

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
  const name = piece.kind === "intro" ? "Meet the whole choir" : piece.kind === "round" ? "Play the jam round" : piece.kind === "solo" ? `Sing ${piece.tracks[0].id}'s introduction` : piece.kind === "motesong" ? `Hear ${piece.tracks[0].id[0].toUpperCase()}${piece.tracks[0].id.slice(1)}’s song` : "Play the new invention";
  return <>{again}&nbsp;{name}</>;
}

/** One puppet as the stage effects see it, in stage pixels. */
interface Mark {
  x: number;
  /** the floor line under it */
  floor: number;
  /** where its feet are (above the floor while hopping) */
  feet: number;
  /** drawn height */
  h: number;
  hop: number;
  color: string;
  singing: boolean;
  level: number;
  bubble: string | null;
  spot: boolean;
}
/** A music note floating up from a singer. */
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

/** A note head with a stem and flag (drawn, not typed, so it is never text on the page). */
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

/** Behind the puppets: floor shadows and spotlights. In front: rising notes and chat bubbles. */
function drawStage(back: HTMLCanvasElement | null, front: HTMLCanvasElement | null, W: number, H: number, marks: Mark[], notes: Note[], dt: number, still: boolean) {
  if (!back || !front || W < 2 || H < 2) return;
  const b = fitCanvas(back, W, H), f = fitCanvas(front, W, H);
  if (!b || !f) return;
  for (const m of marks) {
    if (!m.spot) continue;
    const r = m.h * 0.42;
    const cone = b.createLinearGradient(0, 0, 0, m.floor);
    cone.addColorStop(0, "rgba(255,236,190,0.02)");
    cone.addColorStop(1, "rgba(255,236,190,0.16)");
    b.fillStyle = cone;
    b.beginPath();
    b.moveTo(m.x - 18, 0);
    b.lineTo(m.x + 18, 0);
    b.lineTo(m.x + r, m.floor);
    b.lineTo(m.x - r, m.floor);
    b.fill();
    const pool = b.createRadialGradient(m.x, m.floor, 0, m.x, m.floor, r * 1.2);
    pool.addColorStop(0, "rgba(255,226,160,0.42)");
    pool.addColorStop(1, "rgba(255,226,160,0)");
    b.fillStyle = pool;
    b.beginPath();
    b.ellipse(m.x, m.floor, r * 1.2, 14, 0, 0, Math.PI * 2);
    b.fill();
  }
  for (const m of [...marks].sort((p, q) => p.floor - q.floor)) {
    // the shadow tightens as the puppet leaves the floor
    const k = 1 - Math.min(1, m.hop) * 0.35;
    b.fillStyle = `rgba(14,10,8,${(0.42 * k).toFixed(3)})`;
    b.beginPath();
    b.ellipse(m.x, m.floor - 2, m.h * 0.24 * k, Math.max(3, m.h * 0.025) * k, 0, 0, Math.PI * 2);
    b.fill();
  }
  if (!still) {
    for (const [i, m] of marks.entries()) {
      if (!m.singing || Math.random() > dt * (1.2 + 5 * m.level)) continue;
      notes.push({ x: m.x + (Math.random() - 0.5) * m.h * 0.2, y: m.feet - m.h * 0.72, age: 0, life: 1.6 + Math.random() * 0.8, seed: Math.random() * 6 + i, color: m.color, double: Math.random() < 0.35 });
    }
  }
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    n.age += dt;
    n.y -= dt * 46;
    if (n.age > n.life || n.y < 24) notes.splice(i, 1);
  }
  for (const n of notes) {
    const t = n.age / n.life;
    f.globalAlpha = Math.min(1, n.age * 5) * (1 - t * t);
    f.fillStyle = n.color;
    drawNote(f, n.x + Math.sin(n.age * 3 + n.seed) * 9, n.y, n.double);
  }
  f.globalAlpha = 1;
  f.font = `600 12px ${getComputedStyle(front).fontFamily}`;
  f.textBaseline = "middle";
  for (const m of marks) {
    if (!m.bubble) continue;
    const tw = f.measureText(m.bubble).width, bw = tw + 18, bh = 24;
    const bx = Math.max(4, Math.min(W - bw - 4, m.x - bw / 2 + 14)), by = Math.max(4, m.feet - m.h * 0.92 - bh);
    f.fillStyle = "#f6ecd2";
    f.strokeStyle = "#2d2620";
    f.lineWidth = 1.5;
    f.beginPath();
    f.roundRect(bx, by, bw, bh, 10);
    f.moveTo(Math.min(bx + bw - 12, Math.max(bx + 12, m.x)) - 5, by + bh);
    f.lineTo(Math.min(bx + bw - 12, Math.max(bx + 12, m.x)) - 9, by + bh + 8);
    f.lineTo(Math.min(bx + bw - 12, Math.max(bx + 12, m.x)) + 3, by + bh);
    f.fill();
    f.stroke();
    f.fillStyle = "#2d2620";
    f.fillText(m.bubble, bx + 9, by + bh / 2 + 0.5);
  }
}

function Stage() {
  const voices = useMoppet((s) => s.voices);
  const selected = useMoppet((s) => s.selected);
  const select = useMoppet((s) => s.select);
  const piece = useMoppet((s) => s.piece);
  const status = useEnsemble((s) => s.status);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const poke = useRef<{ index: number; at: number } | null>(null);
  const [lyric, setLyric] = useState({ label: "", text: "Six forgotten props. A brand new song." });
  const [stageLabel, setStageLabel] = useState("READY WHEN YOU ARE");
  useEffect(() => {
    let raf = 0;
    let lastText = "";
    let lastT = performance.now() / 1000;
    let choreo: Choreographer | null = null;
    const notes: Note[] = [];
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const m = useMoppet.getState();
      const e = useEnsemble.getState();
      const active: string[] = [];
      const now = performance.now() / 1000;
      const dt = now - lastT;
      lastT = now;
      const dancing = e.status === "playing" || e.status === "buffering";
      // a paused song holds its formation; only a stopped stage wanders
      const performing = dancing || e.status === "paused";
      const beat = performing ? beatNow(m.piece, e.time) : now * 1.1;
      const poses = m.voices.map((v) => pose(v.id));
      const ids = m.voices.map((v) => v.id);
      if (!choreo || choreo.actors.length !== ids.length) choreo = new Choreographer(ids);
      const featured = performing ? featuredAt(m.piece.tracks, ids, beat) : ids.map(() => false);
      const actors = choreo.step({ playing: performing, beat, now, featured, singing: poses.map((p) => p.singing), poke: poke.current, still }, dt);
      const spot = featured.filter(Boolean).length;
      // spotlights only when a few are featured; the whole choir sings in the open
      const stage = stageRef.current;
      const W = stage?.clientWidth ?? 0, H = stage?.clientHeight ?? 0;
      // read every puppet's resting slot before writing any transform
      const homes = refs.current.map((el) => (el ? { x: el.offsetLeft + el.offsetWidth / 2, h: (el.offsetWidth * 512) / 384 } : null));
      const marks: Mark[] = [];
      m.voices.forEach((v, i) => {
        const el = refs.current[i], home = homes[i], a = actors[i];
        if (!el || !home) return;
        const p = poses[i];
        const lift = a.depth * 44 + a.hop * 34 + (a.walking && !dancing ? Math.abs(Math.sin(now * 12 + i)) * 4 : 0);
        // never taller than the room left above it, so a hop or a step upstage stays on the stage
        const scale = Math.min(0.96 - 0.24 * a.depth, (H - 28 - lift) / home.h);
        el.style.transform = `translate(${(a.x * W - home.x).toFixed(1)}px, ${(-lift).toFixed(1)}px) scale(${scale.toFixed(3)}) rotate(${a.lean.toFixed(2)}deg)`;
        el.style.zIndex = String(Math.round(100 - a.depth * 60 + (p.singing ? 5 : 0)));
        el.style.setProperty("--face", a.face.toFixed(3));
        const floor = H - 24 - a.depth * 44;
        marks.push({ x: a.x * W, floor, feet: floor - lift + a.depth * 44, h: home.h * scale, hop: a.hop, color: v.color, singing: p.singing, level: p.level, bubble: a.bubble, spot: !still && spot > 0 && spot < ids.length - 1 && featured[i] });
        const walkFrame = Math.floor(now * 7 + i * 3) % 8;
        if (v.id === "vee") {
          // the fully animated Moppet: a dancing body with a viseme head riding its neck
          const f = dancing ? Math.floor(beat * 2) % 8 : a.walking ? walkFrame : 7;
          const [nx, ny] = solo.neck[f];
          const blink = p.viseme === 0 && (now * 0.31 + i) % 1 < 0.04;
          const cell = blink ? 7 : p.viseme;
          const hs = solo.headScale;
          el.style.setProperty("--cel", `${((f % 4) * 100) / 3}% ${Math.floor(f / 4) * 100}%`);
          el.style.setProperty("--head", `${((cell % 4) * 100) / 3}% ${Math.floor(cell / 4) * 100}%`);
          el.style.setProperty("--hx", `${(nx - hs / 2) * 100}%`);
          el.style.setProperty("--hy", `${(ny - solo.headNeckY * hs) * 100}%`);
          const tilt = dancing ? Math.sin((Math.PI * beat) / 2) * 5 + (p.singing ? p.level * Math.sin(now * 3.1) * 2 : 0) : Math.sin(now * 1.3) * 1.5;
          el.style.setProperty("--tilt", `${tilt.toFixed(2)}deg`);
          el.style.setProperty("--sy", (1 + (dancing ? 0.03 * (Math.abs(Math.sin(Math.PI * beat)) - 0.5) : 0)).toFixed(3));
          el.classList.toggle("singing", p.singing);
          if (p.singing) active.push(v.name);
          return;
        }
        // the 8-frame dance cycle advances on the score's beat (two frames a beat); a rest holds the settle frame
        const frame = dancing ? Math.floor(beat * 2) % 8 : a.walking ? walkFrame : 7;
        const open = p.singing && p.open > 0.2; // the mouth comes from the engine's lip telemetry
        const col = frame % 4, row = Math.floor(frame / 4);
        const pos = `${(col * 100) / 3}% ${row * 100}%`;
        el.style.setProperty("--cel", pos);
        el.classList.toggle("mouth-open", open);
        // foot-anchored squash and stretch on the beat, from the planted feet
        const pulse = dancing ? Math.abs(Math.sin(Math.PI * beat)) : 0;
        const sy = 1 + (dancing ? 0.04 * (pulse - 0.5) * (p.singing ? 1 : 0.5) : 0.01 * Math.sin(now * 2 + i));
        el.style.setProperty("--sy", sy.toFixed(3));
        el.classList.toggle("singing", p.singing);
        if (p.singing) active.push(v.name);
      });
      drawStage(backRef.current, frontRef.current, W, H, marks, notes, Math.min(dt, 0.05), still);
      const running = e.status === "playing" || e.status === "buffering";
      if (running) {
        const beat = beatNow(m.piece, e.time);
        const lines = m.piece.tracks.flatMap((t) => {
          const ev = t.events.find((x) => beat >= x.beat && beat < x.beat + x.beats);
          if (!ev) return [];
          const name = m.voices.find((v) => v.id === t.id)?.name ?? t.id;
          const line = t.phrases && ev.line !== undefined ? t.phrases[ev.line] : m.piece.kind === "round" && ev.line !== undefined ? (ROUND_LINES[ev.line] ?? "Jam!") : ev.text;
          return [{ id: name, text: line }];
        });
        const names = active.length === 6 ? "ALL TOGETHER" : active.length > 1 ? `${active.length} VOICES IN HARMONY` : active[0] ? `${active[0].toUpperCase()} IS SINGING` : "A LITTLE BREATH";
        const text = lines.length ? (lines.length === 1 ? lines[0].text : lines.map((l) => `${l.id}: ${l.text}`).join(" · ")) : "";
        if (text + names !== lastText) {
          lastText = text + names;
          setStageLabel(names);
          if (text) setLyric({ label: m.piece.title.toUpperCase(), text });
        }
      } else if (lastText) {
        lastText = "";
        setStageLabel("READY WHEN YOU ARE");
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    setLyric({ label: piece.title.toUpperCase(), text: piece.description });
  }, [piece]);
  return (
    <div className="moppet-stage-wrap">
      <div className="theatre-top">
        <span><i /> ON THE LITTLE STAGE</span>
        <span>{status === "playing" ? stageLabel : status === "rendering" ? "RENDERING" : stageLabel}</span>
      </div>
      <div className="stage" ref={stageRef}>
        <canvas ref={backRef} className="stage-fx back" data-layout="overlay" aria-hidden="true" />
        <div className="string-lights" data-layout="overlay" aria-hidden="true">●<span>●</span>●<span>●</span>●<span>●</span>●</div>
        <div className="cast" data-layout="layered">
          {voices.map((v: MoppetVoice, i: number) => (
            <button key={v.id} ref={(el) => void (refs.current[i] = el)} className={`puppet${i === selected ? " selected" : ""}`} onClick={() => { select(i); poke.current = { index: i, at: performance.now() / 1000 }; }} aria-label={`Select ${v.name}`} aria-pressed={i === selected}>
              {v.id === "vee" ? (
                <span className="sprite solo" style={{ backgroundImage: "url(/moppets/vee/body.webp)" }} aria-hidden="true">
                  <span className="solo-head" style={{ backgroundImage: "url(/moppets/vee/head.webp)", width: `${solo.headScale * 100}%`, transformOrigin: `50% ${solo.headNeckY * 100}%` }} />
                </span>
              ) : (
                <span className="sprite" style={{ backgroundImage: `url(/moppets/${v.id}/closed.webp)` }} aria-hidden="true">
                  <span className="sprite-open" style={{ backgroundImage: `url(/moppets/${v.id}/open.webp)` }} />
                </span>
              )}
              <span className="name-tag">{v.name.toUpperCase()}</span>
            </button>
          ))}
        </div>
        <div className="shelf" />
        <canvas ref={frontRef} className="stage-fx front" data-layout="overlay" aria-hidden="true" />
      </div>
      <div className="caption">
        <span>{lyric.label}</span>
        <p aria-live="polite">{lyric.text}</p>
      </div>
      <Transport />
    </div>
  );
}

function Transport() {
  const piece = useMoppet((s) => s.piece);
  const lesson = useMoppet((s) => s.lesson);
  const status = useEnsemble((s) => s.status);
  const duration = useEnsemble((s) => s.duration);
  const time = useEnsemble((s) => s.time);
  const howPlaying = useEnsemble((s) => s.howPlaying);
  const renderMode = useEnsemble((s) => s.renderMode);
  const start = useStore((s) => s.start);
  const volume = useStore((s) => s.volume);
  const setVolume = useStore((s) => s.setVolume);
  const shown = duration || pieceSeconds(piece);
  const busy = status === "preparing" || status === "rendering";
  const [wavBusy, setWavBusy] = useState(false);
  const wav = async () => {
    setWavBusy(true);
    try {
      const out = await exportWav(start);
      download(new Blob([out.bytes], { type: "audio/wav" }), piece.kind === "round" ? "jam-in-my-top-hat.wav" : piece.kind === "intro" ? "studio-404-introduction.wav" : piece.kind === "solo" ? `${piece.tracks[0].id}-introduction.wav` : piece.kind === "motesong" ? `${piece.title.toLowerCase().replace(/\s+/g, "-")}.wav` : `moppet-invention-${piece.seed}.wav`);
    } catch (e) {
      useEnsemble.setState({ message: `WAV export: ${e instanceof Error ? e.message : String(e)}` });
    }
    setWavBusy(false);
  };
  return (
    <div className="transport">
      <button className="primary moppet-play" onClick={() => void play(start)} disabled={busy || wavBusy} data-kind={piece.kind}>
        <PlayLabel piece={piece} />
      </button>
      <button className="square" aria-label="Stop playback" onClick={stop} disabled={status === "idle"}>■</button>
      {busy && <button onClick={cancel}>Cancel</button>}
      <div className="timeline">
        <input aria-label="Song position" type="range" min={0} max={shown} step={0.05} value={Math.min(time, shown)} onChange={(e) => seek(Number(e.target.value))} />
        <div><span>{fmt(time)}</span><span>{fmt(shown)}</span></div>
      </div>
      <label className="volume">VOL <input aria-label="Playback volume" type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} /></label>
      <label className="render-mode" title="Live: six engines rendered just ahead on one timeline. Pre-render: the whole performance is finished first.">
        Render
        <select value={renderMode} onChange={(e) => setRenderMode(e.target.value as RenderMode)}>
          <option value="auto">Auto</option>
          <option value="live">Live</option>
          <option value="prerender">Pre-render</option>
        </select>
      </label>
      <button className="download" onClick={() => void wav()} disabled={busy || wavBusy}>↓ <span>{wavBusy ? "Rendering WAV…" : lesson === "round" ? "Round WAV" : piece.kind === "intro" ? "Song WAV" : "WAV"}</span></button>
      <span className="how">{howPlaying === "live" ? "Live" : howPlaying === "prerender" ? "Pre-rendered" : ""}</span>
    </div>
  );
}

function LessonTabs() {
  const lesson = useMoppet((s) => s.lesson);
  const piece = useMoppet((s) => s.piece);
  const setLesson = useMoppet((s) => s.setLesson);
  const tab = (l: Lesson, label: string) => (
    <button role="tab" aria-selected={lesson === l && piece.kind !== "solo"} onClick={() => setLesson(l)}>{label}</button>
  );
  return <div className="lesson-tabs" role="tablist" aria-label="Choose a performance">{tab("intro", "The first hello")}{tab("school", "01 · Music school")}{tab("round", "02 · The jam round")}{tab("chip", "03 · Chip’s song")}{tab("tabby", "04 · Tabby’s song")}{tab("gruff", "05 · Gruff’s shanty")}</div>;
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
  if (lesson === "intro" || lesson === "chip" || lesson === "tabby" || lesson === "gruff") return null;
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
      {lesson === "round" ? <label>Cycles<select value={repeats} disabled={busy} onChange={(e) => setSettings({ repeats: Number(e.target.value) })}><option value={1}>One each</option><option value={2}>Two each</option></select></label> : <label>Seed<input type="number" value={seed} disabled={busy} onChange={(e) => setSettings({ seed: Number(e.target.value) >>> 0 })} /></label>}
      <button className="invent" disabled={busy} onClick={lesson === "round" ? rehearse : invent}>{lesson === "round" ? "↻ Rehearse this round" : "✦ Invent another melody"}</button>
    </div>
  );
}

function ScoreSvg({ piece }: { piece: Piece }) {
  const voices = useMoppet((s) => s.voices);
  const cursor = useRef<SVGPathElement>(null);
  const w = 1100, h = 245, left = 38, top = 20;
  const midis = piece.tracks.flatMap((t) => t.events.map((e) => e.midi));
  const range = [Math.min(...midis) - 2, Math.max(...midis) + 2];
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
  }, [piece, sx]);
  const octaves: number[] = [];
  for (let n = Math.ceil(range[0] / 12) * 12; n <= range[1]; n += 12) octaves.push(n);
  const bars: number[] = [];
  for (let b = 0; b <= piece.beats; b += 4) bars.push(b);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${piece.title}, ${piece.tracks.length} voice parts across ${piece.beats} beats`}>
      <rect width={w} height={h} fill="#20382e" />
      {octaves.map((n) => <g key={n}><path d={`M${left} ${top + (range[1] - n) * sy}H${w}`} stroke="#ffffff18" /><text x={5} y={top + (range[1] - n) * sy + 3} fill="#bbccba" fontSize={9}>{noteName(n)}</text></g>)}
      {bars.map((b) => <g key={b}><path d={`M${left + b * sx} ${top}V${h - 18}`} stroke="#ffffff16" /><text x={left + b * sx + 3} y={h - 4} fill="#8caa94" fontSize={8}>{b / 4 + 1}</text></g>)}
      {piece.tracks.map((t) => {
        const color = voices.find((v) => v.id === t.id)?.color ?? "#fff";
        return t.events.map((e, i) => (
          <rect key={`${t.id}${i}`} x={left + e.beat * sx} y={top + (range[1] - e.midi) * sy - 2.5} width={Math.max(1.5, e.beats * sx - 1.5)} height={5} rx={1.5} fill={color} opacity={0.85}>
            <title>{`${t.id}: ${noteName(e.midi, piece.key, piece.mode)}, beat ${e.beat + 1}${e.text ? `, ${e.text}` : ""}`}</title>
          </rect>
        ));
      })}
      <path ref={cursor} d={`M${left} 12V${h - 18}`} stroke="#fff2c4" strokeWidth={1.5} />
    </svg>
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
  const harmonic = piece.kind === "round" ? piece.chords.slice(0, 4) : piece.chords.slice(0, 16);
  const midi = () => download(new Blob([midiBytes(piece) as BlobPart], { type: "audio/midi" }), piece.kind === "round" ? "jam-in-my-top-hat.mid" : piece.kind === "intro" ? "studio-404-introduction.mid" : piece.kind === "solo" ? `${piece.tracks[0].id}-introduction.mid` : piece.kind === "motesong" ? `${piece.title.toLowerCase().replace(/\s+/g, "-")}.mid` : `moppet-invention-${piece.seed}.mid`);
  return (
    <div className="moppet-score">
      <LessonTabs />
      <div className="lesson-header">
        <div>
          <p className="eyebrow">{piece.kind === "round" ? "SAME TUNE. ONE VERY STICKY HAT." : piece.kind === "intro" ? "SIX VERSES, ONE CHORUS" : piece.kind === "solo" ? "ONE MOPPET, ALONE" : piece.kind === "motesong" ? "THE NEW ONE TAKES A SOLO" : "AN INVENTION, NOT A REPEAT"}</p>
          <h2>{piece.title}</h2>
          <p>{piece.description}</p>
        </div>
        <span className="seed-label">{piece.kind === "round" ? `${piece.tracks.length} ENTRANCES` : piece.kind === "school" ? `SEED ${piece.seed}` : `D MAJOR · ${piece.bpm} BPM`}</span>
      </div>
      <MusicSettings />
      <p className="moppet-status" role="status">{message || status || (eStatus === "idle" ? "Ready. Press play." : "")}{eStatus === "rendering" ? ` (${Math.round(progress * 100)} %)` : ""}</p>
      <div className="chord-strip">{harmonic.map((c, i) => <span key={i}><b>{c.name}</b><small>{c.roman}</small></span>)}{piece.kind === "round" && <em>Every eight beats, the harmony comes home.</em>}</div>
      {piece.kind === "round" && <div className="round-words">{ROUND_LINES.map((l, i) => <p key={i}><b>{String(i + 1).padStart(2, "0")}</b>{l}</p>)}</div>}
      {lesson === "intro" && <details className="lyrics-sheet"><summary>The words we found</summary><div>{voices.map((v) => <div key={v.id}><h3>{v.name} · {v.role}</h3><p>{v.lyrics.join(" / ")}</p></div>)}<div><h3>All together</h3><p>{CHORUS.join(" / ")}</p></div></div></details>}
      <div className="score-header"><span>THE SCORE <small>{piece.key} {piece.mode === "minor" ? "harmonic minor" : "major"} · {piece.bpm} BPM · {piece.beats} beats</small></span><button onClick={midi}>↓ MIDI</button></div>
      <div className="score" aria-label="Six-part musical score"><ScoreSvg piece={piece} /></div>
      <div className="score-legend">{voices.map((v) => <span key={v.id}><i style={{ background: v.color }} />{v.name}</span>)}<span className="score-help">Higher on the page = higher pitch</span></div>
    </div>
  );
}


/** Connect a MIDI controller to the workbench; shows what it did last. */
function MidiStrip() {
  const midi = useStore((s) => s.midi);
  const setMidi = useStore((s) => s.setMidi);
  const last = useController((s) => s.last);
  const learning = useController((s) => s.learning);
  const resetMap = useController((s) => s.resetMap);
  if (!midiSupported()) return null;
  const on = midi.status === "on";
  const status = midi.status === "connecting" ? "Connecting…" : midi.status === "denied" ? "Blocked by the browser" : on ? (midi.inputs.length ? midi.inputs.join(", ") : "Plug one in") : "Off";
  return (
    <div className="midi-strip">
      <button className={on ? "on" : ""} aria-pressed={on} onClick={() => setMidi(!on)}>{on ? "MIDI on" : "Connect MIDI controller"}</button>
      <span className="midi-what">{learning ? "Turn the knob to use" : last || status}</span>
      <span className="midi-help">Knobs shape the voice · pads 1–7 pick a Moppet, pad 8 sings · keys play it</span>
      <button className="link" onClick={resetMap}>Launchkey layout</button>
    </div>
  );
}

function Workbench() {
  const voices = useMoppet((s) => s.voices);
  const selected = useMoppet((s) => s.selected);
  const select = useMoppet((s) => s.select);
  const reset = useMoppet((s) => s.reset);
  const savePreset = useMoppet((s) => s.savePreset);
  const loadPreset = useMoppet((s) => s.loadPreset);
  const singSolo = useMoppet((s) => s.singSolo);
  const start = useStore((s) => s.start);
  const ccMap = useController((s) => s.map);
  const learning = useController((s) => s.learning);
  const learn = useController((s) => s.learn);
  const v = voices[selected];
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
        {voices.map((c, i) => (
          <button key={c.id} className={`card${i === selected ? " selected" : ""}`} onClick={() => select(i)} aria-pressed={i === selected}>
            <span className="card-top"><span className="swatch" style={{ background: c.color }} /><span className="card-num">0{i + 1}</span></span>
            <strong>{c.name}</strong>
            <small>{c.role}</small>
          </button>
        ))}
      </div>
      <div className="voice-panel">
        <div className="panel-title"><h2>{v.name}</h2><span>{v.role}</span></div>
        <div className="panel-actions">
          <button onClick={solo}>▶ Sing my introduction</button>
          <button className="download" onClick={() => void wav()}>↓ WAV</button>
        </div>
        <MidiStrip />
        <div className="knobs">
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
        <p className="status" role="status">{note}</p>
        <p className="status">Experimental preset. Melody and harmony always come from the score: nothing here changes a singer’s pitch.</p>
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
  const selected = useMoppet((s) => s.selected);
  const voices = useMoppet((s) => s.voices);
  const f0 = useStore((s) => s.source.f0);
  const name = voices[selected].name;
  const piece = useMoppet((s) => s.piece);
  useEffect(() => {
    // load the score and this Moppet into CHIMERA's controls and views on first arrival
    if (useMoppet.getState().piece === piece) {
      loadPiece(piece);
      useMoppet.getState().select(useMoppet.getState().selected);
    }
    (window as unknown as { __choir: unknown }).__choir = { debug: ensembleDebug, ensemble: useEnsemble, moppet: useMoppet, engine, controller: useController, midi: handleControl, makeIntroduction, bench: () => import("../../choir/bench.ts").then((m) => m.benchChoir()) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const view = useMoppet((s) => s.view);
  const setView = useMoppet((s) => s.setView);
  const tabs = (
    <div className="moppet-views" role="tablist" aria-label="Moppets view">
      <button role="tab" aria-selected={view === "stage"} onClick={() => setView("stage")}>The stage</button>
      <button role="tab" aria-selected={view === "inspect"} onClick={() => setView("inspect")}>Inspect {name}’s voice in CHIMERA</button>
    </div>
  );
  const credit = <p className="moppet-credit">Experimental character voices · Studio 404. Physical voice synthesis by <a href="https://github.com/jamesondh/chimera-vocal-synth" target="_blank" rel="noreferrer">CHIMERA</a>, MIT licensed.</p>;
  if (view === "inspect")
    return (
      <div className="right right-moppet right-inspect">
        {tabs}
        <Screen className="s-cast warm" title={`Workbench: ${name}`} sub="Character">
          <Workbench />
        </Screen>
        <Screen className="s-tube" title="Tube" sub={`${name} / glottis to lips`}><TubeView /></Screen>
        <Screen className="s-folds" title="Vocal folds" sub={`${name} / slowed 100×`}><Stroboscope /></Screen>
        <Screen className="s-spec" title="Spectrum" sub={`${name} / alone`}><SpectrumView /></Screen>
        <Screen className="s-voice" title="Voice" sub={name} tools={<VoiceToggles />}><VoiceControls /></Screen>
        <Screen className="s-keys" title="Keys" sub={`Workbench voice / ${Math.round(f0)} Hz`}><Keys /></Screen>
        {credit}
      </div>
    );
  return (
    <div className="right right-moppet right-stage">
      {tabs}
      <Screen className="s-stage warm" title="The Moppet Choir" sub="Studio 404">
        <Stage />
      </Screen>
      <Screen className="s-score warm" title="Music school" sub="Score">
        <ScorePanel />
      </Screen>
      <Screen className="s-cast warm" title={`Workbench: ${name}`} sub="Character">
        <Workbench />
      </Screen>
      {credit}
    </div>
  );
}
