/**
 * Score → gestures, through the engine's own lyric and singing planners (main thread: they
 * allocate). Melody and timing come from the score; how a Moppet colours them is character.ts.
 */
import { EnglishG2P, lyricsToSyllables, planPhrases, planSong } from "../wasm/engine.ts";
import { midiToHz } from "./singerCore.ts";
import type { Gesture, Syllable } from "../wasm/types.ts";
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
