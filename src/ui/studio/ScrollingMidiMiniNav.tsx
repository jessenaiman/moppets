/**
 * Scrolling Multi-Voice MIDI Mini-Navigator mounted beneath `VintageControlStrip`.
 *
 * - Smooth 60fps horizontal MIDI scrolling (`requestAnimationFrame` + `livePlaybackClock()`)
 *   with ZERO React re-renders during playback.
 * - Preserves exact per-character voice colors (`buildPieceVoiceSpecs`) matching Sheet Music.
 * - Includes both a zoomed Scrolling MIDI Tape (readable pitched bars gliding across the playhead)
 *   and a Full-Song Minimap Scrubber lens for instant one-click / drag navigation anywhere in the song.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Compass } from "lucide-react";
import { useAudio } from "../../audio/audio.ts";
import { livePlaybackClock, play, seek, useEnsemble } from "../../choir/ensemble.ts";
import { auditionNote } from "../../choir/live.ts";
import { measures } from "../../choir/meter.ts";
import { noteName } from "../../choir/music.ts";
import { useMoppet } from "../../choir/store.ts";
import { beatSeconds, LEAD_IN, pieceSeconds } from "../../choir/timeline.ts";
import { buildPieceVoiceSpecs } from "./abcConverter.ts";

interface MidiNavBar {
  readonly index: number;
  readonly startSec: number;
  readonly endSec: number;
}

interface MidiNavNote {
  readonly key: string;
  readonly voiceId: string;
  readonly voiceName: string;
  readonly color: string;
  readonly midi: number;
  readonly startSec: number;
  readonly durSec: number;
  readonly endSec: number;
  readonly yPct: number;
  readonly label: string;
}

const fmtClock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function ScrollingMidiMiniNav() {
  const piece = useMoppet((s) => s.piece);
  const voices = useMoppet((s) => s.voices);
  const studio404 = useMoppet((s) => s.studio404);
  const select = useMoppet((s) => s.select);
  const loopRange = useEnsemble((s) => s.loopRange);
  const status = useEnsemble((s) => s.status);
  const startAudio = useAudio((s) => s.start);

  const [mode, setMode] = useState<"scroll" | "full">("scroll");

  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const miniLensRef = useRef<HTMLDivElement>(null);
  const miniPlayheadRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const noteElsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const activeNoteKeysRef = useRef<string[]>([]);

  const totalSec = Math.max(1, pieceSeconds(piece));
  const bs = beatSeconds(piece);

  const voiceSpecs = useMemo(
    () => buildPieceVoiceSpecs(piece, voices, studio404),
    [piece, voices, studio404],
  );

  const bars = useMemo<MidiNavBar[]>(() => {
    const raw = measures(piece);
    return raw.map((m, idx) => ({
      index: idx + 1,
      startSec: LEAD_IN + m.start * bs,
      endSec: LEAD_IN + m.end * bs,
    }));
  }, [piece, bs]);

  const notes = useMemo<MidiNavNote[]>(() => {
    const specById = new Map(voiceSpecs.map((s) => [s.id, s]));
    const allEvents = piece.tracks.flatMap((t) =>
      t.events.map((ev, idx) => ({ trackId: t.id, ev, idx })),
    );
    if (allEvents.length === 0) return [];

    const midis = allEvents.map((x) => x.ev.midi);
    const minMidi = Math.min(...midis) - 2;
    const maxMidi = Math.max(...midis) + 2;
    const span = Math.max(8, maxMidi - minMidi);

    return allEvents.map(({ trackId, ev, idx }) => {
      const sp = specById.get(trackId);
      const color = sp?.darkColor ?? "#34D399";
      const voiceName = sp?.name ?? trackId;
      const startSec = LEAD_IN + ev.beat * bs;
      const durSec = Math.max(0.08, ev.beats * bs);
      const endSec = startSec + durSec;
      const yPct = 10 + ((maxMidi - ev.midi) / span) * 76;
      const lyricBit = ev.text?.trim() ? ` "${ev.text.trim()}"` : "";
      return {
        key: `${trackId}-${idx}`,
        voiceId: trackId,
        voiceName,
        color,
        midi: ev.midi,
        startSec,
        durSec,
        endSec,
        yPct,
        label: `${voiceName} · ${noteName(ev.midi, piece.key, piece.mode)}${lyricBit}`,
      };
    });
  }, [piece, voiceSpecs, bs]);

  // In "scroll" mode, ~14 seconds (~6-7 bars at 110 BPM) fills 100% of the viewport width,
  // giving wide, legible MIDI bars that smoothly glide past the playhead!
  const windowSec = useMemo(() => Math.min(totalSec, Math.max(8, bs * 24)), [totalSec, bs]);
  const worldScale = mode === "scroll" ? Math.max(1, totalSec / windowSec) : 1;

  const seekAndCue = (targetSec: number) => {
    const clamped = Math.max(0, Math.min(totalSec, targetSec));
    seek(clamped);
  };

  useEffect(() => {
    noteElsRef.current.clear();
    activeNoteKeysRef.current = [];
  }, [piece, mode]);

  // 60fps GPU-accelerated horizontal scroll + playhead + sounding note glow (zero React re-renders)
  useEffect(() => {
    let raf = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const vp = viewportRef.current;
      const world = worldRef.current;
      const ph = playheadRef.current;
      if (!vp || !world || !ph) return;

      const ens = useEnsemble.getState();
      const clock = livePlaybackClock();
      const t = Math.max(
        0,
        Math.min(totalSec, clock.status === "playing" ? clock.timeSec : ens.time),
      );
      const isSounding =
        clock.status === "playing" ||
        clock.status === "buffering" ||
        (clock.status === "paused" && t > LEAD_IN);

      const vpWidth = Math.max(1, vp.clientWidth);
      const worldWidthPx = vpWidth * worldScale;

      if (mode === "scroll" && worldScale > 1.001) {
        // Keep the playhead anchored ~28% from the left edge, clamped cleanly at start & end
        const playheadWorldX = (t / totalSec) * worldWidthPx;
        const anchorX = vpWidth * 0.28;
        const maxScroll = Math.max(0, worldWidthPx - vpWidth);
        const scrollX = Math.max(0, Math.min(maxScroll, playheadWorldX - anchorX));
        const playheadScreenX = playheadWorldX - scrollX;

        world.style.transform = `translate3d(${-scrollX.toFixed(2)}px, 0, 0)`;
        ph.style.transform = `translate3d(${playheadScreenX.toFixed(2)}px, 0, 0)`;

        if (miniLensRef.current) {
          const lensLeftPct = (scrollX / worldWidthPx) * 100;
          const lensWidthPct = (vpWidth / worldWidthPx) * 100;
          miniLensRef.current.style.left = `${lensLeftPct.toFixed(2)}%`;
          miniLensRef.current.style.width = `${Math.min(100, lensWidthPct).toFixed(2)}%`;
          miniLensRef.current.style.display = "block";
        }
      } else {
        const playheadScreenX = (t / totalSec) * vpWidth;
        world.style.transform = "translate3d(0px, 0, 0)";
        ph.style.transform = `translate3d(${playheadScreenX.toFixed(2)}px, 0, 0)`;
        if (miniLensRef.current) {
          miniLensRef.current.style.left = "0%";
          miniLensRef.current.style.width = "100%";
          miniLensRef.current.style.display = "none";
        }
      }

      if (miniPlayheadRef.current) {
        miniPlayheadRef.current.style.left = `${((t / totalSec) * 100).toFixed(2)}%`;
      }

      // Update Bar + Time readout without triggering React state
      if (readoutRef.current) {
        let curBar = 1;
        for (let i = 0; i < bars.length; i++) {
          if (t >= bars[i]!.startSec - 0.02) curBar = bars[i]!.index;
          else break;
        }
        readoutRef.current.textContent = `Bar ${curBar}/${Math.max(1, bars.length)} · ${fmtClock(t)}`;
      }

      // Highlight currently sounding MIDI notes
      const nextActive: string[] = [];
      if (isSounding) {
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i]!;
          if (t >= n.startSec - 0.02 && t < n.endSec) {
            nextActive.push(n.key);
          }
        }
      }

      const prevActive = activeNoteKeysRef.current;
      if (
        prevActive.length !== nextActive.length ||
        prevActive.some((k, idx) => k !== nextActive[idx])
      ) {
        for (const oldKey of prevActive) {
          if (!nextActive.includes(oldKey)) {
            const el = noteElsRef.current.get(oldKey);
            if (el) el.removeAttribute("data-sounding");
          }
        }
        for (const curKey of nextActive) {
          const el = noteElsRef.current.get(curKey);
          if (el) el.setAttribute("data-sounding", "true");
        }
        activeNoteKeysRef.current = nextActive;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bars, mode, notes, totalSec, worldScale]);

  const scrubFromRollEvent = (clientX: number) => {
    const vp = viewportRef.current;
    const world = worldRef.current;
    if (!vp || !world) return;
    const vpRect = vp.getBoundingClientRect();
    const worldRect = world.getBoundingClientRect();
    const xInWorld = clientX - worldRect.left;
    const worldWidth = Math.max(1, vpRect.width * worldScale);
    const ratio = Math.max(0, Math.min(1, xInWorld / worldWidth));
    seekAndCue(ratio * totalSec);
  };

  const scrubFromMinimapEvent = (clientX: number) => {
    const mm = minimapRef.current;
    if (!mm) return;
    const rect = mm.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    seekAndCue(ratio * totalSec);
  };

  const loopLeftPct = loopRange ? Math.max(0, (loopRange.startSec / totalSec) * 100) : 0;
  const loopWidthPct = loopRange
    ? Math.max(
        0,
        Math.min(100 - loopLeftPct, ((loopRange.endSec - loopRange.startSec) / totalSec) * 100),
      )
    : 0;
  const barStride = mode === "full" && bars.length > 24 ? 4 : mode === "full" && bars.length > 12 ? 2 : 1;

  return (
    <section
      aria-label="Scrolling MIDI mini-navigator"
      data-testid="scrolling-midi-mini-nav"
      className="flex flex-col gap-1.5 rounded-xl border border-[#34302A] bg-[#181614] p-2.5 shadow-md"
    >
      {/* Slim Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase text-[#D9A75C]">
            <Compass className="size-3.5 text-[#34D399]" />
            MIDI Navigator
          </span>
          <span
            ref={readoutRef}
            className="rounded border border-[#2E2A23] bg-[#100F0D] px-1.5 py-0.5 font-mono text-xs tabular-nums text-[#E8DFCE]"
          >
            Bar 1/{Math.max(1, bars.length)} · 00:00
          </span>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-[#34302A] bg-[#11100E] p-0.5">
          <button
            type="button"
            aria-pressed={mode === "scroll"}
            onClick={() => setMode("scroll")}
            className={`rounded px-2 py-0.5 text-xs font-semibold cursor-pointer transition-colors ${
              mode === "scroll"
                ? "bg-[#2B261F] text-[#F4EFE6] shadow-2xs"
                : "text-[#A79E90] hover:text-[#F4EFE6]"
            }`}
          >
            Scrolling
          </button>
          <button
            type="button"
            aria-pressed={mode === "full"}
            onClick={() => setMode("full")}
            className={`rounded px-2 py-0.5 text-xs font-semibold cursor-pointer transition-colors ${
              mode === "full"
                ? "bg-[#2B261F] text-[#F4EFE6] shadow-2xs"
                : "text-[#A79E90] hover:text-[#F4EFE6]"
            }`}
          >
            Full Map
          </button>
        </div>
      </div>

      {/* Horizontally Scrolling Multi-Voice Pitched MIDI Tape */}
      <div
        ref={viewportRef}
        role="slider"
        tabIndex={0}
        aria-label="Scrolling MIDI music timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalSec)}
        aria-valuenow={Math.round(useEnsemble.getState().time)}
        onKeyDown={(e) => {
          const cur = useEnsemble.getState().time;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            seekAndCue(cur - bs * 2);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            seekAndCue(cur + bs * 2);
          } else if (e.key === "Home") {
            e.preventDefault();
            seekAndCue(0);
          } else if (e.key === "End") {
            e.preventDefault();
            seekAndCue(totalSec);
          }
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button[data-midi-note]")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          scrubFromRollEvent(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            scrubFromRollEvent(e.clientX);
          }
        }}
        className="relative h-[86px] w-full overflow-hidden rounded-lg border border-[#2C2822] bg-[#100F0D] cursor-ew-resize select-none touch-none"
      >
        {/* Subtle horizontal pitch guide lines */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between py-3 opacity-25">
          <div className="border-b border-dashed border-[#443C30]" />
          <div className="border-b border-dashed border-[#443C30]" />
          <div className="border-b border-dashed border-[#443C30]" />
        </div>

        {/* Translated World Layer */}
        <div
          ref={worldRef}
          style={{ width: `${(worldScale * 100).toFixed(3)}%`, willChange: "transform" }}
          className="relative h-full"
        >
          {/* Bar Grid Lines + Bar Numbers */}
          {bars.map((b, idx) => {
            const leftPct = (b.startSec / totalSec) * 100;
            const showNum = idx % barStride === 0;
            const major = idx % 4 === 0;
            return (
              <div
                key={`mbar-${b.index}`}
                style={{ left: `${leftPct.toFixed(3)}%` }}
                className={`pointer-events-none absolute inset-y-0 border-l ${
                  major ? "border-[#D9A75C]/30" : "border-[#2E2A23]/80"
                }`}
              >
                {showNum && (
                  <span className="inline-block pl-1 pt-0.5 font-mono text-[11px] leading-none text-[#8F8576]">
                    {b.index}
                  </span>
                )}
              </div>
            );
          })}

          {/* Loop Highlight */}
          {loopRange && loopWidthPct > 0 && (
            <div
              style={{ left: `${loopLeftPct.toFixed(3)}%`, width: `${loopWidthPct.toFixed(3)}%` }}
              className="pointer-events-none absolute inset-y-0 border-x border-[#D9A75C]/70 bg-[#D9A75C]/10"
            />
          )}

          {/* Color-Coded Pitched MIDI Note Bars */}
          {notes.map((n) => {
            const leftPct = (n.startSec / totalSec) * 100;
            const widthPct = Math.max(0.35 / worldScale, (n.durSec / totalSec) * 100);
            return (
              <button
                key={n.key}
                ref={(el) => {
                  if (el) noteElsRef.current.set(n.key, el);
                  else noteElsRef.current.delete(n.key);
                }}
                type="button"
                data-midi-note="true"
                title={n.label}
                aria-label={n.label}
                onClick={(ev) => {
                  ev.stopPropagation();
                  seekAndCue(n.startSec);
                  const vIdx = voices.findIndex((v) => v.id === n.voiceId);
                  if (vIdx >= 0) select(vIdx);
                  const singer = voices.find((v) => v.id === n.voiceId);
                  if (singer && status !== "playing") {
                    void startAudio();
                    void auditionNote(singer, n.midi, "ah", 240);
                  } else if (status === "idle") {
                    void play(startAudio, n.startSec);
                  }
                }}
                style={{
                  left: `${leftPct.toFixed(3)}%`,
                  width: `${widthPct.toFixed(3)}%`,
                  top: `${n.yPct.toFixed(1)}%`,
                  backgroundColor: n.color,
                }}
                className="studio-midi-nav-note absolute h-[7px] min-w-[4px] rounded-full opacity-90 transition-transform hover:scale-y-150 cursor-pointer"
              />
            );
          })}
        </div>

        {/* Live Glowing Playhead Needle */}
        <div
          ref={playheadRef}
          style={{ left: 0, willChange: "transform" }}
          className="pointer-events-none absolute inset-y-0 z-10 w-[2px] bg-[#34D399] shadow-[0_0_8px_rgba(52,211,153,0.75)]"
        >
          <span className="absolute -top-0.5 -left-[4px] size-2.5 rotate-45 bg-[#D9A75C]" />
        </div>
      </div>

      {/* Full-Song Minimap Overview Scrubber Bar */}
      <div
        ref={minimapRef}
        aria-label="Full song MIDI overview scrubber"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          scrubFromMinimapEvent(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            scrubFromMinimapEvent(e.clientX);
          }
        }}
        className="relative h-5 w-full overflow-hidden rounded-md border border-[#2C2822] bg-[#12110F] cursor-pointer select-none touch-none"
      >
        {/* Miniature skyline of the whole song */}
        {notes.map((n) => (
          <span
            key={`mm-${n.key}`}
            style={{
              left: `${((n.startSec / totalSec) * 100).toFixed(2)}%`,
              width: `${Math.max(0.5, (n.durSec / totalSec) * 100).toFixed(2)}%`,
              top: `${Math.max(15, Math.min(80, n.yPct)).toFixed(0)}%`,
              backgroundColor: n.color,
            }}
            className="pointer-events-none absolute h-[2.5px] rounded-full opacity-75"
          />
        ))}

        {/* Viewport Window Lens */}
        <div
          ref={miniLensRef}
          className="pointer-events-none absolute inset-y-0 rounded-sm border border-[#D9A75C]/75 bg-[#D9A75C]/15"
          style={{ left: "0%", width: "25%" }}
        />

        {/* Minimap Playhead Tick */}
        <div
          ref={miniPlayheadRef}
          className="pointer-events-none absolute inset-y-0 w-[2px] bg-[#34D399]"
          style={{ left: "0%" }}
        />
      </div>
    </section>
  );
}
