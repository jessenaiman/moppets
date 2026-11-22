import { beatsPerBar } from "../choir/meter.ts";
import type { Chord, ScoreEvent } from "../choir/music.ts";
import { buildSong } from "../choir/songbook.ts";
import { catalogSong } from "../choir/songs.ts";
import { CAST } from "../choir/voices.ts";

export type AuditionPartId = "gruff" | "vee" | "scribe" | "pip" | "tabby" | "zap" | "clank";

export interface AuditionEdit {
  pitchSemitones?: number;
  entranceBeats?: number;
}

export type AuditionEdits = Partial<Record<AuditionPartId, AuditionEdit>>;
export type AuditionNote = Pick<ScoreEvent, "beat" | "beats" | "midi" | "text" | "line">;

export interface AuditionPart {
  id: AuditionPartId;
  label: string;
  notes: AuditionNote[];
  pitchSemitones: number;
  entranceBeats: number;
  beatbox?: { text: string; swing: number };
}

export interface AuditionLyric {
  beat: number;
  beats: number;
  text: string;
}

export interface AuditionScore {
  title: string;
  bpm: number;
  startBeat: number;
  beats: number;
  writtenBeats: number;
  beatsPerBar: number;
  chords: Chord[];
  parts: AuditionPart[];
  lyrics: AuditionLyric[];
  conflicts: string[];
}

const partIds: readonly AuditionPartId[] = ["gruff", "vee", "scribe", "pip", "tabby", "zap", "clank"];

function readChorus() {
  const song = catalogSong("gruff");
  const chorus = song.sections.find(section => section.name === "chorus");
  if (!chorus) throw new Error("Left in the Workshop is missing its first chorus");

  // Vee's figure supplies the written bass in this chorus.
  const bass = chorus.choir && song.bass && song.figures?.[song.bass] &&
    song.seats.some(([id]) => id === song.bass) ? "none" : song.bass;
  const piece = buildSong({ ...song, sections: [chorus], bass, finale: undefined });
  const start = beatsPerBar(piece.meter);
  const lyrics: AuditionLyric[] = [];
  let beat = 0;
  for (const line of chorus.lines) {
    if ("rest" in line) {
      beat += line.rest;
      continue;
    }
    const beats = line.rhythm.reduce((total, length) => total + length, 0);
    lyrics.push({ beat, beats, text: line.words });
    beat += beats + (song.breath ?? 0);
  }
  return {
    title: piece.title,
    bpm: piece.bpm,
    beatbox: piece.beat,
    writtenBeats: piece.beats - start,
    beatsPerBar: start,
    chords: piece.chords.filter(chord => chord.beat >= start).map(chord => ({ ...chord, beat: chord.beat - start })),
    lyrics,
    parts: partIds.map(id => ({
      id,
      label: CAST.find(voice => voice.id === id)?.name ?? id,
      notes: (piece.tracks.find(track => track.id === id)?.events ?? [])
        .filter(note => note.beat >= start)
        .map(({ beat, beats, midi, text, line }) => ({ beat: beat - start, beats, midi, text, line })),
    })),
  };
}

export function buildAuditionScore(edits: AuditionEdits = {}): AuditionScore {
  const { beatbox, parts: writtenParts, lyrics, ...score } = readChorus();
  const conflicts: string[] = [];
  let startBeat = 0;
  let beats = score.writtenBeats;
  const parts = writtenParts.map(part => {
    const { pitchSemitones = 0, entranceBeats = 0 } = edits[part.id] ?? {};
    const notes = part.notes.map(note => ({ ...note, beat: note.beat + entranceBeats, midi: note.midi + pitchSemitones }));
    const beatboxPart = part.id === "zap" ? beatbox : undefined;
    let latestEnd = -Infinity;
    for (const note of notes) {
      if (note.beat < latestEnd - 1e-6) {
        const bar = 1 + Math.floor((note.beat - entranceBeats) / score.beatsPerBar);
        const message = `${part.label} has overlapping notes in bar ${bar}.`;
        if (!conflicts.includes(message)) conflicts.push(message);
      }
      startBeat = Math.min(startBeat, note.beat);
      latestEnd = Math.max(latestEnd, note.beat + note.beats);
    }
    beats = Math.max(beats, latestEnd);
    if (beatboxPart) {
      startBeat = Math.min(startBeat, entranceBeats);
      beats = Math.max(beats, entranceBeats + score.writtenBeats);
    }
    return { ...part, notes, pitchSemitones, entranceBeats, beatbox: beatboxPart };
  });
  const leadEntrance = edits.gruff?.entranceBeats ?? 0;
  return { ...score, startBeat, beats, parts, lyrics: lyrics.map(line => ({ ...line, beat: line.beat + leadEntrance })), conflicts };
}
