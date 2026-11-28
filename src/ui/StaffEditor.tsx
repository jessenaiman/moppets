/**
 * Interactive VexFlow musical staff for rehearsing, auditioning, and step-editing a Moppet's
 * melody notes (with tempo scale, solo, line loop, and MIDI keyboard step-input).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Play, Repeat, Square } from "lucide-react";
import { useId } from "react";
import { Accidental, Annotation, Beam, Dot, Formatter, Renderer, Stave, StaveNote, Voice } from "vexflow";
import { measures } from "../choir/meter.ts";
import { useAudio } from "../audio/audio.ts";
import { g2p } from "../audio/g2p.ts";
import { useController } from "../choir/controller.ts";
import { playLoop, setLoopRange, setSoloMix, stop, useEnsemble } from "../choir/ensemble.ts";
import { auditionNote, setStaffMidiHook } from "../choir/live.ts";
import { noteName, type Piece, type ScoreEvent, type Track } from "../choir/music.ts";
import { sungSyllables } from "../choir/plan.ts";
import { checkSung, holdFix, lineStarts, splitFix } from "../choir/songCheck.ts";
import { sheetWords } from "../choir/songFile.ts";
import { beatsToVexDuration, clefForVoice, keySigAccidentals, midiToVexNote, vexKeySignature } from "../choir/staffMath.ts";
import { currentFile, useMoppet, type TempoScale } from "../choir/store.ts";
import { STUDIO_404_CAST, studio404Name } from "../choir/studio404.ts";
import { beatSeconds, LEAD_IN } from "../choir/timeline.ts";
import type { MoppetVoice } from "../choir/voices.ts";
import { applyScoreInk, type ScoreInkTheme } from "./ChoirScore.tsx";
import { midiSupported } from "./midi.ts";

export interface StaffNoteItem {
  beat: number;
  beats: number;
  midi: number;
  syllable: string;
  /** Index in `track.events` */
  index: number;
  canEdit: boolean;
}

export interface StaffPhrase {
  id: string;
  label: string;
  startBeat: number;
  endBeat: number;
  lineIndex?: number;
  src?: [number, number, number];
  notes: StaffNoteItem[];
}

export function trackSyllables(track: Track): (string | null)[] {
  const byLine = new Map<number, string[]>();
  const seen = new Map<number, number>();
  return track.events.map((e) => {
    if (e.line === undefined) return e.text || null;
    if (track.lines && !track.phrases) {
      const words = track.lines[e.line]?.split(/\s+/) ?? [];
      const k = seen.get(e.line) ?? 0;
      seen.set(e.line, k + 1);
      return words[k] ?? null;
    }
    if (!track.phrases) return e.text || null;
    if (!byLine.has(e.line)) {
      try {
        byLine.set(e.line, sungSyllables(track.phrases[e.line]).map((x) => (x.melisma ? "–" : x.text)));
      } catch {
        byLine.set(e.line, []);
      }
    }
    const k = seen.get(e.line) ?? 0;
    seen.set(e.line, k + 1);
    const syllables = byLine.get(e.line)!;
    return syllables[k % syllables.length] ?? null;
  });
}

