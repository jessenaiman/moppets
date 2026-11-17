/**
 * Checks for a sung line as it is written: its syllables by the pronouncing dictionary against its
 * notes (the lyric planner needs one each), and words whose stress the rhythm turns round. Uses the
 * engine's syllable splitter, so the dictionary must be loaded (g2p.load()) for the counts to match
 * what the singers will plan.
 */
import { lyricsToSyllables } from "../wasm/engine.ts";
import type { Line, Rest, Song, Sung } from "./songbook.ts";

export interface LineCheck {
  /** the syllables as the dictionary splits the words */
  syllables: string[];
  notes: number;
  /** the line can be sung (one syllable per note) */
  ok: boolean;
  /** what is wrong, or "" */
  problem: string;
  /** a word sung against its stress (a hint, not an error) */
  hint: string;
}

/**
 * `start`: the line's beat in the song (from `lineStarts`), to tell strong beats from weak; a note
 * on a whole beat is strong, one between beats weak.
 */
export function checkSung(s: Pick<Sung, "words" | "rhythm">, start?: number): LineCheck {
  const syl = s.words.trim() ? lyricsToSyllables(s.words) : [];
  const syllables = syl.map((x) => x.text);
  const notes = s.rhythm.length;
  const diff = syllables.length - notes;
  const problem = !syllables.length ? "no words" : diff > 0 ? `${diff} syllable${diff > 1 ? "s" : ""} too many: ${syllables.length} for ${notes} notes` : diff < 0 ? `${-diff} syllable${diff < -1 ? "s" : ""} short: ${syllables.length} for ${notes} notes` : "";
  let hint = "";
  if (!problem && start !== undefined) {
    // a word of several syllables whose stressed one falls between beats while another lands on one
    let at = start, word: { text: string; stressed: boolean; onBeat: boolean }[] = [];
    for (let i = 0; i < syl.length && !hint; i++) {
      const onBeat = Math.abs(at - Math.round(at)) < 1e-6;
      word.push({ text: syl[i].text, stressed: syl[i].nucleus.stress === 1, onBeat });
      at += s.rhythm[i];
      if (syl[i].wordEnd) {
        if (word.length > 1 && word.some((w) => w.stressed && !w.onBeat) && word.some((w) => !w.stressed && w.onBeat)) hint = `"${word.map((w) => w.text).join("")}" is sung against its stress (${word.map((w) => (w.stressed ? w.text.toUpperCase() : w.text)).join("·")})`;
        word = [];
      }
    }
  }
  return { syllables, notes, ok: !problem, problem, hint };
}

/** Where each line of a song starts, in beats (the song opens with a bar of groove), by line object. */
export function lineStarts(song: Song): Map<Line | Rest, number> {
  const out = new Map<Line | Rest, number>();
  let at = 4;
  for (const section of song.sections)
    for (const l of section.lines) {
      if (!out.has(l)) out.set(l, at);
      at += "rest" in l ? l.rest : l.rhythm.reduce((a, b) => a + b, 0);
    }
  return out;
}

/** Every problem in a song, as "line: problem" (empty when it can all be sung). */
export function songProblems(song: Song): string[] {
  const out: string[] = [];
  for (const section of new Set(song.sections))
    for (const l of section.lines) {
      if ("rest" in l) continue;
      for (const s of [l, ...(l.with ?? [])]) {
        const c = checkSung(s);
        if (!c.ok) out.push(`"${s.words}": ${c.problem}`);
      }
    }
  return out;
}
