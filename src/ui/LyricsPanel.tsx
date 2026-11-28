import { useMemo } from "react";
import { Play } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { measures } from "../choir/meter.ts";
import type { Piece } from "../choir/music.ts";
import { resolvePerformerIdentity } from "../choir/performer.ts";
import type { VideoBubbleClip } from "../choir/stageCast.ts";
import { useMoppet } from "../choir/store.ts";
import { beatSeconds, LEAD_IN } from "../choir/timeline.ts";

interface LyricSectionGroup {
  readonly key: string;
  readonly name: string;
  readonly barLabel: string;
  readonly lines: {
    readonly id: string;
    readonly speaker: string;
    readonly color: string;
    readonly text: string;
    readonly startSec: number;
    readonly endSec: number;
  }[];
}

function barLabelForBeat(piece: Piece, startBeat: number, endBeat: number): string {
  const ms = measures(piece);
  if (!ms.length) return "";
  let b1 = 1;
  let b2 = 1;
  for (let i = 0; i < ms.length; i++) {
    if (ms[i].start <= startBeat + 0.05) b1 = i + 1;
    if (ms[i].start < endBeat - 0.05) b2 = i + 1;
  }
  return b1 === b2 ? `Bar ${b1}` : `Bars ${b1}–${b2}`;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function LyricsPanel({
  piece,
  bubbles,
  currentStageSec,
  onSeekStageSec,
  inkTheme = "dark",
  zoom = 100,
}: {
  piece: Piece;
  bubbles: readonly VideoBubbleClip[];
  currentStageSec: number;
  onSeekStageSec: (stageSec: number) => void;
  inkTheme?: "paper" | "dark";
  zoom?: number;
}) {
  const voices = useMoppet((s) => s.voices);
  const studio404 = useMoppet((s) => s.studio404);

  const groups = useMemo<LyricSectionGroup[]>(() => {
    const bs = beatSeconds(piece);

    // Spoken skits: group cleanly by piece.scenes (Scene 1, Scene 2, ...)
    if (piece.kind === "skit") {
      const scenes = piece.scenes?.length
        ? piece.scenes
        : [{ beat: 0, beats: Math.max(1, piece.beats), cast: piece.tracks.map((t) => t.id) }];

      const rawEvents = piece.tracks
        .flatMap((t) => {
          const v = voices.find((x) => x.id === t.id);
          const ident = v
            ? resolvePerformerIdentity(v, studio404, piece.title)
            : { name: t.id, color: "#34D399" };
          return t.events
            .filter((ev) => ev.text.trim().length > 0)
            .map((ev, idx) => ({
              id: `${t.id}-${idx}`,
              speaker: ident.name,
              color: ident.color,
              text: ev.text.trim(),
              beat: ev.beat,
              startSec: LEAD_IN + ev.beat * bs,
              endSec: LEAD_IN + (ev.beat + Math.max(0.8, ev.beats)) * bs,
            }));
        })
        .sort((a, b) => a.beat - b.beat);

      const sceneGroups = scenes
        .map((sc, idx) => {
          const scStart = LEAD_IN + sc.beat * bs;
          const scEnd = LEAD_IN + (sc.beat + sc.beats) * bs;
          const lines = rawEvents.filter((l) => l.beat >= sc.beat - 0.05 && l.beat < sc.beat + sc.beats - 0.05);
          return {
            key: `skit-scene-${idx}`,
            name: `Scene ${idx + 1}`,
            barLabel: `${formatClock(scStart)} – ${formatClock(scEnd)}`,
            lines,
          };
        })
        .filter((g) => g.lines.length > 0);

      if (sceneGroups.length > 0) return sceneGroups;
      if (rawEvents.length > 0) {
        return [
          {
            key: "skit-all",
            name: piece.title,
            barLabel: formatClock(piece.beats * bs),
            lines: rawEvents,
          },
        ];
      }
    }

    // Rounds: group cleanly by performer/part when sections don't already split them
    if (piece.kind === "round" && bubbles.length > 0 && (!piece.sections || piece.sections.length <= 1)) {
      const bySpeaker = new Map<string, LyricSectionGroup>();
      for (const b of bubbles) {
        const existing = bySpeaker.get(b.speaker);
        const line = {
          id: b.id,
          speaker: b.speaker,
          color: b.color,
          text: b.text,
          startSec: b.startSec,
          endSec: b.startSec + b.durationSec,
        };
        if (existing) {
          existing.lines.push(line);
        } else {
          bySpeaker.set(b.speaker, {
            key: `round-${b.speaker}`,
            name: `${b.speaker} · Round Part`,
            barLabel: `${formatClock(b.startSec)} entrance`,
            lines: [line],
          });
        }
      }
      const out = [...bySpeaker.values()];
      if (out.length > 0) return out;
    }

    const sections = piece.sections?.length
      ? piece.sections
      : [{ name: piece.title, beat: 0 }];

    const computed: LyricSectionGroup[] = sections.map((sec, idx) => {
      const next = sections[idx + 1];
      const secStartSec = LEAD_IN + sec.beat * bs;
      const secEndSec = next ? LEAD_IN + next.beat * bs : Infinity;
      const endBeat = next ? next.beat : piece.beats;
      const matchingBubbles = bubbles.filter(
        (b) => b.startSec >= secStartSec - 0.15 && b.startSec < secEndSec - 0.15,
      );
      return {
        key: `${sec.beat}-${idx}`,
        name: sec.name,
        barLabel: barLabelForBeat(piece, sec.beat, endBeat),
        lines: matchingBubbles.map((b) => ({
          id: b.id,
          speaker: b.speaker,
          color: b.color,
          text: b.text,
          startSec: b.startSec,
          endSec: b.startSec + b.durationSec,
        })),
      };
    });

    const nonEmpty = computed.filter((g) => g.lines.length > 0);
    if (nonEmpty.length > 0) return nonEmpty;

    if (bubbles.length > 0) {
      return [
        {
          key: "all-lines",
          name: piece.title,
          barLabel: barLabelForBeat(piece, 0, piece.beats),
          lines: bubbles.map((b) => ({
            id: b.id,
            speaker: b.speaker,
            color: b.color,
            text: b.text,
            startSec: b.startSec,
            endSec: b.startSec + b.durationSec,
          })),
        },
      ];
    }

    return [];
  }, [piece, bubbles, voices, studio404]);

  const isPaper = inkTheme === "paper";
  const textScale = zoom >= 150 ? "text-base" : zoom >= 125 ? "text-[15px]" : "text-sm";

  return (
    <div
      className={`flex h-full min-h-0 flex-col rounded-xl border ${
        isPaper
          ? "border-[#CBD5E1] bg-[#F4F7F5] text-[#13231E]"
          : "border-[#283542] bg-[#0E1519] text-[#E8F3EE]"
      }`}
      data-testid="lyrics-panel"
    >
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-4 p-3.5">
          {groups.length === 0 ? (
            <div
              className={`rounded-xl border p-4 text-center text-xs ${
                isPaper
                  ? "border-[#CBD5E1] bg-white text-[#334155]"
                  : "border-[#283542] bg-[#11161C] text-[#A8B8C8]"
              }`}
            >
              Instrumental performance — switch to <strong>Full Score</strong> or <strong>Piano Roll</strong> to inspect the notes.
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.key} className="space-y-1.5">
                <div
                  className={`flex items-center justify-between border-b pb-1.5 ${
                    isPaper ? "border-[#CBD5E1]" : "border-[#283542]"
                  }`}
                >
                  <h3 className="flex items-center gap-2 text-xs font-bold capitalize tracking-wide">
                    <span className="size-2 rounded-full bg-[#34D399]" />
                    {group.name}
                  </h3>
                  {group.barLabel && (
                    <span className={`font-mono text-xs ${isPaper ? "text-[#475569]" : "text-[#A8B8C8]"}`}>
                      {group.barLabel}
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 pt-0.5">
                  {group.lines.map((line) => {
                    const active = currentStageSec >= line.startSec - 0.05 && currentStageSec < line.endSec;
                    return (
                      <button
                        key={line.id}
                        type="button"
                        onClick={() => onSeekStageSec(line.startSec)}
                        data-lyric-active={active ? "true" : undefined}
                        className={`group flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer ${
                          active
                            ? isPaper
                              ? "border-[#059669] bg-[#D1FAE5] text-[#041A12]"
                              : "border-[#34D399] bg-[#182028] text-[#F1F5F9]"
                            : isPaper
                              ? "border-transparent bg-white/70 text-[#13231E] hover:border-[#94A3B8] hover:bg-white"
                              : "border-[#283542]/60 bg-[#11161C] text-[#E8F3EE] hover:border-[#34D399]/60 hover:bg-[#182028]"
                        }`}
                      >
                        <span className="mt-1 flex size-4 shrink-0 items-center justify-center">
                          {active ? (
                            <Play className="size-3.5 fill-[#34D399] text-[#34D399]" />
                          ) : (
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: line.color }}
                            />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block leading-snug font-medium ${textScale}`}>{line.text}</span>
                          <span
                            className={`mt-0.5 block text-xs tabular-nums ${
                              active && isPaper
                                ? "text-[#065F46]"
                                : isPaper
                                  ? "text-[#475569]"
                                  : "text-[#A8B8C8]"
                            }`}
                          >
                            {line.speaker} · {line.startSec.toFixed(1)}s
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
