/**
 * Checks for a sung line as it is written: its syllables by the pronouncing dictionary against its
 * notes (the lyric planner needs one each), and words whose stress the rhythm turns round. Uses the
 * engine's syllable splitter, so the dictionary must be loaded (g2p.load()) for the counts to match
 * what the singers will plan.
 */
import { sungSyllables } from "./plan.ts";
import { lyricsToSyllables } from "@chimera/wasm/engine.ts";
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
  const syl = s.words.trim() ? sungSyllables(s.words) : [];
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
      // a held note carries its syllable on; only where a syllable starts counts
      if (!syl[i].melisma) word.push({ text: syl[i].text, stressed: syl[i].nucleus.stress === 1, onBeat });
      at += s.rhythm[i];
      if (syl[i].wordEnd) {
        if (word.length > 1 && word.some((w) => w.stressed && !w.onBeat) && word.some((w) => !w.stressed && w.onBeat)) hint = `"${word.map((w) => w.text).join("")}" is sung against its stress (${word.map((w) => (w.stressed ? w.text.toUpperCase() : w.text)).join("·")})`;
        word = [];
      }
    }
  }
  return { syllables, notes, ok: !problem, problem, hint };
}

/**
 * A fix for a line short of syllables: hold its last syllable over the spare notes (a mark per
 * note, before any closing punctuation). The singer stretches the line's last word; move the
 * marks by hand to hold another syllable instead ("ma_ny").
 */
export function holdFix(words: string, notesSpare: number): string {
  return words.replace(/([A-Za-z'_])([^A-Za-z'_]*)$/, `$1${"_".repeat(notesSpare)}$2`);
}

/**
 * A fix for a line with syllables to spare: split its longest notes in two, each half the same
 * pitch, until there is a note per syllable (null when the notes are already too short to split,
 * under a quarter of a beat). The line keeps its length, so its chords still fit.
 */
export function splitFix(s: Pick<Sung, "degrees" | "rhythm">, extra: number): Pick<Sung, "degrees" | "rhythm"> | null {
  const degrees = [...s.degrees], rhythm = [...s.rhythm];
  for (let n = 0; n < extra; n++) {
    const i = rhythm.indexOf(Math.max(...rhythm));
    if (rhythm[i] < 0.5) return null;
    rhythm.splice(i, 1, rhythm[i] / 2, rhythm[i] / 2);
    degrees.splice(i, 0, degrees[i]);
  }
  return { degrees, rhythm };
}

/**
 * Where each sung syllable ends in the typed words (character offsets, one per `sungSyllables`
 * syllable, holds included): `_` inserted at offset k holds syllable k over one more note.
 * Null when the words can't be split (the dictionary and the spelling disagree).
 */
export function syllableEnds(words: string): number[] | null {
  const ends: number[] = [];
  for (const m of words.matchAll(/[A-Za-z'][A-Za-z'\-_]*/g)) {
    const word = m[0], clean = word.replace(/_/g, "");
    const lengths = lyricsToSyllables(clean).map((x) => x.text.replace(/~/g, "").length);
    // walk the word's letters, closing a syllable when its spelling is used up; each _ is its own
    let k = 0, used = 0;
    for (let i = 0; i < word.length; i++) {
      if (word[i] === "_") {
        ends.push(m.index! + i + 1);
        continue;
      }
      used++;
      if (k < lengths.length - 1 && used >= lengths[k]) {
        ends.push(m.index! + i + 1);
        k++;
        used = 0;
      }
    }
    // the last syllable ends with the word's last letter (before any _ after it)
    const tail = word.length - (word.match(/_*$/)![0].length);
    ends.splice(ends.length - (word.length - tail), 0, m.index! + tail);
  }
  return ends.length === sungSyllables(words).length ? ends : null;
}

/** Hold syllable `k` over one more note (its `_` mark). */
export const holdAt = (words: string, k: number): string | null => {
  const ends = syllableEnds(words);
  return ends && ends[k] !== undefined ? words.slice(0, ends[k]) + "_" + words.slice(ends[k]) : null;
};

/** Remove one hold, the one sung as syllable `k` (it must be a hold). */
export const unholdAt = (words: string, k: number): string | null => {
  const ends = syllableEnds(words);
  return ends && words[ends[k] - 1] === "_" ? words.slice(0, ends[k] - 1) + words.slice(ends[k]) : null;
};

/** Split note `i` in two halves at the same pitch (the line keeps its length). */
export function splitNote(s: Pick<Sung, "degrees" | "rhythm">, i: number): Pick<Sung, "degrees" | "rhythm"> | null {
  if (s.rhythm[i] === undefined || s.rhythm[i] < 0.5) return null;
  const degrees = [...s.degrees], rhythm = [...s.rhythm];
  rhythm.splice(i, 1, rhythm[i] / 2, rhythm[i] / 2);
  degrees.splice(i, 0, degrees[i]);
  return { degrees, rhythm };
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
