/**
 * Always-Visible Responsive Sheet Music Stand:
 * - Restores our approved Broadcast Conductor Desk manuscript styling (warm framed ivory page,
 *   rounded amber active-note highlight box, measure wash, chord labels, and gliding 60fps playhead).
 * - Preserves 100% of `ChoirScore`'s per-character color coding & grouped choir voice lanes.
 * - Live Auto-Follow (`Following` toggle, active by default) smoothly scrolls both `Grouped Choir`
 *   and `abcjs` `Lead / Staves` (and spoken skit scripts!) in real time as the song plays, pausing
 *   politely on manual wheel/touch scroll and jumping right back to the playhead on click.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import abcjs from "abcjs";
import { LocateFixed, Moon, Pencil, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAudio } from "../../audio/audio.ts";
import { livePlaybackClock, seek, useEnsemble } from "../../choir/ensemble.ts";
import { auditionNote } from "../../choir/live.ts";
import { measures } from "../../choir/meter.ts";
import { useMoppet } from "../../choir/store.ts";
import { beatSeconds, LEAD_IN } from "../../choir/timeline.ts";
import { ChoirScore, SpokenSkitScript } from "../ChoirScore.tsx";
import { buildPieceVoiceSpecs, pieceToAbc, type AbcVoiceSpec } from "./abcConverter.ts";

const RehearsalStaffPanel = lazy(() =>
  import("../StaffEditor.tsx").then((m) => ({ default: m.RehearsalStaffPanel })),
);

interface TimedSvgNote {
  readonly startSec: number;
  readonly endSec: number;
  readonly midi: number;
  readonly beat: number;
  readonly elements: SVGElement[];
}

function colorizeAbcVoices(
  paper: HTMLElement,
  specs: readonly AbcVoiceSpec[],
  isPaper: boolean,
): void {
  const multi = specs.length > 1;
  specs.forEach((sp, idx) => {
    const color = isPaper ? sp.paperColor : sp.darkColor;
    const selector = multi ? `.abcjs-v${idx}` : ".abcjs-note, .abcjs-beam, .abcjs-slur, .abcjs-lyric";
    paper.querySelectorAll<SVGElement>(selector).forEach((el) => {
      if (
        el.classList.contains("abcjs-staff") ||
        el.classList.contains("abcjs-bar") ||
        el.classList.contains("abcjs-clef") ||
        el.classList.contains("abcjs-key-signature") ||
        el.classList.contains("abcjs-time-signature")
      ) {
        return;
      }
      if (el.classList.contains("abcjs-lyric") || el.classList.contains("abcjs-voice-name")) {
        el.style.fill = color;
        return;
      }
      el.querySelectorAll<SVGElement>("path, ellipse, circle, rect, polygon, text").forEach((child) => {
        const stroke = child.getAttribute("stroke");
        const fill = child.getAttribute("fill");
        if (fill !== "none") child.style.fill = color;
        if (stroke && stroke !== "none") child.style.stroke = color;
      });
      if (el.tagName === "path" || el.tagName === "text") {
        const stroke = el.getAttribute("stroke");
        const fill = el.getAttribute("fill");
        if (fill !== "none") el.style.fill = color;
        if (stroke && stroke !== "none") el.style.stroke = color;
      }
    });
  });
}

export function ResponsiveSheetMusic() {
  const piece = useMoppet((s) => s.piece);
  const voices = useMoppet((s) => s.voices);
  const selected = useMoppet((s) => s.selected);
  const select = useMoppet((s) => s.select);
  const studio404 = useMoppet((s) => s.studio404);
  const ensembleStatus = useEnsemble((s) => s.status);

  const [visibleVoiceIds, setVisibleVoiceIds] = useState<string[] | "all">("all");
  const [scoreLayout, setScoreLayout] = useState<"abc-parts" | "grouped-choir">("grouped-choir");
  const [surface, setSurface] = useState<"paper" | "dark">("paper");
  const [zoom, setZoom] = useState<100 | 125>(100);
  const [follow, setFollow] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [containerWidth, setContainerWidth] = useState(720);

  const hostRef = useRef<HTMLDivElement>(null);
  const abcScrollRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const abcCursorRef = useRef<HTMLDivElement>(null);
  const abcFocusBoxRef = useRef<HTMLDivElement>(null);
  const timedNotesRef = useRef<TimedSvgNote[]>([]);
  const activeElsRef = useRef<SVGElement[]>([]);
  const activeBarRef = useRef<number>(-1);
  const lastScrolledBandRef = useRef<number>(-1);

  const allVoiceSpecs = useMemo(
    () => buildPieceVoiceSpecs(piece, voices, studio404),
    [piece, voices, studio404],
  );

  // Group voices cleanly (Round Groups 1..3, or Lead / Treble / Bass)
  const groupedVoices = useMemo(() => {
    const groups = new Map<string, AbcVoiceSpec[]>();
    for (const sp of allVoiceSpecs) {
      const list = groups.get(sp.group) ?? [];
      list.push(sp);
      groups.set(sp.group, list);
    }
    return [...groups.entries()];
  }, [allVoiceSpecs]);

  // Reset filter & re-engage Follow when switching songs or starting playback
  useEffect(() => {
    setVisibleVoiceIds("all");
    setFollow(true);
    lastScrolledBandRef.current = -1;
  }, [piece.title]);

  useEffect(() => {
    if (ensembleStatus === "playing" || ensembleStatus === "buffering") {
      setFollow(true);
    }
  }, [ensembleStatus]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? el.clientWidth);
      if (w < 160) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setContainerWidth((prev) => (Math.abs(prev - w) >= 14 ? w : prev));
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const abcData = useMemo(() => {
    if (piece.kind === "skit") return null;
    return pieceToAbc(piece, voices, studio404, { trackIds: visibleVoiceIds });
  }, [piece, voices, studio404, visibleVoiceIds]);

  const isPaper = surface === "paper";

  useEffect(() => {
    const paper = paperRef.current;
    if (!paper || !abcData || piece.kind === "skit" || scoreLayout !== "abc-parts") return;

    paper.replaceChildren();
    activeElsRef.current = [];
    activeBarRef.current = -1;
    lastScrolledBandRef.current = -1;
    timedNotesRef.current = [];

    const effectiveWidth = Math.round(containerWidth / (zoom / 100));
    const preferredMeasuresPerLine =
      effectiveWidth < 560 ? 2 : effectiveWidth < 960 ? 3 : 4;
    const staffwidth = Math.max(240, effectiveWidth - 36);
    const ink = isPaper ? "#1E1914" : "#F0E9DC";

    const clickMap = new Map<SVGElement, { beat: number; midi: number }>();

    const tunes = abcjs.renderAbc(paper, abcData.abc, {
      responsive: "resize",
      staffwidth,
      wrap: {
        minSpacing: 1.8,
        maxSpacing: 2.7,
        preferredMeasuresPerLine,
      },
      add_classes: true,
      paddingtop: 12,
      paddingbottom: 18,
      paddingleft: 12,
      paddingright: 12,
      foregroundColor: ink,
      selectionColor: "#D99B38",
      clickListener: (abcElem) => {
        const firstSvg = abcElem.abselem?.elemset?.[0];
        const hit = firstSvg ? clickMap.get(firstSvg) : undefined;
        if (!hit) return;
        const bs = beatSeconds(piece);
        seek(LEAD_IN + hit.beat * bs);
        void useAudio.getState().start();
        const voice = voices[selected] ?? voices[0];
        if (voice && hit.midi > 0) void auditionNote(voice, hit.midi, "ah", 320);
      },
    });

    // Apply per-character voice colors onto SVG noteheads, stems, beams, ties, lyrics & labels
    colorizeAbcVoices(paper, abcData.voiceSpecs, isPaper);

    const tune = tunes[0];
    if (!tune) return;

    const bs = beatSeconds(piece);
    const timed: TimedSvgNote[] = [];
    try {
      const events = tune.setupEvents(0, 1, Math.max(30, piece.bpm));
      for (const ev of events) {
        if (ev.type !== "event" || !ev.elements?.length) continue;
        const beat = ev.milliseconds / 1000 / Math.max(1e-6, bs);
        const startSec = LEAD_IN + ev.milliseconds / 1000;
        const midi = ev.midiPitches?.[0]?.pitch ?? 60;
        const els: SVGElement[] = [];
        for (const group of ev.elements) {
          for (const el of group) {
            if (el instanceof SVGElement) {
              els.push(el);
              clickMap.set(el, { beat, midi });
            }
          }
        }
        if (els.length > 0) {
          timed.push({ startSec, endSec: startSec + bs * 0.9, midi, beat, elements: els });
        }
      }
      for (let i = 0; i < timed.length - 1; i++) {
        const nextStart = timed[i + 1].startSec;
        if (nextStart > timed[i].startSec) timed[i] = { ...timed[i], endSec: nextStart };
      }
    } catch {
      // Measure highlight remains active below
    }
    timedNotesRef.current = timed;
  }, [abcData, containerWidth, isPaper, piece, voices, selected, scoreLayout, zoom]);

  // 60fps Live Playhead + Amber Focus Box + Auto-Scroll in `abcjs` (`Lead / Staves`) mode
  useEffect(() => {
    if (piece.kind === "skit" || scoreLayout !== "abc-parts") return;
    let raf = 0;
    const bars = measures(piece);
    const bs = beatSeconds(piece);

    const clearHighlights = () => {
      for (const el of activeElsRef.current) el.classList.remove("studio-abc-active");
      activeElsRef.current = [];
      if (activeBarRef.current >= 0 && paperRef.current) {
        paperRef.current
          .querySelectorAll(`.abcjs-m${activeBarRef.current}`)
          .forEach((n) => n.classList.remove("studio-abc-bar-active"));
        activeBarRef.current = -1;
      }
      if (abcCursorRef.current) abcCursorRef.current.style.display = "none";
      if (abcFocusBoxRef.current) abcFocusBoxRef.current.style.display = "none";
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const paper = paperRef.current;
      const scroller = abcScrollRef.current;
      if (!paper || !scroller) return;
      const e = useEnsemble.getState();
      const clock = livePlaybackClock();
      const t = clock.status === "playing" ? clock.timeSec : e.time;
      const playing =
        clock.status === "playing" ||
        clock.status === "buffering" ||
        (clock.status === "paused" && t > 0.01);

      if (!playing) {
        if (activeElsRef.current.length || activeBarRef.current >= 0) clearHighlights();
        return;
      }

      const beat = Math.max(0, (t - LEAD_IN) / bs);
      const barIdx = bars.findIndex((b) => beat >= b.start && beat < b.end);

      if (barIdx !== activeBarRef.current) {
        if (activeBarRef.current >= 0) {
          paper
            .querySelectorAll(`.abcjs-m${activeBarRef.current}`)
            .forEach((n) => n.classList.remove("studio-abc-bar-active"));
        }
        if (barIdx >= 0) {
          paper
            .querySelectorAll(`.abcjs-m${barIdx}`)
            .forEach((n) => n.classList.add("studio-abc-bar-active"));
        }
        activeBarRef.current = barIdx;
      }

      const timed = timedNotesRef.current;
      let activeItemIdx = -1;
      const nextActive: SVGElement[] = [];
      for (let i = 0; i < timed.length; i++) {
        const item = timed[i]!;
        if (t >= item.startSec - 0.03 && t < item.endSec) {
          if (activeItemIdx < 0) activeItemIdx = i;
          nextActive.push(...item.elements);
        }
      }

      for (const prev of activeElsRef.current) {
        if (!nextActive.includes(prev)) prev.classList.remove("studio-abc-active");
      }
      for (const cur of nextActive) {
        if (!cur.classList.contains("studio-abc-active")) cur.classList.add("studio-abc-active");
      }
      activeElsRef.current = nextActive;

      // Position rounded Amber Focus Box & Gliding Playhead Cursor relative to paperRef
      const firstEl = nextActive[0] ?? (barIdx >= 0 ? paper.querySelector<SVGElement>(`.abcjs-m${barIdx}`) : null);
      if (firstEl) {
        const paperRect = paper.getBoundingClientRect();
        const elRect = firstEl.getBoundingClientRect();
        if (elRect.width > 0 && elRect.height > 0) {
          const relX = elRect.left - paperRect.left;
          const relY = elRect.top - paperRect.top;

          if (abcFocusBoxRef.current && nextActive.length > 0) {
            const padX = 7;
            const padY = 6;
            abcFocusBoxRef.current.style.transform = `translate3d(${(relX - padX).toFixed(1)}px, ${(relY - padY).toFixed(1)}px, 0)`;
            abcFocusBoxRef.current.style.width = `${Math.max(22, elRect.width + padX * 2).toFixed(1)}px`;
            abcFocusBoxRef.current.style.height = `${Math.max(26, elRect.height + padY * 2).toFixed(1)}px`;
            abcFocusBoxRef.current.style.display = "block";
          } else if (abcFocusBoxRef.current) {
            abcFocusBoxRef.current.style.display = "none";
          }

          if (abcCursorRef.current) {
            let cursorX = relX + elRect.width * 0.4;
            if (activeItemIdx >= 0) {
              const curItem = timed[activeItemIdx]!;
              const nextItem = timed[activeItemIdx + 1];
              const nextEl = nextItem?.elements[0];
              if (nextItem && nextEl) {
                const nextRect = nextEl.getBoundingClientRect();
                // Smoothly glide X across same staff row
                if (Math.abs(nextRect.top - elRect.top) < 42 && nextRect.left > elRect.left) {
                  const frac = Math.max(
                    0,
                    Math.min(1, (t - curItem.startSec) / Math.max(0.05, curItem.endSec - curItem.startSec)),
                  );
                  cursorX = relX + frac * (nextRect.left - elRect.left);
                }
              }
            }
            abcCursorRef.current.style.transform = `translate3d(${cursorX.toFixed(1)}px, ${(relY - 10).toFixed(1)}px, 0)`;
            abcCursorRef.current.style.height = `${Math.max(54, elRect.height + 24).toFixed(1)}px`;
            abcCursorRef.current.style.display = "block";
          }

          // Smooth auto-scroll when active staff line moves down the manuscript
          if (follow) {
            const band = Math.floor(relY / 85);
            const scrollerRect = scroller.getBoundingClientRect();
            const topInScroller = elRect.top - scrollerRect.top;
            const botInScroller = elRect.bottom - scrollerRect.bottom;
            if (
              band !== lastScrolledBandRef.current &&
              (topInScroller < 16 || botInScroller > -24 || topInScroller > scrollerRect.height * 0.48)
            ) {
              lastScrolledBandRef.current = band;
              const targetTop = Math.max(0, scroller.scrollTop + topInScroller - 36);
              scroller.scrollTo({ top: targetTop, behavior: "smooth" });
            }
          }
        }
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearHighlights();
    };
  }, [follow, piece, scoreLayout]);

  const toggleVoicePill = (voiceId: string) => {
    const idx = voices.findIndex((v) => v.id === voiceId);
    if (idx >= 0) select(idx);
    if (visibleVoiceIds === "all") {
      setVisibleVoiceIds([voiceId]);
      return;
    }
    if (visibleVoiceIds.length === 1 && visibleVoiceIds[0] === voiceId) {
      setVisibleVoiceIds("all");
      return;
    }
    setVisibleVoiceIds([voiceId]);
  };

  const toggleGroupPill = (groupSpecs: readonly AbcVoiceSpec[]) => {
    const ids = groupSpecs.map((s) => s.id);
    if (
      Array.isArray(visibleVoiceIds) &&
      visibleVoiceIds.length === ids.length &&
      ids.every((id) => visibleVoiceIds.includes(id))
    ) {
      setVisibleVoiceIds("all");
    } else {
      setVisibleVoiceIds(ids);
    }
  };

  const meterLabel = piece.meter?.trim() || "4/4";

  return (
    <section
      ref={hostRef}
      aria-label="Sheet music stand"
      data-testid="responsive-sheet-music"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#34302A] bg-[#161513] shadow-lg"
    >
      {/* Conductor's Stand Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-[#2E2B26] bg-[#1D1B18] px-3 py-1.5">
        <div className="min-w-0 flex flex-col">
          <h2 className="truncate text-sm font-bold leading-tight text-[#F4EFE6]">{piece.title}</h2>
          <span className="truncate text-[11px] tabular-nums text-[#B7AEA0]">
            {piece.kind === "skit"
              ? `Stage Play Script · ${piece.scenes?.length ?? 1} scenes`
              : `${piece.key} ${piece.mode} · ${meterLabel} · ${piece.bpm} BPM`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {/* Live Auto-Follow Toggle ("Following Along") */}
          <button
            type="button"
            data-testid="score-follow-toggle"
            aria-pressed={follow}
            onClick={() => {
              lastScrolledBandRef.current = -1;
              setFollow((v) => !v);
            }}
            title={
              follow
                ? "Auto-following the live playhead (scroll manually anytime to read ahead)"
                : "Click to snap back and follow the live playhead"
            }
            className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-xs font-semibold cursor-pointer transition-colors ${
              follow
                ? "border-[#34D399]/80 bg-[#152821] text-[#34D399] shadow-[0_0_10px_rgba(52,211,153,0.16)]"
                : "border-[#D9A75C] bg-[#282015] text-[#F5B851] hover:bg-[#33281A]"
            }`}
          >
            <LocateFixed className="size-3.5" />
            {follow ? "Following" : "Follow"}
          </button>

          {piece.kind !== "skit" && (
            <ToggleGroup
              type="single"
              value={scoreLayout}
              onValueChange={(val) => {
                if (val === "grouped-choir" || val === "abc-parts") setScoreLayout(val);
              }}
              size="sm"
              aria-label="Score notation mode"
              className="rounded-lg border border-[#3B362E] bg-[#121110] p-0.5"
            >
              <ToggleGroupItem
                value="grouped-choir"
                aria-label="Grouped choir staff with color-coded voices"
                className="h-6 px-2 text-xs font-semibold text-[#B7AEA0] data-[state=on]:bg-[#2A2621] data-[state=on]:text-[#F4EFE6]"
              >
                Choir
              </ToggleGroupItem>
              <ToggleGroupItem
                value="abc-parts"
                aria-label="Separate engraved part staves (abcjs)"
                className="h-6 px-2 text-xs font-semibold text-[#B7AEA0] data-[state=on]:bg-[#2A2621] data-[state=on]:text-[#F4EFE6]"
              >
                Staves
              </ToggleGroupItem>
            </ToggleGroup>
          )}

          {/* Zoom 100% / 125% */}
          <ToggleGroup
            type="single"
            value={String(zoom)}
            onValueChange={(val) => {
              if (val === "100" || val === "125") setZoom(Number(val) as 100 | 125);
            }}
            size="sm"
            aria-label="Score zoom"
            className="rounded-lg border border-[#3B362E] bg-[#121110] p-0.5"
          >
            <ToggleGroupItem
              value="100"
              className="h-6 px-1.5 text-xs font-semibold text-[#B7AEA0] data-[state=on]:bg-[#2A2621] data-[state=on]:text-[#F4EFE6]"
            >
              100%
            </ToggleGroupItem>
            <ToggleGroupItem
              value="125"
              className="h-6 px-1.5 text-xs font-semibold text-[#B7AEA0] data-[state=on]:bg-[#2A2621] data-[state=on]:text-[#F4EFE6]"
            >
              125%
            </ToggleGroupItem>
          </ToggleGroup>

          <ToggleGroup
            type="single"
            value={surface}
            onValueChange={(val) => {
              if (val === "paper" || val === "dark") setSurface(val);
            }}
            size="sm"
            aria-label="Sheet music surface"
            className="rounded-lg border border-[#3B362E] bg-[#121110] p-0.5"
          >
            <ToggleGroupItem
              value="paper"
              aria-label="Paper sheet music"
              style={
                surface === "paper"
                  ? { backgroundColor: "#D9A75C", color: "#18130D" }
                  : { color: "#B7AEA0" }
              }
              className="h-6 gap-1 px-2 text-xs font-semibold"
            >
              <Sun className="size-3" />
              Paper
            </ToggleGroupItem>
            <ToggleGroupItem
              value="dark"
              aria-label="Dark ink sheet music"
              style={
                surface === "dark"
                  ? { backgroundColor: "#2E2A23", color: "#F4EFE6" }
                  : { color: "#B7AEA0" }
              }
              className="h-6 gap-1 px-2 text-xs font-semibold"
            >
              <Moon className="size-3" />
              Dark
            </ToggleGroupItem>
          </ToggleGroup>

          {piece.kind !== "skit" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
              className="h-7 border-[#3B362E] bg-[#121110] px-2 text-xs font-semibold text-[#F4EFE6] hover:border-[#D9A75C] hover:bg-[#23201B] hover:text-[#F4EFE6]"
            >
              <Pencil data-icon="inline-start" />
              Edit
            </Button>
          )}
        </div>
      </div>

      {/* Color-Coded Voice Grouping Bar (preserved & synced across both modes) */}
      {piece.kind !== "skit" && allVoiceSpecs.length > 0 && (
        <div
          aria-label="Singer colors and voice groups"
          className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-1.5 text-xs ${
            isPaper
              ? "border-[#DFD4BF] bg-[#F2EBD9] text-[#2A2118]"
              : "border-[#2E2B26] bg-[#191714] text-[#EFE8DA]"
          }`}
        >
          {allVoiceSpecs.length > 1 && (
            <button
              type="button"
              aria-pressed={visibleVoiceIds === "all"}
              onClick={() => setVisibleVoiceIds("all")}
              style={
                visibleVoiceIds === "all"
                  ? isPaper
                    ? { backgroundColor: "#2A2118", color: "#FAF5E8", borderColor: "#2A2118" }
                    : { backgroundColor: "#2A2621", color: "#F4EFE6", borderColor: "#D9A75C" }
                  : isPaper
                    ? { backgroundColor: "rgba(255,255,255,0.8)", color: "#3A2E22", borderColor: "#CBBFA8" }
                    : { backgroundColor: "#121110", color: "#B7AEA0", borderColor: "#3B362E" }
              }
              className="rounded-md border px-2.5 py-0.5 text-xs font-semibold cursor-pointer"
            >
              All Voices ({allVoiceSpecs.length})
            </button>
          )}

          {groupedVoices.map(([groupName, groupSpecs]) => (
            <div key={groupName} className="flex flex-wrap items-center gap-1.5">
              {groupedVoices.length > 1 && (
                <button
                  type="button"
                  onClick={() => toggleGroupPill(groupSpecs)}
                  title={`Focus ${groupName} group`}
                  className={`text-xs font-semibold cursor-pointer hover:underline ${
                    isPaper ? "text-[#6E5A44]" : "text-[#A79E90]"
                  }`}
                >
                  {groupName}:
                </button>
              )}
              {groupSpecs.map((sp) => {
                const color = isPaper ? sp.paperColor : sp.darkColor;
                const active =
                  visibleVoiceIds === "all" || visibleVoiceIds.includes(sp.id);
                const isolated =
                  Array.isArray(visibleVoiceIds) &&
                  visibleVoiceIds.length === 1 &&
                  visibleVoiceIds[0] === sp.id;
                return (
                  <button
                    key={sp.id}
                    type="button"
                    aria-pressed={isolated}
                    onClick={() => toggleVoicePill(sp.id)}
                    title={isolated ? "Click to show all voices" : `Focus ${sp.name}'s staff`}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold cursor-pointer transition-opacity ${
                      isolated
                        ? isPaper
                          ? "border-[#2A2118] bg-white shadow-2xs"
                          : "border-[#D9A75C] bg-[#26221B]"
                        : isPaper
                          ? "border-transparent bg-white/60 hover:bg-white"
                          : "border-transparent bg-[#1E1C19] hover:border-[#3B362E]"
                    } ${active ? "opacity-100" : "opacity-45"}`}
                  >
                    <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span style={{ color: isolated || active ? color : undefined }}>{sp.name}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Engraved Color-Coded Sheet Music (Grouped Choir OR abcjs Lead/Staves) OR Spoken Skit Script */}
      {piece.kind === "skit" ? (
        <div className="min-h-0 flex-1 overflow-hidden bg-[#141311] p-2">
          <SpokenSkitScript
            piece={piece}
            inkTheme={surface}
            zoom={zoom}
            follow={follow}
            onFollowChange={setFollow}
          />
        </div>
      ) : scoreLayout === "grouped-choir" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ChoirScore
            embedded
            inkTheme={surface}
            zoom={zoom}
            visibleVoiceIds={visibleVoiceIds}
            follow={follow}
            onFollowChange={setFollow}
            onPart={() => setScoreLayout("abc-parts")}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#141311] p-2">
          <div
            ref={abcScrollRef}
            onWheel={() => setFollow(false)}
            onTouchMove={() => setFollow(false)}
            className={`studio-abc-stand flex-1 overflow-y-auto overflow-x-hidden rounded-xl border px-3 py-2 shadow-inner ${
              isPaper
                ? "border-[#DFD4BF] bg-[#FAF5E8] text-[#1E1914]"
                : "border-[#2E2B26] bg-[#141311] text-[#EFE8DA]"
            }`}
            data-surface={surface}
          >
            <div className="relative w-full">
              {/* Rounded Amber Conductor Note-Focus Frame */}
              <div
                ref={abcFocusBoxRef}
                style={{ display: "none", willChange: "transform" }}
                className="pointer-events-none absolute top-0 left-0 z-10 rounded-lg border-2 border-[#D99B38] bg-[#F5B851]/20 shadow-[0_0_12px_rgba(245,184,81,0.22)]"
              />
              {/* Gliding Playhead Line */}
              <div
                ref={abcCursorRef}
                style={{ display: "none", willChange: "transform" }}
                className={`pointer-events-none absolute top-0 left-0 z-10 w-[2px] ${
                  isPaper ? "bg-[#0D9488]" : "bg-[#34D399]"
                }`}
              >
                <span className="absolute -top-1 -left-[3.5px] size-2 rotate-45 bg-[#D99B38]" />
              </div>
              <div ref={paperRef} className="w-full" />
            </div>
          </div>
        </div>
      )}

      {/* Optional Note & Lyric Editor Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-4xl border-[#3B362E] bg-[#161513] text-[#F4EFE6] sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="text-[#F4EFE6]">Edit Notes &amp; Lyrics · {piece.title}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[75vh] overflow-y-auto">
            <Suspense fallback={<p className="p-4 text-xs text-[#B7AEA0]">Loading staff editor…</p>}>
              <RehearsalStaffPanel inkTheme={surface} zoom={zoom} />
            </Suspense>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