/** Group a Moppet's track into displayable phrases for the rehearsal staff. */
export function trackPhrases(piece: Piece, track: Track | undefined): StaffPhrase[] {
  if (!track || !track.events.length) return [];
  const syls = trackSyllables(track);
  const editable = piece.kind !== "skit";
  const allNotes: StaffNoteItem[] = [];
  track.events.forEach((e: ScoreEvent, index: number) => {
    const isPad = e.line === undefined && !e.src && e.text !== "" && (track.phrases?.length || track.lines?.length);
    if (isPad) return;
    allNotes.push({
      beat: e.beat,
      beats: e.beats,
      midi: e.midi,
      syllable: syls[index] ?? e.text ?? "",
      index,
      canEdit: editable,
    });
  });
  if (!allNotes.length) {
    // Pads-only backing part: fall back to chunked bars
    track.events.forEach((e, index) =>
      allNotes.push({ beat: e.beat, beats: e.beats, midi: e.midi, syllable: e.text || "oo", index, canEdit: editable }),
    );
  }
  const phrases: StaffPhrase[] = [];
  let bucket: StaffNoteItem[] = [];
  let lastLine = track.events[allNotes[0].index]?.line;
  const flush = () => {
    if (!bucket.length) return;
    const firstEv = track.events[bucket[0].index];
    const lineIdx = firstEv?.line;
    const rawLine = lineIdx !== undefined ? (track.phrases?.[lineIdx] ?? track.lines?.[lineIdx]) : undefined;
    const textPreview = rawLine ? rawLine.replace(/_/g, "") : bucket.map((n) => n.syllable).filter(Boolean).join(" ");
    const n = phrases.length + 1;
    phrases.push({
      id: `${track.id}-${n}`,
      label: textPreview ? `${n}. ${textPreview}` : `Phrase ${n} (beats ${bucket[0].beat + 1}–${Math.ceil(bucket[bucket.length - 1].beat + bucket[bucket.length - 1].beats)})`,
      startBeat: bucket[0].beat,
      endBeat: bucket[bucket.length - 1].beat + bucket[bucket.length - 1].beats,
      lineIndex: lineIdx,
      src: firstEv?.src ? [firstEv.src[0], firstEv.src[1], firstEv.src[2]] : undefined,
      notes: bucket,
    });
    bucket = [];
  };
  for (const item of allNotes) {
    const ev = track.events[item.index];
    const prev = bucket[bucket.length - 1];
    const gap = prev ? item.beat - (prev.beat + prev.beats) : 0;
    const splitByLine = ev.line !== undefined ? ev.line !== lastLine || gap >= 1 : bucket.length >= 8 || gap >= 2;
    if (bucket.length && splitByLine) flush();
    bucket.push(item);
    lastLine = ev.line;
  }
  flush();
  return phrases;
}

interface VexStaffLineProps {
  events: StaffNoteItem[];
  piece: Piece;
  voice: MoppetVoice;
  selectedIndex: number | null;
  compact?: boolean;
  inkTheme?: ScoreInkTheme;
  zoom?: number;
  onSelect: (index: number) => void;
  onShift: (index: number, steps: number) => void;
}

