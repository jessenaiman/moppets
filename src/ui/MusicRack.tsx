import { ChoirScore, type RackProps } from "./ChoirScore";
import { revealStaff } from "./scoreScroll";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Accidental,
  Annotation,
  Beam,
  Dot,
  Formatter,
  Fraction,
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
import {measures} from "../choir/meter";
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
function systems(bars:ReturnType<typeof measures>) {
  return Array.from({length:Math.ceil(bars.length/4)},(_,i)=>({
    first:i*4,count:Math.min(4,bars.length-i*4),bars:bars.slice(i*4,i*4+4),
  }));
}
function engrave(root: HTMLDivElement, piece: Piece, track: Track, lines: ReturnType<typeof systems>) {
  const clef = clefForVoice(track.events.map((e) => e.midi)),
    sig = vexKeySignature(piece.key, piece.mode);
  const words = trackSyllables(track);
  const positions: { beat: number; x: number; row: HTMLDivElement }[] = [];
  root.replaceChildren();
  const systemWidth = Math.max(...lines.map(l=>l.count),1) * 195;
  for (const { first, count, bars } of lines) {
    const row = document.createElement("div");
    row.dataset.firstBar=String(first+1);
    row.dataset.barCount=String(count);
    root.append(row);
    const width = count * 195,
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
      const measure=bars[bar-first];
      const [numBeats,beatValue]=measure.signature.split("/").map(Number);
      if(measure.printMeter) stave.addTimeSignature(measure.signature);
      stave.setContext(ctx).draw();
      const notes: StaveNote[] = [],
        ties: [StaveNote | null, StaveNote | null][] = [];
      const accidentals = keySigAccidentals(sig);
      const end = measure.end;
      const starts: number[] = [];
      let cursor = measure.start;
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
      const voice = new Voice({numBeats,beatValue}).setMode(Voice.Mode.SOFT).addTickables(notes);
      const beams = Beam.generateBeams(notes,{groups:[new Fraction(numBeats>=6 && numBeats%3===0 && beatValue===8 ? 3 : 1,beatValue)]});
      new Formatter().joinVoices([voice]).format([voice], width / count - (stave.getNoteStartX() - x) - 12);
      voice.draw(ctx, stave);
      const anchors = starts.map((beat, i) => ({ beat, x: notes[i].getAbsoluteX(), row }));
      positions.push(...anchors);
      anchors.push({ beat: end, x: x + width / count, row });
      for (const chord of piece.chords.filter((c) => c.beat >= measure.start && c.beat < end)) {
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
    svg.setAttribute("viewBox", `0 0 ${systemWidth} ${height}`);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.removeAttribute("style");
    row.style.removeProperty("width");
    positions.push({ beat: bars[count-1].end, x: width, row });
    const cursor = document.createElementNS("http://www.w3.org/2000/svg", "path");
    cursor.setAttribute("class", "rack-cursor");
    svg.append(cursor);
  }
  return positions;
}
export function MusicRack(props: RackProps) {
  const [part, setPart] = useState(false);
  return part ? <PartRack {...props} onChoir={() => setPart(false)}/>
    : <ChoirScore {...props} onPart={() => setPart(true)}/>;
}

function PartRack({timeSec, playing, onSeek = seek, onChoir}: RackProps & {onChoir:()=>void}) {
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
  const bars=useMemo(()=>measures(piece),[piece]);
  const lines=useMemo(()=>systems(bars),[bars]);
  const paper = useRef<HTMLDivElement>(null);
  const [fullPage, setFullPage] = useState(false);
  const [visibleLine, setVisibleLine] = useState(0);
  const [follow, setFollow] = useState(true);
  const ensembleTime = useEnsemble(s => s.time);
  const beat = ((timeSec ?? ensembleTime) - LEAD_IN) / beatSeconds(piece);
  const currentBar = bars.findIndex(b=>beat<b.end);
  const bar = currentBar < 0 ? Math.max(0,bars.length-1) : currentBar;
  const line = Math.max(
    0,
    lines.findIndex((l) => bar >= l.first && bar < l.first + l.count),
  );
  const event = track?.events.find(
    (e) => e.beat <= beat && e.beat + e.beats > beat,
  );
  const ensemblePlaying = useEnsemble(s => s.status === "playing");
  const sounding = playing ?? ensemblePlaying;
  const anchors=useRef<ReturnType<typeof engrave>>([]);
  useEffect(() => {
    anchors.current = paper.current && track?.events.length ? engrave(paper.current, piece, track, lines) : [];
  }, [piece, track, lines]);
  useEffect(() => {
    const root = paper.current;
    if (!root) return;
    // Always fill the rack width so staves & lyrics stay crisp and legible instead of shrinking to a narrow column.
    root.style.setProperty("--system-width", "100%");
  }, [lines, compact, fullPage, track]);
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
    if (follow && row) revealStaff(root,row);
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
    <section className="music-rack" data-full-page={fullPage || undefined}>
      <header>
        <div>
          <small>
            {piece.title === "Borrowed Light" && voice.id === "vee" ? "Moonbeam" : studio ? studio404Name(voice.id, voice.name) : voice.name} ·{" "}
            {piece.key} {piece.mode} · {bars[bar]?.signature ?? piece.meter ?? "4/4"} · {piece.bpm} BPM
          </small>
          <h2>{piece.title}</h2>
        </div>
        <button type="button" onClick={onChoir}>All voices</button>
        <button aria-pressed={fullPage} onClick={() => setFullPage(!fullPage)}>{fullPage ? "Close full score" : "Full score"}</button>
        <button onClick={() => setFollow(!follow)} aria-pressed={follow}>
          {follow ? "Following" : "Follow score"}
        </button>
      </header>
      {track?.events.length ? (
        <div
          className="rack-paper"
          data-layout="layered"
          ref={paper}
          onScroll={e=>{
            const root=e.currentTarget, top=root.getBoundingClientRect().top;
            const index=Array.from(root.children).findIndex(row=>row.getBoundingClientRect().bottom>top+1);
            if(index>=0)setVisibleLine(index);
          }}
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
              onSeek(
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
            value={follow ? line : Math.min(visibleLine,lines.length-1)}
            onChange={(e) => {
              if (!follow) {
                const root=paper.current,row=root?.children[+e.target.value];
                if (root && row) root.scrollTop += row.getBoundingClientRect().top-root.getBoundingClientRect().top;
                return;
              }
              onSeek(
                LEAD_IN + lines[+e.target.value].bars[0].start * beatSeconds(piece),
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
          {!follow && sounding && `Playing bar ${bar+1} · `}
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
