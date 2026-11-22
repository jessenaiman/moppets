import type { BandNote, BandPart } from "./band.ts";
import type { Piece } from "./music.ts";

/** A syncopated bass riff and offbeat keys around Neon's native beatbox. */
export function neonBand(piece: Piece): BandPart[] {
  const bass: BandNote[] = [];
  const keys: BandNote[] = [];
  const near = (pitchClass: number, floor: number) => floor + (pitchClass - floor + 120) % 12;
  const bassRiff = [[0, 0.65, 0, 100], [0.75, 0.4, 0, 72], [1.5, 0.45, 2, 86], [2, 0.7, 0, 96], [3.5, 0.33, 2, 82]];
  const bridgeStart = piece.sections?.find(section => section.name === "the dark")?.beat;
  for (const chord of piece.chords) {
    const finale = piece.sections?.at(-1)?.name === "Finale" && chord.beat === piece.sections.at(-1)?.beat;
    if (finale) {
      bass.push({ beat: chord.beat, beats: chord.beats, midi: near(chord.tones[0], 38), vel: 98 });
      for (const tone of chord.tones) keys.push({ beat: chord.beat, beats: chord.beats, midi: near(tone, 60), vel: 76 });
      continue;
    }
    if (bridgeStart !== undefined && chord.beat >= bridgeStart && chord.beat < bridgeStart + 8) {
      bass.push({ beat: chord.beat, beats: chord.beats * 0.6, midi: near(chord.tones[0], 38), vel: 82 });
      continue;
    }
    for (const [offset, duration, tone, vel] of bassRiff) {
      if (offset >= chord.beats) break;
      bass.push({ beat: chord.beat + offset, beats: Math.min(duration, chord.beats - offset), midi: near(chord.tones[tone], 38), vel });
    }
    for (const offset of [1.25, 2.75, 3.5]) {
      if (offset >= chord.beats) break;
      for (const tone of chord.tones.slice(1)) {
        keys.push({ beat: chord.beat + offset, beats: Math.min(0.23, chord.beats - offset), midi: near(tone, 60), vel: offset === 2.75 ? 89 : 75 });
      }
    }
  }
  return [
    { id: "bass", channel: 10, program: 33, notes: bass },
    { id: "keys", channel: 11, program: 4, notes: keys },
  ];
}
