import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Accidental, Beam, Dot, Formatter, Fraction, Renderer, Stave, StaveNote, StaveTie, Voice } from "vexflow";
import { BASS_NOTE, BEAT_SOUNDS, parseBeat } from "@chimera/wasm/engine.ts";
import { BAND_SETUP, bandEnabled, bandFor, CRASH, HAT, KICK, OPEN_HAT, SNARE } from "../choir/band.ts";
import { measures } from "../choir/meter.ts";
import { noteName, type Piece } from "../choir/music.ts";
import { clefForVoice, keySigAccidentals, midiToVexNote, vexKeySignature } from "../choir/staffMath.ts";
import { studio404Name } from "../choir/studio404.ts";
import { beatSeconds, LEAD_IN } from "../choir/timeline.ts";

type Note = { beat: number; beats: number; midi: number; text?: string };
type Part = { id: string; name: string; notes: Note[]; percussion?: boolean };
type Bar = ReturnType<typeof measures>[number];

const WIDTH = 420;
const LEFT = 25;
const RIGHT = WIDTH - 12;
const CENTER = 46;
const GRID = [-18, -9, 0, 9, 18];

function beatboxNotes(piece: Piece): Note[] {
  if (!piece.beat) return [];
  const pattern = parseBeat(piece.beat.text);
  if (!pattern.length) return [];

  // CHIMERA's standalone sequencer starts one scheduling horizon after CueCore starts it.
  const first = 0.2 / beatSeconds(piece);
  const stepBeat = piece.bpm / Math.max(40, Math.min(240, piece.bpm)) / 4;
  const swing = Math.max(0, Math.min(0.6, piece.beat.swing));
  const notes: Note[] = [];
  for (let i = 0; first + i * stepBeat < piece.beats; i++) {
    const step = pattern[i % pattern.length];
    if (!step) continue;
    const sound = BEAT_SOUNDS.find(({ id }) => id === step.id);
    const midi = sound?.role === "bass" ? step.note ?? BASS_NOTE
      : sound?.role === "kick" ? KICK
      : sound?.role === "snare" ? SNARE
      : step.id === "kch" ? CRASH
      : step.id === "tss" ? OPEN_HAT
      : sound?.role === "hat" ? HAT : 39;
    const beat = first + (i + (i % 2 ? swing / 2 : 0)) * stepBeat;
    if (beat < piece.beats) notes.push({ beat, beats: Math.min(stepBeat, piece.beats - beat), midi, text: sound?.name ?? step.id });
  }
  return notes;
}

function scoreParts(piece: Piece): Part[] {
  const parts: Part[] = piece.tracks.map((track) => ({
    id: track.id,
    name: studio404Name(track.id, track.id.charAt(0).toUpperCase() + track.id.slice(1)),
    notes: track.events.map(({ beat, beats, midi, text }) => ({ beat, beats, midi, text })),
  }));

  const band = bandFor(piece).filter((part) => part.notes.length > 0);
  for (const { id, notes } of band) parts.push({ id: `band-${id}`, name: BAND_SETUP[id].name, notes, percussion: id === "drums" });
  if (!band.length && piece.pluck) {
    const notes = piece.pluck.flatMap((midi, beat) => midi === null ? [] : [{ beat, beats: 0.28 / beatSeconds(piece), midi }]);
    if (notes.length) parts.push({ id: "pluck", name: "Pluck", notes });
  }
  if (piece.beat) parts.push({ id: "beatbox", name: "Beatbox", notes: beatboxNotes(piece), percussion: true });
  return parts;
}

const TICKS_PER_BEAT = 8;
const DURATIONS = [
  [32, "w", 0], [24, "h", 1], [16, "h", 0], [12, "q", 1], [8, "q", 0],
  [6, "8", 1], [4, "8", 0], [3, "16", 1], [2, "16", 0], [1, "32", 0],
] as const;

type Slot = { tick: number; duration: string; dots: number; notes: Note[] };

