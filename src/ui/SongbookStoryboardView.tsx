/**
 * Synchronized Studio 404 Illustrated Songbook & Storyboard View (`S-57`, `D-143`, `D-144`).
 *
 * Blends the musical Songbook (live VexFlow notation, key/BPM/meter, timed lyrics) with
 * connected Character & Location Bible reference cards, 4-panel 35mm stage strips,
 * reproducible Image + I2V Motion Prompts, and links to native `.designcraft` / PDF outputs.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Accidental,
  Annotation,
  Beam,
  Dot,
  Formatter,
  Fraction,
  GhostNote,
  Renderer,
  Stave,
  StaveNote,
  StaveTie,
  Voice,
} from "vexflow";
import {
  BookOpen,
  Camera,
  Check,
  Clapperboard,
  Copy,
  ExternalLink,
  Film,
  Layers,
  MapPin,
  Music,
  Pause,
  Play,
  Printer,
  SlidersHorizontal,
  Sparkles,
  Square,
  Wrench,
} from "lucide-react";
import { useAudio } from "../audio/audio.ts";
import { Choreographer } from "../choir/choreo.ts";
import { play, pose as samplePose, seek, stop, useEnsemble } from "../choir/ensemble.ts";
import { measures } from "../choir/meter.ts";
import { PPQ } from "../choir/midi.ts";
import type { CinemaShotPreset, Piece } from "../choir/music.ts";
import type { Pose } from "../choir/pose.ts";
import { keySigAccidentals, midiToVexNote, vexKeySignature } from "../choir/staffMath.ts";
import { beatSeconds, LEAD_IN } from "../choir/timeline.ts";
import { useMoppet, type Lesson } from "../choir/store.ts";
import { CAST } from "../choir/voices.ts";
import {
  compileIllustratedSongbook,
  listSongbookCatalog,
  type IllustratedSongbookSpec,
  type SongbookSceneSpec,
} from "../choir/songbookStoryboard.ts";
import { LiveStage3D } from "../stage/LiveStage3D.tsx";
import { stageCanvasRegistry } from "../stage/recordClip.ts";
import {
  defaultMoodForSection,
  STAGE_LIGHTING_MOODS,
  useStageDirector,
  type StageLightingMood,
} from "../stage/stageDirectorStore.ts";
import { STAGE_WORLD_LIST, type StageWorldId } from "../stage/stageWorlds.ts";
import { beatX, indexParts, type BeatAxis, type ScorePart } from "./sharedStaff.ts";

const fmtTime = (sec: number) => {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem < 10 ? "0" : ""}${rem.toFixed(1)}`;
};

function sanitizeDisplayPath(raw: string): string {
  return raw
    .replace(/^\/run\/media\/[^/]+\/[^/]+\/Work\/moppet-choir\//, "")
    .replace(/^\/run\/media\/[^/]+\/[^/]+\//, "");
}

function StoryboardImg({
  src,
  alt,
  fallbackText,
  className,
  loading,
}: {
  src: string | null | undefined;
  alt: string;
  fallbackText: string;
  className: string;
  loading?: "lazy" | "eager";
}) {
  const [failed, setFailed] = useState(false);
  const cleanSrc = src?.trim() ?? "";
  if (!cleanSrc || failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`${className} flex items-center justify-center bg-[#1e1510] font-mono text-xs font-bold text-[#e3bd7f]`}
      >
        {fallbackText}
      </div>
    );
  }
  return <img src={cleanSrc} alt={alt} className={className} loading={loading} onError={() => setFailed(true)} />;
}

function CopyPromptButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      data-sb-tone="light"
      onClick={onCopy}
      className="inline-flex items-center gap-1 rounded border border-[#ccbda6] bg-[#fffdf9] px-2 py-0.5 text-[11px] font-semibold text-[#473425] hover:border-[#8c6438] hover:bg-[#f6efe3] cursor-pointer"
    >
      {copied ? <Check className="size-3 text-emerald-700" /> : <Copy className="size-3 text-[#8c6438]" />}
      {copied ? "Copied" : label}
    </button>
  );
}

const LEAD_SHEET_LENGTHS = [
  [4, "w"],
  [3, "h"],
  [2, "h"],
  [1.5, "q"],
  [1, "q"],
  [0.75, "8"],
  [0.5, "8"],
  [0.375, "16"],
  [0.25, "16"],
  [0.125, "32"],
  [0.0625, "64"],
] as const;

type IndexedEventRef = ReturnType<typeof indexParts>[number];
type BarEntry = ReturnType<typeof measures>[number];

function medianMidi(midis: readonly number[]): number | null {
  if (!midis.length) return null;
  const sorted = [...midis].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function clefForBarMidis(midis: readonly number[], fallback: "treble" | "bass"): "treble" | "bass" {
  const med = medianMidi(midis);
  if (med === null) return fallback;
  if (med < 57) return "bass";
  if (Math.min(...midis) < 50 && Math.max(...midis) <= 64) return "bass";
  return "treble";
}

function leadSheetPaint(svg: SVGSVGElement, id: string, colors: string[]) {
  if (colors.length === 1) return colors[0]!;
  if (!svg.getElementById(id)) {
    const gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    gradient.id = id;
    colors.forEach((color, i) => {
      for (const edge of [i, i + 1]) {
        const stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
        stop.setAttribute("offset", String(edge / colors.length));
        stop.setAttribute("stop-color", color);
        gradient.append(stop);
      }
    });
    svg.querySelector("defs")?.append(gradient);
  }
  return `url(#${id})`;
}

/** Engrave a 3–4 bar lead-sheet system with automatic per-measure bass/treble clef switching and padded ledger room. */
function engraveLeadSheetSystem(
  root: HTMLDivElement,
  piece: Piece,
  parts: ScorePart[],
  events: IndexedEventRef[],
  bars: BarEntry[],
  first: number,
  systemId: string,
  width: number,
) {
  const ns = "http://www.w3.org/2000/svg";
  root.replaceChildren();
  const renderer = new Renderer(root, Renderer.Backends.SVG);
  renderer.resize(width, 176);
  const svg = root.querySelector("svg")!;
  svg.prepend(document.createElementNS(ns, "defs"));
  const ctx = renderer.getContext();

  const sysStart = Math.round((bars[0]?.start ?? 0) * PPQ);
  const sysEnd = Math.round((bars.at(-1)?.end ?? 0) * PPQ);
  const sysMidis = events.filter((e) => e.start < sysEnd && e.end > sysStart).map((e) => e.pitch);
  const pieceMed = medianMidi(events.map((e) => e.pitch)) ?? 64;
  let currentClef: "treble" | "bass" = clefForBarMidis(sysMidis, pieceMed < 57 ? "bass" : "treble");

  const signature = vexKeySignature(piece.key, piece.mode);
  const barWidth = width / Math.max(1, bars.length);
  const staveY = 26;
  const lyrics = new Map<number, { x: number; word: string; color: string; rank: number }>();
  const previous = new Map<IndexedEventRef, { note: StaveNote; head: number }>();
  let highest = 18;
  let lowest = 112;

  for (const [b, bar] of bars.entries()) {
    const left = b * barWidth;
    const start = Math.round(bar.start * PPQ);
    const end = Math.round(bar.end * PPQ);
    const within = events.filter((e) => e.start < end && e.end > start);
    const barClef = clefForBarMidis(within.map((e) => e.pitch), currentClef);
    const clefChanged = b === 0 || barClef !== currentClef;
    currentClef = barClef;

    const stave = new Stave(left, staveY, barWidth);
    if (clefChanged) stave.addClef(barClef, "small");
    if (b === 0) stave.addKeySignature(signature);
    if (bar.printMeter) stave.addTimeSignature(bar.signature);
    stave.setContext(ctx).draw();

    const identical = new Map<string, { from: number; to: number; refs: IndexedEventRef[] }>();
    for (const ref of within) {
      const from = Math.max(start, ref.start);
      const to = Math.min(end, ref.end);
      const key = `${from}:${to}`;
      const span = identical.get(key) ?? { from, to, refs: [] };
      span.refs.push(ref);
      identical.set(key, span);
    }
    const lanes: { from: number; to: number; refs: IndexedEventRef[] }[][] = [[]];
    for (const span of [...identical.values()].sort((a, b2) => a.from - b2.from || a.to - b2.to)) {
      const free = lanes.find((lane) => (lane.at(-1)?.to ?? start) <= span.from);
      if (free) free.push(span);
      else lanes.push([span]);
    }

    const [numBeats, beatValue] = bar.signature.split("/").map(Number);
    const written: {
      note: StaveNote;
      heads: { pitch: number; displayPitch: number; octaveTag: "8vb" | "8va" | null; refs: IndexedEventRef[] }[];
      tick: number;
    }[] = [];
    const beams: Beam[] = [];

    const voices = lanes.map((lane, laneIndex) => {
      const notes: (StaveNote | GhostNote)[] = [];
      const fill = (from: number, to: number, refs: IndexedEventRef[]) => {
        const byPitch = new Map<number, IndexedEventRef[]>();
        for (const ref of refs) {
          const same = byPitch.get(ref.pitch) ?? [];
          same.push(ref);
          byPitch.set(ref.pitch, same);
        }
        const heads = [...byPitch]
          .sort(([a], [b2]) => a - b2)
          .map(([pitch, hRefs]) => {
            let displayPitch = pitch;
            let octaveTag: "8vb" | "8va" | null = null;
            if (barClef === "treble" && displayPitch < 53) {
              while (displayPitch < 53) displayPitch += 12;
              octaveTag = "8vb";
            } else if (barClef === "bass" && displayPitch > 67) {
              while (displayPitch > 67) displayPitch -= 12;
              octaveTag = "8va";
            }
            return { pitch, displayPitch, octaveTag, refs: hRefs };
          });

        for (let at = from; at < to; ) {
          const [beats, code] = LEAD_SHEET_LENGTHS.find(([n]) => n * PPQ <= to - at) ?? LEAD_SHEET_LENGTHS.at(-1)!;
          const ticks = Math.min(to - at, Math.round(beats * PPQ));
          const durationOverride = new Fraction(ticks, 4 * PPQ);
          if (!refs.length && (laneIndex > 0 || within.some((e) => e.start < at + ticks && e.end > at))) {
            notes.push(new GhostNote({ duration: code, durationOverride }));
            at += ticks;
            continue;
          }
          const pitches = heads.map(({ displayPitch }) => midiToVexNote(displayPitch, piece.key, piece.mode, {}));
          const dotted = [3, 1.5, 0.75, 0.375].includes(beats);
          const note = new StaveNote({
            clef: barClef,
            keys: heads.length ? pitches.map((p) => p.key) : [barClef === "bass" ? "d/3" : "b/4"],
            duration: code + (heads.length ? "" : "r"),
            dots: dotted ? 1 : 0,
            durationOverride,
            autoStem: lanes.length === 1,
            stemDirection: laneIndex % 2 === 0 ? 1 : -1,
          });
          if (dotted) Dot.buildAndAttach([note], { all: true });
          const octaveMarkers = [...new Set(heads.map((h) => h.octaveTag).filter(Boolean))];
          if (octaveMarkers.length === 1) {
            note.addModifier(
              new Annotation(octaveMarkers[0]!)
                .setFont("sans-serif", 9, "italic")
                .setVerticalJustification(
                  octaveMarkers[0] === "8vb" ? Annotation.VerticalJustify.BOTTOM : Annotation.VerticalJustify.TOP,
                ),
              0,
            );
          }
          heads.forEach((head, k) => {
            const singers = [...new Set(head.refs.map((e) => e.part))];
            const fillStyle = leadSheetPaint(
              svg,
              `${systemId}-u-${singers.join("-")}`,
              singers.map((i) => parts[i]!.color),
            );
            note.setKeyStyle(k, { fillStyle, strokeStyle: fillStyle });
          });
          notes.push(note);
          written.push({ note, heads, tick: at });
          at += ticks;
        }
      };
      let tick = start;
      for (const span of lane) {
        fill(tick, span.from, []);
        fill(span.from, span.to, span.refs);
        tick = span.to;
      }
      fill(tick, end, []);
      const voice = new Voice({ numBeats, beatValue }).setMode(Voice.Mode.SOFT).addTickables(notes);
      let run: StaveNote[] = [];
      const flush = () => {
        if (run.length > 1) {
          beams.push(
            ...Beam.generateBeams(run, {
              maintainStemDirections: true,
              groups: [new Fraction(beatValue === 8 && numBeats % 3 === 0 ? 3 : 1, beatValue)],
            }),
          );
        }
        run = [];
      };
      for (const n of notes) {
        if (n instanceof StaveNote) run.push(n);
        else flush();
      }
      flush();
      return voice;
    });

    const accidentalState = new Map<number, Record<string, number>>();
    written.sort((a, b2) => a.tick - b2.tick);
    for (const { note, heads } of written) {
      heads.forEach(({ displayPitch }, k) => {
        const octave = Math.floor(displayPitch / 12);
        const state = accidentalState.get(octave) ?? keySigAccidentals(signature);
        const { accidental } = midiToVexNote(displayPitch, piece.key, piece.mode, state);
        accidentalState.set(octave, state);
        if (accidental) note.addModifier(new Accidental(accidental), k);
      });
    }

    const formatter = new Formatter().joinVoices(voices);
    formatter.format(voices, Math.max(24, left + barWidth - stave.getNoteStartX() - 14));
    const barAxis: BeatAxis = { start: bar.start, end: bar.end, from: stave.getNoteStartX() + 12, to: left + barWidth - 6 };
    for (const w of written) {
      w.note.setStave(stave);
      const context = w.note.getTickContext();
      context.setX(context.getX() + beatX([barAxis], w.tick / PPQ) - w.note.getAbsoluteX() - 5);
    }

    voices.forEach((v) => v.draw(ctx, stave));
    beams.forEach((beam) => beam.setContext(ctx).draw());

    for (const w of written) {
      const x = w.note.getAbsoluteX() + 5;
      const ys = w.note.getYs();
      highest = Math.min(highest, ...ys);
      lowest = Math.max(lowest, ...ys);
      if (w.note.hasStem()) {
        const ext = w.note.getStemExtents();
        highest = Math.min(highest, ext.topY, ext.baseY);
        lowest = Math.max(lowest, ext.topY, ext.baseY);
      }
      w.heads.forEach((head, i) => {
        const held = head.refs.find((e) => e.start < w.tick);
        if (held) {
          const prev = previous.get(held);
          new StaveTie({ firstNote: prev?.note, lastNote: w.note, firstIndexes: [prev?.head ?? i], lastIndexes: [i] })
            .setContext(ctx)
            .draw();
        }
        if (b === bars.length - 1 && head.refs.some((e) => e.end > end)) {
          new StaveTie({ firstNote: w.note, firstIndexes: [i], lastIndexes: [i] }).setContext(ctx).draw();
        }
        for (const e of head.refs) {
          previous.set(e, { note: w.note, head: i });
          const part = parts[e.part]!;
          const word = part.words[e.index];
          const rank = e.part + (part.events[e.index]!.line === undefined ? parts.length : 0);
          if (e.start === w.tick && word && rank < (lyrics.get(w.tick)?.rank ?? Infinity)) {
            lyrics.set(w.tick, { x, word: word.split(/\s+/).slice(0, 2).join(" "), color: part.color, rank });
          }
        }
      });
    }

    const barLabel = document.createElementNS(ns, "text");
    barLabel.setAttribute("x", String(left + 9));
    barLabel.setAttribute("y", "16");
    barLabel.setAttribute("font-size", "10");
    barLabel.setAttribute("fill", "#536c60");
    barLabel.textContent = String(first + b + 1);
    svg.append(barLabel);
  }

  const top = Math.min(0, highest - 14);
  const baseline = Math.max(126, lowest + 20);
  let lastRight = -Infinity;
  for (const [, l] of [...lyrics].sort(([a], [b2]) => a - b2)) {
    const labelWidth = Math.max(8, l.word.length * 6.4);
    if (l.x - labelWidth / 2 < lastRight + 4) continue;
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", String(l.x));
    text.setAttribute("y", String(baseline));
    text.setAttribute("font-size", "10");
    text.setAttribute("fill", l.color);
    text.setAttribute("text-anchor", "middle");
    text.textContent = l.word;
    svg.append(text);
    lastRight = l.x + labelWidth / 2;
  }

  const height = Math.ceil(baseline + 12 - top);
  svg.setAttribute("viewBox", `0 ${top} ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", String(height));
  svg.style.height = "auto";
  svg.style.display = "block";
  svg.style.overflow = "hidden";
}

/** Pure static VexFlow lead-sheet engraving (no playback clock dependency). */
function StaticLeadSheet({ piece, compact = false }: { piece: Piece; compact?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const bars = useMemo(() => measures(piece), [piece]);
  const parts = useMemo(
    () =>
      piece.tracks.map((tr, i) => ({
        id: tr.id,
        name: tr.id.toUpperCase(),
        color: ["#097364", "#9a442b", "#7048a0", "#236a9c", "#805e13", "#a33f71"][i % 6]!,
        events: tr.events,
        words: tr.events.map((e) => e.text),
      })),
    [piece],
  );
  const events = useMemo(() => indexParts(parts), [parts]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || !bars.length || !parts.length) return;
    el.innerHTML = "";
    const width = Math.max(460, Math.min(820, el.clientWidth || 720));
    const perRow = compact ? 3 : 4;
    const systems = Array.from({ length: Math.ceil(bars.length / perRow) }, (_, i) => ({
      first: i * perRow,
      bars: bars.slice(i * perRow, (i + 1) * perRow),
    }));
    const limit = compact ? Math.min(4, systems.length) : Math.min(8, systems.length);
    for (let i = 0; i < limit; i++) {
      const host = document.createElement("div");
      host.className = "border-b border-[#e5dac8] bg-white px-2 py-2 last:border-b-0";
      el.append(host);
      engraveLeadSheetSystem(host, piece, parts, events, systems[i]!.bars, systems[i]!.first, `sb-${piece.title}-${i}`, width);
    }
  }, [piece, bars, parts, events, compact]);

  if (!bars.length) {
    return (
      <div className="rounded-lg border border-[#d8cbb8] bg-white p-4 text-xs text-[#6e5a47]">
        Dialogue skit timing grid ({piece.bpm} BPM seconds timeline, {piece.tracks.length} speakers).
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#d4c4ae] bg-white shadow-xs">
      <div ref={wrapRef} aria-label="Songbook engraved lead sheet" />
      {bars.length > (compact ? 12 : 32) && (
        <p className="m-0 border-t border-[#e5dac8] bg-[#faf5ec] px-3 py-1.5 text-[11px] text-[#6a5542]">
          Showing opening lead-sheet systems ({bars.length} total measures in full interactive score).
        </p>
      )}
    </div>
  );
}

const CAMERA_SHOT_OPTIONS: readonly { id: CinemaShotPreset | ""; label: string }[] = [
  { id: "", label: "Cam: Score" },
  { id: "wide", label: "Wide" },
  { id: "two-shot", label: "Two-Shot" },
  { id: "closeup", label: "Closeup" },
  { id: "low-angle", label: "Low-Angle" },
  { id: "reaction", label: "Reaction" },
];

/** Capture a crisp 16:9 snapshot directly from the active Three.js WebGL `<canvas>`. */
function captureStageSnapshot(): string | null {
  const src = stageCanvasRegistry.current;
  if (!src || src.width === 0 || src.height === 0) return null;
  const out = document.createElement("canvas");
  out.width = 480;
  out.height = 270;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#10080b";
  ctx.fillRect(0, 0, out.width, out.height);
  const k = Math.min(out.width / src.width, out.height / src.height);
  const w = src.width * k;
  const h = src.height * k;
  ctx.drawImage(src, (out.width - w) / 2, (out.height - h) / 2, w, h);
  try {
    return out.toDataURL("image/webp", 0.86);
  } catch {
    return out.toDataURL("image/png");
  }
}

/** Inline per-scene Variable Stage controls (3D World, Lighting Mood, Camera Shot) shared across Storyboard & Drawer. */
function SceneVariableStageControls({
  songId,
  sceneIndex,
  compact = false,
  onChanged,
}: {
  songId: string;
  sceneIndex: number;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const override = useStageDirector((s) => s.overrides[`${songId}:${sceneIndex}`]);
  const setSceneOverride = useStageDirector((s) => s.setSceneOverride);
  const setVariableStageEnabled = useStageDirector((s) => s.setVariableStageEnabled);

  const selectClass = compact
    ? "rounded border border-[#cbb99f] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#3a2a1d]"
    : "rounded-md border border-[#cbb99f] bg-[#fffdf9] px-2 py-0.5 text-[11px] font-semibold text-[#3a2a1d]";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <SlidersHorizontal className="size-3 text-[#8c432b] shrink-0" />
      <select
        aria-label={`Scene ${sceneIndex} 3D world`}
        value={override?.worldId ?? ""}
        onChange={(e) => {
          setVariableStageEnabled(true);
          const v = e.target.value as StageWorldId | "";
          setSceneOverride(songId, sceneIndex, { worldId: v || undefined });
          if (v) useAudio.getState().setWorld(v);
          useStageDirector.getState().setPreviewSceneKey(`${songId}:${sceneIndex}`);
          onChanged?.();
        }}
        className={selectClass}
      >
        <option value="">World: Default</option>
        {STAGE_WORLD_LIST.map((w) => (
          <option key={w.id} value={w.id}>
            {w.shortLabel}
          </option>
        ))}
      </select>

      <select
        aria-label={`Scene ${sceneIndex} lighting mood`}
        value={override?.mood ?? "auto"}
        onChange={(e) => {
          setVariableStageEnabled(true);
          const v = e.target.value as StageLightingMood;
          setSceneOverride(songId, sceneIndex, { mood: v });
          onChanged?.();
        }}
        className={selectClass}
      >
        {STAGE_LIGHTING_MOODS.map((m) => (
          <option key={m.id} value={m.id}>
            Mood: {m.shortLabel}
          </option>
        ))}
      </select>

      <select
        aria-label={`Scene ${sceneIndex} camera shot`}
        value={override?.cameraPreset ?? ""}
        onChange={(e) => {
          setVariableStageEnabled(true);
          const v = e.target.value as CinemaShotPreset | "";
          setSceneOverride(songId, sceneIndex, { cameraPreset: v || undefined });
          onChanged?.();
        }}
        className={selectClass}
      >
        {CAMERA_SHOT_OPTIONS.map((c) => (
          <option key={c.id || "default"} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function SceneCard({
  spec,
  scene,
  onSeekStageSec,
  onSnapScene,
  snapping = false,
}: {
  spec: IllustratedSongbookSpec;
  scene: SongbookSceneSpec;
  onSeekStageSec?: (stageSec: number) => void;
  onSnapScene?: (scene: SongbookSceneSpec) => void;
  snapping?: boolean;
}) {
  const captured = useStageDirector((s) => s.captures[`${spec.id}:${scene.index}`]);
  const override = useStageDirector((s) => s.overrides[`${spec.id}:${scene.index}`]);

  const effectiveHeroUrl = captured?.heroUrl ?? scene.heroUrl;
  const effectiveCamera = override?.cameraPreset ?? scene.cameraPreset;

  const cleanAnchors = scene.refAnchors.map(sanitizeDisplayPath);
  const fullBrief = [
    `[${scene.code} — ${scene.title} | ${scene.barsLabel} | ${fmtTime(scene.startSec)}–${fmtTime(scene.endSec)}]`,
    `Camera/Lens: ${effectiveCamera} · ${scene.lensSpec}`,
    override?.worldId ? `3D Stage World: ${override.worldId}` : "",
    override?.mood && override.mood !== "auto" ? `Lighting Mood: ${override.mood}` : "",
    `Blocking: ${scene.blockingSummary.join(" | ") || "Standard ensemble groove"}`,
    scene.takesSummary.length ? `Directed Takes: ${scene.takesSummary.join(" | ")}` : "",
    `Lyrics/Dialogue: ${scene.lines.map((l) => `${l.speaker}: "${l.text}"`).join(" / ") || "(Instrumental)"}`,
    `Image Prompt: ${scene.imagePrompt}`,
    `I2V Motion Prompt: ${scene.motionPrompt}`,
    `Refs:\n${cleanAnchors.join("\n")}`,
    `Bookend Guard: ${scene.bookendRule}`,
  ]
    .filter(Boolean)
    .join("\n");

  const seekOrWatch = (sec: number) => {
    useStageDirector.getState().setVariableStageEnabled(true);
    useStageDirector.getState().setPreviewSceneKey(`${spec.id}:${scene.index}`);
    if (onSeekStageSec) {
      onSeekStageSec(Math.max(0, sec - LEAD_IN));
    } else {
      window.location.href = `${spec.watchUrl}&scene=${encodeURIComponent(scene.title)}`;
    }
  };

  return (
    <article className="rounded-2xl border border-[#d7c8b2] bg-[#faf7f1] text-[#1c1410] shadow-sm overflow-hidden print:break-inside-avoid">
      {/* Scene Spread Header */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#dfd2be] bg-[#f2eadc] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-[#1c1410] px-2 py-0.5 font-mono text-xs font-bold text-[#faf7f1]">
            {scene.code}
          </span>
          <h3 className="font-serif text-lg font-bold tracking-tight text-[#1c1410] m-0">
            {scene.title}
          </h3>
          <span className="font-mono text-xs text-[#6d5946]">
            {scene.barsLabel} · {fmtTime(scene.startSec)}–{fmtTime(scene.endSec)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <SceneVariableStageControls
            songId={spec.id}
            sceneIndex={scene.index}
            onChanged={() => seekOrWatch(scene.startSec)}
          />
          {onSnapScene && (
            <button
              type="button"
              disabled={snapping}
              onClick={() => onSnapScene(scene)}
              className="inline-flex items-center gap-1 rounded-full border border-[#8c6438] bg-[#fffaf0] px-2.5 py-0.5 text-[11px] font-semibold text-[#5a3d20] hover:bg-[#f2e5cf] disabled:opacity-50 cursor-pointer"
            >
              <Camera className="size-3 text-[#9a442b]" />
              {snapping ? "Snapping…" : "Snap 3D Strip"}
            </button>
          )}
          <button
            type="button"
            data-sb-tone="teal"
            onClick={() => seekOrWatch(scene.startSec)}
            className="inline-flex items-center gap-1 rounded-full bg-[#203832] px-2.5 py-0.5 text-[11px] font-semibold text-[#e9fff7] hover:bg-[#2b4d45] cursor-pointer"
          >
            <Play className="size-3 fill-current" />
            {onSeekStageSec ? "Jump 3D Stage" : "Watch beat"}
          </button>
          <CopyPromptButton text={fullBrief} label="Copy Brief" />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2">
        {/* Subpage Left: Hero Keyframe + Linked Cast/Loc Ingredients + 35mm Strip */}
        <div className="space-y-3">
          {effectiveHeroUrl ? (
            <div className="overflow-hidden rounded-xl border border-[#cbb99f] bg-[#160d0a] shadow-inner">
              <div className="flex items-center justify-between border-b border-[#3a2519] bg-[#1e120d] px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-[#d9c3a5]">
                <span>
                  {scene.code} Hero Keyframe ({captured?.heroUrl ? "Live 3D Capture" : "Three.js Stage Plate"})
                </span>
                <span>{effectiveCamera} · {scene.lensSpec.split("·")[0]}</span>
              </div>
              <StoryboardImg
                src={effectiveHeroUrl}
                alt={`${spec.title} ${scene.code} hero`}
                fallbackText={scene.code}
                className="aspect-video w-full object-cover"
                loading="lazy"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-[#cbb99f] bg-white p-3 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-semibold text-[#6d5946]">
                <span>Stage Blueprint &amp; Linked Cast Composition</span>
                <span className="font-mono">{spec.locationRef.setId}</span>
              </div>
              <div className="relative overflow-hidden rounded-lg border border-[#dfd2be] bg-[#170d0a]">
                <StoryboardImg
                  src={spec.locationRef.plateUrl}
                  alt={spec.locationRef.label}
                  fallbackText={spec.locationRef.setId}
                  className="aspect-video w-full object-cover opacity-80"
                  loading="lazy"
                />
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-center gap-3 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-3 pb-2 pt-8">
                  {spec.castRefs.slice(0, 5).map((c) => (
                    <div key={c.castId} className="flex flex-col items-center gap-0.5">
                      <StoryboardImg
                        src={c.portraitUrl}
                        alt={c.displayName}
                        fallbackText={c.displayName.slice(0, 2).toUpperCase()}
                        className="h-14 w-14 rounded-lg border border-white/25 bg-black/50 object-contain p-0.5"
                        loading="lazy"
                      />
                      <span className="font-mono text-[10px] font-semibold text-[#fff3dd]">{c.displayName}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 4-Panel 35mm Filmstrip */}
          <div className="rounded-xl border border-[#d7c8b2] bg-[#1b1411] p-2.5 text-[#f6ead7]">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-[#cdb79a]">
              <span className="inline-flex items-center gap-1">
                <Film className="size-3 text-[#e3bd7f]" />
                35mm 4-Panel Action Strip
              </span>
              <span>{scene.lensSpec}</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {scene.stripTimestampsSec.map((t, i) => {
                const thumbUrl = captured?.frames[i] ?? scene.stripFrameUrls?.[i];
                return (
                  <button
                    key={`${scene.code}-f-${i}`}
                    type="button"
                    onClick={() => seekOrWatch(t)}
                    className="group relative overflow-hidden rounded border border-[#4a3629] bg-[#2a1d17] text-left hover:border-[#e3bd7f] cursor-pointer"
                  >
                    {thumbUrl ? (
                      <StoryboardImg
                        src={thumbUrl}
                        alt={`${scene.code} frame ${i + 1}`}
                        fallbackText={`F${i + 1}`}
                        className="aspect-video w-full object-cover transition-transform group-hover:scale-[1.03]"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex aspect-video items-center justify-center bg-[#231712] px-1 text-center font-mono text-[10px] text-[#e3bd7f]">
                        Beat @{fmtTime(t)}
                      </div>
                    )}
                    <div className="flex items-center justify-between bg-[#140e0b] px-1.5 py-0.5 font-mono text-[9px] text-[#d9c3a5]">
                      <span>F{i + 1}</span>
                      <span>{fmtTime(t)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Subpage Right: Timed Lyrics, Blocking & Structured Prompts */}
        <div className="space-y-3">
          {/* Timed Lyrics / Dialogue Rows */}
          <div className="rounded-xl border border-[#d8cbb8] bg-white p-3">
            <div className="mb-2 flex items-center justify-between border-b border-[#efe5d6] pb-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-[#6e5641]">
                Timed Lyrics &amp; Stage Blocking
              </span>
              {scene.takesSummary.length > 0 && (
                <span className="font-mono text-[10px] font-semibold text-[#097364]">
                  {scene.takesSummary.join(" · ")}
                </span>
              )}
            </div>
            {scene.lines.length > 0 ? (
              <ul className="space-y-1.5 m-0 p-0 list-none">
                {scene.lines.map((ln, li) => (
                  <li key={`${scene.code}-l-${li}`} className="flex items-baseline gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => seekOrWatch(ln.timeSec)}
                      className="shrink-0 rounded bg-[#f4ede1] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#6e5641] hover:bg-[#e7dac6] cursor-pointer"
                    >
                      {fmtTime(ln.timeSec)}
                    </button>
                    <span className="shrink-0 font-bold" style={{ color: ln.color }}>
                      {ln.speaker}:
                    </span>
                    <span className="font-serif text-[13px] text-[#1c1410]">{ln.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-xs italic text-[#7a6450]">Instrumental / stage transition cue.</p>
            )}
            {scene.blockingSummary.length > 0 && (
              <p className="mt-2 mb-0 border-t border-[#f1e9db] pt-1.5 font-mono text-[10px] text-[#5e4b3a]">
                Moves: {scene.blockingSummary.join(" · ")}
              </p>
            )}
          </div>

          {/* Image Prompt */}
          <div className="rounded-xl border border-[#d8cbb8] bg-white p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#8c432b]">
                <Sparkles className="size-3" />
                Image / Keyframe Prompt
              </span>
              <CopyPromptButton text={scene.imagePrompt} />
            </div>
            <p className="m-0 text-xs leading-relaxed text-[#2d2119]">{scene.imagePrompt}</p>
          </div>

          {/* I2V Motion Prompt */}
          <div className="rounded-xl border border-[#d8cbb8] bg-white p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#097364]">
                <Clapperboard className="size-3" />
                I2V / EffectCraft Motion Prompt
              </span>
              <CopyPromptButton text={scene.motionPrompt} />
            </div>
            <p className="m-0 text-xs leading-relaxed text-[#2d2119]">{scene.motionPrompt}</p>
          </div>

          {/* Traceable Reference Anchors & Bookend Guard */}
          <div className="rounded-xl border border-[#d8cbb8] bg-[#f5efe4] p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#584534]">
                @Ref Anchors &amp; Continuity Guard
              </span>
              <CopyPromptButton text={cleanAnchors.join("\n")} label="Copy Refs" />
            </div>
            <p className="m-0 mb-1.5 text-[11px] font-semibold text-[#3f3023]">{scene.bookendRule}</p>
            <div className="space-y-0.5 font-mono text-[10px] text-[#695645] break-all">
              {cleanAnchors.map((r) => (
                <div key={r}>{r}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

/** Compact Songbook & Storyboard Tab embedded cleanly inside VideoStudio's Right Panel (`Book`). */
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
    <div className="songbook-reader min-h-0 flex-1 overflow-y-auto bg-[#f7f2e8] text-[#1c1410] [scrollbar-width:thin]">
      <div className="space-y-3 p-3 pb-6">
        <div className="rounded-xl border border-[#d5c6af] bg-[#faf7f1] p-3 space-y-2">
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

        {/* Standard Cast Bible Cards */}
        <div className="rounded-xl border border-[#d5c6af] bg-[#faf7f1] p-3 space-y-2">
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

        {/* Per-Scene Prompt, Variable Stage & Strip Accordion */}
        {spec.scenes.map((sc) => {
          const cap = captures[`${spec.id}:${sc.index}`];
          const strip = cap?.frames.some(Boolean) ? cap.frames : sc.stripFrameUrls;
          return (
            <div key={sc.code} className="rounded-xl border border-[#d5c6af] bg-[#faf7f1] p-2.5 space-y-2">
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
              <div className="rounded border border-[#e3d7c4] bg-white p-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase text-[#8c432b]">Image Prompt</span>
                  <CopyPromptButton text={sc.imagePrompt} />
                </div>
                <p className="m-0 text-[11px] leading-snug text-[#2d2119]">{sc.imagePrompt}</p>
              </div>
              <div className="rounded border border-[#e3d7c4] bg-white p-2 space-y-1">
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

/** Full-Page Studio 404 Illustrated Songbook & Storyboard Reader (`?songbook=<id>`), live-wired to the 3D Three.js Stage. */
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
      {/* Editorial Top Bar */}
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
            <a
              data-sb-tone="teal"
              href={spec.watchUrl}
              className="rounded-lg border border-[#203832] bg-[#203832] px-3 py-1 text-xs font-semibold text-white hover:bg-[#2c4f46]"
            >
              Watch Film
            </a>
            <a
              href={spec.rehearseUrl}
              className="rounded-lg border border-[#8c6438] bg-[#fffaf0] px-3 py-1 text-xs font-semibold text-[#5a3d20] hover:bg-[#f2e5cf]"
            >
              Live Console
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-4 pt-6 sm:px-6">
        {/* Live 3D Three.js Stage Dock wired directly to CHIMERA & Per-Scene Variable Stage */}
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
              <div className="flex items-center gap-2">
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
        {/* Spread 0: Songbook Cover, Connected Reference Plates & Lead Sheet */}
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
                <span className="rounded-lg border border-[#74573e] bg-[#160f0b] px-2.5 py-1">
                  {fmtTime(spec.durationSec)}
                </span>
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
            {/* Left Spread Half: Master Look Prompt + Cast/Location/Prop Reference Plates */}
            <div className="space-y-4">
              <div className="rounded-xl border border-[#d7c8b2] bg-white p-3.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#8c432b]">
                    Master Style, Stage &amp; Continuity Prompt
                  </span>
                  <CopyPromptButton text={spec.masterLookPrompt} label="Copy Master Prompt" />
                </div>
                <p className="m-0 text-xs leading-relaxed text-[#2d2119]">{spec.masterLookPrompt}</p>
                <div className="mt-2.5 space-y-0.5 border-t border-[#efe5d6] pt-2 font-mono text-[10px] text-[#6d5946] break-all">
                  <div>Lead Sheet: {sanitizeDisplayPath(spec.songFilePath)}</div>
                  {spec.designcraftPath && <div>DesignCraft: {sanitizeDisplayPath(spec.designcraftPath)}</div>}
                  <div>Connected Book: {sanitizeDisplayPath(spec.dcbookPath)}</div>
                </div>
              </div>

              {/* Cast Bible Reference Plates */}
              <div className="space-y-2">
                <h2 className="m-0 flex items-center gap-1.5 font-serif text-base font-bold text-[#1c1410]">
                  <Layers className="size-4 text-[#097364]" />
                  Connected Character Master Bibles ({spec.castRefs.length})
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {spec.castRefs.map((c) => (
                    <div
                      key={c.castId}
                      className="flex items-start gap-2.5 rounded-xl border border-[#d7c8b2] bg-white p-2.5 shadow-2xs"
                    >
                      <StoryboardImg
                        src={c.bibleHeroUrl}
                        alt={c.displayName}
                        fallbackText={c.displayName.slice(0, 2).toUpperCase()}
                        className="size-16 shrink-0 rounded-lg border border-[#e5d9c6] bg-[#1a120e] object-contain p-1"
                      />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-serif text-sm font-bold text-[#1c1410]">{c.displayName}</span>
                          <span className="rounded bg-[#f0e7d8] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#5b4735]">
                            {c.heightDu} DU · {c.renderMode}
                          </span>
                        </div>
                        <p className="m-0 text-[11px] leading-snug text-[#4e3c2d]">{c.usageInPiece}</p>
                        <p
                          className="m-0 truncate font-mono text-[9px] text-[#7a6450]"
                          title={sanitizeDisplayPath(c.bibleDocPath)}
                        >
                          {sanitizeDisplayPath(c.bibleDocPath)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Location & Hero Props */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="rounded-xl border border-[#d7c8b2] bg-white p-2.5 space-y-1.5">
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
                  <div
                    className="truncate font-mono text-[9px] text-[#7a6450]"
                    title={sanitizeDisplayPath(spec.locationRef.setAssetPath)}
                  >
                    {sanitizeDisplayPath(spec.locationRef.setAssetPath)}
                  </div>
                </div>

                <div className="rounded-xl border border-[#d7c8b2] bg-white p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#6e5641]">
                    <Wrench className="size-3.5 text-[#097364]" />
                    Hero Props &amp; Stage Gear
                  </div>
                  <ul className="m-0 list-none space-y-1.5 p-0">
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

            {/* Right Spread Half: Engraved VexFlow Lead Sheet + Section Flow Index */}
            <div className="space-y-4">
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

              {/* Scene Flow Index */}
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

        {/* Spreads 1..N: Per-Scene Storyboard & Prompt Spreads */}
        <div className="space-y-5">
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
