import {
  Accidental,
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
import type { Piece, ScoreEvent } from "../choir/music";
import { measures } from "../choir/meter";
import { PPQ } from "../choir/midi";
import { clefForVoice, keySigAccidentals, midiToVexNote, vexKeySignature } from "../choir/staffMath";

export interface ScorePart {
  id: string;
  name: string;
  color: string;
  events: ScoreEvent[];
  words: (string | null)[];
}
type EventRef = { part: number; index: number; pitch: number; start: number; end: number };
type Head = { pitch: number; refs: EventRef[] };
type Written = { note: StaveNote; heads: Head[]; tick: number; stop: number };
type Span = { from: number; to: number; refs: EventRef[] };
type Bar = ReturnType<typeof measures>[number];
const lengths = [
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
const ns = "http://www.w3.org/2000/svg";

function letter(
  svg: SVGSVGElement,
  x: number,
  y: number,
  value: string,
  size: number,
  color: string,
  extraAttrs?: Record<string, string>,
): SVGTextElement {
  const text = document.createElementNS(ns, "text");
  text.setAttribute("x", String(x));
  text.setAttribute("y", String(y));
  text.setAttribute("font-size", String(size));
  text.setAttribute("fill", color);
  text.setAttribute("stroke", "none");
  text.setAttribute("text-anchor", "middle");
  if (extraAttrs) {
    for (const [k, v] of Object.entries(extraAttrs)) text.setAttribute(k, v);
  }
  text.textContent = value;
  svg.append(text);
  return text;
}

function headPaint(svg: SVGSVGElement, id: string, colors: string[]) {
  if (colors.length === 1) return colors[0];
  if (!svg.getElementById(id)) {
    const gradient = document.createElementNS(ns, "linearGradient");
    gradient.id = id;
    colors.forEach((color, i) => {
      for (const edge of [i, i + 1]) {
        const stop = document.createElementNS(ns, "stop");
        stop.setAttribute("offset", String(edge / colors.length));
        stop.setAttribute("stop-color", color);
        gradient.append(stop);
      }
    });
    svg.querySelector("defs")!.append(gradient);
  }
  return `url(#${id})`;
}

export function indexParts(parts: ScorePart[]): EventRef[] {
  return parts
    .flatMap((part, i) =>
      part.events.map((event, index) => {
        const start = Math.round(event.beat * PPQ);
        return {
          part: i,
          index,
          pitch: event.midi,
          start,
          end: Math.max(start + 1, Math.round((event.beat + event.beats) * PPQ)),
        };
      }),
    )
    .sort((a, b) => a.start - b.start || a.part - b.part);
}

/** Singers with the same rhythm form a chord. Independent rhythms get separate stems. */
function rhythmicLanes(within: EventRef[], start: number, end: number) {
  const identical = new Map<string, Span>();
  for (const ref of within) {
    const from = Math.max(start, ref.start),
      to = Math.min(end, ref.end),
      key = from + ":" + to;
    const span = identical.get(key) ?? { from, to, refs: [] };
    span.refs.push(ref);
    identical.set(key, span);
  }
  const lanes: Span[][] = [[]];
  for (const span of [...identical.values()].sort((a, b) => a.from - b.from || a.to - b.to)) {
    const free = lanes.find((lane) => (lane.at(-1)?.to ?? start) <= span.from);
    if (free) free.push(span);
    else lanes.push([span]);
  }
  return lanes;
}

export interface BeatAxis {
  start: number;
  end: number;
  from: number;
  to: number;
}
export function beatX(axis: BeatAxis[], beat: number): number {
  const bar = axis.find((b) => beat < b.end) ?? axis[axis.length - 1];
  if (!bar) return 0;
  return bar.from + Math.max(0, Math.min(1, (beat - bar.start) / (bar.end - bar.start))) * (bar.to - bar.from);
}

export interface EngravedSystem {
  axis: BeatAxis[];
  cursor: SVGLineElement;
  cursorCap: SVGPolygonElement;
  noteFocusBox: SVGRectElement;
  barHighlights: { rect: SVGRectElement; start: number; end: number }[];
  soundingHeads: { group: SVGElement; from: number; to: number; cx: number; cy: number }[];
  lyricItems: { el: SVGTextElement; from: number; to: number }[];
  topY: number;
  bottomY: number;
}

export function engraveSystem(
  root: HTMLDivElement,
  piece: Piece,
  parts: ScorePart[],
  events: EventRef[],
  bars: Bar[],
  first: number,
  systemId: string,
  width: number,
): EngravedSystem {
  root.replaceChildren();
  const renderer = new Renderer(root, Renderer.Backends.SVG);
  renderer.resize(width, 148);
  const svg = root.querySelector("svg")!;
  const defs = document.createElementNS(ns, "defs");
  svg.prepend(defs);
  const bgGroup = document.createElementNS(ns, "g");
  bgGroup.setAttribute("data-layer", "bar-highlights");
  svg.insertBefore(bgGroup, defs.nextSibling);

  const ctx = renderer.getContext();
  const clef = clefForVoice(events.map((e) => e.pitch));
  const signature = vexKeySignature(piece.key, piece.mode);
  const barWidth = width / bars.length;
  const axis: BeatAxis[] = [];
  const barHighlights: { rect: SVGRectElement; start: number; end: number }[] = [];
  const soundingHeads: { group: SVGElement; from: number; to: number; cx: number; cy: number }[] = [];
  const lyricItems: { el: SVGTextElement; from: number; to: number }[] = [];
  const lyrics = new Map<
    number,
    { x: number; word: string; color: string; rank: number; from: number; to: number }
  >();
  const previous = new Map<EventRef, { note: StaveNote; head: number }>();
  const hasChords = piece.chords.some(
    (ch) => bars.length > 0 && ch.beat >= bars[0]!.start - 0.01 && ch.beat < bars.at(-1)!.end - 0.01,
  );
  let highest = hasChords ? -10 : 6,
    lowest = 89;

  for (const [b, bar] of bars.entries()) {
    const left = b * barWidth,
      start = Math.round(bar.start * PPQ),
      end = Math.round(bar.end * PPQ);

    // Pre-create warm active-measure highlight rectangle in background layer
    const barRect = document.createElementNS(ns, "rect");
    barRect.setAttribute("x", String(left + 2));
    barRect.setAttribute("width", String(Math.max(8, barWidth - 4)));
    barRect.setAttribute("rx", "7");
    barRect.setAttribute("fill", "rgba(217, 167, 92, 0.14)");
    barRect.setAttribute("stroke", "rgba(217, 167, 92, 0.42)");
    barRect.setAttribute("stroke-width", "1");
    barRect.style.pointerEvents = "none";
    barRect.style.display = "none";
    bgGroup.append(barRect);
    barHighlights.push({ rect: barRect, start: bar.start, end: bar.end });

    const stave = new Stave(left, 8, barWidth);
    if (!b) stave.addClef(clef, "small").addKeySignature(signature);
    if (bar.printMeter) stave.addTimeSignature(bar.signature);
    stave.setContext(ctx).draw();
    const within = events.filter((e) => e.start < end && e.end > start);
    const lanes = rhythmicLanes(within, start, end);
    const [numBeats, beatValue] = bar.signature.split("/").map(Number);
    const written: Written[] = [];
    const beams: Beam[] = [];
    const voices = lanes.map((lane, laneIndex) => {
      const notes: (StaveNote | GhostNote)[] = [];
      function fill(from: number, to: number, refs: EventRef[]) {
        const byPitch = new Map<number, EventRef[]>();
        for (const ref of refs) {
          const same = byPitch.get(ref.pitch) ?? [];
          same.push(ref);
          byPitch.set(ref.pitch, same);
        }
        const heads = [...byPitch].sort(([a], [b]) => a - b).map(([pitch, refs]) => ({ pitch, refs }));
        for (let at = from; at < to;) {
          const [beats, code] = lengths.find(([n]) => n * PPQ <= to - at) ?? lengths.at(-1)!;
          const ticks = Math.min(to - at, Math.round(beats * PPQ));
          const durationOverride = new Fraction(ticks, 4 * PPQ);
          if (!refs.length && (laneIndex > 0 || within.some((e) => e.start < at + ticks && e.end > at))) {
            notes.push(new GhostNote({ duration: code, durationOverride }));
            at += ticks;
            continue;
          }
          const pitches = heads.map(({ pitch }) => midiToVexNote(pitch, piece.key, piece.mode, {}));
          const dotted = [3, 1.5, 0.75, 0.375].includes(beats);
          const note = new StaveNote({
            clef,
            keys: heads.length ? pitches.map((p) => p.key) : [clef === "bass" ? "d/3" : "b/4"],
            duration: code + (heads.length ? "" : "r"),
            dots: dotted ? 1 : 0,
            durationOverride,
            autoStem: lanes.length === 1,
            stemDirection: laneIndex % 2 === 0 ? 1 : -1,
          });
          if (dotted) Dot.buildAndAttach([note], { all: true });
          heads.forEach((head, k) => {
            const singers = [...new Set(head.refs.map((e) => e.part))];
            const fill = headPaint(
              svg,
              systemId + "-u" + singers.join("-"),
              singers.map((i) => parts[i].color),
            );
            note.setKeyStyle(k, { fillStyle: fill, strokeStyle: fill });
          });
          notes.push(note);
          written.push({ note, heads, tick: at, stop: at + ticks });
          at += ticks;
        }
      }
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
        if (run.length > 1)
          beams.push(
            ...Beam.generateBeams(run, {
              maintainStemDirections: true,
              groups: [new Fraction(beatValue === 8 && numBeats % 3 === 0 ? 3 : 1, beatValue)],
            }),
          );
        run = [];
      };
      for (const note of notes) {
        if (note instanceof StaveNote) run.push(note);
        else flush();
      }
      flush();
      return voice;
    });

    const accidentalState = new Map<number, Record<string, number>>();
    written.sort((a, b) => a.tick - b.tick);
    for (const { note, heads } of written)
      heads.forEach(({ pitch }, k) => {
        const octave = Math.floor(pitch / 12),
          state = accidentalState.get(octave) ?? keySigAccidentals(signature);
        const { accidental } = midiToVexNote(pitch, piece.key, piece.mode, state);
        accidentalState.set(octave, state);
        if (accidental) note.addModifier(new Accidental(accidental), k);
      });
    const formatter = new Formatter().joinVoices(voices);
    formatter.format(voices, Math.max(16, left + barWidth - stave.getNoteStartX() - 14));
    const barAxis = { start: bar.start, end: bar.end, from: stave.getNoteStartX() + 13, to: left + barWidth - 5 };
    axis.push(barAxis);
    for (const w of written) {
      w.note.setStave(stave);
      const context = w.note.getTickContext();
      context.setX(context.getX() + beatX([barAxis], w.tick / PPQ) - w.note.getAbsoluteX() - 5);
    }
    voices.forEach((v) => v.draw(ctx, stave));
    beams.forEach((beam) => beam.setContext(ctx).draw());

    // Chord symbols cleanly above the bar & measure number
    for (const ch of piece.chords) {
      if (ch.beat >= bar.start - 0.01 && ch.beat < bar.end - 0.01 && ch.name) {
        const cx = Math.max(left + 26, beatX([barAxis], ch.beat));
        letter(svg, cx, 1, ch.name, 11.5, "#8C4A1C", {
          "font-weight": "700",
          "data-chord": "true",
        });
      }
    }

    for (const w of written) {
      const x = w.note.getAbsoluteX() + 5;
      const ys = w.note.getYs();
      highest = Math.min(highest, ...ys);
      lowest = Math.max(lowest, ...ys);
      if (w.note.hasStem()) {
        const tip = w.note.getStemExtents().topY;
        highest = Math.min(highest, tip);
        lowest = Math.max(lowest, tip);
      }
      w.heads.forEach((head, i) => {
        const group = w.note.noteHeads[i].getSVGElement();
        if (!group) return;
        soundingHeads.push({
          group,
          from: w.tick / PPQ,
          to: w.stop / PPQ,
          cx: x,
          cy: ys[i] ?? ys[0] ?? 48,
        });
        group.setAttribute("data-refs", head.refs.map((e) => e.part + ":" + e.index).join(","));
        group.setAttribute("data-midi", String(head.pitch));
        const title = document.createElementNS(ns, "title");
        title.textContent = head.refs
          .map((e) => parts[e.part].name + " · " + (parts[e.part].words[e.index] ?? ""))
          .join(" / ");
        group.append(title);
        group.setAttribute("role", "button");
        group.setAttribute("aria-label", title.textContent + " · MIDI " + head.pitch);
        group.setAttribute("tabindex", "0");
        const held = head.refs.find((e) => e.start < w.tick);
        if (held) {
          const prev = previous.get(held);
          new StaveTie({ firstNote: prev?.note, lastNote: w.note, firstIndexes: [prev?.head ?? i], lastIndexes: [i] })
            .setContext(ctx)
            .draw();
        }
        if (w.stop === end && b === bars.length - 1 && head.refs.some((e) => e.end > end))
          new StaveTie({ firstNote: w.note, firstIndexes: [i], lastIndexes: [i] }).setContext(ctx).draw();
        for (const e of head.refs) {
          previous.set(e, { note: w.note, head: i });
          const part = parts[e.part],
            word = part.words[e.index];
          const rank = e.part + (part.events[e.index].line === undefined ? parts.length : 0);
          if (e.start === w.tick && word && rank < (lyrics.get(w.tick)?.rank ?? Infinity))
            lyrics.set(w.tick, {
              x,
              word: word.split(/\s+/).slice(0, 2).join(" "),
              color: part.color,
              rank,
              from: e.start / PPQ,
              to: e.end / PPQ,
            });
        }
      });
    }
    letter(svg, left + 10, 17, String(first + b + 1), 11, "#786146", {
      "font-weight": "600",
      "data-barnum": "true",
    });
  }

  const top = Math.min(-2, highest - 10),
    baseline = lowest + 18;
  const rowEnds = [-Infinity, -Infinity];
  let usedSecondRow = false;
  for (const [, l] of [...lyrics].sort(([a], [b]) => a - b)) {
    const labelWidth = Math.max(10, l.word.length * 6.8);
    const half = labelWidth / 2;
    let rowIdx = 0;
    if (l.x - half < rowEnds[0] + 4) {
      rowIdx = l.x - half >= rowEnds[1] + 4 ? 1 : rowEnds[0] <= rowEnds[1] ? 0 : 1;
    }
    if (rowIdx === 1) usedSecondRow = true;
    const textEl = letter(svg, l.x, baseline + rowIdx * 13.5, l.word, 11.8, l.color, {
      "font-weight": "500",
      class: "choir-lyric-word",
    });
    lyricItems.push({ el: textEl, from: l.from, to: l.to });
    rowEnds[rowIdx] = l.x + half;
  }

  const height = baseline + (usedSecondRow ? 24 : 12) - top;
  const bottomY = top + height - 3;

  // Size all bar highlight rects to span the full system height cleanly
  for (const bh of barHighlights) {
    bh.rect.setAttribute("y", String(top + 2));
    bh.rect.setAttribute("height", String(Math.max(24, height - 4)));
  }

  svg.setAttribute("viewBox", `0 ${top} ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", String(height));
  svg.style.height = "auto";
  svg.style.display = "block";
  svg.style.overflow = "visible";

  // Rounded Amber Conductor Note-Focus Frame (matches approved Broadcast Conductor Desk design)
  const noteFocusBox = document.createElementNS(ns, "rect");
  noteFocusBox.setAttribute("rx", "7");
  noteFocusBox.setAttribute("ry", "7");
  noteFocusBox.setAttribute("fill", "rgba(245, 184, 81, 0.20)");
  noteFocusBox.setAttribute("stroke", "#D99B38");
  noteFocusBox.setAttribute("stroke-width", "2");
  noteFocusBox.setAttribute("data-focus-box", "true");
  noteFocusBox.style.pointerEvents = "none";
  noteFocusBox.style.display = "none";
  svg.append(noteFocusBox);

  // Smooth Playhead Cursor Line + Diamond Cap
  const cursor = document.createElementNS(ns, "line");
  cursor.setAttribute("y1", String(top + 4));
  cursor.setAttribute("y2", String(baseline + (usedSecondRow ? 18 : 6)));
  cursor.setAttribute("stroke", "#0D9488");
  cursor.setAttribute("stroke-width", "2");
  cursor.setAttribute("data-cursor", "true");
  cursor.style.pointerEvents = "none";
  cursor.style.display = "none";
  svg.append(cursor);

  const cursorCap = document.createElementNS(ns, "polygon");
  cursorCap.setAttribute("fill", "#D99B38");
  cursorCap.setAttribute("data-cursor-cap", "true");
  cursorCap.style.pointerEvents = "none";
  cursorCap.style.display = "none";
  svg.append(cursorCap);

  return {
    axis,
    cursor,
    cursorCap,
    noteFocusBox,
    barHighlights,
    soundingHeads,
    lyricItems,
    topY: top + 4,
    bottomY,
  };
}
