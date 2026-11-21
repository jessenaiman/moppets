/**
 * Score → gestures, through the engine's own lyric and singing planners (main thread: they
 * allocate). Melody and timing come from the score; how a Moppet colours them is character.ts.
 */
import { EnglishG2P, lyricsToSyllables, planPhrases, planSong } from "@chimera/wasm/engine.ts";
import { midiToHz } from "./singerCore.ts";
import type { Gesture, Syllable } from "@chimera/wasm/types.ts";
import type { Piece, ScoreEvent, Track } from "./music.ts";
import { PLAN_VIBRATO } from "./character.ts";
import type { MoppetVoice } from "./voices.ts";

import { beatSeconds, LEAD_IN } from "./timeline.ts";
export { beatSeconds, LEAD_IN, pieceSeconds, TAIL } from "./timeline.ts";

export interface TrackPlan {
  id: string;
  gestures: Gesture[];
  firstMidi: number;
  /** when this singer's last gesture has finished (s, on the timeline) */
  end: number;
  /** this piece lets the voice's velum recipe colour its vowels */
  nasal: boolean;
}

/**
 * A sung line's syllables, with its holds: `_` straight after a syllable holds its vowel onto one
 * more note per mark ("ma_ny" sings ma-a-ny over three notes, "made__" holds "made" over three).
 * The engine's own mark, a lone "-" or "~" between words, holds the syllable before it too.
 * A hold is a melisma syllable: the vowel carries on to the next note's pitch, and the held
 * syllable's closing consonants wait for the last of its notes.
 */
export function sungSyllables(text: string): Syllable[] {
  if (!text.includes("_")) return lyricsToSyllables(text);
  const syl = lyricsToSyllables(text.replace(/_/g, ""));
  // where each mark falls: the syllable that ends at or after the letters before it, per word
  const holds: number[] = []; // after which syllable, once per mark
  let base = 0;
  for (const word of text.match(/[A-Za-z'][A-Za-z'\-_]*/g) ?? []) {
    const clean = word.replace(/_/g, "");
    const pieces = lyricsToSyllables(clean).map((s) => s.text.length);
    let letters = 0;
    for (const ch of word) {
      if (ch !== "_") {
        letters++;
        continue;
      }
      let k = 0, end = pieces[0] ?? 0;
      while (k < pieces.length - 1 && end < letters) end += pieces[++k];
      holds.push(base + k);
    }
    base += pieces.length;
  }
  if (base !== syl.length) throw new Error(`can't place the holds in "${text}"`);
  const out: Syllable[] = [];
  syl.forEach((s, i) => {
    const n = holds.filter((h) => h === i).length;
    out.push(n ? { ...s, phraseEnd: false } : s);
    for (let j = 0; j < n; j++) out.push({ text: "~", onset: [], nucleus: s.nucleus, coda: [], melisma: true, wordEnd: s.wordEnd, phraseEnd: j === n - 1 && s.phraseEnd });
  });
  return out;
}

/** The syllables of one phrase of contiguous notes (each word's stress and syllable breaks come from the planner). */
function phraseSyllables(track: Track, group: ScoreEvent[]): Syllable[] {
  const fromLine = group[0].line !== undefined && track.phrases !== undefined && group.every((e) => e.line === group[0].line);
  if (fromLine) {
    const syl = sungSyllables(track.phrases![group[0].line!]);
    if (syl.length !== group.length) throw new Error(`${track.id}: expected ${group.length} syllables, got ${syl.length}: ${syl.map((s) => s.text).join(" ")}`);
    return syl;
  }
  return group.map((e) => {
    const list = lyricsToSyllables(e.text);
    if (list.length !== 1) throw new Error(`${track.id}: expected one syllable for "${e.text}", found ${list.length}`);
    return list[0];
  });
}

/** The dictionary lives in the engine, one per page: any instance reads it (load it before planning). */
const g2p = new EnglishG2P();

/**
 * A skit's lines, spoken: each line through the speech planner at the Moppet's speaking pitch,
 * starting on its beat and sped up only if the planner's natural pace would run past its slot.
 */
function planSpeech(track: Track, piece: Piece, v: MoppetVoice): TrackPlan {
  const gestures: Gesture[] = [];
  const beat = beatSeconds(piece);
  let end = LEAD_IN;
  for (const e of track.events) {
    const phrases = g2p.toPhrases(e.text);
    if (!phrases.length) continue;
    const t0 = LEAD_IN + e.beat * beat, slot = e.beats * beat;
    const opts = { body: v.body, t0, f0: midiToHz(e.midi) };
    let plan = planPhrases(phrases, opts);
    if (plan.end - t0 > slot) plan = planPhrases(phrases, { ...opts, rate: Math.min(1.6, (plan.end - t0) / slot) });
    gestures.push(...plan.gestures);
    end = Math.max(end, plan.end + 0.3);
  }
  return { id: track.id, gestures, firstMidi: track.events[0].midi, end, nasal: true };
}

export function planTrack(track: Track, piece: Piece, v: MoppetVoice): TrackPlan {
  if (piece.kind === "skit") return planSpeech(track, piece, v);
  const gestures: Gesture[] = [];
  const beat = beatSeconds(piece);
  const nasal = piece.kind === "intro" || piece.kind === "solo";
  let group: ScoreEvent[] = [];
  let end = LEAD_IN;
  const flush = () => {
    if (!group.length) return;
    const syllables = phraseSyllables(track, group);
    const notes = group.map((e, i) => ({ midi: e.midi, beats: e.beats, syl: syllables[i] }));
    // Release sustained lyric endings a quarter beat early so the next singer has a clean entrance.
    const lastNote = notes[notes.length - 1];
    if (piece.title === "Found Things" && group[0].line !== undefined && lastNote.beats >= 1 && group.length > 1 && group[group.length - 1].beat + lastNote.beats < piece.beats) {
      lastNote.beats -= 0.25;
    }
    const plan = planSong(notes, { body: v.body, bpm: piece.bpm, t0: LEAD_IN + group[0].beat * beat, vibrato: PLAN_VIBRATO });
    gestures.push(...plan.gestures);
    end = Math.max(end, plan.end + 0.3);
    group = [];
  };
  for (const e of track.events) {
    const last = group[group.length - 1];
    if (last && (Math.abs(last.beat + last.beats - e.beat) > 1e-6 || (track.phrases && last.line !== e.line))) flush();
    group.push(e);
  }
  flush();
  return { id: track.id, gestures, firstMidi: track.events[0].midi, end, nasal };
}