function staffSlots(part: Part, bar: Bar, barTicks: number): Slot[] {
  // The score rounds expressive timings to 32nds. The MIDI view keeps the original events.
  const tick = (beat: number) => Math.max(0, Math.min(barTicks, Math.round((beat - bar.start) * TICKS_PER_BEAT)));
  const events = part.notes
    .filter(note => note.beats > 0 && note.beat < bar.end && note.beat + note.beats > bar.start)
    .map(note => {
      const start = Math.min(barTicks - 1, tick(note.beat));
      return { note, start, end: Math.max(start + 1, tick(note.beat + note.beats)) };
    });
  const boundaries = [...new Set([0, barTicks, ...events.flatMap(({ start, end }) => [start, end])])]
    .sort((a, b) => a - b);
  const slots: Slot[] = [];
  for (let i = 0; i + 1 < boundaries.length; i++) {
    let start = boundaries[i];
    const end = boundaries[i + 1];
    const pitches = new Map<number, Note>();
    for (const event of events) {
      if (event.start <= start && event.end > start) pitches.set(event.note.midi, event.note);
    }
    const notes = [...pitches.values()].sort((a, b) => a.midi - b.midi);
    while (start < end) {
      const [length, duration, dots] = DURATIONS.find(([size]) => size <= end - start) ?? DURATIONS[DURATIONS.length - 1];
      slots.push({ tick: start, duration, dots, notes });
      start += length;
    }
  }
  return slots;
}

function percussionKey(midi: number): string {
  if (midi === KICK) return "f/4";
  if (midi === SNARE) return "c/5";
  if (midi === HAT) return "g/5/x2";
  if (midi === OPEN_HAT) return "g/5/x3";
  if (midi === CRASH) return "a/5/x2";
  return "e/5/x2";
}