export function VexStaffLine({
  events,
  piece,
  voice,
  selectedIndex,
  compact = false,
  inkTheme = "paper",
  zoom = 100,
  onSelect,
  onShift,
}: VexStaffLineProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ idx: number; y0: number; moved: boolean; deltaSteps: number } | null>(null);
  const playheadRef = useRef<SVGLineElement | null>(null);
  const noteCoordsRef = useRef<{ beat: number; endBeat: number; x: number }[]>([]);
  const [dragSteps, setDragSteps] = useState<{ idx: number; steps: number } | null>(null);

  const baseWidth = Math.max(compact ? 320 : 440, 115 + events.length * (compact ? 48 : 60));
  const width = Math.round(baseWidth * (zoom / 100));
  const height = compact ? 148 : 164;

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.innerHTML = "";
    noteCoordsRef.current = [];
    playheadRef.current = null;
    if (!events.length) return;

    const clef = clefForVoice(events.map((e) => e.midi), voice.register);
    const keySig = vexKeySignature(piece.key, piece.mode);
    const renderer = new Renderer(el, Renderer.Backends.SVG);
    renderer.resize(baseWidth, height);
    const ctx = renderer.getContext();
    const stave = new Stave(8, 16, baseWidth - 16);
    stave.addClef(clef);
    if (keySig && keySig !== "C") stave.addKeySignature(keySig);
    const bars = measures(piece);
    const barAt = (beat:number) => bars.findIndex(measure=>beat<measure.end);
    let bar = barAt(events[0].beat);
    stave.addTimeSignature(bars[bar]?.signature ?? piece.meter ?? "4/4");
    stave.setContext(ctx).draw();
    let activeAcc = keySigAccidentals(keySig);
    const staveNotes = events.map((ev) => {
      const b = barAt(ev.beat);
      if (b !== bar) {
        bar = b;
        activeAcc = keySigAccidentals(keySig);
      }
      const { duration, dots } = beatsToVexDuration(ev.beats);
      const { key, accidental } = midiToVexNote(ev.midi, piece.key, piece.mode, activeAcc);
      const note = new StaveNote({ keys: [key], duration, clef, autoStem: true });
      if (accidental) note.addModifier(new Accidental(accidental), 0);
      if (dots > 0) Dot.buildAndAttach([note], { all: true });
      if (ev.syllable) {
        const ann = new Annotation(ev.syllable)
          .setFont("Geist Variable", 12, "normal")
          .setVerticalJustification(Annotation.VerticalJustify.BOTTOM);
        note.addModifier(ann, 0);
      }
      if (selectedIndex === ev.index) {
        note.setStyle({ fillStyle: "#F5B851", strokeStyle: "#D97706" });
      }
      return note;
    });

    const totalBeats = Math.max(1, Math.ceil(events.reduce((a, e) => a + e.beats, 0)));
    const vfVoice = new Voice({ numBeats: totalBeats, beatValue: 4 });
    vfVoice.setMode(Voice.Mode.SOFT);
    vfVoice.addTickables(staveNotes);

    let beams: Beam[] = [];
    try {
      beams = Beam.generateBeams(staveNotes);
    } catch {
      beams = [];
    }

    const startX = stave.getNoteStartX();
    const avail = Math.max(100, baseWidth - startX - 24);
    new Formatter().joinVoices([vfVoice]).format([vfVoice], avail);
    vfVoice.draw(ctx, stave);
    for (const b of beams) b.setContext(ctx).draw();

    const svg = el.querySelector("svg");
    if (!svg) return;
    svg.setAttribute("viewBox", `0 0 ${baseWidth} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(Math.round(height * (zoom / 100))));
    svg.setAttribute("pointer-events", "auto");
    applyScoreInk(el, inkTheme);
    const ns = "http://www.w3.org/2000/svg";
    const hits = document.createElementNS(ns, "g");
    hits.setAttribute("class", "staff-hits");
    const xs = staveNotes.map((n) => n.getAbsoluteX());
    noteCoordsRef.current = events.map((ev, i) => ({
      beat: ev.beat,
      endBeat: ev.beat + ev.beats,
      x: xs[i] + 6,
    }));

    events.forEach((ev, i) => {
      const left = i === 0 ? Math.max(8, xs[i] - 18) : (xs[i - 1] + xs[i]) / 2 + 4;
      const right = i === xs.length - 1 ? Math.min(baseWidth - 8, xs[i] + 32) : (xs[i] + xs[i + 1]) / 2 + 4;
      const w = Math.max(18, right - left);
      if (selectedIndex === ev.index) {
        const pill = document.createElementNS(ns, "rect");
        pill.setAttribute("class", "staff-sel-pill");
        pill.setAttribute("pointer-events", "none");
        pill.setAttribute("x", String(left));
        pill.setAttribute("y", "14");
        pill.setAttribute("width", String(w));
        pill.setAttribute("height", String(height - 28));
        pill.setAttribute("rx", "5");
        hits.appendChild(pill);
      }
      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("class", "staff-hit");
      rect.setAttribute("stroke", "none");
      rect.setAttribute("pointer-events", "all");
      rect.setAttribute("data-note-idx", String(ev.index));
      rect.setAttribute("x", String(left));
      rect.setAttribute("y", "10");
      rect.setAttribute("width", String(w));
      rect.setAttribute("height", String(height - 20));
      const title = document.createElementNS(ns, "title");
      const label = `${ev.syllable ? `"${ev.syllable}" · ` : ""}${noteName(ev.midi, piece.key, piece.mode)} · ${ev.beats} beat${ev.beats === 1 ? "" : "s"}`;
      title.textContent = ev.canEdit ? `${label} — click to hear, drag or ↑/↓ to shift` : `${label} — click to hear`;
      rect.appendChild(title);
      hits.appendChild(rect);
    });

    const line = document.createElementNS(ns, "line");
    line.setAttribute("class", "staff-playhead");
    line.setAttribute("y1", "16");
    line.setAttribute("y2", String(height - 18));
    line.setAttribute("visibility", "hidden");
    hits.appendChild(line);
    playheadRef.current = line;
    svg.appendChild(hits);
  }, [events, piece, voice.register, selectedIndex, baseWidth, width, height, inkTheme, zoom]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const line = playheadRef.current;
      const coords = noteCoordsRef.current;
      if (!line || !coords.length) return;
      const { status, time } = useEnsemble.getState();
      if (status !== "playing" && status !== "buffering" && status !== "paused") {
        line.setAttribute("visibility", "hidden");
        return;
      }
      const beat = Math.max(0, (time - LEAD_IN) / beatSeconds(piece));
      const first = coords[0], last = coords[coords.length - 1];
      if (beat < first.beat || beat > last.endBeat) {
        line.setAttribute("visibility", "hidden");
        return;
      }
      let x = first.x;
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        if (beat >= c.beat && beat <= c.endBeat) {
          const nextX = coords[i + 1]?.x ?? c.x + 28;
          const frac = (beat - c.beat) / Math.max(0.05, c.endBeat - c.beat);
          x = c.x + frac * (nextX - c.x);
          break;
        }
        if (beat > c.endBeat) x = coords[i + 1]?.x ?? c.x + 24;
      }
      line.setAttribute("x1", String(x));
      line.setAttribute("x2", String(x));
      line.setAttribute("visibility", "visible");
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [piece]);

  const hitIdx = (target: EventTarget | null): number | null => {
    const el = target instanceof Element ? target.closest("[data-note-idx]") : null;
    if (!el) return null;
    const n = Number(el.getAttribute("data-note-idx"));
    return Number.isFinite(n) ? n : null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const idx = hitIdx(e.target);
    if (idx === null) return;
    e.currentTarget.focus();
    onSelect(idx);
    const ev = events.find((x) => x.index === idx);
    if (!ev?.canEdit) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointer event
    }
    dragRef.current = { idx, y0: e.clientY, moved: false, deltaSteps: 0 };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.y0;
    if (Math.abs(dy) >= 6) d.moved = true;
    const steps = Math.round(-dy / 8);
    if (steps !== d.deltaSteps) {
      d.deltaSteps = steps;
      setDragSteps(d.moved && steps !== 0 ? { idx: d.idx, steps } : null);
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragSteps(null);
    if (d?.moved && d.deltaSteps !== 0) onShift(d.idx, d.deltaSteps);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!events.length) return;
    const pos = selectedIndex === null ? -1 : events.findIndex((x) => x.index === selectedIndex);
    if (e.key === "ArrowUp" && pos >= 0 && events[pos].canEdit) {
      e.preventDefault();
      onShift(events[pos].index, 1);
    } else if (e.key === "ArrowDown" && pos >= 0 && events[pos].canEdit) {
      e.preventDefault();
      onShift(events[pos].index, -1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onSelect(events[Math.min(events.length - 1, pos + 1)].index);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSelect(events[Math.max(0, pos <= 0 ? 0 : pos - 1)].index);
    } else if (e.key === " " && pos >= 0) {
      e.preventDefault();
      onSelect(events[pos].index);
    }
  };

  return (
    <div className="staff-scroll" data-ink={inkTheme}>
      <div
        ref={canvasRef}
        className="staff-canvas"
        data-layout="layered"
        tabIndex={0}
        role="application"
        aria-label={`${voice.name}'s musical staff`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragSteps(null);
        }}
        onKeyDown={onKeyDown}
      />
      {dragSteps && (
        <p className="staff-drag-hint" role="status">
          Shift {dragSteps.steps > 0 ? `+${dragSteps.steps}` : dragSteps.steps} scale step{Math.abs(dragSteps.steps) === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}

const TEMPOS: readonly TempoScale[] = [0.5, 0.75, 1];

export function RehearsalStaffPanel({
  inkTheme = "paper",
  zoom = 100,
}: {
  inkTheme?: ScoreInkTheme;
  zoom?: number;
} = {}) {
  const piece = useMoppet((s) => s.piece);
  const voices = useMoppet((s) => s.voices);
  const selected = useMoppet((s) => s.selected);
  const select = useMoppet((s) => s.select);
  const studio404 = useMoppet((s) => s.studio404);
  const lesson = useMoppet((s) => s.lesson);
  const tempoScale = useMoppet((s) => s.tempoScale);
  const setTempoScale = useMoppet((s) => s.setTempoScale);
  const shiftTrackNote = useMoppet((s) => s.shiftTrackNote);
  const editSongFile = useMoppet((s) => s.editSongFile);
  const editPhraseWords = useMoppet((s) => s.editPhraseWords);
  const saveSongFile = useMoppet((s) => s.saveSongFile);
  const revertSongFile = useMoppet((s) => s.revertSongFile);
  const songEdits = useMoppet((s) => s.songEdits);
  const soloMix = useEnsemble((s) => s.soloMix);
  const loopRange = useEnsemble((s) => s.loopRange);
  const eStatus = useEnsemble((s) => s.status);
  const midi = useController((s) => s.midi);
  const setMidi = useController((s) => s.setMidi);
  const start = useAudio((s) => s.start);
  const lyricInputId = useId();

  // Everyone who sings in this piece (and is on stage): one tab each above the staff.
  const singers = useMemo(
    () => voices.map((v, i) => ({ v, i })).filter(({ v }) => piece.tracks.some((t) => t.id === v.id && t.events.length > 0) && (!piece.stage || piece.stage.includes(v.id))),
    [voices, piece],
  );

  const voice = voices[selected];
  const displayName = studio404 ? studio404Name(voice.id, voice.name) : voice.name;
  const track = piece.tracks.find((t) => t.id === voice?.id);
  const phrases = useMemo(() => trackPhrases(piece, track), [piece, track]);
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [selectedNoteIdx, setSelectedNoteIdx] = useState<number | null>(null);
  const [dictReady, setDictReady] = useState(g2p.loaded);

  useEffect(() => {
    if (!g2p.loaded) void g2p.load().then(() => setDictReady(true), () => setDictReady(true));
  }, []);

  useEffect(() => {
    setPhraseIdx(0);
    setSelectedNoteIdx(null);
  }, [piece.title, voice?.id]);

  const safePhraseIdx = phrases.length ? Math.min(phraseIdx, phrases.length - 1) : 0;
  const activePhrase = phrases[safePhraseIdx] ?? null;
  const activeNote = activePhrase?.notes.find((n) => n.index === selectedNoteIdx) ?? null;

  const lineIdx = activePhrase?.lineIndex;
  const committedWords = lineIdx !== undefined ? (track?.phrases?.[lineIdx] ?? track?.lines?.[lineIdx] ?? "") : "";
  const [draftWords, setDraftWords] = useState(committedWords);
  useEffect(() => {
    setDraftWords(committedWords);
  }, [piece.title, track?.id, safePhraseIdx, lineIdx, committedWords]);

  const hearItem = (item: StaffNoteItem, overrideMidi?: number) => {
    if (!voice) return;
    const ms = item.beats * beatSeconds(piece) * 1000;
    void auditionNote(voice, overrideMidi ?? item.midi, item.syllable, ms);
  };

  const selectNote = (idx: number) => {
    setSelectedNoteIdx(idx);
    const item = activePhrase?.notes.find((n) => n.index === idx);
    if (item) hearItem(item);
  };

  const shiftNote = (idx: number, steps: number) => {
    if (!track || !voice) return;
    const item = activePhrase?.notes.find((n) => n.index === idx);
    const nextMidi = shiftTrackNote(track.id, idx, steps);
    setSelectedNoteIdx(idx);
    if (item && nextMidi !== null) hearItem(item, nextMidi);
  };

  // Arm MIDI step-input while a note on the staff is selected
  useEffect(() => {
    if (!activePhrase || selectedNoteIdx === null || !track || !voice) {
      setStaffMidiHook(null);
      return;
    }
    setStaffMidiHook((rawMidi) => {
      const state = useMoppet.getState();
      const curTrack = state.piece.tracks.find((t) => t.id === track.id);
      const pos = activePhrase.notes.findIndex((n) => n.index === selectedNoteIdx);
      if (!curTrack || pos < 0) return false;
      const item = activePhrase.notes[pos];
      const sung = rawMidi + (voice.octave ?? 0);
      state.editNotePitch(track.id, item.index, sung);
      const updated = useMoppet.getState().piece.tracks.find((t) => t.id === track.id)?.events[item.index];
      const actualMidi = updated?.midi ?? sung;
      const ms = item.beats * beatSeconds(useMoppet.getState().piece) * 1000;
      void auditionNote(voice, actualMidi, item.syllable, ms);
      if (pos + 1 < activePhrase.notes.length) {
        setSelectedNoteIdx(activePhrase.notes[pos + 1].index);
      } else if (safePhraseIdx + 1 < phrases.length) {
        const nextPhrase = phrases[safePhraseIdx + 1];
        setPhraseIdx(safePhraseIdx + 1);
        setSelectedNoteIdx(nextPhrase.notes[0]?.index ?? null);
      } else {
        setSelectedNoteIdx(activePhrase.notes[0]?.index ?? null);
      }
      return true;
    });
    return () => setStaffMidiHook(null);
  }, [activePhrase, selectedNoteIdx, track, voice, safePhraseIdx, phrases]);

  const busy = eStatus === "preparing" || eStatus === "rendering";
  const bs = beatSeconds(piece);
  const phraseRange = activePhrase
    ? {
        startSec: Math.max(0, LEAD_IN + activePhrase.startBeat * bs - 0.15),
        endSec: LEAD_IN + activePhrase.endBeat * bs + 0.35,
        label: activePhrase.label,
      }
    : null;
  const isLooping = !!(loopRange && phraseRange && Math.abs(loopRange.startSec - phraseRange.startSec) < 0.05 && (eStatus === "playing" || eStatus === "buffering"));

  const toggleLoop = () => {
    if (!phraseRange) return;
    if (isLooping) {
      setLoopRange(null);
      stop();
    } else {
      void playLoop(start, phraseRange);
    }
  };

  const fileStatus = useMemo(() => currentFile(lesson), [lesson, songEdits]);
  const renderLyricEditor = () => {
    if (!activePhrase || activePhrase.lineIndex === undefined || !track) return null;
    if (fileStatus?.parsed.kind === "song") {
      const song = fileStatus.parsed.song;
      if (activePhrase.src) {
        const [si, li, ai] = activePhrase.src;
        const distinct = [...new Set(song.sections)];
        const lineObj = distinct[si]?.lines[li];
        const sung = lineObj && !("rest" in lineObj) ? (ai < 0 ? lineObj : lineObj.with?.[ai]) : null;
        if (!lineObj || "rest" in lineObj || !sung) return null;
        const starts = lineStarts(song);
        const startBeat = (starts.get(lineObj) ?? 4) + (ai >= 0 ? (sung.offset ?? 0) : 0);
        const check = dictReady ? checkSung(sung, startBeat) : null;
        const diff = check ? check.syllables.length - check.notes : 0;
        const split = check && check.syllables.length > 0 && diff > 0 ? splitFix(sung, diff) : null;
        const applyChange = (fn: (target: NonNullable<typeof sung>) => void) =>
          editSongFile((x) => {
            if (x.kind !== "song") return;
            const l = [...new Set(x.song.sections)][si]?.lines[li];
            const target = l && !("rest" in l) ? (ai < 0 ? l : l.with?.[ai]) : null;
            if (target) fn(target);
          });
        return (
          <div className="staff-lyric-bar">
            <label htmlFor={lyricInputId}>Line lyrics</label>
            <input
              id={lyricInputId}
              aria-label="Edit line lyrics"
              value={sung.words}
              aria-invalid={check ? !check.ok : undefined}
              onChange={(e) => {
                const next = sheetWords(e.target.value);
                applyChange((target) => {
                  target.words = next;
                });
              }}
            />
            <small className={`staff-lyric-status ${!check ? "hint" : check.ok ? (check.hint ? "hint" : "ok") : "bad"}`} title={check?.hint || check?.problem}>
              {!check ? "Loading dictionary…" : check.ok ? `${check.notes} notes ✓${check.hint ? ` · ${check.hint}` : ""}` : check.problem}
            </small>
            {check && check.syllables.length > 0 && diff < 0 && (
              <button type="button" onClick={() => applyChange((target) => { target.words = holdFix(target.words, -diff); })}>
                Hold last word
              </button>
            )}
            {split && (
              <button type="button" onClick={() => applyChange((target) => { Object.assign(target, split); })}>
                Split note
              </button>
            )}
          </div>
        );
      }
      if (song.finale && (song.finale.notes || activePhrase.notes.length === 1)) {
        const finaleWord = song.finale.word;
        const check = dictReady ? checkSung({ words: finaleWord, rhythm: activePhrase.notes.map(n => n.beats) }) : null;
        return (
          <div className="staff-lyric-bar">
            <label htmlFor={lyricInputId}>Line lyrics</label>
            <input
              id={lyricInputId}
              aria-label="Edit line lyrics"
              value={finaleWord}
              aria-invalid={check ? !check.ok : undefined}
              onChange={(e) => {
                const next = sheetWords(e.target.value);
                editSongFile((x) => {
                  if (x.kind === "song" && x.song.finale) x.song.finale.word = next;
                });
              }}
            />
            <small className={`staff-lyric-status ${!check ? "hint" : check.ok ? "ok" : "bad"}`}>
              {!check ? "Loading dictionary…" : check.ok ? `${activePhrase.notes.length} note${activePhrase.notes.length === 1 ? "" : "s"} ✓` : check.problem}
            </small>
          </div>
        );
      }
      return null;
    }

    const rhythm = activePhrase.notes.map((n) => n.beats);
    const check = dictReady ? checkSung({ words: draftWords, rhythm }, activePhrase.startBeat) : null;
    const diff = check ? check.syllables.length - check.notes : 0;
    return (
      <div className="staff-lyric-bar">
        <label htmlFor={lyricInputId}>Line lyrics</label>
        <input
          id={lyricInputId}
          aria-label="Edit line lyrics"
          value={draftWords}
          aria-invalid={check ? !check.ok : undefined}
          onChange={(e) => {
            const next = e.target.value;
            setDraftWords(next);
            if (dictReady && next !== committedWords && checkSung({ words: next, rhythm }).ok) {
              editPhraseWords(track.id, activePhrase.lineIndex!, next);
            }
          }}
        />
        <small className={`staff-lyric-status ${!check ? "hint" : check.ok ? (check.hint ? "hint" : "ok") : "bad"}`} title={check?.hint || check?.problem}>
          {!check ? "Loading dictionary…" : check.ok ? `${check.notes} notes ✓${check.hint ? ` · ${check.hint}` : ""}` : check.problem}
        </small>
        {check && check.syllables.length > 0 && diff < 0 && (
          <button
            type="button"
            onClick={() => {
              const fixed = holdFix(draftWords, -diff);
              setDraftWords(fixed);
              editPhraseWords(track.id, activePhrase.lineIndex!, fixed);
            }}
          >
            Hold last word
          </button>
        )}
        {draftWords !== committedWords && (
          <button type="button" onClick={() => setDraftWords(committedWords)}>
            Reset line
          </button>
        )}
      </div>
    );
  };
  const midiLabel = !midiSupported()
    ? "MIDI needs HTTPS/localhost"
    : midi.status === "denied"
      ? "MIDI blocked"
      : midi.status === "connecting"
        ? "MIDI connecting…"
        : midi.status === "on"
          ? midi.inputs[0] ? `MIDI: ${midi.inputs[0]}` : "MIDI: No device"
          : "Connect MIDI";

  if (piece.kind === "skit") {
    return (
      <div className="staff-panel" aria-label="Spoken skit part editor">
        <p className="text-xs text-[#A8B8C8]">
          <strong>{piece.title}</strong> is a spoken skit without pitched vocal melodies. Use <strong>Full Score</strong> or <strong>Lyrics</strong> to inspect and cue lines by scene.
        </p>
      </div>
    );
  }

  return (
    <div className="staff-panel" aria-label={`${displayName}'s rehearsal staff`}>
      <div className="staff-toolbar">
        <span className="staff-title">
          <b>{displayName}’s Staff</b>
          <small>{piece.key} {piece.mode} · {piece.bpm} BPM</small>
        </span>
        {singers.length > 1 && (
          <div className="staff-singers" role="tablist" aria-label="Whose notes to show">
            {singers.map(({ v, i }) => (
              <button key={v.id} type="button" role="tab" aria-selected={i === selected} className={i === selected ? "on" : ""} onClick={() => select(i)}
                style={{ ["--singer" as string]: studio404 ? (STUDIO_404_CAST[v.id]?.color ?? v.color) : v.color }}>
                <i aria-hidden="true" />{studio404 ? studio404Name(v.id, v.name) : v.name}
              </button>
            ))}
          </div>
        )}
        {fileStatus?.edited && (
          <span className="staff-save-actions">
            <button type="button" onClick={() => void saveSongFile()}>{import.meta.env.DEV ? `Save to songs/${fileStatus.file}` : `Download ${fileStatus.file}`}</button>
            <button type="button" className="link" onClick={revertSongFile}>Revert</button>
          </span>
        )}
        <div className="staff-controls">
          <div className="staff-tempo" role="group" aria-label="Rehearsal tempo">
            {TEMPOS.map((rate) => (
              <button key={rate} type="button" className={tempoScale === rate ? "on" : ""} aria-pressed={tempoScale === rate} disabled={busy} onClick={() => setTempoScale(rate)}>
                {rate === 1 ? "1.0×" : `${rate}×`}
              </button>
            ))}
          </div>
          <button type="button" className={soloMix ? "on" : ""} aria-pressed={soloMix} disabled={!track} onClick={() => setSoloMix(!soloMix)} title={`Hear only ${displayName} during playback`}>
            {soloMix ? `Solo: ${displayName}` : `Solo ${displayName}`}
          </button>
          <button type="button" className={`inline-flex items-center gap-1 ${isLooping ? "on" : ""}`} aria-pressed={isLooping} disabled={!phraseRange || busy} onClick={toggleLoop} title="Loop the selected line on stage">
            {isLooping ? <><Square className="size-3.5 fill-current" /> Stop loop</> : <><Repeat className="size-3.5" /> Loop line</>}
          </button>
          <button type="button" className={midi.status === "on" ? "on" : ""} disabled={!midiSupported()} aria-pressed={midi.status === "on"} onClick={() => setMidi(midi.status !== "on")} title="Connect a MIDI keyboard for step-input on the selected note">
            {midiLabel}
          </button>
        </div>
      </div>

      {!activePhrase ? (
        <p className="words-note">{displayName} sits this song out — pick a singer on stage to view their staff.</p>
      ) : (
        <>
          <div className="staff-phrase-bar">
            <button type="button" className="inline-flex items-center gap-1" disabled={safePhraseIdx <= 0} onClick={() => { setPhraseIdx(safePhraseIdx - 1); setSelectedNoteIdx(null); }}>
              <ChevronLeft className="size-3.5" /> Prev line
            </button>
            <select aria-label="Select line to rehearse" value={safePhraseIdx} onChange={(e) => { setPhraseIdx(Number(e.target.value)); setSelectedNoteIdx(null); }}>
              {phrases.map((p, i) => <option key={p.id} value={i}>{p.label}</option>)}
            </select>
            <button type="button" className="inline-flex items-center gap-1" disabled={safePhraseIdx >= phrases.length - 1} onClick={() => { setPhraseIdx(safePhraseIdx + 1); setSelectedNoteIdx(null); }}>
              Next line <ChevronRight className="size-3.5" />
            </button>
          </div>

          {renderLyricEditor()}

          <VexStaffLine
            events={activePhrase.notes}
            piece={piece}
            voice={voice}
            selectedIndex={selectedNoteIdx}
            inkTheme={inkTheme}
            zoom={zoom}
            onSelect={selectNote}
            onShift={shiftNote}
          />

          <div className="staff-note-bar">
            {activeNote ? (
              <>
                <span className="staff-note-info">
                  Note {activePhrase.notes.findIndex((n) => n.index === activeNote.index) + 1}/{activePhrase.notes.length}
                  {activeNote.syllable ? ` “${activeNote.syllable}”` : ""} · <b className="text-[#F5B851]">{noteName(activeNote.midi, piece.key, piece.mode)}</b> · {activeNote.beats} beat{activeNote.beats === 1 ? "" : "s"}
                </span>
                <button type="button" className="inline-flex items-center gap-1" onClick={() => hearItem(activeNote)}>
                  <Play className="size-3.5 fill-current" /> Hear
                </button>
                <button type="button" className="inline-flex items-center gap-1" onClick={() => shiftNote(activeNote.index, -1)}>
                  <ArrowDown className="size-3.5" /> Lower
                </button>
                <button type="button" className="inline-flex items-center gap-1" onClick={() => shiftNote(activeNote.index, 1)}>
                  <ArrowUp className="size-3.5" /> Higher
                </button>
                <button type="button" className="inline-flex items-center gap-1" onClick={() => {
                  const p = activePhrase.notes.findIndex((n) => n.index === activeNote.index);
                  if (p > 0) selectNote(activePhrase.notes[p - 1].index);
                }} disabled={activePhrase.notes[0]?.index === activeNote.index}>
                  <ChevronLeft className="size-3.5" /> Prev
                </button>
                <button type="button" className="inline-flex items-center gap-1" onClick={() => {
                  const p = activePhrase.notes.findIndex((n) => n.index === activeNote.index);
                  if (p >= 0 && p + 1 < activePhrase.notes.length) selectNote(activePhrase.notes[p + 1].index);
                }} disabled={activePhrase.notes[activePhrase.notes.length - 1]?.index === activeNote.index}>
                  Next <ChevronRight className="size-3.5" />
                </button>
                <button type="button" onClick={() => setSelectedNoteIdx(null)}>Done</button>
                <span className="staff-midi-hint">
                  {midi.status === "on" && midi.inputs.length
                    ? "MIDI step-input armed: press a key to shift & advance."
                    : "Click Connect MIDI or use the bottom keyboard in Step-Edit mode to step-enter pitches."}
                </span>
              </>
            ) : (
              <span className="staff-midi-hint">Click any notehead to hear {displayName} sing it; drag up/down, use Up/Down arrows, or press a key to change it.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
