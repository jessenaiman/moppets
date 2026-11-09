/**
 * Score → gestures, through the engine's own lyric and singing planners (main thread: they
 * allocate). Melody and timing come from the score; how a Moppet colours them is character.ts.
 */
import { lyricsToSyllables, planSong } from "../wasm/engine.ts";
import type { Gesture, Syllable } from "../wasm/types.ts";
import type { Piece, ScoreEvent, Track } from "./music.ts";
import { PLAN_VIBRATO } from "./character.ts";
import type { MoppetVoice } from "./voices.ts";

/** Silence on the timeline before beat 0, so the first onset's consonant has room. */
export const LEAD_IN = 0.4;
/** Tail after the last beat for the final release to ring out. */
export const TAIL = 0.6;

export const beatSeconds = (piece: Piece) => 60 / piece.bpm;
export const pieceSeconds = (piece: Piece) => LEAD_IN + piece.beats * beatSeconds(piece) + TAIL;

export interface TrackPlan {
  id: string;
  gestures: Gesture[];
  firstMidi: number;
  /** when this singer's last gesture has finished (s, on the timeline) */
  end: number;
  /** this piece lets the voice's velum recipe colour its vowels */
  nasal: boolean;
}

/** The syllables of one phrase of contiguous notes (each word's stress and syllable breaks come from the planner). */
function phraseSyllables(track: Track, group: ScoreEvent[]): Syllable[] {
  const fromLine = group[0].line !== undefined && track.phrases !== undefined && group.every((e) => e.line === group[0].line);
  if (fromLine) {
    const syl = lyricsToSyllables(track.phrases![group[0].line!]);
    if (syl.length !== group.length) throw new Error(`${track.id}: expected ${group.length} syllables, got ${syl.length}: ${syl.map((s) => s.text).join(" ")}`);
    return syl;
  }
  return group.map((e) => {
    const list = lyricsToSyllables(e.text);
    if (list.length !== 1) throw new Error(`${track.id}: expected one syllable for "${e.text}", found ${list.length}`);
    return list[0];
  });
}

export function planTrack(track: Track, piece: Piece, v: MoppetVoice): TrackPlan {
  const gestures: Gesture[] = [];
  const beat = beatSeconds(piece);
  const nasal = piece.kind === "intro" || piece.kind === "solo";
  let group: ScoreEvent[] = [];
  let end = LEAD_IN;
  const flush = () => {
    if (!group.length) return;
    const syllables = phraseSyllables(track, group);
    const notes = group.map((e, i) => ({ midi: e.midi, beats: e.beats, syl: syllables[i] }));
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
