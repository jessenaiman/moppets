/**
 * Captions for a piece, timed from its score on the shared timeline (seconds, beat 0 at LEAD_IN):
 * a skit's lines with their speakers, or a song's lyric lines. Several Moppets singing the same line
 * together make one caption; pads ("oo", "bom") have no line and make none. Engine-free, and SRT
 * out, so a video editor can load them as an editable caption track.
 */
import type { Piece } from "./music.ts";
import { beatSeconds, LEAD_IN } from "./timeline.ts";

export interface Caption {
  start: number;
  end: number;
  text: string;
  /** who says or sings it (names, joined) */
  who: string;
}

export function captionsFor(piece: Piece, names: Record<string, string> = {}): Caption[] {
  const bs = beatSeconds(piece), at = (beat: number) => LEAD_IN + beat * bs;
  const raw: Caption[] = [];
  for (const t of piece.tracks) {
    const name = names[t.id] ?? t.id;
    if (piece.kind === "skit") {
      for (const e of t.events) raw.push({ start: at(e.beat), end: at(e.beat + e.beats), text: e.text, who: name });
      continue;
    }
    const words = t.phrases ?? t.lines;
    if (!words) continue;
    const byLine = new Map<number, { start: number; end: number }>();
    for (const e of t.events) {
      if (e.line === undefined || !words[e.line]) continue;
      const span = byLine.get(e.line);
      byLine.set(e.line, { start: Math.min(span?.start ?? Infinity, at(e.beat)), end: Math.max(span?.end ?? 0, at(e.beat + e.beats)) });
    }
    // a round repeats its lines: split a line's notes into separate passes where they jump ahead
    for (const [line, span] of byLine) {
      const passes: { start: number; end: number }[] = [];
      for (const e of t.events.filter((x) => x.line === line)) {
        const s = at(e.beat), en = at(e.beat + e.beats), last = passes[passes.length - 1];
        if (last && s - last.end < 1) last.end = Math.max(last.end, en);
        else passes.push({ start: s, end: en });
      }
      for (const p of passes.length ? passes : [span]) raw.push({ ...p, text: words[line], who: name });
    }
  }
  raw.sort((a, b) => a.start - b.start || a.text.localeCompare(b.text));
  // the same words at (nearly) the same time are one caption, credited to everyone singing them
  const out: Caption[] = [];
  for (const c of raw) {
    const twin = out.find((o) => o.text === c.text && Math.abs(o.start - c.start) < 0.3);
    if (twin) {
      twin.end = Math.max(twin.end, c.end);
      if (!twin.who.split(", ").includes(c.who)) twin.who += `, ${c.who}`;
    } else out.push({ ...c });
  }
  return out;
}

const stamp = (s: number) => {
  const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

/** SubRip text; `speakers` puts the name first, as a skit's script does. */
export function srt(captions: readonly Caption[], speakers = false): string {
  return captions.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${speakers ? `${c.who.toUpperCase()}: ` : ""}${c.text}\n`).join("\n");
}
