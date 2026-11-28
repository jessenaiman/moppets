/**
 * Spacious Multi-Track MIDI Piano Roll for Live Console and Theater views.
 *
 * Playhead updates strictly via direct DOM style mutation (`requestAnimationFrame`),
 * guaranteeing ZERO React re-renders during playback.
 */
import { useEffect, useMemo, useRef } from "react";
import { getCastCharacter } from "../choir/castManifest.ts";
import { useEnsemble } from "../choir/ensemble.ts";
import { auditionNote } from "../choir/live.ts";
import { measures } from "../choir/meter.ts";
import { noteName, type Piece } from "../choir/music.ts";
import { studio404Name } from "../choir/studio404.ts";
import { beatSeconds, LEAD_IN, pieceSeconds } from "../choir/timeline.ts";
import type { MoppetVoice } from "../choir/voices.ts";

export interface MidiPianoRollProps {
  readonly piece: Piece;
  readonly voices: readonly MoppetVoice[];
  readonly studio404: boolean;
  readonly theme: "theater" | "console";
  readonly loopRange?: { startSec: number; endSec: number; label: string } | null;
  readonly heightPx?: number;
  readonly onSeekStageSec: (stageSec: number) => void;
  readonly ariaLabel?: string;
}

interface LaneNote {
  readonly key: string;
  readonly leftPct: number;
  readonly widthPct: number;
  readonly pitchNorm: number;
  readonly midi: number;
  readonly startSec: number;
  readonly label: string;
}

interface VoiceLane {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly voice?: MoppetVoice;
  readonly notes: readonly LaneNote[];
}

