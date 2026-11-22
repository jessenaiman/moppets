import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Accidental, Barline, Beam, Dot, Element as VexElement, Formatter, Fraction, Renderer, Stave, StaveNote, StaveTie, Voice } from "vexflow";
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

function eventTicks(note: Note, bar: Bar, barTicks: number) {
  const tick = (beat: number) => Math.max(0, Math.min(barTicks, Math.round((beat - bar.start) * TICKS_PER_BEAT)));
  const start = Math.min(barTicks - 1, tick(note.beat));
  return { start, end: Math.max(start + 1, tick(note.beat + note.beats)) };
}

function staffSlots(part: Part, bar: Bar, barTicks: number): Slot[] {
  // The MIDI view retains the original timings when notation rounds to 32nds.
  const events = part.notes
    .filter(note => note.beats > 0 && note.beat < bar.end && note.beat + note.beats > bar.start)
    .map(note => ({ note, ...eventTicks(note, bar, barTicks) }));
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

const ROW_HEIGHT = 124;
const SYSTEM_HEADER = 38;
const STAVE_INSET = 8;
const BAR_TAIL = 13;

type StaffCursor = {
  bar: Bar;
  ticks: number;
  anchors: { tick: number; x: number }[];
};

type EngravedNote = { note: StaveNote; events: Note[] };

function prepareStaffBar(parts: Part[], bar: Bar, piece: Piece, index: number, firstBar: number, printMeter: boolean) {
  const signature = vexKeySignature(piece.key, piece.mode);
  const ticks = Math.max(1, Math.round((bar.end - bar.start) * TICKS_PER_BEAT));
  const [numBeats, beatValue] = bar.signature.split("/").map(Number);
  const beatGroup = new Fraction(numBeats >= 6 && numBeats % 3 === 0 && beatValue === 8 ? 3 : 1, beatValue);
  const formatter = new Formatter();
  const rows = parts.map((part, i) => {
    const clef = part.percussion ? "treble" : clefForVoice(part.notes.map(note => note.midi));
    const stave = new Stave(0, i * ROW_HEIGHT + SYSTEM_HEADER, 200);
    if (index === 0) {
      stave.addClef(part.percussion ? "percussion" : clef);
      if (!part.percussion) stave.addKeySignature(signature);
    } else {
      stave.setBegBarType(Barline.type.NONE);
    }
    if (printMeter) stave.addTimeSignature(bar.signature);

    const slots = staffSlots(part, bar, ticks);
    const measureRest = slots.every(slot => !slot.notes.length);
    const written = measureRest ? slots.slice(0, 1) : slots;
    const accidentals: Record<number, Record<string, number>> = {};
    const notes = written.map(({ duration, dots, notes: held }) => {
      const pitches = held.map(note => {
        if (part.percussion) return { key: percussionKey(note.midi), accidental: null };
        const octave = Math.floor(Math.round(note.midi) / 12) - 1;
        accidentals[octave] ??= keySigAccidentals(signature);
        return midiToVexNote(note.midi, piece.key, piece.mode, accidentals[octave]);
      });
      const note = new StaveNote({
        clef,
        keys: pitches.length ? pitches.map(pitch => pitch.key) : [clef === "bass" ? "d/3" : "b/4"],
        duration: measureRest ? "wr" : duration + (held.length ? "" : "r"),
        alignCenter: measureRest,
        durationOverride: measureRest ? new Fraction(ticks, TICKS_PER_BEAT * 4) : undefined,
        dots: measureRest ? 0 : dots,
        autoStem: true,
      });
      if (dots && !measureRest) Dot.buildAndAttach([note], { all: true });
      pitches.forEach((pitch, keyIndex) => {
        if (pitch.accidental) note.addModifier(new Accidental(pitch.accidental), keyIndex);
      });
      return note;
    });
    const voice = new Voice({ numBeats, beatValue }).setMode(Voice.Mode.SOFT).addTickables(notes);
    const beams = Beam.generateBeams(notes, { groups: [beatGroup] });
    formatter.joinVoices([voice]);
    return { part, stave, voice, notes, beams, written, measureRest };
  });
  const voices = rows.map(row => row.voice);
  formatter.preCalculateMinTotalWidth(voices);
  const inset = Math.max(...rows.map(row => row.stave.getNoteStartX())) + 4;
  const chords = piece.chords.filter(chord => chord.beat < bar.end && chord.beat + chord.beats > bar.start)
    .map(chord => chord.name).filter((name, at, list) => name !== list[at - 1]);
  const label = `${firstBar + index + 1}${chords.length ? ` · ${chords.join(" ")}` : ""}`;
  const width = Math.ceil(Math.max(inset + formatter.getMinTotalWidth() + BAR_TAIL, label.length * 7 + 10, 44));
  return { rows, formatter, voices, inset, width, ticks, bar, label };
}

function engraveStaff(panel: HTMLElement, parts: Part[], bars: Bar[], firstBar: number, piece: Piece, viewportWidth: number) {
  const segments = bars.map((bar, i) => prepareStaffBar(parts, bar, piece, i, firstBar,
    i === 0 || bars[i - 1].signature !== bar.signature));
  const width = STAVE_INSET * 2 + segments.reduce((sum, segment) => sum + segment.width, 0);
  const height = ROW_HEIGHT * parts.length + SYSTEM_HEADER;
  const scaleX = Math.min(1, viewportWidth / width);
  // Horizontal space is shared by four measures; staff height remains legible on a phone.
  const scaleY = Math.max(scaleX, 0.51);
  const labels: { text: string; x: number; y: number }[] = [];
  const renderer = new Renderer(panel, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext();
  const previous: (EngravedNote | undefined)[] = [];
  const cursors: StaffCursor[] = [];

  const drawTie = (first: EngravedNote | undefined, last: EngravedNote | undefined, held: Note[]) => {
    if (!held.length) return;
    const from = first ?? last;
    const to = last ?? first;
    if (!from || !to) return;
    new StaveTie({
      firstNote: first?.note,
      lastNote: last?.note,
      firstIndexes: held.map(event => from.events.indexOf(event)),
      lastIndexes: held.map(event => to.events.indexOf(event)),
    }).setContext(ctx).draw();
  };

  let x = STAVE_INSET;
  for (const [index, segment] of segments.entries()) {
    const { bar, rows, voices, formatter, ticks, inset } = segment;
    const noteStart = x + inset;
    for (const { stave } of rows) stave.setX(x).setWidth(segment.width).setNoteStartX(noteStart).setContext(ctx).draw();
    formatter.format(voices, segment.width - inset - BAR_TAIL);
    labels.push({ text: segment.label, x: x + 4, y: 13 / scaleY });
    const positions = new Map<number, number>();

    for (const [i, { part, stave, notes, voice, beams, written, measureRest }] of rows.entries()) {
      if (!index) labels.push({ text: part.name, x: STAVE_INSET + 2, y: i * ROW_HEIGHT + SYSTEM_HEADER + 15 });
      voice.draw(ctx, stave);
      beams.forEach(beam => beam.setContext(ctx).draw());
      for (const [j, note] of notes.entries()) {
        const slot = written[j];
        if (!measureRest) positions.set(slot.tick, note.getAbsoluteX());
        if (part.percussion) continue;
        if (!slot.notes.length) {
          previous[i] = undefined;
          continue;
        }
        const current = { note, events: slot.notes };
        const prior = previous[i];
        if (prior) {
          drawTie(prior, current, current.events.filter(event => prior.events.includes(event)));
        } else if (index === 0 && j === 0) {
          drawTie(undefined, current, current.events.filter(event => event.beat < bar.start - 1e-6));
        }
        if (index === segments.length - 1 && j === notes.length - 1) {
          drawTie(current, undefined, current.events.filter(event => event.beat + event.beats > bar.end + 1e-6));
        }
        previous[i] = current;
      }
    }

    if (!positions.has(0)) positions.set(0, noteStart);
    x += segment.width;
    positions.set(ticks, x);
    const anchors = [...positions].sort(([a], [b]) => a - b).map(([tick, position]) => ({ tick, x: position }));
    cursors.push({ bar, ticks, anchors });
  }

  const svg = panel.querySelector("svg")!;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.display = "block";
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.width = `${width * scaleX}px`;
  svg.style.maxWidth = "100%";
  svg.style.height = `${height * scaleY}px`;
  for (const label of labels) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.textContent = label.text;
    text.setAttribute("stroke", "none");
    text.setAttribute("fill", "currentColor");
    text.setAttribute("transform", `translate(${label.x} ${label.y}) scale(${1 / scaleX} ${1 / scaleY})`);
    text.style.font = "600 12px system-ui, sans-serif";
    svg.append(text);
  }
  svg.style.overflow = "hidden";
  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.setAttribute("stroke", "#0f766e");
  line.setAttribute("opacity", "0.75");
  line.setAttribute("stroke-width", "1.5");
  line.dataset.height = String(height - 10);
  svg.append(line);
  return { line, cursors };
}

export function StaffScore({ parts, bars, beat, piece, firstBar, width }: { parts: Part[]; bars: Bar[]; beat: number; piece: Piece; firstBar: number; width: number }) {
  const root = useRef<HTMLDivElement>(null);
  const drawing = useRef<ReturnType<typeof engraveStaff> | null>(null);
  const [fontReady, setFontReady] = useState(false);

  useLayoutEffect(() => {
    let mounted = true;
    // VexFlow registers the bundled face asynchronously when imported.
    const ready = () => {
      if (!mounted) return;
      VexElement.clearTextMeasurementCache();
      setFontReady(true);
    };
    void document.fonts.load("16px Bravura", "\uE050").then(ready, ready);
    return () => { mounted = false; };
  }, []);

  useLayoutEffect(() => {
    const panel = root.current;
    if (!panel || !parts.length || !bars.length || !fontReady) return;
    panel.replaceChildren();
    const inner = document.createElement("div");
    inner.style.maxWidth = "100%";
    panel.append(inner);
    drawing.current = engraveStaff(inner, parts, bars, firstBar, piece, width);
    return () => {
      panel.replaceChildren();
      drawing.current = null;
    };
  }, [parts, bars, piece, firstBar, fontReady, width]);

  useLayoutEffect(() => {
    if (!drawing.current) return;
    const { line, cursors } = drawing.current;
    const active = cursors.find(({ bar }) => beat >= bar.start && beat < bar.end);
    if (!active) {
      line.removeAttribute("d");
      return;
    }
    const { bar, ticks, anchors } = active;
    const at = (beat - bar.start) / (bar.end - bar.start) * ticks;
    const next = anchors.findIndex(anchor => anchor.tick > at);
    const left = anchors[next - 1], right = anchors[next];
    if (!left || !right) return;
    const x = left.x + (right.x - left.x) * (at - left.tick) / (right.tick - left.tick);
    line.setAttribute("d", `M${x} 21V${line.dataset.height}`);
  }, [beat, parts, bars, piece, firstBar, fontReady, width]);

  const lastBar = firstBar + bars.length;
  return <div ref={root} role="img" aria-label={`Singer and band notation, bars ${firstBar + 1}–${lastBar}`} className="min-w-0 w-full overflow-hidden" />;
}

function PartMeasure({ part, bars, beat, piece, width }: { part: Part; bars: Bar[]; beat: number; piece: Piece; width: number }) {
  const bar = { start: bars[0].start, end: bars[bars.length - 1].end };
  const leftEdge = 12;
  const rightEdge = width - 12;
  const notes = part.notes.filter((note) => note.beat < bar.end && note.beat + note.beats > bar.start);
  const min = Math.min(...notes.map((note) => note.midi));
  const max = Math.max(...notes.map((note) => note.midi));
  const x = (at: number) => leftEdge + (at - bar.start) / (bar.end - bar.start) * (rightEdge - leftEdge);
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
      <svg viewBox={`0 0 ${width} 92`} aria-label={`${part.name} MIDI notes`} role="img" className="block h-auto w-full text-stone-800">
        {GRID.map((dy) => <path key={dy} d={`M${leftEdge} ${CENTER + dy}H${rightEdge}`} stroke="currentColor" opacity=".12" />)}
        {[...bars.map(measure => measure.start), bar.end].map((at) => <path key={at} d={`M${x(at)} 28v36`} stroke="currentColor" opacity=".35" />)}
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
  const scoreArea = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  useLayoutEffect(() => {
    const area = scoreArea.current;
    if (!area) return;
    const update = () => setAvailableWidth(Math.floor(area.getBoundingClientRect().width));
    update();
    if (location.hash === "#score") area.closest("section")?.scrollIntoView({ block: "start" });
    const observer = new ResizeObserver(update);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);
  const [selectedPart, setSelectedPart] = useState("");
  const visibleParts = useMemo(() => {
    const selected = parts.find(part => part.id === selectedPart);
    return selected ? [selected] : parts;
  }, [parts, selectedPart]);
  const [pianoRoll, setPianoRoll] = useState(false);
  const [browsing, setBrowsing] = useState<{ piece: Piece; bar: number }>();
  const beat = (timeSec - LEAD_IN) / beatSeconds(piece);
  const playingBar = bars.findIndex((bar) => beat < bar.end);
  const activeBar = playingBar < 0 ? Math.max(0, bars.length - 1) : playingBar;
  const barIndex = Math.min(bars.length - 1, browsing?.piece === piece ? browsing.bar : activeBar);
  const groupStart = Math.max(0, barIndex - (barIndex % 4));
  const firstBar = Math.min(groupStart, Math.max(0, bars.length - 4));
  const shownBars = useMemo(() => bars.slice(firstBar, firstBar + 4), [bars, firstBar]);
  const bar = bars[barIndex];
  if (!bar) return null;
  const controls = "min-h-10 rounded-md border border-stone-300 px-3 text-xs font-semibold disabled:opacity-40";
  return (
    <section id="score" aria-label="Performance score" className="public-score min-w-0 rounded-xl bg-stone-100 p-3 text-stone-900 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[19px] font-semibold">{pianoRoll ? "MIDI notes" : "Full-band score"}</h2>
        <div className="flex items-center gap-1">
          <button type="button" className={controls} aria-pressed={!pianoRoll} onClick={() => setPianoRoll(false)}>Score</button>
          <button type="button" className={controls} aria-pressed={pianoRoll} onClick={() => setPianoRoll(true)}>MIDI notes</button>
        </div>
      </div>
      <div className="my-2 flex flex-wrap items-center justify-between gap-2 text-[14px]">
        <div className="flex flex-wrap items-center gap-2 tabular-nums">
          <select aria-label="Go to bar" value={barIndex} className={controls}
            onChange={(event) => setBrowsing({ piece, bar: Number(event.currentTarget.value) })}>
            {bars.map((_, index) => <option key={index} value={index}>Bar {index + 1} / {bars.length}</option>)}
          </select>
          <select aria-label="Displayed parts" className={controls} value={visibleParts === parts ? "" : selectedPart}
            onChange={event => setSelectedPart(event.currentTarget.value)}>
            <option value="">Full band</option>
            {parts.map(part => <option key={part.id} value={part.id}>{part.name}</option>)}
          </select>
          <span>{bar.signature} · {piece.key} {piece.mode} · {piece.bpm} BPM</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={controls} disabled={firstBar === 0} onClick={() => setBrowsing({ piece, bar: Math.max(0, groupStart - 4) })} aria-label="Previous four bars">‹</button>
          <button type="button" className={controls} disabled={firstBar + 4 >= bars.length} onClick={() => setBrowsing({ piece, bar: groupStart + 4 })} aria-label="Next four bars">›</button>
          <button type="button" className={controls} aria-pressed={browsing?.piece !== piece} onClick={() => setBrowsing(undefined)}>Follow</button>
        </div>
      </div>
      <div ref={scoreArea} className="min-w-0">
        {availableWidth > 0 && <>
          {pianoRoll && <div className="mb-1 grid gap-1 border-b border-stone-300 text-[13px]"
            style={{ gridTemplateColumns: `repeat(${shownBars.length}, minmax(0,1fr))` }}>
            {shownBars.map((shown, i) => {
              const names = piece.chords.filter(chord => chord.beat < shown.end && chord.beat + chord.beats > shown.start)
                .map(chord => chord.name).filter((name, index, list) => name !== list[index - 1]);
              return <div key={shown.start} className="py-1"><strong>Bar {firstBar + i + 1}</strong>
                <span className="block break-words text-stone-600">{names.join(" · ")}</span></div>;
            })}
          </div>}
          {pianoRoll
            ? visibleParts.map(part => <PartMeasure key={part.id} part={part} bars={shownBars} beat={beat} piece={piece} width={availableWidth}/>)
            : <StaffScore width={availableWidth} parts={visibleParts} bars={shownBars} firstBar={firstBar} beat={beat} piece={piece}/>}
        </>}
      </div>
    </section>
  );
}
