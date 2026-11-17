import { Fragment, useEffect, useRef, useState } from "react";
import { useAudio } from "../audio/audio.ts";
import { Screen } from "@chimera/ui/components/Screen.tsx";
import { currentFile, lessonFile, useMoppet, type Lesson } from "../choir/store.ts";
import { checkSung, holdFix, lineStarts, splitFix } from "../choir/songCheck.ts";
import type { Line, Section, Sung } from "../choir/songbook.ts";
import type { SongFile } from "../choir/songFile.ts";
import { g2p } from "../audio/g2p.ts";
import { cancel, scopeOf, useTelemetry, ensembleDebug, exportWav, loadPiece, pause, play, pose, poseAt, seek, setRenderMode, stop, useEnsemble, type RenderMode } from "../choir/ensemble.ts";
import { GROOVES, MODES, PALETTES, PROGRESSIONS } from "../choir/theory.ts";
import { KEYS, noteName, ROUND_LYRICS, type KeyName, type Piece, type ScaleMode } from "../choir/music.ts";
import { midiBytes } from "../choir/midi.ts";
import { beatSeconds, LEAD_IN, pieceSeconds } from "../choir/plan.ts";
import { CHORUS, type MoppetVoice } from "../choir/voices.ts";
import { makeIntroduction } from "../choir/music.ts";
import { Choreographer, featuredAt, sceneFeatured } from "../choir/choreo.ts";
import { SKITS } from "../choir/skits.ts";
import { gestureAt, type GesturePose } from "../choir/gestures.ts";
import { cuesFor } from "../choir/cues.ts";
import { captionsFor, shownWords, type Caption } from "../choir/captions.ts";
import { PropFx, updateProp } from "./props.tsx";
import { SONGBOOK } from "../choir/songbook.ts";
import { applyControl, ccFor, CONTROLS, handleControl, useController, type ControlGroup, type ControlKey } from "../choir/controller.ts";
import { midiSupported } from "./midi.ts";
import solo from "../choir/vee-solo.json";
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

/** Video capture (tools/moppet-video.ts): while on, the stage draws only when a frame is asked for. */
let capturing = false;
let drawCaptureFrame: ((time: number, dt: number) => void) | null = null;

/**
 * The video export's handle (tools/moppet-video.ts drives it through window.__choir.capture):
 * render a performance to the end, then draw any frame of it on demand.
 */
const captureApi = {
  /** Load a lesson, render it all, and return its WAV (base64), length and captions. */
  async prepare(lesson: string): Promise<{ wav: string; seconds: number; title: string; kind: string; captions: Caption[] }> {
    const m = useMoppet.getState();
    m.setLesson(lesson as Lesson);
    const piece = useMoppet.getState().piece;
    const out = await exportWav(useAudio.getState().start);
    let bin = "";
    const bytes = new Uint8Array(out.bytes);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const names = Object.fromEntries(useMoppet.getState().voices.map((v) => [v.id, v.name]));
    return { wav: btoa(bin), seconds: pieceSeconds(piece), title: piece.title, kind: piece.kind, captions: captionsFor(piece, names) };
  },
  /** Take over the stage's clock: from now on it draws only frames asked for. */
  begin(): void {
    capturing = true;
    document.querySelector(".stage")?.classList.add("capturing");
  },
  frame(time: number, dt: number): void {
    drawCaptureFrame?.(time, dt);
  },
  end(): void {
    capturing = false;
    document.querySelector(".stage")?.classList.remove("capturing");
  },
};

/** Room kept above a front-row puppet's cel for gestures to stretch and lean into (px). */
const HEADROOM = 40;

/** The AniCraft clip a Moppet is playing at this beat (the latest cue that hasn't finished). */
function gestureNow(piece: Piece, id: string, beat: number): GesturePose | null {
  let pose: GesturePose | null = null;
  for (const c of cuesFor(piece)) {
    if (c.who !== id || c.beat > beat) continue;
    pose = gestureAt(c.gesture, (beat - c.beat) * beatSeconds(piece)) ?? pose;
  }
  return pose;
}

