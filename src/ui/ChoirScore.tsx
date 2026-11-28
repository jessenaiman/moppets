import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Music, Play, Plus } from "lucide-react";
import { revealStaff } from "./scoreScroll";
import { auditionNote } from "../choir/live";
import { livePlaybackClock, useEnsemble, seek } from "../choir/ensemble";
import { noteName, type Piece } from "../choir/music";
import { measures } from "../choir/meter";
import { PPQ } from "../choir/midi";
import { useMoppet } from "../choir/store";
import { resolvePerformerIdentity } from "../choir/performer";
import { beatSeconds, LEAD_IN } from "../choir/timeline";
import { trackSyllables } from "./StaffEditor";
import {
  beatX,
  engraveSystem,
  indexParts,
  type BeatAxis,
  type EngravedSystem,
  type ScorePart,
} from "./sharedStaff";

export type ScoreInkTheme = "paper" | "dark";
export type RackProps = {
  timeSec?: number;
  playing?: boolean;
  onSeek?: (seconds: number) => void;
  inkTheme?: ScoreInkTheme;
  zoom?: number;
  visibleVoiceIds?: readonly string[] | "all";
  embedded?: boolean;
  follow?: boolean;
  onFollowChange?: (next: boolean) => void;
};

export const palette = [
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

export const darkPalette = [
  "#34D399",
  "#FB923C",
  "#C084FC",
  "#38BDF8",
  "#F5B851",
  "#F472B6",
  "#A3E635",
  "#818CF8",
  "#FB7185",
  "#22D3EE",
  "#FACC15",
  "#E879F9",
];

export function applyScoreInk(container: HTMLElement | null, inkTheme: ScoreInkTheme): void {
  if (!container || inkTheme !== "dark") return;
  const svgs = container.querySelectorAll("svg");
  svgs.forEach((svg) => {
    svg.querySelectorAll<SVGElement>("path, rect, line, polygon, text, circle, ellipse").forEach((el) => {
      if (el.hasAttribute("data-chord")) {
        el.setAttribute("fill", "#D9A75C");
        return;
      }
      if (el.hasAttribute("data-barnum")) {
        el.setAttribute("fill", "#A79E90");
        return;
      }
      if (el.hasAttribute("data-focus-box")) {
        el.setAttribute("stroke", "#F5B851");
        el.setAttribute("fill", "rgba(245, 184, 81, 0.16)");
        return;
      }
      if (el.hasAttribute("data-cursor")) {
        el.setAttribute("stroke", "#34D399");
        return;
      }
      if (el.hasAttribute("data-cursor-cap")) {
        el.setAttribute("fill", "#F5B851");
        return;
      }
      const fill = el.getAttribute("fill")?.toLowerCase();
      const stroke = el.getAttribute("stroke")?.toLowerCase();
      const isStaveLine =
        el.closest(".vf-stave") !== null &&
        !el.closest(".vf-clef, .vf-keysignature, .vf-timesignature");
      if (fill === "black" || fill === "#000" || fill === "#000000") {
        el.setAttribute("fill", "#F0E9DC");
      } else if (fill === "#536c60" || fill === "#786146" || fill === "#999999") {
        el.setAttribute("fill", "#A79E90");
      }
      if (stroke === "black" || stroke === "#000" || stroke === "#000000") {
        el.setAttribute("stroke", isStaveLine ? "#3E382F" : "#F0E9DC");
      } else if (stroke === "#999999" || stroke === "#999") {
        el.setAttribute("stroke", "#3E382F");
      } else if (stroke === "#187c67" || stroke === "#0d9488") {
        el.setAttribute("stroke", "#34D399");
      }
    });
  });
}

function updateEngravedSystemAtBeat(
  d: EngravedSystem,
  activeBeat: number | null,
  sounding: boolean,
): void {
  let minCx = Infinity;
  let minCy = Infinity;
  let maxCx = -Infinity;
  let maxCy = -Infinity;
  let anyHeadActive = false;

  for (const h of d.soundingHeads) {
    const on = sounding && activeBeat !== null && activeBeat >= h.from && activeBeat < h.to;
    h.group.classList.toggle("choir-note-sounding", on);
    if (on) {
      minCx = Math.min(minCx, h.cx);
      minCy = Math.min(minCy, h.cy);
      maxCx = Math.max(maxCx, h.cx);
      maxCy = Math.max(maxCy, h.cy);
      anyHeadActive = true;
    }
  }

  for (const l of d.lyricItems) {
    const on = sounding && activeBeat !== null && activeBeat >= l.from && activeBeat < l.to;
    l.el.classList.toggle("choir-lyric-sounding", on);
  }

  for (const bh of d.barHighlights) {
    const inBar = activeBeat !== null && activeBeat >= bh.start && activeBeat < bh.end;
    bh.rect.style.display = inBar ? "" : "none";
  }

  if (anyHeadActive && Number.isFinite(minCx)) {
    const halfW = 13;
    const halfH = 13;
    d.noteFocusBox.setAttribute("x", (minCx - halfW).toFixed(1));
    d.noteFocusBox.setAttribute("y", (minCy - halfH).toFixed(1));
    d.noteFocusBox.setAttribute("width", Math.max(26, maxCx - minCx + halfW * 2).toFixed(1));
    d.noteFocusBox.setAttribute("height", Math.max(26, maxCy - minCy + halfH * 2).toFixed(1));
    d.noteFocusBox.style.display = "";
  } else {
    d.noteFocusBox.style.display = "none";
  }

  if (activeBeat === null) {
    d.cursor.style.display = "none";
    d.cursorCap.style.display = "none";
    return;
  }

  const x = beatX(d.axis, activeBeat);
  const xs = x.toFixed(2);
  d.cursor.setAttribute("x1", xs);
  d.cursor.setAttribute("x2", xs);
  d.cursor.style.display = "";

  const cy = d.topY;
  d.cursorCap.setAttribute(
    "points",
    `${(x - 4.5).toFixed(2)},${cy.toFixed(2)} ${xs},${(cy - 4.5).toFixed(2)} ${(x + 4.5).toFixed(2)},${cy.toFixed(2)} ${xs},${(cy + 4.5).toFixed(2)}`,
  );
  d.cursorCap.style.display = "";
}

function smoothScrollRowIntoStand(paper: HTMLElement, row: Element, immediate = false): void {
  const rowEl = row as HTMLElement;
  if (typeof rowEl.offsetTop !== "number" || paper.clientHeight < 40) {
    revealStaff(paper, row);
    return;
  }
  const desiredTopOffset = 14;
  const rowTop = rowEl.offsetTop;
  const rowBottom = rowTop + rowEl.offsetHeight;
  const viewTop = paper.scrollTop;
  const viewBottom = viewTop + paper.clientHeight;
  if (rowTop < viewTop + 4 || rowBottom > viewBottom - 12 || rowTop > viewTop + paper.clientHeight * 0.45) {
    const target = Math.max(0, rowTop - desiredTopOffset);
    if (typeof paper.scrollTo === "function" && !immediate) {
      paper.scrollTo({ top: target, behavior: "smooth" });
    } else {
      paper.scrollTop = target;
    }
  }
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function SpokenSkitScript({
  piece,
  timeSec,
  playing,
  onSeek = seek,
  onLyrics,
  inkTheme = "dark",
  zoom = 100,
  follow = true,
  onFollowChange,
}: {
  piece: Piece;
  timeSec?: number;
  playing?: boolean;
  onSeek?: (seconds: number) => void;
  onLyrics?: () => void;
  inkTheme?: ScoreInkTheme;
  zoom?: number;
  follow?: boolean;
  onFollowChange?: (next: boolean) => void;
}) {
  const voices = useMoppet((s) => s.voices);
  const studio = useMoppet((s) => s.studio404);
  const ensembleSec = useEnsemble((s) => (timeSec === undefined ? s.time : 0));
  const isPlaying = useEnsemble((s) => s.status === "playing" || s.status === "buffering");
  const currentSec = timeSec ?? ensembleSec;
  const activeMode = playing ?? isPlaying;
  const bs = beatSeconds(piece);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scenes = useMemo(() => {
    const rawLines = piece.tracks
      .flatMap((t) => {
        const v = voices.find((x) => x.id === t.id);
        const ident = v
          ? resolvePerformerIdentity(v, studio, piece.title)
          : { id: t.id, name: t.id, color: "#34D399" };
        return t.events
          .filter((ev) => ev.text.trim().length > 0)
          .map((ev, idx) => ({
            id: `${t.id}-${idx}`,
            speakerId: t.id,
            speaker: ident.name,
            color: ident.color,
            beat: ev.beat,
            startSec: LEAD_IN + ev.beat * bs,
            endSec: LEAD_IN + (ev.beat + Math.max(0.8, ev.beats)) * bs,
            text: ev.text.trim(),
          }));
      })
      .sort((a, b) => a.beat - b.beat);

    const sceneList = piece.scenes?.length
      ? piece.scenes
      : [{ beat: 0, beats: Math.max(1, piece.beats), cast: piece.tracks.map((t) => t.id) }];

    const grouped = sceneList
      .map((sc, idx) => {
        const lines = rawLines.filter(
          (l) => l.beat >= sc.beat - 0.05 && l.beat < sc.beat + sc.beats - 0.05,
        );
        return {
          index: idx + 1,
          startSec: LEAD_IN + sc.beat * bs,
          endSec: LEAD_IN + (sc.beat + sc.beats) * bs,
          lines,
        };
      })
      .filter((g) => g.lines.length > 0);

    if (grouped.length > 0) return grouped;
    if (rawLines.length > 0) {
      return [
        {
          index: 1,
          startSec: LEAD_IN,
          endSec: LEAD_IN + piece.beats * bs,
          lines: rawLines,
        },
      ];
    }
    return [];
  }, [piece, voices, studio, bs]);

  // Smooth auto-follow for spoken dialogue lines
  useEffect(() => {
    if (!follow || !scrollRef.current) return;
    const activeLine = scrollRef.current.querySelector<HTMLElement>('[data-skit-active="true"]');
    if (activeLine) {
      smoothScrollRowIntoStand(scrollRef.current, activeLine);
    }
  }, [currentSec, follow]);

  const isPaper = inkTheme === "paper";
  const lineTextClass = zoom >= 150 ? "text-base" : zoom >= 125 ? "text-[15px]" : "text-sm";

  return (
    <section
      aria-label="Spoken skit script"
      data-testid="spoken-skit-script"
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-xl border ${
        isPaper
          ? "border-[#DFD4BF] bg-[#FAF5E8] text-[#1E1914]"
          : "border-[#2E2B26] bg-[#141311] text-[#F4EFE6]"
      }`}
    >
      {onLyrics && (
        <header
          className={`flex flex-wrap items-center justify-between gap-2 border-b px-3.5 py-2 ${
            isPaper ? "border-[#DFD4BF] bg-[#F2EBD9]" : "border-[#2E2B26] bg-[#1D1B18]"
          }`}
        >
          <div className="min-w-0">
            <h2 className="text-sm font-bold leading-tight">{piece.title}</h2>
            <p className={`text-xs ${isPaper ? "text-[#6E5A44]" : "text-[#B7AEA0]"}`}>
              Spoken Skit · {scenes.length} scene{scenes.length === 1 ? "" : "s"} · Click any line to cue stage
            </p>
          </div>
          <button
            type="button"
            onClick={onLyrics}
            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
              isPaper
                ? "border-[#CBBFA8] bg-white text-[#2A2118] hover:border-[#D9A75C]"
                : "border-[#3B362E] bg-[#1E1C19] text-[#F4EFE6] hover:border-[#D9A75C]"
            }`}
          >
            Lyrics View
          </button>
        </header>
      )}

      <div
        ref={scrollRef}
        onWheel={() => onFollowChange?.(false)}
        onTouchMove={() => onFollowChange?.(false)}
        className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-4"
      >
        {scenes.length === 0 ? (
          <p className="text-xs text-[#B7AEA0]">No spoken dialogue lines found in this skit.</p>
        ) : (
          scenes.map((scene) => (
            <div key={scene.index} className="space-y-2">
              <div
                className={`flex items-center justify-between border-b pb-1.5 ${
                  isPaper ? "border-[#DFD4BF]" : "border-[#2E2B26]"
                }`}
              >
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#D99B38]">
                  Scene {scene.index}
                </h3>
                <span className={`font-mono text-xs tabular-nums ${isPaper ? "text-[#6E5A44]" : "text-[#B7AEA0]"}`}>
                  {formatClock(scene.startSec)} – {formatClock(scene.endSec)}
                </span>
              </div>

              <div className="space-y-1.5">
                {scene.lines.map((line) => {
                  const isActive =
                    (activeMode || currentSec > LEAD_IN) &&
                    currentSec >= line.startSec - 0.05 &&
                    currentSec < line.endSec;
                  return (
                    <button
                      key={line.id}
                      type="button"
                      onClick={() => onSeek(line.startSec)}
                      data-skit-active={isActive ? "true" : undefined}
                      aria-current={isActive ? "true" : undefined}
                      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors cursor-pointer ${
                        isActive
                          ? isPaper
                            ? "border-[#D99B38] bg-[#FDF1D6] text-[#1E1914] shadow-2xs"
                            : "border-[#F5B851] bg-[#241E14] text-[#F4EFE6] ring-1 ring-[#F5B851]/45"
                          : isPaper
                            ? "border-[#E4DAC6] bg-white/85 text-[#1E1914] hover:border-[#D9A75C]"
                            : "border-[#2E2B26] bg-[#1A1815] text-[#EFE8DA] hover:border-[#D9A75C]/70 hover:bg-[#221F1B]"
                      }`}
                    >
                      <span
                        className={`mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                          isPaper
                            ? "border-[#DFD4BF] bg-[#FAF5E8] text-[#1E1914]"
                            : "border-[#3B362E] bg-[#121110] text-[#F4EFE6]"
                        }`}
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: line.color }}
                        />
                        {line.speaker}
                      </span>

                      <span className={`min-w-0 flex-1 leading-snug font-medium ${lineTextClass}`}>
                        {line.text}
                      </span>

                      <span
                        className={`mt-0.5 inline-flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums ${
                          isActive
                            ? isPaper
                              ? "text-[#9A5812] font-bold"
                              : "text-[#F5B851] font-bold"
                            : isPaper
                              ? "text-[#6E5A44]"
                              : "text-[#B7AEA0]"
                        }`}
                      >
                        {isActive && <Play className="size-3 fill-current" />}
                        {formatClock(line.startSec)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

type System = { first: number; bars: ReturnType<typeof measures> };
const StaffSystem = memo(function StaffSystem({
  sysIndex,
  piece,
  parts,
  events,
  system,
  renderWidth,
  displayWidth,
  inkTheme,
  activeBeat,
  sounding,
  onAxis,
  onRegisterDrawing,
}: {
  sysIndex: number;
  piece: Piece;
  parts: ScorePart[];
  events: ReturnType<typeof indexParts>;
  system: System;
  renderWidth: number;
  displayWidth: number;
  inkTheme: ScoreInkTheme;
  activeBeat: number | null;
  sounding: boolean;
  onAxis: (first: number, axis: BeatAxis[]) => void;
  onRegisterDrawing: (sysIndex: number, drawing: EngravedSystem | null) => void;
}) {
  const paper = useRef<HTMLDivElement>(null),
    drawing = useRef<EngravedSystem | null>(null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  useLayoutEffect(() => {
    if (!paper.current) return;
    const engraved = engraveSystem(
      paper.current,
      piece,
      parts,
      events,
      system.bars,
      system.first,
      "choir-" + id,
      renderWidth,
    );
    drawing.current = engraved;
    applyScoreInk(paper.current, inkTheme);
    onAxis(system.first, engraved.axis);
    onRegisterDrawing(sysIndex, engraved);
    return () => {
      onRegisterDrawing(sysIndex, null);
    };
  }, [sysIndex, piece, parts, events, system, id, renderWidth, inkTheme, onAxis, onRegisterDrawing]);

  useLayoutEffect(() => {
    const d = drawing.current;
    if (!d) return;
    updateEngravedSystemAtBeat(d, activeBeat, sounding);
  }, [activeBeat, sounding, parts, system, renderWidth]);

  return (
    <div
      ref={paper}
      data-system={system.first}
      data-sys-index={sysIndex}
      aria-current={activeBeat !== null ? "step" : undefined}
      role="group"
      aria-label={`Vocal notation, bars ${system.first + 1}–${system.first + system.bars.length}`}
      style={{ width: displayWidth, maxWidth: "100%" }}
      className={`choir-system-row shrink-0 border-b px-2 py-2 transition-colors ${
        inkTheme === "dark" ? "border-[#2A2621] bg-[#141311]" : "border-[#E5DCC8] bg-[#FAF5E8]"
      }`}
    />
  );
});

function TimingLanes({
  parts,
  system,
  beat,
  onPick,
  axis,
  renderWidth,
  displayWidth,
  inkTheme,
}: {
  parts: ScorePart[];
  system: System;
  beat: number;
  onPick: (part: number, index: number) => void;
  axis: BeatAxis[];
  renderWidth: number;
  displayWidth: number;
  inkTheme: ScoreInkTheme;
}) {
  const start = system.bars[0].start,
    end = system.bars.at(-1)!.end;
  const x = (at: number) => beatX(axis, at);
  const isDark = inkTheme === "dark";
  return (
    <div
      className={`shrink-0 border-t px-3 pt-2 pb-1.5 ${
        isDark ? "border-[#2E2B26] bg-[#181614] text-[#F4EFE6]" : "border-[#DFD4BF] bg-[#F2EBD9] text-[#2A2118]"
      }`}
    >
      <div className="flex items-baseline justify-between text-xs mb-1">
        <b>MIDI note lengths</b>
        <span>
          Bars {system.first + 1}–{system.first + system.bars.length}
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          role="group"
          aria-label="MIDI timing lanes"
          viewBox={`0 0 ${renderWidth} ${parts.length * 18 + 16}`}
          style={{ width: displayWidth, minWidth: "100%", display: "block" }}
        >
          {Array.from({ length: Math.ceil(end - start) }, (_, i) => (
            <line
              key={i}
              x1={x(start + i)}
              x2={x(start + i)}
              y1="4"
              y2={parts.length * 18 + 8}
              stroke={
                system.bars.some((b) => b.start === start + i)
                  ? isDark
                    ? "#5E5446"
                    : "#B8AA94"
                  : isDark
                    ? "#2A2621"
                    : "#E2D8C3"
              }
            />
          ))}
          {parts.map((part, i) => (
            <g key={part.id} fill={part.color}>
              <text x="1" y={i * 18 + 16} fontSize="12" fontWeight="600">
                {part.name}
              </text>
              {part.events.map(
                (n, j) =>
                  n.beat < end &&
                  n.beat + n.beats > start && (
                    <rect
                      key={j}
                      x={x(Math.max(start, n.beat))}
                      y={i * 18 + 8}
                      rx="2"
                      width={Math.max(1.5, x(Math.min(end, n.beat + n.beats)) - x(Math.max(start, n.beat)) - 1)}
                      height="8"
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
            <line
              x1={x(beat)}
              x2={x(beat)}
              y1="3"
              y2={parts.length * 18 + 8}
              stroke={isDark ? "#34D399" : "#0D9488"}
              strokeWidth="1.8"
            />
          )}
        </svg>
      </div>
    </div>
  );
}

export function ChoirScore({
  timeSec,
  playing,
  onSeek = seek,
  onPart,
  onLyrics,
  inkTheme = "paper",
  zoom = 100,
  visibleVoiceIds = "all",
  embedded = false,
  follow,
  onFollowChange,
}: RackProps & { onPart: () => void; onLyrics?: () => void }) {
  const piece = useMoppet((s) => s.piece),
    studio = useMoppet((s) => s.studio404),
    voices = useMoppet((s) => s.voices);
  const ensembleSec = useEnsemble((s) => (timeSec === undefined ? s.time : 0));
  const beat = ((timeSec ?? ensembleSec) - LEAD_IN) / beatSeconds(piece);
  const isPlaying = useEnsemble((s) => s.status === "playing" || s.status === "buffering");
  const sounding = playing ?? isPlaying;

  if (piece.kind === "skit") {
    return (
      <SpokenSkitScript
        piece={piece}
        timeSec={timeSec}
        playing={playing}
        onSeek={onSeek}
        onLyrics={onLyrics}
        inkTheme={inkTheme}
        zoom={zoom}
        follow={follow}
        onFollowChange={onFollowChange}
      />
    );
  }

  return (
    <ChoirNotationScore
      piece={piece}
      studio={studio}
      voices={voices}
      beat={beat}
      sounding={sounding}
      hasExplicitTime={timeSec !== undefined}
      onSeek={onSeek}
      onPart={onPart}
      onLyrics={onLyrics}
      inkTheme={inkTheme}
      zoom={zoom}
      visibleVoiceIds={visibleVoiceIds}
      embedded={embedded}
      externalFollow={follow}
      onExternalFollowChange={onFollowChange}
    />
  );
}

function ChoirNotationScore({
  piece,
  studio,
  voices,
  beat,
  sounding,
  hasExplicitTime,
  onSeek,
  onPart,
  onLyrics,
  inkTheme,
  zoom,
  visibleVoiceIds = "all",
  embedded = false,
  externalFollow,
  onExternalFollowChange,
}: {
  piece: Piece;
  studio: boolean;
  voices: ReturnType<typeof useMoppet.getState>["voices"];
  beat: number;
  sounding: boolean;
  hasExplicitTime: boolean;
  onSeek: (seconds: number) => void;
  onPart: () => void;
  onLyrics?: () => void;
  inkTheme: ScoreInkTheme;
  zoom: number;
  visibleVoiceIds?: readonly string[] | "all";
  embedded?: boolean;
  externalFollow?: boolean;
  onExternalFollowChange?: (next: boolean) => void;
}) {
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
  const activePalette = inkTheme === "dark" ? darkPalette : palette;
  const allParts = useMemo(
    () =>
      piece.tracks
        .filter((t) => t.events.length > 0)
        .map((t, i) => {
          const v = voices.find((v) => v.id === t.id);
          return {
            id: t.id,
            name: v ? resolvePerformerIdentity(v, studio, piece.title).name : t.id,
            color: activePalette[i % activePalette.length],
            events: t.events,
            words: ready ? trackSyllables(t) : [],
          };
        }),
    [piece, voices, studio, ready, activePalette],
  );
  const parts = useMemo(() => {
    if (visibleVoiceIds === "all") return allParts;
    const filtered = allParts.filter((p) => visibleVoiceIds.includes(p.id));
    return filtered.length > 0 ? filtered : allParts;
  }, [allParts, visibleVoiceIds]);
  const events = useMemo(() => indexParts(parts), [parts]);
  const bars = useMemo(() => measures(piece), [piece]);
  const root = useRef<HTMLDivElement>(null);
  const drawingsRef = useRef<Map<number, EngravedSystem>>(new Map());
  const rafSysRef = useRef<number>(-1);
  const handScrolling = useRef(false);
  const [width, setWidth] = useState(740);
  const [full, setFull] = useState(false);
  // Default inline MIDI ticks OFF when embedded (since ScrollingMidiMiniNav sits beneath controls!)
  const [timing, setTiming] = useState(() => !embedded);
  const [internalFollow, setInternalFollow] = useState(true);
  const follow = externalFollow ?? internalFollow;
  const setFollow = useCallback(
    (next: boolean) => {
      setInternalFollow(next);
      onExternalFollowChange?.(next);
    },
    [onExternalFollowChange],
  );

  const [browsing, setBrowsing] = useState(0);
  const [axes, setAxes] = useState<Record<number, BeatAxis[]>>({});
  const onAxis = useCallback((first: number, axis: BeatAxis[]) => setAxes((old) => ({ ...old, [first]: axis })), []);
  const onRegisterDrawing = useCallback((sysIndex: number, d: EngravedSystem | null) => {
    if (d) drawingsRef.current.set(sysIndex, d);
    else drawingsRef.current.delete(sysIndex);
  }, []);

  useEffect(() => {
    if (sounding) setFollow(true);
  }, [sounding, setFollow]);

  const [selection, setSelection] = useState<{
    piece: Piece;
    refs: { part: number; index: number }[];
    selected: number;
  } | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const resize = () => setWidth(Math.max(240, Math.floor(el.clientWidth) - 20));
    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Responsive bar wrapping: 2 bars on mobile/zoomed, 3 on medium, 4 on wide — zero right-edge clipping!
  const effectiveColsWidth = Math.round(width / Math.max(1, zoom / 100));
  const count = effectiveColsWidth < 520 ? 2 : effectiveColsWidth < 780 ? 3 : 4;
  const renderWidth = effectiveColsWidth;
  const displayWidth = width;

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
    rafSysRef.current = -1;
    if (root.current) root.current.scrollTop = 0;
  }, [piece.title, setFollow]);

  // Smoothly reveal active staff when `follow` is toggled back ON or layout shifts
  useLayoutEffect(() => {
    const el = root.current,
      row = el?.querySelector(`[data-sys-index="${current}"]`) ?? el?.children[current];
    if (!follow || !el || !row) return;
    handScrolling.current = false;
    smoothScrollRowIntoStand(el, row);
  }, [current, follow, systems, ready, full, timing]);

  // 60fps `requestAnimationFrame` + `livePlaybackClock()` conductor playhead, amber focus box & auto-scroll!
  useEffect(() => {
    if (hasExplicitTime || !ready) return;
    rafSysRef.current = -1;
    let raf = 0;
    const bs = beatSeconds(piece);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const ens = useEnsemble.getState();
      const clock = livePlaybackClock();
      const liveSec = clock.status === "playing" ? clock.timeSec : ens.time;
      const isLive =
        clock.status === "playing" ||
        clock.status === "buffering" ||
        (clock.status === "paused" && liveSec > 0.02);

      const liveBeat = Math.max(0, (liveSec - LEAD_IN) / Math.max(1e-6, bs));
      const barIdx = bars.findIndex((b) => liveBeat < b.end);
      const activeSys = isLive
        ? Math.max(0, Math.floor((barIdx < 0 ? bars.length - 1 : barIdx) / count))
        : 0;
      const isSounding =
        (clock.status === "playing" || clock.status === "buffering") && liveSec >= LEAD_IN - 0.02;

      for (const [idx, d] of drawingsRef.current.entries()) {
        if (idx === activeSys && isLive) {
          updateEngravedSystemAtBeat(d, liveBeat, isSounding);
        } else {
          updateEngravedSystemAtBeat(d, null, false);
        }
      }

      const el = root.current;
      if (el) {
        const prevSys = rafSysRef.current;
        if (activeSys !== prevSys) {
          if (prevSys >= 0) {
            el.querySelector(`[data-sys-index="${prevSys}"]`)?.removeAttribute("data-active-system");
          }
          if (isLive) {
            const activeRow = el.querySelector(`[data-sys-index="${activeSys}"]`);
            activeRow?.setAttribute("data-active-system", "true");
            if (follow && activeRow) {
              handScrolling.current = false;
              smoothScrollRowIntoStand(el, activeRow);
            }
          }
          rafSysRef.current = isLive ? activeSys : -1;
        }
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bars, count, follow, hasExplicitTime, piece, ready]);

  function chooseSystem(i: number) {
    const sys = systems[i];
    if (!sys) return;
    handScrolling.current = false;
    setBrowsing(i);
    const el = root.current,
      row = el?.querySelector(`[data-system="${sys.first}"]`);
    if (follow) {
      onSeek(LEAD_IN + sys.bars[0].start * beatSeconds(piece));
      if (el && row) smoothScrollRowIntoStand(el, row);
    } else if (el && row) {
      smoothScrollRowIntoStand(el, row);
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
  const isDark = inkTheme === "dark";
  const button = `inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer transition-colors ${
    isDark
      ? "border-[#3B362E] bg-[#1E1C19] text-[#F4EFE6] hover:border-[#D9A75C]"
      : "border-[#CBBFA8] bg-white text-[#2A2118] hover:border-[#D99B38]"
  }`;

  return (
    <section
      aria-label="Combined choir score"
      data-midi-file={piece.midiFile}
      data-playhead-beat={Math.max(0, beat).toFixed(4)}
      data-full-page={full || undefined}
      className="music-rack choir-score flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {!embedded && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2E2B26] bg-[#1D1B18] px-3 py-2 text-[#F4EFE6]">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[#F4EFE6]">{piece.title}</h2>
            <small className="text-xs text-[#B7AEA0]">
              {piece.key} {piece.mode} · {bars[Math.max(bar, 0)]?.signature ?? "4/4"} · {Number(piece.bpm.toFixed(2))} BPM
            </small>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {onLyrics && (
              <button type="button" className={button} onClick={onLyrics}>
                Lyrics
              </button>
            )}
            <button type="button" className={button} onClick={onPart}>
              Solo Part
            </button>
            <button type="button" className={button} onClick={() => setFull(!full)} aria-pressed={full}>
              {full ? "Close Full Page" : "Expand"}
            </button>
          </div>
        </header>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#141311] p-2">
        <div
          className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border shadow-inner ${
            isDark
              ? "border-[#2E2B26] bg-[#141311] text-[#EFE8DA]"
              : "border-[#DFD4BF] bg-[#FAF5E8] text-[#1E1914]"
          }`}
        >
          {piece.midiNotice && (
            <p role="status" className="m-0 bg-[#F5B851]/20 px-3 py-1.5 text-xs font-medium text-[#F5B851]">
              {piece.midiNotice}
            </p>
          )}
          {!embedded && (
            <div
              className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-xs ${
                isDark ? "border-[#2E2B26] bg-[#181614]" : "border-[#DFD4BF] bg-[#F2EBD9]"
              }`}
              aria-label="Singer colors"
            >
              {parts.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1.5 font-semibold">
                  <i style={{ background: p.color }} className="size-2.5 rounded-full" />
                  {p.name}
                </span>
              ))}
            </div>
          )}
          <div
            ref={root}
            aria-label="Entire choir score"
            tabIndex={0}
            className="relative min-h-[8rem] flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2.5 py-2"
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
              <p role="status" className="p-3 text-xs">
                Preparing the score…
              </p>
            )}
            {ready &&
              systems.map((s, i) => (
                <StaffSystem
                  key={s.first}
                  sysIndex={i}
                  piece={piece}
                  parts={parts}
                  events={events}
                  system={s}
                  renderWidth={renderWidth}
                  displayWidth={displayWidth}
                  inkTheme={inkTheme}
                  activeBeat={i === current ? Math.max(0, beat) : null}
                  sounding={sounding && beat >= 0 && i === current}
                  onAxis={onAxis}
                  onRegisterDrawing={onRegisterDrawing}
                />
              ))}
          </div>
          {timing && ready && systems[visible] && axes[systems[visible].first] && (
            <TimingLanes
              parts={parts}
              system={systems[visible]}
              axis={axes[systems[visible].first]}
              renderWidth={renderWidth}
              displayWidth={displayWidth}
              inkTheme={inkTheme}
              beat={Math.max(0, beat)}
              onPick={(part, index) => pick([{ part, index }])}
            />
          )}
          {note && part && ref && pickSet && (
            <div
              className={`flex shrink-0 flex-wrap items-center gap-2 border-t px-3 py-1.5 text-xs ${
                isDark ? "border-[#2E2B26] bg-[#181614]" : "border-[#DFD4BF] bg-[#F2EBD9]"
              }`}
            >
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
              <b className="text-[#D99B38]">{noteName(note.midi, piece.key, piece.mode)}</b>
              <span>
                MIDI {note.midi} · {Math.round(note.beats * PPQ)} ticks
              </span>
              <button
                type="button"
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
                <Music className="size-3.5" />
                Hear
              </button>
              {[-1, 1].map((delta) => (
                <button
                  key={delta}
                  type="button"
                  className={button}
                  aria-label={delta < 0 ? "Lower selected note" : "Raise selected note"}
                  onClick={() => {
                    useMoppet.getState().editNotePitch(part.id, ref.index, Math.max(0, Math.min(127, note.midi + delta)));
                    setSelection({ ...pickSet, piece: useMoppet.getState().piece });
                  }}
                >
                  {delta < 0 ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Warm Studio 404 Bar Jumper & Follow Footer */}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#2E2B26] bg-[#1B1916] px-3 py-1.5 text-[#F4EFE6]">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-[#3B362E] bg-[#121110] px-2 py-1 text-xs font-semibold text-[#F4EFE6] hover:border-[#D9A75C] disabled:opacity-45 cursor-pointer"
            disabled={visible <= 0}
            aria-label="Previous score row"
            onClick={() => chooseSystem(visible - 1)}
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <label className="inline-flex items-center gap-1.5 text-xs text-[#B7AEA0]">
            Bars
            <select
              aria-label="Go to score system"
              value={Math.max(0, visible)}
              onChange={(e) => chooseSystem(Number(e.target.value))}
              className="rounded-md border border-[#3B362E] bg-[#121110] px-2 py-0.5 text-xs font-semibold text-[#F4EFE6]"
            >
              {systems.map((sys, i) => (
                <option key={sys.first} value={i}>
                  {sys.first + 1}–{sys.first + sys.bars.length}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-[#3B362E] bg-[#121110] px-2 py-1 text-xs font-semibold text-[#F4EFE6] hover:border-[#D9A75C] disabled:opacity-45 cursor-pointer"
            disabled={visible >= systems.length - 1}
            aria-label="Next score row"
            onClick={() => chooseSystem(visible + 1)}
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {!embedded && (
            <button
              type="button"
              aria-pressed={follow}
              onClick={() => {
                handScrolling.current = false;
                setBrowsing(current);
                setFollow(!follow);
              }}
              className={`rounded-md border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                follow
                  ? "border-[#34D399] bg-[#152821] text-[#34D399]"
                  : "border-[#D9A75C] bg-[#261E12] text-[#F5B851]"
              }`}
            >
              {follow ? "Following" : "Follow Score"}
            </button>
          )}
          <button
            type="button"
            aria-pressed={timing}
            onClick={() => setTiming(!timing)}
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
              timing
                ? "border-[#D9A75C] bg-[#262016] text-[#F4EFE6]"
                : "border-[#3B362E] bg-[#121110] text-[#B7AEA0] hover:text-[#F4EFE6]"
            }`}
          >
            {timing ? "Hide Inline Ticks" : "Inline Ticks"}
          </button>
        </div>
      </footer>
    </section>
  );
}