export function MidiPianoRoll({
  piece,
  voices,
  studio404,
  theme,
  loopRange,
  heightPx = 156,
  onSeekStageSec,
  ariaLabel = "Multi-track MIDI piano roll",
}: MidiPianoRollProps) {
  const playheadRef = useRef<HTMLDivElement>(null);
  const totalSec = Math.max(1, pieceSeconds(piece));
  const bars = useMemo(() => measures(piece), [piece]);
  const bs = beatSeconds(piece);

  const lanes = useMemo<VoiceLane[]>(() => {
    const activeTracks = piece.tracks.filter((t) => t.events.length > 0);
    return activeTracks.map((track) => {
      const voice = voices.find((v) => v.id === track.id);
      const ch = getCastCharacter(track.id);
      const color = (studio404 ? ch?.color : undefined) ?? voice?.color ?? "#50cfad";
      const displayName = studio404
        ? (ch?.displayName ?? studio404Name(track.id, voice?.name ?? track.id))
        : (voice?.name ?? track.id);
      const midis = track.events.map((e) => e.midi);
      const lo = Math.min(...midis) - 1;
      const hi = Math.max(...midis) + 1;
      const span = Math.max(4, hi - lo);
      const notes: LaneNote[] = track.events.map((ev, idx) => {
        const startSec = LEAD_IN + ev.beat * bs;
        const durSec = Math.max(0.1, ev.beats * bs);
        return {
          key: `${track.id}-${idx}`,
          leftPct: (startSec / totalSec) * 100,
          widthPct: Math.max(0.7, (durSec / totalSec) * 100),
          pitchNorm: (hi - ev.midi) / span,
          midi: ev.midi,
          startSec,
          label: `${displayName} · ${noteName(ev.midi)}`,
        };
      });
      return {
        id: track.id,
        name: displayName,
        color,
        voice,
        notes,
      };
    });
  }, [piece, voices, studio404, bs, totalSec]);

  // Direct DOM playhead movement (zero parent React re-renders)
  useEffect(() => {
    const updateEl = (stageSec: number) => {
      if (!playheadRef.current) return;
      const pct = Math.max(0, Math.min(100, (stageSec / totalSec) * 100));
      playheadRef.current.style.left = `${pct.toFixed(3)}%`;
    };

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      updateEl(useEnsemble.getState().time);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [totalSec]);

  const isTheater = theme === "theater";
  const barStride = bars.length > 40 ? 4 : bars.length > 20 ? 2 : 1;
  const loopLeftPct = loopRange ? Math.max(0, (loopRange.startSec / totalSec) * 100) : 0;
  const loopWidthPct = loopRange
    ? Math.max(0, Math.min(100 - loopLeftPct, ((loopRange.endSec - loopRange.startSec) / totalSec) * 100))
    : 0;

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border ${
        isTheater
          ? "border-[#8c6438]/60 bg-[#120b07] text-[#f8efe2]"
          : "border-white/15 bg-[#070a0d] text-[#edf6f3]"
      }`}
      style={{ height: heightPx }}
      data-testid={`midi-piano-roll-${theme}`}
    >
      {/* Top Bar Ruler */}
      <div
        className={`flex h-6 shrink-0 items-center border-b text-[10px] font-mono ${
          isTheater
            ? "border-[#745438]/45 bg-[#1b120b] text-[#c7b194]"
            : "border-white/10 bg-[#0d1216] text-slate-400"
        }`}
      >
        <div
          className={`w-[82px] shrink-0 border-r px-2 font-sans text-[10px] font-bold tracking-wider uppercase ${
            isTheater ? "border-[#745438]/40 text-[#e3bd7f]" : "border-white/10 text-emerald-300"
          }`}
        >
          Voices ({lanes.length})
        </div>
        <div className="relative flex-1 h-full overflow-hidden">
          {bars.map((m, idx) => {
            if (idx % barStride !== 0) return null;
            const leftPct = ((LEAD_IN + m.start * bs) / totalSec) * 100;
            return (
              <span
                key={`ruler-${m.start}`}
                className="pointer-events-none absolute top-0 bottom-0 flex items-center border-l border-white/10 pl-1"
                style={{ left: `${leftPct.toFixed(2)}%` }}
              >
                {idx + 1}
              </span>
            );
          })}
        </div>
      </div>

      {/* Scrollable Multi-Track Voice Lanes */}
      <div className="flex flex-1 min-h-0 overflow-y-auto">
        {/* Left Voice Names Column */}
        <div
          className={`flex w-[82px] shrink-0 flex-col border-r ${
            isTheater ? "border-[#745438]/40 bg-[#170f0a]" : "border-white/10 bg-[#0b0f13]"
          }`}
        >
          {lanes.map((lane) => (
            <div
              key={`lbl-${lane.id}`}
              className={`flex flex-1 min-h-[24px] items-center gap-1.5 border-b px-2 text-[11px] font-semibold ${
                isTheater ? "border-[#745438]/25 text-[#f4dfba]" : "border-white/5 text-slate-200"
              }`}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: lane.color, boxShadow: `0 0 6px ${lane.color}` }}
              />
              <span className="truncate">{lane.name}</span>
            </div>
          ))}
        </div>

        {/* Right Interactive Note Grid */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={ariaLabel}
          aria-valuemin={0}
          aria-valuemax={Math.round(totalSec)}
          aria-valuenow={0}
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
            onSeekStageSec(ratio * totalSec);
          }}
          className="relative flex flex-1 flex-col cursor-pointer select-none"
        >
          {/* Vertical Bar Grid Lines */}
          {bars.map((m, idx) => {
            const leftPct = ((LEAD_IN + m.start * bs) / totalSec) * 100;
            const major = idx % 4 === 0;
            return (
              <div
                key={`grid-${m.start}`}
                className={`pointer-events-none absolute inset-y-0 border-l ${
                  major
                    ? isTheater
                      ? "border-[#e3bd7f]/22"
                      : "border-emerald-400/20"
                    : "border-white/[0.06]"
                }`}
                style={{ left: `${leftPct.toFixed(2)}%` }}
              />
            );
          })}

          {/* Optional Loop Range Highlight */}
          {loopRange && loopWidthPct > 0 && (
            <div
              className="pointer-events-none absolute inset-y-0 border-x border-emerald-400/55 bg-emerald-400/12"
              style={{ left: `${loopLeftPct.toFixed(2)}%`, width: `${loopWidthPct.toFixed(2)}%` }}
            />
          )}

          {/* Voice Note Rows */}
          {lanes.map((lane) => (
            <div
              key={`row-${lane.id}`}
              className={`relative flex-1 min-h-[24px] border-b ${
                isTheater ? "border-[#745438]/25" : "border-white/5"
              }`}
            >
              {lane.notes.map((n) => (
                <button
                  key={n.key}
                  type="button"
                  title={n.label}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onSeekStageSec(n.startSec);
                    if (lane.voice) void auditionNote(lane.voice, n.midi, "ah", 260);
                  }}
                  style={{
                    left: `${n.leftPct.toFixed(2)}%`,
                    width: `${n.widthPct.toFixed(2)}%`,
                    top: `${(14 + n.pitchNorm * 62).toFixed(1)}%`,
                    backgroundColor: lane.color,
                    boxShadow: `0 0 6px ${lane.color}88`,
                  }}
                  className="absolute h-[5px] rounded-full opacity-95 transition-transform hover:scale-y-150 cursor-pointer"
                />
              ))}
            </div>
          ))}

          {/* Live Playhead */}
          <div
            ref={playheadRef}
            className={`pointer-events-none absolute inset-y-0 z-10 w-[2px] ${
              isTheater
                ? "bg-[#f3c978] shadow-[0_0_10px_rgba(243,201,120,0.9)]"
                : "bg-[#22d3ee] shadow-[0_0_10px_#22d3ee]"
            }`}
            style={{ left: "0%" }}
          >
            <span
              className={`absolute -top-0.5 -left-[4px] size-2.5 rotate-45 ${
                isTheater ? "bg-[#f3c978]" : "bg-[#22d3ee]"
              }`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