/** A clip's pose on the puppet's sprite, pivoting at its feet and mirrored when it faces left. */
function setGesture(el: HTMLElement, g: GesturePose | null, h: number, face: number): void {
  const side = face < 0 ? -1 : 1;
  el.style.setProperty("--gx", `${((g?.dx ?? 0) * h * side).toFixed(1)}px`);
  el.style.setProperty("--gy", `${((g?.dy ?? 0) * h).toFixed(1)}px`);
  el.style.setProperty("--grot", `${((g?.rot ?? 0) * side).toFixed(2)}deg`);
  el.style.setProperty("--gsx", (g?.sx ?? 1).toFixed(3));
  el.style.setProperty("--gsy", (g?.sy ?? 1).toFixed(3));
}

/** The words a Moppet is singing at `beat`, and how far through them it is (0..1). */
function lineAt(piece: Piece, id: string, beat: number): { text: string; at: number } | null {
  const t = piece.tracks.find((x) => x.id === id);
  const words = t?.phrases ?? t?.lines;
  const e = t?.events.find((x) => beat >= x.beat && beat < x.beat + x.beats && x.line !== undefined);
  if (!t || !words || !e) return null;
  // this pass through the line: its notes that run on from this one without a gap of a beat
  const same = t.events.filter((x) => x.line === e.line && Math.abs(x.beat - e.beat) < 32);
  const start = Math.min(...same.map((x) => x.beat)), end = Math.max(...same.map((x) => x.beat + x.beats));
  return { text: shownWords(words[e.line!]), at: Math.min(1, (beat - start + 0.5) / Math.max(0.5, end - start)) };
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
  /** speaking a skit line: a voice, but no musical notes rise */
  talking?: boolean;
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
      if (!m.singing || m.talking || Math.random() > dt * (1.2 + 5 * m.level)) continue;
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
    // long lines (a skit) wrap, about six words to a row
    const rows: string[] = [];
    for (const word of m.bubble.split(" ")) {
      const last = rows[rows.length - 1];
      if (last !== undefined && f.measureText(`${last} ${word}`).width <= 190) rows[rows.length - 1] = `${last} ${word}`;
      else rows.push(word);
    }
    const tw = Math.max(...rows.map((r) => f.measureText(r).width)), bw = tw + 18, bh = 10 + rows.length * 15;
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
    rows.forEach((r, k) => f.fillText(r, bx + 9, by + 5 + 7.5 + k * 15 + 0.5));
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
    /**
     * One frame of the stage. Live, the clock is the wall and the audio; capturing a video
     * (`time` set), it is the song's own clock, a fixed step per frame, and the rendered session's
     * telemetry at that moment, so every frame matches the WAV exactly.
     */
    const draw = (clock: { now: number; dt: number; time: number | null }) => {
      const m = useMoppet.getState();
      const e = useEnsemble.getState();
      const active: string[] = [];
      const { now, dt } = clock;
      const capturing = clock.time !== null;
      const songTime = clock.time ?? e.time;
      const dancing = capturing || e.status === "playing" || e.status === "buffering";
      // a paused song holds its formation; only a stopped stage wanders
      const performing = dancing || e.status === "paused";
      const beat = performing ? beatNow(m.piece, songTime) : now * 1.1;
      const poses = m.voices.map((v) => (capturing ? poseAt(v.id, songTime) : pose(v.id)));
      const ids = m.voices.map((v) => v.id);
      if (!choreo || choreo.actors.length !== ids.length) choreo = new Choreographer(ids);
      const featured = !performing ? ids.map(() => false) : m.piece.scenes ? sceneFeatured(m.piece.scenes, ids, beat) : featuredAt(m.piece.tracks, ids, beat);
      const talk = m.piece.kind === "skit" && performing ? ids.map((id) => m.piece.tracks.find((t) => t.id === id)?.events.find((x) => beat >= x.beat - 0.15 && beat < x.beat + x.beats + 0.3)?.text ?? null) : undefined;
      const actors = choreo.step({ playing: performing, beat, now, featured, singing: poses.map((p) => p.singing), poke: capturing ? null : poke.current, still, talk }, dt);
      const spot = featured.filter(Boolean).length;
      // spotlights only when a few are featured; the whole choir sings in the open
      const stage = stageRef.current;
      const W = stage?.clientWidth ?? 0, H = stage?.clientHeight ?? 0;
      // read every puppet's resting slot before writing any transform
      const homes = refs.current.map((el) => (el ? { x: el.offsetLeft + el.offsetWidth / 2, w: el.offsetWidth, h: (el.offsetWidth * 512) / 384 } : null));
      const marks: Mark[] = [];
      m.voices.forEach((v, i) => {
        const el = refs.current[i], home = homes[i], a = actors[i];
        if (!el || !home) return;
        const p = poses[i];
        const lift = a.depth * 44 + a.hop * 34 + (a.walking && !dancing ? Math.abs(Math.sin(now * 12 + i)) * 4 : 0);
        // never taller than the room left above it, so a hop, a step upstage or a lean stays on the
        // stage: a lean rotates the puppet from its feet, raising a top corner by half its width × sin.
        // The 40 px margin is the gestures' headroom (a laugh's stretch and lean reach ~29 px above the
        // cel on a front-row puppet; the art's transparent top covers the rest), so a gesture never
        // shrinks its Moppet mid-move.
        const g = performing ? gestureNow(m.piece, v.id, beat) : null;
        const tilt = (Math.abs(a.lean) * Math.PI) / 180;
        const reach = home.h * Math.cos(tilt) + (home.w / 2) * Math.sin(tilt);
        const scale = Math.min(0.96 - 0.24 * a.depth, (H - HEADROOM - lift) / reach);
        el.style.transform = `translate(${(a.x * W - home.x).toFixed(1)}px, ${(-lift).toFixed(1)}px) scale(${scale.toFixed(3)}) rotate(${a.lean.toFixed(2)}deg)`;
        el.style.zIndex = String(Math.round(100 - a.depth * 60 + (p.singing ? 5 : 0)));
        el.style.setProperty("--face", a.face.toFixed(3));
        setGesture(el, g, home.h, a.face);
        const floor = H - 24 - a.depth * 44;
        marks.push({ x: a.x * W, floor, feet: floor - lift + a.depth * 44, h: home.h * scale, hop: a.hop, color: v.color, singing: p.singing, level: p.level, bubble: a.bubble, talking: m.piece.kind === "skit", spot: !still && spot > 0 && spot < ids.length - 1 && featured[i] });
        const walkFrame = Math.floor(now * 7 + i * 3) % 8;
        // the 8-frame dance cycle advances on the score's beat (two frames a beat); a rest holds the settle frame
        const cel = dancing ? Math.floor(beat * 2) % 8 : a.walking ? walkFrame : 7;
        updateProp(el.querySelector<HTMLElement>(".prop"), v.id, cel, p, dt, v.id === "scribe" ? lineAt(m.piece, v.id, beat) : null, v.id === "tabby" && p.singing ? scopeOf(v.id, capturing ? songTime : undefined) : null);
        if (v.id === "vee") {
          // the fully animated Moppet: a dancing body with a viseme head riding its neck
          const f = cel;
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
        const frame = cel;
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
      const running = !capturing && (e.status === "playing" || e.status === "buffering");
      if (running) {
        const beat = beatNow(m.piece, e.time);
        const lines = m.piece.tracks.flatMap((t) => {
          const ev = t.events.find((x) => beat >= x.beat && beat < x.beat + x.beats);
          if (!ev) return [];
          const name = m.voices.find((v) => v.id === t.id)?.name ?? t.id;
          const line = t.phrases && ev.line !== undefined ? t.phrases[ev.line] : t.lines && ev.line !== undefined ? t.lines[ev.line] : ev.text;
          return [{ id: name, text: shownWords(line) }];
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
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (capturing) return; // a video capture draws each frame itself
      const now = performance.now() / 1000;
      const dt = now - lastT;
      lastT = now;
      draw({ now, dt, time: null });
    };
    raf = requestAnimationFrame(tick);
    drawCaptureFrame = (time, dt) => draw({ now: time, dt, time });
    return () => {
      cancelAnimationFrame(raf);
      drawCaptureFrame = null;
    };
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
                  <PropFx id={v.id} />
                </span>
              ) : (
                <span className="sprite" style={{ backgroundImage: `url(/moppets/${v.id}/closed.webp)` }} aria-hidden="true">
                  <span className="sprite-open" style={{ backgroundImage: `url(/moppets/${v.id}/open.webp)` }} />
                  <PropFx id={v.id} />
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
  const start = useAudio((s) => s.start);
  const volume = useAudio((s) => s.volume);
  const setVolume = useAudio((s) => s.setVolume);
  const shown = duration || pieceSeconds(piece);
  const busy = status === "preparing" || status === "rendering";
  const [wavBusy, setWavBusy] = useState(false);
  const wav = async () => {
    setWavBusy(true);
    try {
      const out = await exportWav(start);
      download(new Blob([out.bytes], { type: "audio/wav" }), piece.kind === "round" ? `${piece.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.wav` : piece.kind === "intro" ? "studio-404-introduction.wav" : piece.kind === "solo" ? `${piece.tracks[0].id}-introduction.wav` : piece.kind === "motesong" || piece.kind === "skit" ? `${piece.title.toLowerCase().replace(/\s+/g, "-")}.wav` : `moppet-invention-${piece.seed}.wav`);
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
  const fresh = useMoppet((s) => s.freshSkit);
  const tab = (l: Lesson, label: string) => (
    <button role="tab" aria-selected={lesson === l && piece.kind !== "solo"} onClick={() => setLesson(l)}>{label}</button>
  );
  return <div className="lesson-tabs" role="tablist" aria-label="Choose a performance">{tab("intro", "The first hello")}{tab("school", "01 · Music school")}{tab("round", "02 · The jam round")}{tab("chip", "03 · Chip’s song")}{tab("tabby", "04 · Tabby’s song")}{tab("gruff", "05 · Gruff’s shanty")}{SONGBOOK.map((x) => <Fragment key={x.id}>{tab(x.id, x.tab)}</Fragment>)}{SKITS.map((x) => <Fragment key={x.id}>{tab(x.id, `Skit · ${x.title}`)}</Fragment>)}{fresh && tab("newskit", `Skit · ${fresh.title}`)}</div>;
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
function WordsEditor() {
  const lesson = useMoppet((s) => s.lesson);
  const edits = useMoppet((s) => s.songEdits);
  const editSongFile = useMoppet((s) => s.editSongFile);
  const revert = useMoppet((s) => s.revertSongFile);
  const save = useMoppet((s) => s.saveSongFile);
  const voices = useMoppet((s) => s.voices);
  const [open, setOpen] = useState(false);
  const [dictionary, setDictionary] = useState(g2p.loaded);
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
      {open && cur.edited && <button onClick={() => void save()}>{import.meta.env.DEV ? `Save to songs/${cur.file}` : `Download ${cur.file}`}</button>}
      {open && cur.edited && <button className="link" onClick={revert}>Revert</button>}
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
                <input value={l.say} onChange={(e) => editSongFile((x) => void (x.kind === "skit" && (x.skit.scenes[si][li].say = e.target.value)))} />
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
    return (
      <div key={`${li}-${ai}`} className={`words-line${ai !== null ? " answer" : ""}`}>
        <b>{ai !== null ? "+ " : ""}{name(s.who, song.lead)}</b>
        <input value={s.words} aria-invalid={check ? !check.ok : undefined} onChange={(e) => change(si, li, ai, (x) => void (x.words = e.target.value))} />
        {check && <small className={check.ok ? (check.hint ? "hint" : "ok") : "bad"} title={check.hint || check.problem}>{check.syllables.join("·") || "—"} · {check.ok ? `${check.notes} ✓` : check.problem}{check.ok && check.hint ? ` · ${check.hint}` : ""}</small>}
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
      <p className="words-note">One syllable per note: the dots show how the dictionary splits each line, and <code>_</code> after a syllable holds it over one more note (<code>ma_ny</code>). A repeated section is edited once.</p>
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
  const midiName = piece.kind === "round" ? `${piece.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.mid` : piece.kind === "intro" ? "studio-404-introduction.mid" : piece.kind === "solo" ? `${piece.tracks[0].id}-introduction.mid` : piece.kind === "motesong" || piece.kind === "skit" ? `${piece.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.mid` : `moppet-invention-${piece.seed}.mid`;
  const midi = () => download(new Blob([midiBytes(piece) as BlobPart], { type: "audio/midi" }), midiName);
  return (
    <div className="moppet-score">
      <LessonTabs />
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
      <div className="chord-strip">{harmonic.map((c, i) => <span key={i}><b>{c.name}</b><small>{c.roman}</small></span>)}{piece.kind === "round" && <em>Every eight beats, the harmony comes home.</em>}</div>
      {piece.kind === "round" && <RoundWords piece={piece} />}
      {lesson === "intro" && <details className="lyrics-sheet"><summary>The words we found</summary><div>{voices.map((v) => <div key={v.id}><h3>{v.name} · {v.role}</h3><p>{v.lyrics.join(" / ")}</p></div>)}<div><h3>All together</h3><p>{CHORUS.join(" / ")}</p></div></div></details>}
      {piece.kind === "skit" ? <Script piece={piece} /> : <><div className="score-header"><span>THE SCORE <small>{piece.key} {piece.mode === "minor" ? "harmonic minor" : "major"} · {piece.bpm} BPM · {piece.beats} beats</small></span><span className="score-tools"><BandToggle /><SoundCraftButtons name={midiName} /><button onClick={midi}>↓ MIDI</button></span></div>
      <div className="score" aria-label="Six-part musical score"><ScoreSvg piece={piece} /></div>
      <div className="score-legend">{voices.map((v) => <span key={v.id}><i style={{ background: v.color }} />{v.name}</span>)}<span className="score-help">Higher on the page = higher pitch</span></div></>}
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
      {linked && <button onClick={() => void open()} disabled={busy}>Open in SoundCraft</button>}
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
  const start = useAudio((s) => s.start);
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
  const name = voices[selected].name;
  const piece = useMoppet((s) => s.piece);
  useEffect(() => {
    // load the score on first arrival
    if (useMoppet.getState().piece === piece) {
      loadPiece(piece);
      useMoppet.getState().select(useMoppet.getState().selected);
    }
    (window as unknown as { __choir: unknown }).__choir = { capture: captureApi, debug: ensembleDebug, ensemble: useEnsemble, moppet: useMoppet, audio: useAudio, telemetry: useTelemetry, controller: useController, midi: handleControl, makeIntroduction, bench: () => import("../choir/bench.ts").then((m) => m.benchChoir()) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="right right-moppet right-stage">
      <Screen className="s-stage warm" title="The Moppet Choir" sub="Studio 404">
        <Stage />
      </Screen>
      <Screen className="s-score warm" title="Music school" sub="Score">
        <ScorePanel />
      </Screen>
      <Screen className="s-cast warm" title={`Workbench: ${name}`} sub="Character">
        <Workbench />
      </Screen>
      <p className="moppet-credit">Experimental character voices · Studio 404. Physical voice synthesis by <a href="https://github.com/jamesondh/chimera-vocal-synth" target="_blank" rel="noreferrer">CHIMERA</a>, MIT licensed.</p>
    </div>
  );
}
