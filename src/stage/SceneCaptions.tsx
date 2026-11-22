import type { CSSProperties } from "react";

export interface SceneLine {
  key: string;
  speaker: string;
  text: string;
  accent: string;
  start: number;
  end: number;
  words: readonly { text: string; start: number; end: number }[];
  x?: number;
  y?: number;
  bg?: string;
  fg?: string;
  tail?: boolean;
}

// Break at punctuation where possible so a long reply fits beside its speaker.
function phraseAt(line: SceneLine, time: number) {
  let start = 0, length = 0;
  for (let i = 0; i < line.words.length; i++) {
    const word = line.words[i];
    const next = line.words[i + 1];
    length += word.text.length + 1;
    if (!next || length + next.text.length > 34 || (length >= 16 && /[,;:.!?]$/.test(word.text))) {
      if (!next || time < next.start) return line.words.slice(start, i + 1);
      start = i + 1;
      length = 0;
    }
  }
  return [];
}

export function SceneCaptions({lines, time, comic = false}: {
  lines: SceneLine[]; time: number; comic?: boolean;
}) {
  if (!lines.length) return null;
  const balloon = comic && lines.length === 1;
  return <div className={'scene-captions ' + (balloon ? 'is-balloon' : 'is-subtitle')} data-layout="overlay">
    {lines.map(line => {
      const words = phraseAt(line, time);
      const progress = Math.max(0, Math.min(1, (time-line.start) / Math.min(.2, Math.max(.01, line.end-line.start))));
      const pop = Math.sin(progress * Math.PI) * (1-progress);
      const x = line.x ?? .5;
      const style = {
        '--voice': line.accent, '--paper': line.bg ?? (balloon ? '#ffedc6' : '#17151b'),
        '--ink': line.fg ?? (balloon ? '#2a1c1b' : '#fff8eb'),
        ...(balloon && {top:((line.y ?? .07)*100)+'%', left: (Math.max(.31, Math.min(.69,x))*100)+'%',
          transform: `translateX(-50%) rotate(${(x > .5 ? 1 : -1) * 3 * pop}deg) scale(${.95 + .05*progress + .16*pop})`}),
      } as CSSProperties;
      return <div key={line.key} className="scene-caption" style={style} data-tail={balloon && line.tail !== false ? (x>.5 ? 'right' : 'left') : undefined}>
        <b className="scene-speaker">{line.speaker}</b>{' '}
        <span>{words.length ? words.map((w,i) => <span key={i} className="scene-word" data-current={time >= w.start && time < w.end || undefined}>{w.text}{' '}</span>) : line.text}</span>
      </div>;
    })}
  </div>;
}
