import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { revealStaff } from "./scoreScroll";
import { auditionNote } from "../choir/live";
import { useEnsemble, seek } from "../choir/ensemble";
import { noteName, type Piece } from "../choir/music";
import { measures } from "../choir/meter";
import { PPQ } from "../choir/midi";
import { useMoppet } from "../choir/store";
import { resolvePerformerIdentity } from "../choir/performer";
import { beatSeconds, LEAD_IN } from "../choir/timeline";
import { trackSyllables } from "./StaffEditor";
import { beatX, engraveSystem, indexParts, type BeatAxis, type ScorePart } from "./sharedStaff";

export type RackProps = { timeSec?: number; playing?: boolean; onSeek?: (seconds: number) => void };
const palette = [
  "#097364",
  "#9a442b",
  "#7048a0",
  "#236a9c",
  "#805e13",
  "#a33f71",
  "#466527",
  "#505baf",
  "#a3413b",
  "#176a80",
  "#655a23",
  "#654b68",
];
type System = { first: number; bars: ReturnType<typeof measures> };
const StaffSystem = memo(function StaffSystem({
  piece,
  parts,
  events,
  system,
  width,
  activeBeat,
  sounding,
  onAxis,
}: {
  piece: Piece;
  parts: ScorePart[];
  events: ReturnType<typeof indexParts>;
  system: System;
  width: number;
  activeBeat: number | null;
  sounding: boolean;
  onAxis: (first: number, axis: BeatAxis[]) => void;
}) {
  const paper = useRef<HTMLDivElement>(null),
    drawing = useRef<ReturnType<typeof engraveSystem> | null>(null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  useLayoutEffect(() => {
    if (!paper.current) return;
    drawing.current = engraveSystem(
      paper.current,
      piece,
      parts,
      events,
      system.bars,
      system.first,
      "choir-" + id,
      width,
    );
    onAxis(system.first, drawing.current.axis);
  }, [piece, parts, events, system, id, width, onAxis]);
  useLayoutEffect(() => {
    const d = drawing.current;
    if (!d) return;
    for (const h of d.soundingHeads) {
      const on = sounding && activeBeat !== null && activeBeat >= h.from && activeBeat < h.to;
      h.group.classList.toggle("choir-note-sounding", on);
    }
    if (activeBeat === null) {
      d.cursor.style.display = "none";
      return;
    }
    const x = beatX(d.axis, activeBeat);
    d.cursor.setAttribute("x1", String(x));
    d.cursor.setAttribute("x2", String(x));
    d.cursor.style.display = "";
  }, [activeBeat, sounding, parts, system, width]);
  return (
    <div
      ref={paper}
      data-system={system.first}
      aria-current={activeBeat !== null ? "step" : undefined}
      role="group"
      aria-label={`Vocal notation, bars ${system.first + 1}–${system.first + system.bars.length}`}
      className="shrink-0 border-b border-[#d5e0da] bg-white px-1 py-1"
    />
  );
});

function TimingLanes({
  parts,
  system,
  beat,
  onPick,
  axis,
  width,
}: {
  parts: ScorePart[];
  system: System;
  beat: number;
  onPick: (part: number, index: number) => void;
  axis: BeatAxis[];
  width: number;
}) {
  const start = system.bars[0].start,
    end = system.bars.at(-1)!.end;
  const x = (at: number) => beatX(axis, at);
  return (
    <div className="shrink-0 border-t border-[#c5d6cd] bg-[#f5faf7] px-2.5 pt-2">
      <div className="flex items-baseline justify-between text-xs">
        <b>MIDI note lengths</b>
        <span>
          Bars {system.first + 1}–{system.first + system.bars.length}
        </span>
      </div>
      <svg
        role="group"
        aria-label="MIDI timing lanes"
        viewBox={`0 0 ${width} ${parts.length * 16 + 15}`}
        style={{ width, maxWidth: "100%", display: "block" }}
      >
        {Array.from({ length: Math.ceil(end - start) }, (_, i) => (
          <line
            key={i}
            x1={x(start + i)}
            x2={x(start + i)}
            y1="4"
            y2={parts.length * 16 + 7}
            stroke={system.bars.some((b) => b.start === start + i) ? "#99afa4" : "#dce6e0"}
          />
        ))}
        {parts.map((part, i) => (
          <g key={part.id} fill={part.color}>
            <text x="1" y={i * 16 + 16} fontSize="10" fontWeight="600">
              {part.name}
            </text>
            {part.events.map(
              (n, j) =>
                n.beat < end &&
                n.beat + n.beats > start && (
                  <rect
                    key={j}
                    x={x(Math.max(start, n.beat))}
                    y={i * 16 + 8}
                    rx="1.5"
                    width={Math.max(0.8, x(Math.min(end, n.beat + n.beats)) - x(Math.max(start, n.beat)) - 0.8)}
                    height="7"
                    onClick={() => onPick(i, j)}
                    className="cursor-pointer"
                  >
                    <title>
                      {part.name} · MIDI {n.midi} · {Math.round(n.beats * PPQ)} ticks
                    </title>
                  </rect>
                ),
            )}
          </g>
        ))}
        {beat >= start && beat < end && (
          <line x1={x(beat)} x2={x(beat)} y1="3" y2={parts.length * 16 + 7} stroke="#113e33" strokeWidth="1.5" />
        )}
      </svg>
    </div>
  );
}

export function ChoirScore({
  timeSec,
  playing,
  onSeek = seek,
  onPart,
  onLyrics,
}: RackProps & { onPart: () => void; onLyrics?: () => void }) {
  const piece = useMoppet((s) => s.piece),
    studio = useMoppet((s) => s.studio404),
    voices = useMoppet((s) => s.voices);
  const ensembleSec = useEnsemble((s) => (timeSec === undefined ? s.time : 0));
  const beat = ((timeSec ?? ensembleSec) - LEAD_IN) / beatSeconds(piece);
  const isPlaying = useEnsemble((s) => s.status === "playing");
  const sounding = playing ?? isPlaying;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    Promise.all([import("../audio/g2p").then(({ g2p }) => g2p.load()), document.fonts.load("16px Bravura", "\uE050")])
      .then(() => {
        if (mounted) setReady(true);
      })
      .catch(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);
  const parts = useMemo(
    () =>
      piece.tracks.map((t, i) => {
        const v = voices.find((v) => v.id === t.id);
        return {
          id: t.id,
          name: v ? resolvePerformerIdentity(v, studio, piece.title).name : t.id,
          color: palette[i % palette.length],
          events: t.events,
          words: ready ? trackSyllables(t) : [],
        };
      }),
    [piece, voices, studio, ready],
  );
  const events = useMemo(() => indexParts(parts), [parts]);
  const bars = useMemo(() => measures(piece), [piece]);
  const root = useRef<HTMLDivElement>(null);
  const handScrolling = useRef(false);
  const [width, setWidth] = useState(480),
    [full, setFull] = useState(false),
    [timing, setTiming] = useState(true),
    [follow, setFollow] = useState(true);
  const [browsing, setBrowsing] = useState(0);
  const [axes, setAxes] = useState<Record<number, BeatAxis[]>>({});
  const onAxis = useCallback((first: number, axis: BeatAxis[]) => setAxes((old) => ({ ...old, [first]: axis })), []);
  useEffect(() => {
    if (sounding) setFollow(true);
  }, [sounding]);
  const [selection, setSelection] = useState<{
    piece: Piece;
    refs: { part: number; index: number }[];
    selected: number;
  } | null>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const resize = () => setWidth(Math.max(160, Math.floor(el.clientWidth) - 16));
    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const count = Math.max(1, Math.min(6, Math.floor(width / 185)));
  const systems = useMemo(
    () =>
      Array.from({ length: Math.ceil(bars.length / count) }, (_, i) => ({
        first: i * count,
        bars: bars.slice(i * count, (i + 1) * count),
      })),
    [bars, count],
  );
  const bar = bars.findIndex((b) => beat < b.end);
  const current = Math.max(0, Math.floor((bar < 0 ? bars.length - 1 : bar) / count));
  const visible = Math.min(systems.length - 1, follow ? current : browsing);
  useEffect(() => {
    setBrowsing(0);
    setFollow(true);
    setSelection(null);
  }, [piece.title]);
  useLayoutEffect(() => {
    const el = root.current,
      row = el?.children[current];
    if (!follow || !el || !row) return;
    handScrolling.current = false;
    revealStaff(el, row);
  }, [current, follow, systems, ready, full, timing]);
  function chooseSystem(i: number) {
    const sys = systems[i];
    if (!sys) return;
    handScrolling.current = false;
    setBrowsing(i);
    const el = root.current,
      row = el?.querySelector(`[data-system="${sys.first}"]`);
    if (follow) {
      onSeek(LEAD_IN + sys.bars[0].start * beatSeconds(piece));
      if (el && row) revealStaff(el, row);
    } else if (el && row) {
      el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top;
    }
  }
  function browsePaper() {
    handScrolling.current = true;
    if (follow) {
      setBrowsing(current);
      setFollow(false);
    }
  }
  function pick(refs: { part: number; index: number }[]) {
    if (refs.length) setSelection({ piece, refs, selected: 0 });
  }
  const pickSet = selection?.piece === piece ? selection : null;
  const ref = pickSet?.refs[pickSet.selected];
  const part = ref && parts[ref.part],
    note = ref && part?.events[ref.index];
  const button = "rounded border border-[#9bb4ab] px-2 py-1 text-xs font-semibold";
  return (
    <section
      aria-label="Combined choir score"
      data-midi-file={piece.midiFile}
      data-playhead-beat={Math.max(0, beat).toFixed(4)}
      data-full-page={full || undefined}
      className="music-rack choir-score"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 !bg-[#213737] !px-3 !py-2.5 !text-white">
        <div className="min-w-0">
          <small className="!text-[#b6d9cc]">
            {piece.key} {piece.mode} · {bars[Math.max(bar, 0)]?.signature ?? "4/4"} · {Number(piece.bpm.toFixed(2))} BPM
          </small>
          <h2 className="!font-sans !text-lg !text-white">{piece.title}</h2>
        </div>
        <div className="flex flex-wrap gap-1">
          {onLyrics && (
            <button className={button} onClick={onLyrics}>
              Lyrics
            </button>
          )}
          <button className={button} onClick={onPart}>
            Parts
          </button>
          <button className={button} onClick={() => setFull(!full)} aria-pressed={full}>
            {full ? "Close full score" : "Full score"}
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-col overflow-hidden bg-white text-[#233c32]">
        {piece.midiNotice && (
          <p role="status" className="m-0 bg-amber-100 px-3 py-1 text-xs text-amber-950">
            {piece.midiNotice}
          </p>
        )}
        <div
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#c6d5cd] bg-[#f0f6f2] px-3 py-2 text-xs"
          aria-label="Singer colors"
        >
          {parts.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 font-semibold">
              <i style={{ background: p.color }} className="size-2 rounded-full" />
              {p.name}
            </span>
          ))}
        </div>
        <div
          ref={root}
          aria-label="Entire choir score"
          tabIndex={0}
          className="min-h-[7rem] flex-1 overflow-auto overscroll-contain px-1.5"
          onWheel={browsePaper}
          onTouchMove={browsePaper}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) browsePaper();
          }}
          onScroll={() => {
            if (!handScrolling.current || !root.current) return;
            const el = root.current,
              top = el.getBoundingClientRect().top;
            const i = Array.from(el.children).findIndex((row) => row.getBoundingClientRect().bottom > top + 4);
            if (i >= 0) setBrowsing(i);
          }}
          onKeyDown={(e) => {
            if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) browsePaper();
            if ((e.key === "Enter" || e.key === " ") && (e.target as Element).closest("[data-refs]")) {
              e.preventDefault();
              e.target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            }
          }}
          onClick={(e) => {
            const refs = (e.target as Element).closest("[data-refs]")?.getAttribute("data-refs");
            if (refs)
              pick(
                refs.split(",").map((s) => {
                  const [part, index] = s.split(":").map(Number);
                  return { part, index };
                }),
              );
          }}
        >
          {!ready && (
            <p role="status" className="p-2 text-xs">
              Preparing the score…
            </p>
          )}
          {ready &&
            systems.map((s, i) => (
              <StaffSystem
                key={s.first}
                piece={piece}
                parts={parts}
                events={events}
                system={s}
                width={width}
                activeBeat={i === current ? Math.max(0, beat) : null}
                sounding={sounding && beat >= 0 && i === current}
                onAxis={onAxis}
              />
            ))}
        </div>
        {timing && ready && systems[visible] && axes[systems[visible].first] && (
          <TimingLanes
            parts={parts}
            system={systems[visible]}
            axis={axes[systems[visible].first]}
            width={width}
            beat={Math.max(0, beat)}
            onPick={(part, index) => pick([{ part, index }])}
          />
        )}
        {note && part && ref && pickSet && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[#c5d6cd] px-3 py-1 text-xs">
            {pickSet.refs.length > 1 ? (
              <select
                aria-label="Singer on this note"
                value={pickSet.selected}
                onChange={(e) => setSelection({ ...pickSet, selected: Number(e.target.value) })}
              >
                {pickSet.refs.map((r, i) => (
                  <option key={i} value={i}>
                    {parts[r.part].name}
                  </option>
                ))}
              </select>
            ) : (
              <b style={{ color: part.color }}>{part.name}</b>
            )}
            <b>{noteName(note.midi, piece.key, piece.mode)}</b>
            <span>
              MIDI {note.midi} · {Math.round(note.beats * PPQ)} ticks
            </span>
            <button
              className={button}
              aria-label="Audition selected note"
              onClick={() => {
                const singer = voices.find((v) => v.id === part.id);
                if (singer)
                  void auditionNote(
                    singer,
                    note.midi,
                    part.words[ref.index] ?? "oo",
                    note.beats * beatSeconds(piece) * 1000,
                  );
              }}
            >
              ♪
            </button>
            {[-1, 1].map((delta) => (
              <button
                key={delta}
                className={button}
                aria-label={delta < 0 ? "Lower selected note" : "Raise selected note"}
                onClick={() => {
                  useMoppet.getState().editNotePitch(part.id, ref.index, Math.max(0, Math.min(127, note.midi + delta)));
                  setSelection({ ...pickSet, piece: useMoppet.getState().piece });
                }}
              >
                {delta < 0 ? "−" : "+"}
              </button>
            ))}
          </div>
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-1 !bg-[#eef4f0] !px-2 !py-1.5 !text-[#284539]">
        <div className="flex items-center gap-1">
          <button
            className={button}
            disabled={visible <= 0}
            aria-label="Previous score row"
            onClick={() => chooseSystem(visible - 1)}
          >
            ‹
          </button>
          <label>
            Bars{" "}
            <select
              aria-label="Go to score system"
              value={Math.max(0, visible)}
              onChange={(e) => chooseSystem(Number(e.target.value))}
            >
              {systems.map((sys, i) => (
                <option key={sys.first} value={i}>
                  {sys.first + 1}–{sys.first + sys.bars.length}
                </option>
              ))}
            </select>
          </label>
          <button
            className={button}
            disabled={visible >= systems.length - 1}
            aria-label="Next score row"
            onClick={() => chooseSystem(visible + 1)}
          >
            ›
          </button>
        </div>
        <button
          className={button}
          aria-pressed={follow}
          onClick={() => {
            handScrolling.current = false;
            setBrowsing(current);
            setFollow(!follow);
          }}
        >
          {follow ? "Following" : "Follow score"}
        </button>
        <button className={button} aria-pressed={timing} onClick={() => setTiming(!timing)}>
          {timing ? "Hide MIDI" : "Show MIDI"}
        </button>
      </footer>
    </section>
  );
}