function StaffScore({ parts, bar, beat, piece }: { parts: Part[]; bar: Bar; beat: number; piece: Piece }) {
  const root = useRef<HTMLDivElement>(null);
  const cursor = useRef<SVGPathElement | null>(null);
  const anchors = useRef<{ tick: number; x: number }[]>([]);
  const barTicks = Math.max(1, Math.round((bar.end - bar.start) * TICKS_PER_BEAT));

  useLayoutEffect(() => {
    const panel = root.current;
    if (!panel || !parts.length) return;
    panel.replaceChildren();
    const slots = parts.map(part => staffSlots(part, bar, barTicks));
    const tickCount = new Set(slots.flatMap(row => row.map(slot => slot.tick))).size;
    const width = Math.max(WIDTH, 120 + tickCount * 25);
    const rowHeight = 124;
    const height = rowHeight * parts.length;
    const renderer = new Renderer(panel, Renderer.Backends.SVG);
    renderer.resize(width, height);
    const ctx = renderer.getContext();
    const signature = vexKeySignature(piece.key, piece.mode);
    const [numBeats, beatValue] = bar.signature.split("/").map(Number);
    const rows = parts.map((part, i) => {
      const clef = clefForVoice(part.notes.map(note => note.midi));
      const stave = new Stave(10, i * rowHeight + 4, width - 22)
        .addClef(part.percussion ? "percussion" : clef);
      if (!part.percussion) stave.addKeySignature(signature);
      stave.addTimeSignature(bar.signature);
      const measureRest = slots[i].every(slot => !slot.notes.length);
      const writtenSlots = measureRest ? slots[i].slice(0, 1) : slots[i];
      const accidentals: Record<number, Record<string, number>> = {};
      const notes = writtenSlots.map(({ duration, dots, notes }) => {
        const pitches = notes.map(note => {
          if (part.percussion) return { key: percussionKey(note.midi), accidental: null };
          const octave = Math.floor(Math.round(note.midi) / 12) - 1;
          accidentals[octave] ??= keySigAccidentals(signature);
          return midiToVexNote(note.midi, piece.key, piece.mode, accidentals[octave]);
        });
        const staveNote = new StaveNote({
          clef: part.percussion ? "treble" : clef,
          keys: pitches.length ? pitches.map(pitch => pitch.key) : [clef === "bass" ? "d/3" : "b/4"],
          duration: measureRest ? "wr" : duration + (notes.length ? "" : "r"),
          alignCenter: measureRest,
          durationOverride: measureRest ? new Fraction(barTicks, TICKS_PER_BEAT * 4) : undefined,
          dots: measureRest ? 0 : dots,
          autoStem: true,
        });
        if (dots && !measureRest) Dot.buildAndAttach([staveNote], { all: true });
        pitches.forEach((pitch, index) => {
          if (pitch.accidental) staveNote.addModifier(new Accidental(pitch.accidental), index);
        });
        return staveNote;
      });
      const voice = new Voice({ numBeats, beatValue }).setMode(Voice.Mode.SOFT).addTickables(notes);
      const beatGroup = new Fraction(numBeats >= 6 && numBeats % 3 === 0 && beatValue === 8 ? 3 : 1, beatValue);
      const beams = Beam.generateBeams(notes, { groups: [beatGroup] });
      return { part, stave, notes, voice, beams };
    });

    const noteStart = Math.max(...rows.map(({ stave }) => stave.getNoteStartX())) + 5;
    const formatter = new Formatter();
    for (const { stave, voice } of rows) {
      stave.setNoteStartX(noteStart).setContext(ctx).draw();
      formatter.joinVoices([voice]);
    }
    formatter.format(rows.map(({ voice }) => voice), width - noteStart - 28);
    const positions = new Map<number, number>();
    const svg = panel.querySelector("svg")!;
    for (const [i, { part, stave, notes, voice, beams }] of rows.entries()) {
      ctx.setFont("system-ui", 13, "bold").fillText(part.name, 12, i * rowHeight + 17);
      voice.draw(ctx, stave);
      beams.forEach(beam => beam.setContext(ctx).draw());
      const row = slots[i];
      for (const [j, note] of notes.entries()) {
        const slot = row[j];
        if (!slot.notes.length && notes.length === 1) continue;
        positions.set(slot.tick, note.getAbsoluteX());
        if (part.percussion || !slot.notes.length) continue;

        const tie = (from: StaveNote | null, to: StaveNote | null, firstIndexes: number[], lastIndexes = firstIndexes) => {
          if (firstIndexes.length) new StaveTie({ firstNote: from, lastNote: to, firstIndexes, lastIndexes }).setContext(ctx).draw();
        };
        if (j === 0) {
          tie(null, note, slot.notes.flatMap((event, index) => event.beat < bar.start - 1e-6 ? [index] : []));
        }
        const next = row[j + 1];
        if (next) {
          const firstIndexes: number[] = [], lastIndexes: number[] = [];
          slot.notes.forEach((event, index) => {
            const other = next.notes.indexOf(event);
            if (other >= 0) {
              firstIndexes.push(index);
              lastIndexes.push(other);
            }
          });
          tie(note, notes[j + 1], firstIndexes, lastIndexes);
        } else {
          tie(note, null, slot.notes.flatMap((event, index) => event.beat + event.beats > bar.end + 1e-6 ? [index] : []));
        }
      }
    }

    if (!positions.has(0)) positions.set(0, noteStart);
    positions.set(barTicks, width - 12);
    anchors.current = [...positions].sort(([a], [b]) => a - b).map(([tick, x]) => ({ tick, x }));
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("stroke", "#0f766e");
    line.setAttribute("opacity", "0.75");
    line.setAttribute("stroke-width", "1.5");
    line.dataset.height = String(height - 10);
    svg.append(line);
    cursor.current = line;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.removeAttribute("style");
    svg.style.width = "100%";
    svg.style.minWidth = `${Math.round(width * 0.83)}px`;
    return () => {
      panel.replaceChildren();
      cursor.current = null;
      anchors.current = [];
    };
  }, [parts, bar, barTicks, piece.key, piece.mode]);

  useLayoutEffect(() => {
    const line = cursor.current;
    if (!line) return;
    if (beat < bar.start || beat >= bar.end) {
      line.removeAttribute("d");
      return;
    }
    const at = (beat - bar.start) / (bar.end - bar.start) * barTicks;
    const next = anchors.current.findIndex(anchor => anchor.tick > at);
    const left = anchors.current[next - 1], right = anchors.current[next];
    if (!left || !right) return;
    const x = left.x + (right.x - left.x) * (at - left.tick) / (right.tick - left.tick);
    line.setAttribute("d", `M${x} 23V${line.dataset.height}`);
  }, [beat, bar, barTicks, parts, piece.key, piece.mode]);

  return <div ref={root} role="img" aria-label="Singer and band notation" className="overflow-x-auto" />;
}

