import type { CSSProperties, RefObject } from "react";
import "./shotcraft-stage.css";

export interface SceneLine {
  key: string;
  speaker: string;
  speakerIds?: readonly string[];
  speakerNames?: readonly string[];
  speakerColors?: readonly string[];
  isGroup?: boolean;
  text: string;
  accent: string;
  start: number;
  end: number;
  words: readonly { text: string; start: number; end: number }[];
  /** Normalized 0..1 viewport center X (initial value before 60fps 3D projection damping). */
  x?: number;
  /** Normalized 0..1 viewport top Y (initial value before 60fps 3D projection damping). */
  y?: number;
  /** Horizontal pointer tail offset % within bubble width (14..86). */
  tailXPct?: number;
  /** Optional second pointer tail offset % for spread group bubbles. */
  tail2XPct?: number;
  /** Opacity (0 or 1) for optional second group pointer tail. */
  tail2Opacity?: number;
  bg?: string;
  fg?: string;
  tail?: boolean;
}

// Break at punctuation where possible so a long reply fits cleanly inside its bubble.
function phraseAt(line: SceneLine, time: number) {
  let start = 0;
  let length = 0;
  for (let i = 0; i < line.words.length; i++) {
    const word = line.words[i];
    const next = line.words[i + 1];
    length += word.text.length + 1;
    if (!next || length + next.text.length > 46 || (length >= 22 && /[,;:.!?]$/.test(word.text))) {
      if (!next || time < next.start) return line.words.slice(start, i + 1);
      start = i + 1;
      length = 0;
    }
  }
  return [];
}

function BubbleTailSvg({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 12"
      width="18"
      height="11"
      aria-hidden="true"
    >
      <path d="M 1 0 L 10 10.5 L 19 0 Z" fill="var(--bubble-bg)" />
      <path
        d="M 1 0 L 10 10.5 L 19 0"
        fill="none"
        stroke="var(--bubble-border)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SceneCaptions({
  lines,
  time,
  containerRef,
}: {
  lines: readonly SceneLine[];
  time: number;
  comic?: boolean;
  containerRef?: RefObject<HTMLDivElement | null>;
}) {
  if (!lines.length) return null;

  return (
    <div
      ref={containerRef}
      className="scene-captions is-floating-bubbles"
      data-layout="overlay"
    >
      {lines.map((line) => {
        const words = phraseAt(line, time);
        const colors = line.speakerColors?.length ? line.speakerColors : [line.accent];
        const isGroup = Boolean(
          line.isGroup || (line.speakerIds && line.speakerIds.length >= 2) || colors.length >= 2,
        );
        const tailEnabled = line.tail !== false;
        const leftPct = Math.max(12, Math.min(88, (line.x ?? 0.5) * 100));
        const topPct = Math.max(3, Math.min(58, (line.y ?? 0.14) * 100));
        const tailPct = Math.max(14, Math.min(86, line.tailXPct ?? 50));
        const tail2Pct = Math.max(14, Math.min(86, line.tail2XPct ?? 62));
        const tail2Opacity = line.tail2Opacity ?? (isGroup && Math.abs(tail2Pct - tailPct) >= 12 ? 1 : 0);

        const style = {
          "--voice": line.accent,
          "--bubble-left": `${leftPct.toFixed(2)}%`,
          "--bubble-top": `${topPct.toFixed(2)}%`,
          "--tail-x": `${tailPct.toFixed(2)}%`,
          "--tail2-x": `${tail2Pct.toFixed(2)}%`,
          "--tail2-opacity": String(tail2Opacity),
        } as CSSProperties;

        return (
          <div
            key={line.key}
            data-bubble-key={line.key}
            data-group={isGroup ? "true" : undefined}
            className="scene-caption"
            style={style}
          >
            <div className="scene-speaker-row">
              <span className="scene-speaker-dots" aria-hidden="true">
                {colors.slice(0, 6).map((c, idx) => (
                  <span
                    key={`${c}-${idx}`}
                    className="scene-speaker-dot"
                    style={{ backgroundColor: c, color: c }}
                  />
                ))}
              </span>
              <b className="scene-speaker">{line.speaker}</b>
            </div>
            <div className="scene-lyric">
              {words.length
                ? words.map((w, i) => (
                    <span
                      key={i}
                      className="scene-word"
                      data-current={(time >= w.start && time < w.end) || undefined}
                    >
                      {w.text}{" "}
                    </span>
                  ))
                : line.text}
            </div>
            {tailEnabled && <BubbleTailSvg className="scene-tail is-primary" />}
            {tailEnabled && isGroup && <BubbleTailSvg className="scene-tail is-secondary" />}
          </div>
        );
      })}
    </div>
  );
}
