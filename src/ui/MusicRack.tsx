import { useEffect, useMemo, useRef, useState } from "react";
import {
  Accidental,
  Annotation,
  Beam,
  Dot,
  Formatter,
  Renderer,
  Stave,
  StaveNote,
  StaveTie,
  Voice,
} from "vexflow";
import { auditionNote } from "../choir/live.ts";
import { seek, useEnsemble } from "../choir/ensemble.ts";
import { noteName, type Piece, type Track } from "../choir/music.ts";
import {
  clefForVoice,
  keySigAccidentals,
  midiToVexNote,
  vexKeySignature,
} from "../choir/staffMath.ts";
import { LEAD_IN, beatSeconds } from "../choir/timeline.ts";
import { STUDIO_404_CAST, studio404Name } from "../choir/studio404.ts";
import { useMoppet } from "../choir/store.ts";
import { trackSyllables } from "./StaffEditor.tsx";

const durations = [
  [4, "w"],
  [3, "hd"],
  [2, "h"],
  [1.5, "qd"],
  [1, "q"],
  [0.75, "8d"],
  [0.5, "8"],
  [0.375, "16d"],
  [0.25, "16"],
  [0.125, "32"],
  [0.0625, "64"],
] as const;
function systems(piece: Piece, track: Track | undefined, compact: boolean) {
  const bars = Math.max(1, Math.ceil(piece.beats / 4)),
    lines = [];
  const events = track?.events ?? [];
  for (let first = 0; first < bars;) {
    let count = Math.min(compact ? 2 : 4, bars - first);
    if (!compact && bars - first > 4) {
      const cost = (n: number) => {
        const edge = (first + n) * 4,
          before = events.filter((e) => e.beat < edge).at(-1),
          after = events.find((e) => e.beat >= edge);
        return (
          (before && before.beat + before.beats > edge ? 8 : 0) +
          (before?.line !== undefined && before.line === after?.line ? 4 : 0) -
          n / 10
        );
      };
      count = [2, 3, 4]
        .filter((n) => bars - first - n !== 1)
        .sort((a, b) => cost(a) - cost(b))[0];
    }
    lines.push({ first, count });
    first += count;
  }
  return lines;
}
function engrave(root: HTMLDivElement, piece: Piece, track: Track, lines: ReturnType<typeof systems>) {
  const clef = clefForVoice(track.events.map((e) => e.midi)),
    sig = vexKeySignature(piece.key, piece.mode);
  const words = trackSyllables(track);
  const positions: { beat: number; x: number; row: HTMLDivElement }[] = [];
  root.replaceChildren();
  for (const { first, count } of lines) {
    const row = document.createElement("div");
    root.append(row);
    const width = count <= 2 ? 440 : 760,
      height = 130;
    const renderer = new Renderer(row, Renderer.Backends.SVG);
    renderer.resize(width, height);
    const ctx = renderer.getContext();
    let prior: StaveNote | null = null;
    for (let bar = first; bar < first + count; bar++) {
      const x = ((bar - first) * width) / count,
        stave = new Stave(x, 3, width / count);
      if (bar === first)
        stave
          .addClef(clef)
          .addKeySignature(sig)
          .setMeasure(bar + 1);
      stave.setContext(ctx).draw();
      const notes: StaveNote[] = [],
        ties: [StaveNote | null, StaveNote | null][] = [];
      const accidentals = keySigAccidentals(sig);
      const end = 4 * (bar + 1);
      const starts: number[] = [];
      let cursor = bar * 4;
      function emit(until: number, index?: number) {
        const e = index === undefined ? undefined : track.events[index];
        while (cursor < until - 0.001) {
          const remaining = until - cursor;
          const [duration, code] = durations.find(([d]) => d <= remaining + 0.001) ?? durations[durations.length - 1];
          const pitch = e ? midiToVexNote(e.midi, piece.key, piece.mode, accidentals) : null;
          const dotted = code.endsWith("d");
          const note = new StaveNote({
            clef,
            keys: [pitch?.key ?? (clef === "bass" ? "d/3" : "b/4")],
            duration: code.replace("d", "") + (e ? "" : "r"),
            dots: dotted ? 1 : 0,
            autoStem: true,
          });
          if (dotted) Dot.buildAndAttach([note], { all: true });
          if (pitch?.accidental) note.addModifier(new Accidental(pitch.accidental));
          if (e && index !== undefined) {
            if (cursor > e.beat + 0.001) ties.push([prior, note]);
            else if (words[index])
              note.addModifier(
                new Annotation(words[index]!).setFont("Georgia", 12).setVerticalJustification(Annotation.VerticalJustify.BOTTOM),
              );
            note.setAttribute("id", "rack-note-" + bar + "-" + notes.length);
            note.setAttribute("data-index", String(index));
          }
          starts.push(cursor);
          notes.push(note);
          prior = e ? note : null;
          cursor = Math.min(until, cursor + duration);
          if (e && cursor === end && bar === first + count - 1 && e.beat + e.beats > end + 0.001) ties.push([note, null]);
        }
      }
      track.events.forEach((e, i) => {
        if (e.beat >= end || e.beat + e.beats <= cursor) return;
        emit(e.beat);
        emit(Math.min(end, e.beat + e.beats), i);
      });
      emit(end);
      const voice = new Voice({ numBeats: 4, beatValue: 4 }).setMode(Voice.Mode.SOFT).addTickables(notes);
      const beams = Beam.generateBeams(notes);
      new Formatter().joinVoices([voice]).format([voice], width / count - (stave.getNoteStartX() - x) - 12);
      voice.draw(ctx, stave);
      const anchors = starts.map((beat, i) => ({ beat, x: notes[i].getAbsoluteX(), row }));
      positions.push(...anchors);
      anchors.push({ beat: end, x: x + width / count, row });
      for (const chord of piece.chords.filter((c) => c.beat >= bar * 4 && c.beat < end)) {
        const next = anchors.findIndex((a) => a.beat > chord.beat);
        const left = anchors[next - 1],
          right = anchors[next];
        if (!left || !right) continue;
        const at = left.x + ((right.x - left.x) * (chord.beat - left.beat)) / (right.beat - left.beat);
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", String(at));
        text.setAttribute("y", "16");
        text.setAttribute("class", "rack-chord");
        text.textContent = chord.name;
        row.querySelector("svg")!.append(text);
      }
      beams.forEach((b) => b.setContext(ctx).draw());
      for (const note of notes) {
        const index = note.getAttribute("data-index");
        if (index === undefined) continue;
        const el = row.querySelector("#vf-" + note.getAttribute("id"));
        if (el) el.setAttribute("data-event", index);
      }
      ties.forEach(([a, b]) =>
        new StaveTie({
          firstNote: a ?? undefined,
          lastNote: b ?? undefined,
          firstIndexes: [0],
          lastIndexes: [0],
        })
          .setContext(ctx)
          .draw(),
      );
    }
    const svg = row.querySelector("svg")!;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.removeAttribute("style");
    row.style.removeProperty("width");
    positions.push({ beat: (first + count) * 4, x: width, row });
    const cursor = document.createElementNS("http://www.w3.org/2000/svg", "path");
    cursor.setAttribute("class", "rack-cursor");
    svg.append(cursor);
  }
  return positions;
}
export function MusicRack() {
  const piece = useMoppet((s) => s.piece),
    voice = useMoppet((s) => s.voices[s.selected]);
  const studio = useMoppet((s) => s.studio404),
    track = piece.tracks.find((t) => t.id === voice.id);
  const [compact, setCompact] = useState(
    () => matchMedia("(max-width:550px)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(max-width:550px)");
    const resize = () => setCompact(query.matches);
    query.addEventListener("change", resize);
    return () => query.removeEventListener("change", resize);
  }, []);
  const lines = useMemo(
    () => systems(piece, track, compact),
    [piece, track, compact],
  );
  const paper = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const beat = useEnsemble((s) => (s.time - LEAD_IN) / beatSeconds(piece));
  const bar = Math.max(0, Math.floor(beat / 4));
  const line = Math.max(
    0,
    lines.findIndex((l) => bar >= l.first && bar < l.first + l.count),
  );
  const event = track?.events.find(
    (e) => e.beat <= beat && e.beat + e.beats > beat,
  );
  const sounding = useEnsemble((s) => s.status === "playing");
  const anchors=useRef<ReturnType<typeof engrave>>([]);
  useEffect(() => {
    anchors.current = paper.current && track?.events.length ? engrave(paper.current, piece, track, lines) : [];
  }, [piece, track, lines]);
  useEffect(()=>{
    const points=anchors.current;
    const i=points.findIndex(p=>p.beat>beat);
    const a=points[i-1],b=points[i];
    if(!a || !b || a.row!==b.row)return;
    const path=a.row.querySelector(".rack-cursor");
    const x=a.x+(b.x-a.x)*(beat-a.beat)/(b.beat-a.beat);
    path?.setAttribute("d",`M${x} 24v64`);
    return ()=>path?.removeAttribute("d");
  },[beat,piece,track,lines]);
  useEffect(() => {
    const root = paper.current;
    if (!root) return;
    Array.from(root.children).forEach((row, i) =>
      row.classList.toggle("current", line === i && sounding),
    );
    const row = root.children[line];
    if (follow && row)
      root.scrollTop +=
        row.getBoundingClientRect().top - root.getBoundingClientRect().top;
  }, [line, follow, lines, sounding]);
  const [pick, setPick] = useState<{ track: Track; index: number } | null>(
    null,
  );
  const chosen =
    pick?.track === track && pick ? track?.events[pick.index] : undefined;
  function adjust(steps: number) {
    if (!pick || !track || !chosen) return;
    const state = useMoppet.getState();
    const midi = state.shiftTrackNote(track.id, pick.index, steps);
    if (midi !== null) {
      void auditionNote(
        voice,
        midi,
        chosen.text,
        chosen.beats * beatSeconds(piece) * 1000,
      );
      const updated = useMoppet
        .getState()
        .piece.tracks.find((t) => t.id === track.id);
      if (updated) setPick({ track: updated, index: pick.index });
    }
  }
  useEffect(() => {
    const root = paper.current;
    const active = root?.querySelectorAll(".rack-sounding");
    active?.forEach((n) => n.classList.remove("rack-sounding"));
    if (sounding && event && track)
      root
        ?.querySelectorAll('[data-event="' + track.events.indexOf(event) + '"]')
        .forEach((n) => n.classList.add("rack-sounding"));
  }, [sounding, event, track]);
  return (
    <section className="music-rack">
      <header>
        <div>
          <small>
            {studio ? studio404Name(voice.id, voice.name) : voice.name} ·{" "}
            {piece.key} {piece.mode} · {piece.bpm} BPM
          </small>
          <h2>{piece.title}</h2>
        </div>
        <button onClick={() => setFollow(!follow)} aria-pressed={follow}>
          {follow ? "Following" : "Follow score"}
        </button>
      </header>
      {track?.events.length ? (
        <div
          className="rack-paper"
          data-layout="layered"
          ref={paper}
          onClick={(e) => {
            const index = (e.target as Element)
              .closest("[data-event]")
              ?.getAttribute("data-event");
            if (index == null || !track) return;
            const note = track.events[+index];
            setPick({ track, index: +index });
            void auditionNote(
              voice,
              note.midi,
              note.text,
              note.beats * beatSeconds(piece) * 1000,
            );
          }}
          onWheel={() => setFollow(false)}
          onTouchMove={() => setFollow(false)}
          tabIndex={0}
          aria-label="Full selected part"
        />
      ) : (
        <p className="rack-tacet">Tacet · {voice.name} rests throughout.</p>
      )}
      <footer>
        {piece.sections && (
          <select
            aria-label="Song section"
            value={piece.sections.reduce(
              (i, s, j) => (s.beat <= beat ? j : i),
              0,
            )}
            onChange={(e) => {
              setFollow(true);
              seek(
                LEAD_IN +
                  piece.sections![+e.target.value].beat * beatSeconds(piece),
              );
            }}
          >
            {piece.sections.map((s, i) => (
              <option key={i} value={i}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <label>
          Bar{" "}
          <select
            aria-label="Go to score system"
            value={line}
            onChange={(e) => {
              setFollow(true);
              seek(
                LEAD_IN + lines[+e.target.value].first * 4 * beatSeconds(piece),
              );
            }}
          >
            {lines.map((l, i) => (
              <option key={i} value={i}>
                {l.first + 1}–{l.first + l.count}
              </option>
            ))}
          </select>
        </label>
        {chosen && (
          <span>
            {noteName(chosen.midi, piece.key, piece.mode)}{" "}
            <button aria-label="Lower selected note" onClick={() => adjust(-1)}>
              −
            </button>
            <button aria-label="Raise selected note" onClick={() => adjust(1)}>
              +
            </button>
          </span>
        )}
        <output>
          {sounding && event
            ? noteName(event.midi, piece.key, piece.mode) +
              " · MIDI " +
              event.midi
            : sounding
              ? "Rest"
              : "Ready"}
        </output>
      </footer>
    </section>
  );
}