function PartMeasure({ part, bar, beat, piece }: { part: Part; bar: Bar; beat: number; piece: Piece }) {
  const notes = part.notes.filter((note) => note.beat < bar.end && note.beat + note.beats > bar.start);
  const min = Math.min(...notes.map((note) => note.midi));
  const max = Math.max(...notes.map((note) => note.midi));
  const x = (at: number) => LEFT + (at - bar.start) / (bar.end - bar.start) * (RIGHT - LEFT);
  const inBar = beat >= bar.start && beat < bar.end;
  const active = notes.filter((note) => note.beat <= beat && note.beat + note.beats > beat);
  const labels = active.map((note) => note.text && part.percussion ? `${note.text} · ${note.midi}`
    : `${noteName(note.midi, piece.key, piece.mode)} · ${note.midi}`);

  return (
    <div className="border-b border-stone-300/70 py-1.5 last:border-b-0">
      <div className="flex min-h-5 items-baseline justify-between gap-3 px-2 text-xs">
        <b>{part.name}</b>
        <span className="truncate tabular-nums text-teal-800">{labels.join(" / ")}</span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} 92`} aria-label={`${part.name} MIDI notes`} role="img" className="block h-auto w-full text-stone-800">
        {GRID.map((dy) => <path key={dy} d={`M${LEFT} ${CENTER + dy}H${RIGHT}`} stroke="currentColor" opacity=".12" />)}
        {[bar.start, bar.end].map((at) => <path key={at} d={`M${x(at)} 28v36`} stroke="currentColor" opacity=".35" />)}
        {notes.map((note, i) => {
          const left = x(Math.max(note.beat, bar.start));
          const width = x(Math.min(note.beat + note.beats, bar.end)) - left;
          const fill = active.includes(note) ? "#0f766e" : "#57534e";
          const name = note.text && part.percussion ? note.text : noteName(note.midi, piece.key, piece.mode);
          const y = CENTER + (max === min ? 0 : (0.5 - (note.midi - min) / (max - min)) * 38);
          return (
            <g key={i}>
              <title>{`${name} · MIDI ${note.midi} · beat ${note.beat} · ${note.beats} beats`}</title>
              <rect x={left} y={y - 4} width={Math.max(2, width)} height="8" rx="2" fill={fill} />
              {width >= 24 && <text x={left + 3} y={y + 2.7} fontSize="9" fill="white">{note.midi}</text>}
            </g>
          );
        })}
        {inBar && <path d={`M${x(beat)} 9V82`} stroke="#0f766e" strokeWidth="1.5" opacity=".8" />}
      </svg>
    </div>
  );
}

export function PerformanceScore({ piece, timeSec }: { piece: Piece; timeSec: number }) {
  const band = bandEnabled();
  const parts = useMemo(() => scoreParts(piece), [piece, band]);
  const bars = useMemo(() => measures(piece), [piece]);
  const [pianoRoll, setPianoRoll] = useState(false);
  const [browsing, setBrowsing] = useState<{ piece: Piece; bar: number }>();
  const beat = (timeSec - LEAD_IN) / beatSeconds(piece);
  const playingBar = bars.findIndex((bar) => beat < bar.end);
  const activeBar = playingBar < 0 ? Math.max(0, bars.length - 1) : playingBar;
  const barIndex = Math.min(bars.length - 1, browsing?.piece === piece ? browsing.bar : activeBar);
  const bar = bars[barIndex];
  if (!bar) return null;
  const chords = piece.chords.filter(({ beat, beats }) => beat < bar.end && beat + beats > bar.start);
  const controls = "min-h-10 rounded-md border border-stone-300 px-3 text-xs font-semibold disabled:opacity-40";
  return (
    <section aria-label="Performance score" className="min-w-0 rounded-xl bg-stone-100 p-3 text-stone-900 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{pianoRoll ? "MIDI notes" : "Full-band score"}</h2>
        <div className="flex items-center gap-1">
          <button type="button" className={controls} aria-pressed={!pianoRoll} onClick={() => setPianoRoll(false)}>Score</button>
          <button type="button" className={controls} aria-pressed={pianoRoll} onClick={() => setPianoRoll(true)}>MIDI notes</button>
        </div>
      </div>
      <div className="my-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2 tabular-nums">
          <select aria-label="Go to bar" value={barIndex} className={controls}
            onChange={(event) => setBrowsing({ piece, bar: Number(event.currentTarget.value) })}>
            {bars.map((_, index) => <option key={index} value={index}>Bar {index + 1} / {bars.length}</option>)}
          </select>
          <span>{bar.signature} · {piece.key} {piece.mode} · {piece.bpm} BPM</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={controls} disabled={barIndex === 0} onClick={() => setBrowsing({ piece, bar: barIndex - 1 })} aria-label="Previous bar">‹</button>
          <button type="button" className={controls} disabled={barIndex === bars.length - 1} onClick={() => setBrowsing({ piece, bar: barIndex + 1 })} aria-label="Next bar">›</button>
          <button type="button" className={controls} aria-pressed={browsing?.piece !== piece} onClick={() => setBrowsing(undefined)}>Follow</button>
        </div>
      </div>
      {chords.length > 0 && <div aria-label="Chords" className="flex gap-2 px-2 pb-1 text-xs text-stone-600">
        {chords.map(({ name, beat }) => <span key={beat}>{name}</span>)}
      </div>}
      {pianoRoll
        ? parts.map(part => <PartMeasure key={part.id} part={part} bar={bar} beat={beat} piece={piece} />)
        : <StaffScore parts={parts} bar={bar} beat={beat} piece={piece} />}
    </section>
  );
}
