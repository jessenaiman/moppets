/**
 * Pure static VexFlow lead-sheet engraving for the Songbook & Storyboard spread
 * (no playback clock dependency).
 */
import { useLayoutEffect, useMemo, useRef } from "react";
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
import { measures } from "../../choir/meter.ts";
import { PPQ } from "../../choir/midi.ts";
import type { Piece } from "../../choir/music.ts";
import { keySigAccidentals, midiToVexNote, vexKeySignature } from "../../choir/staffMath.ts";
import { beatX, indexParts, type BeatAxis, type ScorePart } from "../sharedStaff.ts";

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

export function StaticLeadSheet({ piece, compact = false }: { piece: Piece; compact?: boolean }) {
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
