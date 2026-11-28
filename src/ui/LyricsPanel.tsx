import { useMemo } from "react";
import { Play } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { measures } from "../choir/meter.ts";
import type { Piece } from "../choir/music.ts";
import { beatSeconds, LEAD_IN } from "../choir/timeline.ts";
import type { VideoBubbleClip } from "../choir/stageCast.ts";

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

export function LyricsPanel({
  piece,
  bubbles,
  currentStageSec,
  onSeekStageSec,
}: {
  piece: Piece;
  bubbles: readonly VideoBubbleClip[];
  currentStageSec: number;
  onSeekStageSec: (stageSec: number) => void;
}) {
  const groups = useMemo<LyricSectionGroup[]>(() => {
    const bs = beatSeconds(piece);
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

    // Include any opening lines before first section or fallback if sections have empty lines
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
  }, [piece, bubbles]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#160f0a] text-[#f8efe2]" data-testid="lyrics-panel">
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-3 p-3">
          {groups.length === 0 ? (
            <div className="rounded-lg border border-[#745438]/40 bg-[#21160f] p-4 text-center text-xs text-[#c7b194]">
              Instrumental performance — switch to <strong>Score</strong> to inspect the notation or <strong>Parts</strong> to trigger stage animations.
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.key} className="space-y-1">
                <div className="flex items-center justify-between border-b border-[#745438]/35 pb-1">
                  <h3 className="flex items-center gap-1.5 text-xs font-bold capitalize tracking-wide text-[#f4dfba]">
                    <span className="h-3 w-0.5 rounded-full bg-[#e3bd7f]" />
                    {group.name}
                  </h3>
                  {group.barLabel && (
                    <span className="font-mono text-[11px] text-[#c7b194]">{group.barLabel}</span>
                  )}
                </div>

                <div className="space-y-1 pt-0.5">
                  {group.lines.map((line) => {
                    const active = currentStageSec >= line.startSec - 0.05 && currentStageSec < line.endSec;
                    return (
                      <button
                        key={line.id}
                        type="button"
                        onClick={() => onSeekStageSec(line.startSec)}
                        data-lyric-active={active ? "true" : undefined}
                        className={`group flex w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-all cursor-pointer ${
                          active
                            ? "border-[#e3bd7f] bg-gradient-to-r from-[#3a2815]/95 to-[#261a10]/95 text-white shadow-[0_0_16px_rgba(227,189,127,0.2)]"
                            : "border-transparent bg-transparent text-[#d9c5a9] hover:border-[#745438]/55 hover:bg-[#241810]/80 hover:text-white"
                        }`}
                      >
                        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                          {active ? (
                            <Play className="size-3 fill-[#e3bd7f] text-[#e3bd7f]" />
                          ) : (
                            <span
                              className="size-1.5 rounded-full opacity-60 group-hover:opacity-100"
                              style={{ backgroundColor: line.color }}
                            />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] leading-snug font-medium">{line.text}</span>
                          <span className="block text-[10px] text-[#a79072]">
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
