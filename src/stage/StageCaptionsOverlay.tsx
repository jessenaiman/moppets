/**
 * Clean, unobtrusive single-line cinema subtitle bar anchored at the bottom chin
 * (`bottom: 10px`) so performers' 3D heads, eyes, and bodies are 100% unobstructed.
 */
import React from "react";
import type { VideoBubbleClip } from "../choir/videoProject.ts";

export interface StageSubtitleWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface StageSubtitleLine {
  readonly key: string;
  readonly speaker: string;
  readonly speakerColors?: readonly string[];
  readonly text: string;
  readonly accent: string;
  readonly start: number;
  readonly end: number;
  readonly words: readonly StageSubtitleWord[];
}

export interface CaptionViewState {
  readonly lines: readonly StageSubtitleLine[];
  readonly timeSec: number;
}

export const EMPTY_CAPTION_STATE: CaptionViewState = { lines: [], timeSec: 0 };

export function activeWordIndexForBubble(b: VideoBubbleClip, timeSec: number): number {
  const words = b.words;
  if (!words || words.length === 0) return -1;
  for (let i = 0; i < words.length; i++) {
    if (timeSec >= words[i].startSec && timeSec < words[i].endSec) return i;
  }
  return -1;
}

export function activePhraseStartForBubble(b: VideoBubbleClip, timeSec: number): number {
  const words = b.words;
  if (!words || words.length === 0) return 0;
  let start = 0;
  let length = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const next = words[i + 1];
    length += word.text.length + 1;
    if (!next || length + next.text.length > 46 || (length >= 22 && /[,;:.!?]$/.test(word.text))) {
      if (!next || timeSec < next.startSec) return start;
      start = i + 1;
      length = 0;
    }
  }
  return start;
}

function phraseWordsAtTime(line: StageSubtitleLine, time: number): readonly StageSubtitleWord[] {
  let start = 0;
  let length = 0;
  for (let i = 0; i < line.words.length; i++) {
    const word = line.words[i];
    const next = line.words[i + 1];
    length += word.text.length + 1;
    if (!next || length + next.text.length > 52 || (length >= 26 && /[,;:.!?]$/.test(word.text))) {
      if (!next || time < next.start) return line.words.slice(start, i + 1);
      start = i + 1;
      length = 0;
    }
  }
  return [];
}

export const StageCaptionsOverlay: React.FC<{
  readonly lines: readonly StageSubtitleLine[];
  readonly time: number;
}> = ({ lines, time }) => {
  if (!lines.length) return null;

  const primary =
    lines.find((l) => time >= l.start && time <= l.end) ??
    lines[lines.length - 1];
  const words = phraseWordsAtTime(primary, time);
  const colors = primary.speakerColors?.length ? primary.speakerColors : [primary.accent];

  return (
    <div
      data-layout="overlay"
      style={{
        position: "absolute",
        bottom: 10,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 20,
        maxWidth: "86%",
        pointerEvents: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 12px",
        borderRadius: 999,
        background: "rgba(10, 12, 16, 0.78)",
        border: "1px solid rgba(255, 255, 255, 0.14)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.45)",
        fontSize: 13,
        lineHeight: 1.25,
        color: "#f8fafc",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      <span
        aria-hidden="true"
        style={{ display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0 }}
      >
        {colors.slice(0, 4).map((c, idx) => (
          <span
            key={`${c}-${idx}`}
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              backgroundColor: c,
              boxShadow: `0 0 6px ${c}`,
            }}
          />
        ))}
      </span>
      <span
        style={{
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: primary.accent,
          fontSize: 11,
          flexShrink: 0,
        }}
      >
        {primary.speaker}
      </span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: 600,
          color: "#f8fafc",
        }}
      >
        {words.length > 0
          ? words.map((w, idx) => {
              const current = time >= w.start && time < w.end;
              return (
                <span
                  key={idx}
                  style={
                    current
                      ? {
                          color: "#ffffff",
                          textDecoration: "underline",
                          textDecorationColor: primary.accent,
                          textDecorationThickness: 2,
                          textUnderlineOffset: 3,
                        }
                      : undefined
                  }
                >
                  {w.text}{" "}
                </span>
              );
            })
          : primary.text}
      </span>
    </div>
  );
};
